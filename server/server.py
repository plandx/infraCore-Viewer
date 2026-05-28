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
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

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


# Geometry entry: (aabb_6, obb_c, obb_ax, obb_h)
#   aabb_6  : (xmin,ymin,zmin,xmax,ymax,zmax)  – axis-aligned bounding box
#   obb_c   : np.ndarray (3,)                   – OBB center in world coords
#   obb_ax  : np.ndarray (3,3)                  – OBB axes (columns = axis vectors)
#   obb_h   : np.ndarray (3,)                   – OBB half-extents per axis


def _compute_obb(verts_flat: Any) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute Oriented Bounding Box from tessellated vertex array via PCA."""
    pts = np.array(verts_flat, dtype=np.float64).reshape(-1, 3)
    center = pts.mean(axis=0)
    pts_c = pts - center
    cov = (pts_c.T @ pts_c) / max(len(pts) - 1, 1)
    try:
        _, axes = np.linalg.eigh(cov)   # columns = eigenvectors
    except np.linalg.LinAlgError:
        axes = np.eye(3)
    proj = pts_c @ axes
    lo, hi = proj.min(axis=0), proj.max(axis=0)
    half = (hi - lo) / 2.0
    obb_center = center + axes @ ((lo + hi) / 2.0)
    return obb_center, axes, half


def _tessellate_geoms(
    geo_settings: Any,
    model: Any,
    elems: list,
) -> Dict[int, tuple]:
    """Tessellate elements and return {express_id: (aabb_6, obb_c, obb_ax, obb_h)}."""
    import ifcopenshell.geom

    result: Dict[int, tuple] = {}
    try:
        it = ifcopenshell.geom.iterator(geo_settings, model, include=elems)
    except Exception as exc:
        print(f"[clash] Iterator Fehler: {exc}", flush=True)
        return result

    if not it.initialize():
        return result

    while True:
        try:
            shape = it.get()
            verts = shape.geometry.verts
            if verts:
                xs = verts[0::3]; ys = verts[1::3]; zs = verts[2::3]
                aabb = (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))
                obb_c, obb_ax, obb_h = _compute_obb(verts)
                result[shape.id] = (aabb, obb_c, obb_ax, obb_h)
        except Exception:
            pass
        if not it.next():
            break

    return result


def _aabbs_overlap(a: tuple, b: tuple, extend: float) -> bool:
    """Fast AABB overlap check — coarse filter before OBB test."""
    return (
        a[0] - extend <= b[3] and a[3] + extend >= b[0] and
        a[1] - extend <= b[4] and a[4] + extend >= b[1] and
        a[2] - extend <= b[5] and a[5] + extend >= b[2]
    )


def _obb_overlap_sat(
    c_a: np.ndarray, ax_a: np.ndarray, h_a: np.ndarray,
    c_b: np.ndarray, ax_b: np.ndarray, h_b: np.ndarray,
    extend: float,
) -> bool:
    """OBB–OBB Separating Axis Theorem test (15 axes).

    Returns True if the oriented bounding boxes overlap (or are within
    `extend` of each other). Each OBB is expanded by `extend` in all
    directions before testing.

    Based on the formulation in "Real-Time Collision Detection" (Ericson 2005).
    """
    t = c_b - c_a
    R = ax_a.T @ ax_b          # R[i,j] = ax_a[:,i] · ax_b[:,j]
    absR = np.abs(R) + 1e-9    # small epsilon avoids near-parallel edge degeneracy

    # t projected into OBB A's local frame
    t_a = ax_a.T @ t

    # ── Face normals of OBB A ────────────────────────────────────────────────
    for i in range(3):
        if abs(t_a[i]) > h_a[i] + float(h_b @ absR[i, :]) + extend:
            return False

    # ── Face normals of OBB B ────────────────────────────────────────────────
    t_b = ax_b.T @ t
    for j in range(3):
        if abs(t_b[j]) > float(h_a @ absR[:, j]) + h_b[j] + extend:
            return False

    # ── Cross-product edge axes A[:,ia] × B[:,ib] ───────────────────────────
    for ia in range(3):
        ia1, ia2 = (ia + 1) % 3, (ia + 2) % 3
        for ib in range(3):
            ib1, ib2 = (ib + 1) % 3, (ib + 2) % 3
            ta = abs(t_a[ia2] * R[ia1, ib] - t_a[ia1] * R[ia2, ib])
            ra = h_a[ia1] * absR[ia2, ib] + h_a[ia2] * absR[ia1, ib]
            rb = h_b[ib1] * absR[ia, ib2] + h_b[ib2] * absR[ia, ib1]
            if ta > ra + rb + extend:
                return False

    return True  # no separating axis found → boxes overlap


def _cgal_clash(
    tree: Any,
    elems_a: list,
    elems_b: list,
    check_type: str,
    tolerance: float,
) -> List[tuple]:
    """Run CGAL clash_*_many and return [(elem_a, elem_b, distance), ...].

    Mapping:
      hard-clash + tol=0  → clash_intersection_many  (exact mesh intersection)
      hard-clash + tol>0  → clash_clearance_many(tol) (near-miss within tolerance)
      clearance           → clash_clearance_many(tol)
      duplicate           → clash_clearance_many(tol)
    """
    if check_type == "hard-clash" and tolerance <= 0:
        raw = tree.clash_intersection_many(elems_a, elems_b)
        label = "clash_intersection_many"
    else:
        tol = tolerance if tolerance > 0 else (0.05 if check_type == "clearance" else 0.001)
        try:
            raw = tree.clash_clearance_many(elems_a, elems_b, tol)
        except TypeError:
            raw = tree.clash_clearance_many(elems_a, elems_b, tol, False)
        label = f"clash_clearance_many(tol={tol})"

    pairs = []
    for clash in raw:
        try:
            ea = clash.a if hasattr(clash, "a") else clash[0]
            eb = clash.b if hasattr(clash, "b") else clash[1]
            pairs.append((ea, eb, float(getattr(clash, "distance", 0.0))))
        except Exception:
            pass

    print(f"[clash] CGAL {label}: {len(raw)} Roh-Paare → {len(pairs)} verarbeitbar", flush=True)
    return pairs


def _aabb_obb_clash(
    geoms_a: Dict[int, tuple],
    geoms_b: Dict[int, tuple],
    model_a: Any,
    model_b: Any,
    check_type: str,
    tolerance: float,
) -> List[tuple]:
    """Fallback: AABB coarse + OBB/SAT fine filter. Returns [(ea, eb, 0.0), ...]."""
    extend = tolerance if tolerance >= 0 else 0.0
    use_obb = check_type in ("hard-clash", "clearance")

    pairs = []
    for eid_a, (aabb_a, obb_ca, obb_axa, obb_ha) in geoms_a.items():
        for eid_b, (aabb_b, obb_cb, obb_axb, obb_hb) in geoms_b.items():
            if model_a is model_b and eid_a == eid_b:
                continue
            if not _aabbs_overlap(aabb_a, aabb_b, extend):
                continue
            if use_obb and not _obb_overlap_sat(obb_ca, obb_axa, obb_ha, obb_cb, obb_axb, obb_hb, extend):
                continue
            pairs.append((model_a.by_id(eid_a), model_b.by_id(eid_b), 0.0))

    return pairs


@app.post("/clash")
def run_clash(req: ClashPayload):
    """Kollisionsprüfung im IfcClash-Stil.

    Primär: CGAL clash_intersection_many / clash_clearance_many — echte
    Dreiecks-Geometrie wie in IfcClash / BlenderBIM.

    Same-model: Datei zweimal als separate file-Objekte laden, damit der
    C++-interne same-file-Skip nicht greift.

    Fallback: AABB-Grobfilter + OBB/SAT-Feinfilter (numpy PCA), falls CGAL
    eine Exception wirft.

    Toleranz:
      hard-clash + tol=0  → clash_intersection_many (exakter Schnitt)
      hard-clash + tol>0  → clash_clearance_many(tol) (auch Beinahe-Treffer)
      clearance / dup     → clash_clearance_many(tol)
    """
    import ifcopenshell.geom

    if not _models:
        print("[clash] Keine Modelle geladen!", flush=True)
        return {"results": [], "count": 0}

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    all_results: List[Dict[str, Any]] = []

    for rule in req.rules:
        print(
            f"\n[clash] === Regel '{rule.name}' ({rule.check_type}, tol={rule.tolerance}) ===",
            flush=True,
        )

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
            elems_a = _filter_by_conditions(elems_a, rule.set_a.conditions)
            if not elems_a:
                print(f"[clash] Set-A '{mname_a}': keine Elemente — übersprungen", flush=True)
                continue
            cond_a_str = f", {len(rule.set_a.conditions)} Kond." if rule.set_a.conditions else ""
            print(
                f"[clash] Set-A '{mname_a}': {len(elems_a)} Elemente"
                f" ({', '.join(types_a[:3])}{'…' if len(types_a) > 3 else ''}{cond_a_str})",
                flush=True,
            )

            for mname_b, model_b in models_b.items():
                elems_b: list = []
                for t in types_b:
                    elems_b.extend(_by_type_safe(model_b, t))
                elems_b = _filter_by_conditions(elems_b, rule.set_b.conditions)
                if not elems_b:
                    print(f"[clash] Set-B '{mname_b}': keine Elemente — übersprungen", flush=True)
                    continue
                cond_b_str = f", {len(rule.set_b.conditions)} Kond." if rule.set_b.conditions else ""
                print(
                    f"[clash] Set-B '{mname_b}': {len(elems_b)} Elemente"
                    f" ({', '.join(types_b[:3])}{'…' if len(types_b) > 3 else ''}{cond_b_str})",
                    flush=True,
                )

                # ── Same-model: load second copy to bypass C++ same-file skip ──
                _tmp_copy = None
                if model_a is model_b:
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
                            tmp_path = tmp.name
                        model_a.write(tmp_path)
                        _tmp_copy = ifcopenshell.open(tmp_path)
                        model_b_w = _tmp_copy
                        elems_b_w = [model_b_w.by_id(e.id()) for e in elems_b]
                        print(
                            f"[clash] Same-model: Kopie geladen"
                            f" (ptr_a={id(model_a)}, ptr_b={id(model_b_w)})",
                            flush=True,
                        )
                    except Exception as exc:
                        print(f"[clash] Kopie fehlgeschlagen: {exc} — übersprungen", flush=True)
                        continue
                    finally:
                        if tmp_path:
                            Path(tmp_path).unlink(missing_ok=True)
                else:
                    model_b_w = model_b
                    elems_b_w = elems_b

                # ── Build BVH tree ───────────────────────────────────────────
                b_tree = ifcopenshell.geom.tree()
                tree_ok = True
                try:
                    b_tree.add_iterator(
                        ifcopenshell.geom.iterator(geo_settings, model_a, include=elems_a)
                    )
                    b_tree.add_iterator(
                        ifcopenshell.geom.iterator(geo_settings, model_b_w, include=elems_b_w)
                    )
                except Exception as exc:
                    print(f"[clash] Baum-Aufbau fehlgeschlagen: {exc}", flush=True)
                    tree_ok = False

                # ── Primary: CGAL clash_*_many ───────────────────────────────
                raw_pairs: List[tuple] = []
                cgal_ok = False
                if tree_ok:
                    try:
                        raw_pairs = _cgal_clash(
                            b_tree, elems_a, elems_b_w,
                            rule.check_type, rule.tolerance,
                        )
                        cgal_ok = True
                    except Exception as exc:
                        print(f"[clash] CGAL fehlgeschlagen: {exc}", flush=True)

                # ── Fallback: AABB + OBB/SAT ────────────────────────────────
                if not cgal_ok:
                    print("[clash] Fallback: AABB + OBB/SAT", flush=True)
                    geoms_a = _tessellate_geoms(geo_settings, model_a, elems_a)
                    geoms_b = _tessellate_geoms(geo_settings, model_b, elems_b)
                    raw_pairs = _aabb_obb_clash(
                        geoms_a, geoms_b, model_a, model_b,
                        rule.check_type, rule.tolerance,
                    )
                    print(f"[clash] AABB+OBB Fallback: {len(raw_pairs)} Paare", flush=True)

                # ── Deduplicate and build results ────────────────────────────
                before = len(all_results)
                for ea, eb, dist in raw_pairs:
                    eid_a = ea.id()
                    eid_b = eb.id()

                    if mname_a == mname_b and eid_a == eid_b:
                        continue

                    pair = tuple(sorted([(mname_a, eid_a), (mname_b, eid_b)]))
                    if pair in seen:
                        continue
                    seen.add(pair)

                    # eb may be from the copy; get original for name/type
                    eb_orig = model_b.by_id(eid_b) if _tmp_copy is not None else eb

                    all_results.append({
                        "rule_id":      rule.id,
                        "rule_name":    rule.name,
                        "severity":     rule.severity,
                        "check_type":   rule.check_type,
                        "model_name_a": mname_a,
                        "express_id_a": eid_a,
                        "name_a":       getattr(ea, "Name", None) or "",
                        "type_a":       ea.is_a(),
                        "model_name_b": mname_b,
                        "express_id_b": eid_b,
                        "name_b":       getattr(eb_orig, "Name", None) or "",
                        "type_b":       eb_orig.is_a(),
                        "overlap":      dist,
                    })

                del _tmp_copy
                print(
                    f"[clash] '{mname_a}' × '{mname_b}': {len(all_results) - before} Treffer"
                    f" ({'CGAL' if cgal_ok else 'AABB+OBB'})",
                    flush=True,
                )

        rule_total = sum(1 for r in all_results if r["rule_id"] == rule.id)
        print(f"[clash] Regel '{rule.name}': {rule_total} Treffer gesamt", flush=True)

    print(f"\n[clash] Gesamt: {len(all_results)} Kollisionen\n", flush=True)
    return {"results": all_results, "count": len(all_results)}


# ── Clash Diagnose ─────────────────────────────────────────────────────────────

@app.get("/clash/test")
def clash_test():
    """Schnell-Diagnose: prüft ob Geometrie-Tessellierung funktioniert."""
    import ifcopenshell.geom

    if not _models:
        return {"error": "Keine Modelle geladen. Bitte zuerst IFC-Dateien hochladen."}

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    report = {}
    for mname, model in _models.items():
        products = _by_type_safe(model, "IfcProduct")
        sample = products[:20]
        geoms = _tessellate_geoms(geo_settings, model, sample)

        # Self-clash test: how many sample pairs overlap (AABB + OBB)?
        aabb_hits, obb_hits = 0, 0
        ids = list(geoms.keys())
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a = geoms[ids[i]]; b = geoms[ids[j]]
                if _aabbs_overlap(a[0], b[0], 0.0):
                    aabb_hits += 1
                    if _obb_overlap_sat(a[1], a[2], a[3], b[1], b[2], b[3], 0.0):
                        obb_hits += 1

        report[mname] = {
            "products_total": len(products),
            "sample_size": len(sample),
            "sample_with_geometry": len(geoms),
            "sample_aabb_pairs": aabb_hits,
            "sample_obb_pairs": obb_hits,
            "ok": True,
        }

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
