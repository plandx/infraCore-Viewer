"""infraCore-Viewer — lokaler Python/IfcOpenShell-Companion-Server

Start (einmalig reicht):
    python server/server.py

Beim ersten Start werden alle Abhängigkeiten automatisch in server/vendor/
installiert — kein manuelles pip install notwendig.

Der Server läuft auf http://127.0.0.1:8765 (nur localhost).
"""

# ── Bootstrap: Abhängigkeiten automatisch installieren ────────────────────────
import subprocess
import sys
from pathlib import Path

_HERE    = Path(__file__).parent.resolve()
_VENDOR  = _HERE / "vendor"
_MARKER  = _VENDOR / ".bootstrap_ok"
_REQS    = _HERE / "requirements.txt"

def _bootstrap() -> None:
    if _MARKER.exists():
        sys.path.insert(0, str(_VENDOR))
        return

    print("=" * 60)
    print("infraCore: Erster Start — installiere Python-Bibliotheken …")
    print(f"  Ziel: {_VENDOR}")
    print("  (dauert ca. 30–60 Sekunden, danach sofortiger Start)")
    print("=" * 60, flush=True)

    _VENDOR.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            sys.executable, "-m", "pip", "install",
            "--target", str(_VENDOR),
            "--requirement", str(_REQS),
            "--no-cache-dir",
        ],
        capture_output=False,
    )
    if result.returncode != 0:
        print("\n[FEHLER] Installation fehlgeschlagen.", file=sys.stderr)
        print("Bitte manuell ausführen:", file=sys.stderr)
        print(f"  pip install -r {_REQS}", file=sys.stderr)
        sys.exit(1)

    _MARKER.touch()
    sys.path.insert(0, str(_VENDOR))
    print("\n✓ Installation abgeschlossen — Server startet …\n", flush=True)

_bootstrap()

# ── Ab hier normale Imports (aus vendor/ oder System) ─────────────────────────

import io
import tempfile
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any, Dict, List, Optional, Set

import ifcopenshell
import ifcopenshell.util.element
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="infraCore Python Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory model store: display-name → ifcopenshell.file
_models: Dict[str, ifcopenshell.file] = {}

# Pre-computed index for fast element-to-model identification:
#   _model_eids[name]  = set of express-IDs in that model
#   _model_guids[name] = {express_id: GlobalId} for IfcRoot elements
_model_eids:  Dict[str, Set[int]]        = {}
_model_guids: Dict[str, Dict[int, str]]  = {}


def _index_model(name: str, model: ifcopenshell.file) -> None:
    """Build express-ID and GlobalId index for fast cross-model identification."""
    eids: Set[int] = set()
    guids: Dict[int, str] = {}
    for entity in model:
        eid = entity.id()
        eids.add(eid)
        guid = getattr(entity, "GlobalId", None)
        if guid:
            guids[eid] = guid
    _model_eids[name]  = eids
    _model_guids[name] = guids


def _ov_model_name(ov: Any, candidate_names: List[str]) -> Optional[str]:
    """Identify which model (among candidates) the entity_instance ov belongs to.

    Uses GlobalId (GUID) for disambiguation when multiple models share the
    same express ID — which is common because IFC express IDs are file-local.
    """
    eid     = ov.id()
    guid_ov = getattr(ov, "GlobalId", None)

    hits = [n for n in candidate_names if eid in _model_eids.get(n, set())]

    if len(hits) == 1:
        return hits[0]

    if len(hits) > 1 and guid_ov:
        for n in hits:
            if _model_guids.get(n, {}).get(eid) == guid_ov:
                return n

    return hits[0] if hits else None


def _by_type_safe(model: ifcopenshell.file, ifc_type: str) -> list:
    """Call model.by_type with include_subtypes=True, fall back to default."""
    try:
        return model.by_type(ifc_type, include_subtypes=True)
    except TypeError:
        return model.by_type(ifc_type)
    except Exception as exc:
        print(f"[clash] by_type({ifc_type}) fehlgeschlagen: {exc}", flush=True)
        return []


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "models": list(_models.keys())}


@app.get("/models")
def list_models():
    return {"models": list(_models.keys())}


