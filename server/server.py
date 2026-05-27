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
from typing import Dict

import ifcopenshell
import ifcopenshell.util.element
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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
