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
from typing import Any, Dict, List, Optional

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
    return {"name": name, "entity_count": len(list(model))}


@app.delete("/models/{name}")
def delete_model(name: str):
    if name not in _models:
        raise HTTPException(status_code=404, detail="Model not found")
    del _models[name]
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
    tolerance: float = 0.0          # metres; used as extend for clearance/duplicate
    set_a: ClashComponentFilter
    set_b: ClashComponentFilter

class ClashPayload(BaseModel):
    rules: List[ClashRulePayload]


@app.post("/clash")
def run_clash(req: ClashPayload):
    """Kollisionsprüfung via ifcopenshell.geom.tree (OBB-Intersection)."""
    import ifcopenshell.geom  # lazy import — not available until bootstrap

    geo_settings = ifcopenshell.geom.settings()
    geo_settings.set(geo_settings.USE_WORLD_COORDS, True)

    all_results: List[Dict[str, Any]] = []

    for rule in req.rules:
        # ── Build one spatial tree per Set-B model ────────────────────────────
        b_trees: Dict[str, Any] = {}  # model_name → tree
        types_b = rule.set_b.ifc_types or ["IfcProduct"]

        for mname, model in _models.items():
            if rule.set_b.model_names and mname not in rule.set_b.model_names:
                continue
            tree = ifcopenshell.geom.tree()
            added = 0
            for t in types_b:
                try:
                    for elem in model.by_type(t, include_subtypes=True):
                        try:
                            tree.add_element(elem, geo_settings)
                            added += 1
                        except Exception:
                            pass
                except Exception:
                    pass
            if added:
                b_trees[mname] = tree

        if not b_trees:
            continue

        # ── Collect Set-A elements and query ─────────────────────────────────
        types_a = rule.set_a.ifc_types or ["IfcProduct"]
        extend  = rule.tolerance if rule.check_type in ("clearance", "duplicate") else 0.0
        seen: set = set()

        for mname_a, model_a in _models.items():
            if rule.set_a.model_names and mname_a not in rule.set_a.model_names:
                continue
            for t in types_a:
                try:
                    elems_a = model_a.by_type(t, include_subtypes=True)
                except Exception:
                    continue
                for elem_a in elems_a:
                    for mname_b, tree_b in b_trees.items():
                        try:
                            overlapping = tree_b.select(elem_a, extend=extend, completely_within=False)
                        except Exception:
                            continue
                        for ov in overlapping:
                            eid_b = ov.id()
                            # Skip self-clash and already-seen pairs
                            if mname_a == mname_b and elem_a.id() == eid_b:
                                continue
                            pair = tuple(sorted([(mname_a, elem_a.id()), (mname_b, eid_b)]))
                            if pair in seen:
                                continue
                            seen.add(pair)
                            all_results.append({
                                "rule_id":      rule.id,
                                "rule_name":    rule.name,
                                "severity":     rule.severity,
                                "check_type":   rule.check_type,
                                "model_name_a": mname_a,
                                "express_id_a": elem_a.id(),
                                "name_a":       getattr(elem_a, "Name", None) or "",
                                "type_a":       elem_a.is_a(),
                                "model_name_b": mname_b,
                                "express_id_b": eid_b,
                                "name_b":       getattr(ov, "Name", None) or "",
                                "type_b":       ov.is_a(),
                                "overlap":      0.0,
                            })

    return {"results": all_results, "count": len(all_results)}


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