@app.post("/upload")
async def upload_model(name: str = Form(...), file: UploadFile = File(...)):
    """Browser schickt IFC-Bytes; der Server lädt sie mit IfcOpenShell."""
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        model = ifcopenshell.open(tmp_path)
    except Exception as exc:
        Path(tmp_path).unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    Path(tmp_path).unlink(missing_ok=True)
    _models[name] = model
    _index_model(name, model)
    entity_count = len(list(model))
    print(f"[upload] '{name}' geladen — {entity_count} Entitäten", flush=True)
    return {"name": name, "entity_count": entity_count}


@app.delete("/models/{name}")
def delete_model(name: str):
    if name not in _models:
        raise HTTPException(status_code=404, detail="Model not found")
    del _models[name]
    _model_eids.pop(name, None)
    _model_guids.pop(name, None)
    print(f"[delete] '{name}' entfernt", flush=True)
    return {"deleted": name}


@app.get("/download/{name}")
def download_model(name: str):
    """Serialisiert das (ggf. modifizierte) Modell als IFC-Datei zurück an den Browser."""
    if name not in _models:
        raise HTTPException(status_code=404, detail="Model not found")
    model = _models[name]
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        model.write(tmp_path)
        data = Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    safe_name = name.encode("utf-8").decode("latin-1", errors="replace")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# ── Clash Detection ────────────────────────────────────────────────────────────

class PropCondition(BaseModel):
    prop_name: str
    operator: str   # "contains" | "equals" | "startsWith" | "notEmpty"
    value: str = ""

class ClashComponentFilter(BaseModel):
    ifc_types: List[str] = []       # empty → all IfcProduct subtypes
    model_names: List[str] = []     # empty → all loaded models
    conditions: List[PropCondition] = []  # property filter conditions (AND-combined)

class ClashRulePayload(BaseModel):
    id: str
    name: str
    severity: str = "warning"       # "error" | "warning" | "info"
    check_type: str = "hard-clash"  # "hard-clash" | "clearance" | "duplicate"
    tolerance: float = 0.0
    set_a: ClashComponentFilter
    set_b: ClashComponentFilter

class ClashPayload(BaseModel):
    rules: List[ClashRulePayload]


def _get_all_pset_props(elem: Any) -> Dict[str, str]:
    """Collect all Pset / property values for an element as a flat dict.

    Keys: "PsetName.PropertyName" and bare "PropertyName".
    Values: string representation of the nominal value.
    """
    props: Dict[str, str] = {}
    try:
        psets = ifcopenshell.util.element.get_psets(elem)
        for pset_name, pset_dict in psets.items():
            for k, v in pset_dict.items():
                if k == "id":
                    continue
                sv = str(v) if v is not None else ""
                props[f"{pset_name}.{k}"] = sv
                # Also index by bare key (last-write-wins for duplicates)
                props[k] = sv
    except Exception:
        pass
    # Direct attributes (Name, Description, ObjectType, Tag, …)
    for attr in ("Name", "Description", "ObjectType", "Tag", "LongName"):
        v = getattr(elem, attr, None)
        if v is not None:
            props[attr] = str(v)
    return props


def _match_condition(props: Dict[str, str], cond: PropCondition) -> bool:
    """Return True if the element's properties satisfy the condition."""
    val = props.get(cond.prop_name, "")
    cv = cond.value
    op = cond.operator
    if op == "notEmpty":
        return bool(val.strip())
    if op == "equals":
        return val == cv
    if op == "contains":
        return cv.lower() in val.lower()
    if op == "startsWith":
        return val.lower().startswith(cv.lower())
    return True


def _filter_by_conditions(elems: list, conditions: List[PropCondition]) -> list:
    """Return subset of elems that satisfy ALL conditions (AND logic)."""
    if not conditions:
        return elems
    result = []
    for elem in elems:
        props = _get_all_pset_props(elem)
        if all(_match_condition(props, c) for c in conditions):
            result.append(elem)
    return result


