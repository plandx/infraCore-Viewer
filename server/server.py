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

class ClashComponentFilter(BaseModel):
    ifc_types: List[str] = []    # empty → all IfcProduct subtypes
    model_names: List[str] = []  # empty → all loaded models

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


@app.post("/clash")
def run_clash(req: ClashPayload):
    """Kollisionsprüfung via ifcopenshell.geom.tree (OBB-Intersection).

    Strategie: Pro Regel wird EIN gemeinsamer Baum mit ALLEN relevanten Modellen
    gebaut (Set-A ∪ Set-B). Dadurch kann tree.select(elem_a) auch dann tessellieren,
    wenn elem_a aus einem anderen Modell stammt als die Set-B-Elemente.

    Element-zu-Modell-Zuordnung erfolgt über GlobalId (GUID) als primäres Merkmal —
    robust gegen identische Express-IDs in verschiedenen IFC-Dateien.
    """
    import ifcopenshell.geom  # lazy import — not available until bootstrap

    if not _models:
        print("[clash] Keine Modelle geladen!", flush=True)
        return {"results": [], "count": 0}

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    all_results: List[Dict[str, Any]] = []

    for rule in req.rules:
        print(f"\n[clash] === Regel '{rule.name}' ({rule.check_type}, tol={rule.tolerance}) ===", flush=True)

        types_a     = rule.set_a.ifc_types or ["IfcProduct"]
        types_b_set = set(rule.set_b.ifc_types)
        # Use tolerance as BVH extend: catches near-misses and clearances.
        # For hard-clash without tolerance, a tiny epsilon avoids float rounding issues.
        extend = rule.tolerance if rule.tolerance > 0.0 else 1e-4
        seen: set = set()

        models_a = {n: m for n, m in _models.items()
                    if not rule.set_a.model_names or n in rule.set_a.model_names}
        models_b = {n: m for n, m in _models.items()
                    if not rule.set_b.model_names or n in rule.set_b.model_names}

        if not models_a or not models_b:
            print(f"[clash] Keine Modelle für A oder B — übersprungen", flush=True)
            continue

        # ── Build ONE combined tree with all relevant models ──────────────────
        # Critical: adding all models to the same tree lets tree.select(elem_a)
        # tessellate any element regardless of which model it came from.
        combined_tree = ifcopenshell.geom.tree()
        all_relevant = {**models_a, **models_b}
        loaded_in_tree: Set[str] = set()

        for mname, model in all_relevant.items():
            try:
                combined_tree.add_file(model, geo_settings)
                loaded_in_tree.add(mname)
                print(f"[clash] Modell '{mname}' zum Baum hinzugefügt", flush=True)
            except Exception as exc:
                print(f"[clash] add_file für '{mname}' fehlgeschlagen: {exc}", flush=True)

        if not loaded_in_tree:
            print(f"[clash] Kein Modell im Baum — Regel übersprungen", flush=True)
            continue

        b_model_names = [n for n in models_b if n in loaded_in_tree]

        # ── Query Set-A elements ──────────────────────────────────────────────
        for mname_a, model_a in models_a.items():
            if mname_a not in loaded_in_tree:
                continue

            elems_a: list = []
            for t in types_a:
                found = _by_type_safe(model_a, t)
                elems_a.extend(found)

            print(f"[clash] Set-A '{mname_a}': {len(elems_a)} Elemente ({', '.join(types_a[:3])}{'…' if len(types_a)>3 else ''})", flush=True)

            clash_count_rule = 0
            for elem_a in elems_a:
                try:
                    overlapping = combined_tree.select(elem_a, extend=extend)
                except Exception as exc:
                    print(f"[clash] select() fehlgeschlagen für {elem_a.id()}: {exc}", flush=True)
                    continue

                for ov in overlapping:
                    eid_a = elem_a.id()
                    eid_b = ov.id()

                    # Identify which Set-B model ov belongs to
                    mname_b = _ov_model_name(ov, b_model_names)
                    if mname_b is None:
                        continue

                    # Skip self-collision
                    if mname_a == mname_b and eid_a == eid_b:
                        continue

                    # Apply Set-B type filter (tree contains all types)
                    if types_b_set and not any(ov.is_a(t) for t in types_b_set):
                        continue

                    pair = tuple(sorted([(mname_a, eid_a), (mname_b, eid_b)]))
                    if pair in seen:
                        continue
                    seen.add(pair)
                    clash_count_rule += 1

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
                        "name_b":       getattr(ov, "Name", None) or "",
                        "type_b":       ov.is_a(),
                        "overlap":      0.0,
                    })

            print(f"[clash] → {clash_count_rule} neue Treffer aus '{mname_a}'", flush=True)

        rule_total = sum(1 for r in all_results if r["rule_id"] == rule.id)
        print(f"[clash] Regel '{rule.name}': {rule_total} Treffer gesamt", flush=True)

    print(f"\n[clash] Gesamt: {len(all_results)} Kollisionen\n", flush=True)
    return {"results": all_results, "count": len(all_results)}


# ── Clash Diagnose ─────────────────────────────────────────────────────────────

@app.get("/clash/test")
def clash_test():
    """Schnell-Diagnose: prüft ob Geometrie-Tessellierung funktioniert.
    Gibt für jedes geladene Modell zurück wie viele Elemente erfolgreich
    tesselliert werden konnten.
    """
    import ifcopenshell.geom

    if not _models:
        return {"error": "Keine Modelle geladen. Bitte zuerst IFC-Dateien hochladen."}

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    report = {}
    for mname, model in _models.items():
        try:
            tree = ifcopenshell.geom.tree()
            tree.add_file(model, geo_settings)

            products = _by_type_safe(model, "IfcProduct")
            sample_results = 0
            if products:
                # Try select on first 5 elements to verify
                for elem in products[:5]:
                    try:
                        hits = tree.select(elem, extend=0.5)
                        sample_results += len(hits)
                    except Exception:
                        pass

            report[mname] = {
                "products": len(products),
                "sample_select_hits": sample_results,
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