@app.post("/clash")
def run_clash(req: ClashPayload):
    """Kollisionsprüfung via ifcopenshell.geom clash_*_many APIs (IfcOpenShell 0.8.x).

    Pro A×B-Modellpaar wird ein BVH-Baum mit AUSSCHLIESSLICH den relevanten
    Elementen beider Sets gebaut (iterator mit include=[…]).  Danach rufen wir
    clash_collision_many / clash_clearance_many / clash_intersection_many auf —
    das korrekte IfcOpenShell 0.8.x-API statt des nicht-existenten add_element().
    """
    import ifcopenshell.geom

    if not _models:
        print("[clash] Keine Modelle geladen!", flush=True)
        return {"results": [], "count": 0}

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    all_results: List[Dict[str, Any]] = []

    for rule in req.rules:
        print(f"\n[clash] === Regel '{rule.name}' ({rule.check_type}, tol={rule.tolerance}) ===", flush=True)

        types_a = rule.set_a.ifc_types or ["IfcProduct"]
        types_b = rule.set_b.ifc_types or ["IfcProduct"]
        seen: set = set()

        models_a = {n: m for n, m in _models.items()
                    if not rule.set_a.model_names or n in rule.set_a.model_names}
        models_b = {n: m for n, m in _models.items()
                    if not rule.set_b.model_names or n in rule.set_b.model_names}

        if not models_a or not models_b:
            print("[clash] Keine Modelle für A oder B — übersprungen", flush=True)
            continue

        for mname_a, model_a in models_a.items():
            elems_a: list = []
            for t in types_a:
                elems_a.extend(_by_type_safe(model_a, t))
            # Apply property conditions (AND logic) to Set-A
            elems_a = _filter_by_conditions(elems_a, rule.set_a.conditions)
            if not elems_a:
                print(f"[clash] Set-A '{mname_a}': keine Elemente nach Typ+Kondition-Filter — übersprungen", flush=True)
                continue
            cond_a_str = f", {len(rule.set_a.conditions)} Kond." if rule.set_a.conditions else ""
            print(f"[clash] Set-A '{mname_a}': {len(elems_a)} Elemente ({', '.join(types_a[:3])}{'…' if len(types_a) > 3 else ''}{cond_a_str})", flush=True)

            for mname_b, model_b in models_b.items():
                elems_b: list = []
                for t in types_b:
                    elems_b.extend(_by_type_safe(model_b, t))
                # Apply property conditions (AND logic) to Set-B
                elems_b = _filter_by_conditions(elems_b, rule.set_b.conditions)
                if not elems_b:
                    print(f"[clash] Set-B '{mname_b}': keine Elemente nach Typ+Kondition-Filter — übersprungen", flush=True)
                    continue
                cond_b_str = f", {len(rule.set_b.conditions)} Kond." if rule.set_b.conditions else ""
                print(f"[clash] Set-B '{mname_b}': {len(elems_b)} Elemente ({', '.join(types_b[:3])}{'…' if len(types_b) > 3 else ''}{cond_b_str})", flush=True)

                # ── BVH-Baum mit Set-B-Elementen aufbauen ────────────────
                # Für same-model: Ein Iterator mit A∪B (damit select(elem_a)
                # den Baum nach dem Modell kennt und tessellieren kann).
                # Für cross-model: Zwei Iteratoren — A-Iterator registriert
                # das Modell so dass select(elem_a) funktioniert.
                b_tree = ifcopenshell.geom.tree()
                try:
                    if model_a is model_b:
                        ids_seen: set = set()
                        combined: list = []
                        for e in elems_a + elems_b:
                            if e.id() not in ids_seen:
                                ids_seen.add(e.id())
                                combined.append(e)
                        b_tree.add_iterator(
                            ifcopenshell.geom.iterator(geo_settings, model_a, include=combined)
                        )
                    else:
                        # A-Iterator: registriert model_a für select()-Tessellierung
                        b_tree.add_iterator(
                            ifcopenshell.geom.iterator(geo_settings, model_a, include=elems_a)
                        )
                        # B-Iterator: die eigentlichen Such-Elemente
                        b_tree.add_iterator(
                            ifcopenshell.geom.iterator(geo_settings, model_b, include=elems_b)
                        )
                except Exception as exc:
                    print(f"[clash] Baum-Aufbau fehlgeschlagen ('{mname_a}' × '{mname_b}'): {exc}", flush=True)
                    continue

                # select()-Radius je nach Prüftyp:
                #   hard-clash  → 0 (nur echte AABB-Überschneidung)
                #   clearance   → Mindestabstand (Elemente innerhalb dieser Distanz)
                #   duplicate   → Toleranz (Elemente nahezu deckungsgleich)
                if rule.check_type == "clearance":
                    extend = rule.tolerance if rule.tolerance > 0 else 0.05
                elif rule.check_type == "duplicate":
                    extend = rule.tolerance if rule.tolerance > 0 else 0.002
                else:
                    extend = 0.0  # hard-clash: reiner AABB-Schnitt

                elems_b_ids: set = {e.id() for e in elems_b}

                before = len(all_results)
                for elem_a in elems_a:
                    eid_a = elem_a.id()
                    try:
                        candidates = b_tree.select(elem_a, extend=extend)
                    except Exception as exc:
                        print(f"[clash] select() Fehler für #{eid_a}: {exc}", flush=True)
                        continue

                    for cand in candidates:
                        eid_b = cand.id()

                        # Selbst-Kollision überspringen
                        if mname_a == mname_b and eid_a == eid_b:
                            continue

                        # Nur Set-B-Elemente berücksichtigen
                        if eid_b not in elems_b_ids:
                            continue

                        pair = tuple(sorted([(mname_a, eid_a), (mname_b, eid_b)]))
                        if pair in seen:
                            continue
                        seen.add(pair)

                        all_results.append({
                            "rule_id":      rule.id,
                            "rule_name":    rule.name,
                            "severity":     rule.severity,
                            "check_type":   rule.check_type,
                            "model_name_a": mname_a,
                            "express_id_a": eid_a,
                            "name_a":       getattr(elem_a, "Name", None) or "",
                            "type_a":       elem_a.is_a(),
                            "model_name_b": mname_b,
                            "express_id_b": eid_b,
                            "name_b":       getattr(cand, "Name", None) or "",
                            "type_b":       cand.is_a(),
                            "overlap":      0.0,
                        })

                print(f"[clash] '{mname_a}' × '{mname_b}': {len(all_results) - before} Treffer", flush=True)

        rule_total = sum(1 for r in all_results if r["rule_id"] == rule.id)
        print(f"[clash] Regel '{rule.name}': {rule_total} Treffer gesamt", flush=True)

    print(f"\n[clash] Gesamt: {len(all_results)} Kollisionen\n", flush=True)
    return {"results": all_results, "count": len(all_results)}


# ── Clash Diagnose ─────────────────────────────────────────────────────────────

@app.get("/clash/test")
def clash_test():
    """Schnell-Diagnose: prüft ob Geometrie-Tessellierung und select() funktionieren."""
    import ifcopenshell.geom

    if not _models:
        return {"error": "Keine Modelle geladen. Bitte zuerst IFC-Dateien hochladen."}

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    report = {}
    for mname, model in _models.items():
        products = _by_type_safe(model, "IfcProduct")
        sample = products[:20]
        try:
            tree = ifcopenshell.geom.tree()
            it = ifcopenshell.geom.iterator(geo_settings, model, include=sample)
            tree.add_iterator(it)

            hits = 0
            for e in sample[:5]:
                try:
                    hits += len(tree.select(e, extend=0.5))
                except Exception:
                    pass

            report[mname] = {
                "products_total": len(products),
                "sample_size": len(sample),
                "sample_select_hits": hits,
                "ok": True,
            }
        except Exception as exc:
            report[mname] = {"ok": False, "error": str(exc)}

    return {"models": report}


# ── Script execution ────────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    script: str


@app.post("/execute")
def execute_script(req: ExecuteRequest):
    """Führt ein Python-Skript aus. Verfügbar im Kontext:
    - ifc_models  dict[name, ifcopenshell.file]
    - ifcopenshell
    - ifcopenshell.util.element (als `util`)
    """
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    ctx: dict = {
        "ifc_models": _models,
        "ifcopenshell": ifcopenshell,
        "util": ifcopenshell.util.element,
    }

    error: str | None = None
    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(compile(req.script, "<infracore-script>", "exec"), ctx)  # noqa: S102
    except SystemExit:
        pass
    except Exception:
        error = traceback.format_exc()

    return {
        "stdout": stdout_buf.getvalue(),
        "stderr": stderr_buf.getvalue(),
        "error": error,
    }


if __name__ == "__main__":
    print("infraCore Python Server — http://127.0.0.1:8765")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
