import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { Play, X, RefreshCw, Upload, Circle, Trash2, RotateCcw, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { loadIFCFile, evictPropModelCache } from "../utils/ifcLoader";

const SERVER_URL = "http://127.0.0.1:8765";

const STARTER_SCRIPT = `# Verfügbar: ifc_models (dict), ifcopenshell, util
# Beispiel:
for name, model in ifc_models.items():
    walls = model.by_type("IfcWall")
    print(f"{name}: {len(walls)} Wände")
`;

type ServerStatus = "unknown" | "online" | "offline";

interface OutputEntry {
  kind: "stdout" | "stderr" | "error" | "info";
  text: string;
}

// ── Server API helpers ─────────────────────────────────────────────────────────

async function pingServer(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const r = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, models: [] };
    const data = await r.json();
    return { ok: true, models: data.models ?? [] };
  } catch {
    return { ok: false, models: [] };
  }
}

async function uploadModel(name: string, file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("file", file);
  try {
    const r = await fetch(`${SERVER_URL}/upload`, { method: "POST", body: fd, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return (await r.json()).detail ?? "Upload fehlgeschlagen";
    return null;
  } catch (e) {
    return String(e);
  }
}

async function runScript(script: string): Promise<{ stdout: string; stderr: string; error: string | null }> {
  const r = await fetch(`${SERVER_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script }),
    signal: AbortSignal.timeout(60_000),
  });
  return r.json();
}

async function deleteServerModel(name: string): Promise<string | null> {
  try {
    const r = await fetch(`${SERVER_URL}/models/${encodeURIComponent(name)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return (await r.json()).detail ?? "Löschen fehlgeschlagen";
    return null;
  } catch (e) {
    return String(e);
  }
}

async function downloadModel(serverName: string): Promise<ArrayBuffer> {
  const r = await fetch(`${SERVER_URL}/download/${encodeURIComponent(serverName)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`Download fehlgeschlagen: ${r.status}`);
  return r.arrayBuffer();
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PythonPanel() {
  const models             = useModelStore((s) => s.models);
  const worldOrigin        = useModelStore((s) => s.worldOrigin);
  const updateModel        = useModelStore((s) => s.updateModel);
  const settings           = useModelStore((s) => s.settings);
  const setPythonPanelOpen = useModelStore((s) => s.setPythonPanelOpen);

  const isDark = settings.theme === "dark";

  const [script, setScript]               = useState(STARTER_SCRIPT);
  const [output, setOutput]               = useState<OutputEntry[]>([]);
  const [running, setRunning]             = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [serverStatus, setServerStatus]   = useState<ServerStatus>("unknown");
  const [serverModels, setServerModels]   = useState<string[]>([]);
  const [reloadingSet, setReloadingSet]   = useState<Set<string>>(new Set());
  const [reloadErrors, setReloadErrors]   = useState<Map<string, string>>(new Map());
  const outputEndRef = useRef<HTMLDivElement>(null);

  const pushOutput = (entries: OutputEntry[]) =>
    setOutput((prev) => [...prev, ...entries]);

  // ── Server health polling ─────────────────────────────────────────────────
  const checkServer = useCallback(async () => {
    const { ok, models: m } = await pingServer();
    setServerStatus(ok ? "online" : "offline");
    if (ok) setServerModels(m);
  }, []);

  useEffect(() => {
    checkServer();
    const id = setInterval(checkServer, 5000);
    return () => clearInterval(id);
  }, [checkServer]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  // ── Sync visible models to server ─────────────────────────────────────────
  const syncModels = useCallback(async () => {
    if (serverStatus !== "online") {
      pushOutput([{ kind: "error", text: "Server nicht erreichbar." }]);
      return;
    }
    setSyncing(true);

    const visibleModels = [...models.values()].filter((m) => m.visible && m.file);
    const visibleNames  = new Set(visibleModels.map((m) => m.name));

    // Remove server models that are no longer visible in the viewer
    const toDelete = serverModels.filter((name) => !visibleNames.has(name));
    for (const name of toDelete) {
      const err = await deleteServerModel(name);
      if (err) pushOutput([{ kind: "error", text: `Entfernen "${name}": ${err}` }]);
      else     pushOutput([{ kind: "info",  text: `✗ ${name} entfernt` }]);
    }

    // Upload all currently visible models
    if (visibleModels.length > 0) {
      pushOutput([{ kind: "info", text: `Übertrage ${visibleModels.length} Modell(e) an Server…` }]);
      for (const m of visibleModels) {
        const err = await uploadModel(m.name, m.file!);
        if (err) pushOutput([{ kind: "error", text: `${m.name}: ${err}` }]);
        else     pushOutput([{ kind: "info",  text: `✓ ${m.name}` }]);
      }
    } else if (toDelete.length === 0) {
      pushOutput([{ kind: "info", text: "Keine sichtbaren Modelle mit Datei gefunden." }]);
    }

    setSyncing(false);
    const { models: sm } = await pingServer();
    setServerModels(sm);
  }, [models, serverStatus, serverModels]);

  // ── Reload a server model back into the viewer ────────────────────────────
  const reloadFromServer = useCallback(async (serverName: string) => {
    setReloadingSet((prev) => new Set(prev).add(serverName));
    setReloadErrors((prev) => { const m = new Map(prev); m.delete(serverName); return m; });
    try {
      // Download modified IFC bytes
      const buffer = await downloadModel(serverName);
      const newFile = new File([buffer], serverName, { type: "application/octet-stream" });

      // Find matching model in viewer by name
      const existing = [...models.values()].find((m) => m.name === serverName);
      if (!existing) {
        pushOutput([{ kind: "error", text: `Kein Viewer-Modell für "${serverName}" gefunden.` }]);
        return;
      }

      // Evict old property cache, mark as loading
      if (existing.file) evictPropModelCache(existing.file);
      updateModel(existing.id, { status: "loading" });

      // Determine model index for colour (preserve existing)
      const modelIdx = [...models.keys()].indexOf(existing.id);

      // Re-parse with IfcOpenShell-WASM
      const { entry } = await loadIFCFile(newFile, modelIdx, worldOrigin, () => {});

      // Patch store — ViewportContainer detects mesh change and swaps automatically
      updateModel(existing.id, {
        ...entry,
        id: existing.id,
        color: existing.color,
        visible: existing.visible,
        opacity: existing.opacity,
        status: "loaded",
      });

      pushOutput([{ kind: "info", text: `↩ ${serverName} neu geladen` }]);
    } catch (e) {
      const msg = String(e);
      setReloadErrors((prev) => new Map(prev).set(serverName, msg));
      updateModel(
        [...models.values()].find((m) => m.name === serverName)?.id ?? "",
        { status: "loaded" },
      );
      pushOutput([{ kind: "error", text: `Reload "${serverName}": ${msg}` }]);
    } finally {
      setReloadingSet((prev) => { const s = new Set(prev); s.delete(serverName); return s; });
    }
  }, [models, worldOrigin, updateModel]);

  // ── Execute script ────────────────────────────────────────────────────────
  const execute = useCallback(async () => {
    if (running || serverStatus !== "online") return;
    setRunning(true);
    pushOutput([{ kind: "info", text: "▶ Ausführen…" }]);
    try {
      const { stdout, stderr, error } = await runScript(script);
      const entries: OutputEntry[] = [];
      if (stdout) entries.push({ kind: "stdout", text: stdout });
      if (stderr) entries.push({ kind: "stderr", text: stderr });
      if (error)  entries.push({ kind: "error",  text: error });
      if (entries.length === 0) entries.push({ kind: "info", text: "✓ Fertig (keine Ausgabe)" });
      pushOutput(entries);
    } catch (e) {
      pushOutput([{ kind: "error", text: String(e) }]);
    } finally {
      setRunning(false);
    }
  }, [running, script, serverStatus]);

  const submitKeymap = Prec.highest(
    keymap.of([{ key: "Ctrl-Enter", mac: "Cmd-Enter", run: () => { execute(); return true; } }]),
  );

  const statusColor: Record<ServerStatus, string> = {
    unknown: "text-muted-foreground",
    online:  "text-green-500",
    offline: "text-red-400",
  };
  const statusLabel: Record<ServerStatus, string> = {
    unknown: "Prüfe…",
    online:  "Verbunden",
    offline: "Offline",
  };

  // Which server models have a matching viewer model?
  const viewerNames = new Set([...models.values()].map((m) => m.name));

  return (
    <div className="flex flex-col h-full bg-background border-t border-border" style={{ fontFamily: '"Segoe UI Variable","Segoe UI",system-ui,sans-serif' }}>
      {/* Header toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/10 shrink-0 select-none">
        <span className="text-[12px] font-semibold text-foreground shrink-0">Python</span>

        <div className="flex items-center gap-1 text-[10px]">
          <Circle size={7} className={cn("fill-current", statusColor[serverStatus])} />
          <span className={cn("font-medium", statusColor[serverStatus])}>{statusLabel[serverStatus]}</span>
        </div>

        <div className="flex-1" />

        <button
          title="Sichtbare Modelle an Server übertragen"
          disabled={syncing || serverStatus !== "online"}
          onClick={syncModels}
          className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] border border-border bg-background hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-foreground disabled:opacity-40 transition-colors"
        >
          {syncing ? <RefreshCw size={10} className="animate-spin" /> : <Upload size={10} />}
          <span>Sync ↑</span>
        </button>

        <button
          title="Skript ausführen (Ctrl+Enter)"
          disabled={running || serverStatus !== "online"}
          onClick={execute}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] font-medium transition-colors shrink-0",
            serverStatus === "online"
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-muted text-muted-foreground border border-border",
          )}
        >
          <Play size={10} />
          <span>Run</span>
        </button>

        <button title="Ausgabe löschen" onClick={() => setOutput([])}
          className="p-1 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-muted-foreground">
          <Trash2 size={11} />
        </button>

        <button title="Panel schließen" onClick={() => setPythonPanelOpen(false)}
          className="p-1 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-muted-foreground">
          <X size={13} />
        </button>
      </div>

      {/* Offline hint */}
      {serverStatus === "offline" && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/10 border-b border-border shrink-0 font-mono">
          Server starten: <span className="font-semibold">python server/server.py</span>
          <span className="text-muted-foreground ml-2">— installiert Bibliotheken beim ersten Start automatisch</span>
        </div>
      )}

      {/* Server model strip — Sync ↓ (reload into viewer) */}
      {serverStatus === "online" && serverModels.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border shrink-0 bg-muted/10 overflow-x-auto">
          <span className="text-[9px] text-muted-foreground shrink-0 uppercase">Server:</span>
          {serverModels.map((name) => {
            const inViewer   = viewerNames.has(name);
            const loading    = reloadingSet.has(name);
            const hasError   = reloadErrors.has(name);
            return (
              <button
                key={name}
                disabled={loading || !inViewer}
                onClick={() => reloadFromServer(name)}
                title={
                  !inViewer
                    ? `"${name}" ist nicht im Viewer geladen`
                    : hasError
                    ? `Fehler: ${reloadErrors.get(name)}`
                    : `Modell "${name}" vom Server in den Viewer übernehmen`
                }
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] border shrink-0 transition-colors",
                  loading
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : hasError
                    ? "border-red-400/40 bg-red-400/10 text-red-400"
                    : inViewer
                    ? "border-border hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-foreground"
                    : "border-border/30 text-muted-foreground/40 cursor-not-allowed",
                )}
              >
                {loading   ? <RefreshCw size={9} className="animate-spin" />
                 : hasError ? <AlertCircle size={9} />
                 : <RotateCcw size={9} />}
                <span className="truncate max-w-[120px]">{name}</span>
              </button>
            );
          })}
          <span className="text-[9px] text-muted-foreground/50 shrink-0 ml-1">← in Viewer laden</span>
        </div>
      )}

      {/* Main split: editor + console */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-auto">
          <CodeMirror
            value={script}
            extensions={[python(), submitKeymap]}
            theme={isDark ? vscodeDark : vscodeLight}
            onChange={(v) => setScript(v)}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              indentOnInput: true,
              tabSize: 4,
              foldGutter: false,
            }}
            style={{ height: "100%", fontSize: 12 }}
          />
        </div>

        {/* Console */}
        <div className="h-36 shrink-0 border-t border-border bg-[#1E1E1E] overflow-y-auto text-[10.5px] leading-relaxed px-3 py-2 space-y-0.5" style={{ fontFamily: '"Cascadia Code","Consolas",monospace' }}>
          {output.length === 0 ? (
            <span className="text-muted-foreground/50">Ausgabe erscheint hier…</span>
          ) : (
            output.map((e, i) => (
              <pre
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  e.kind === "stdout" ? "text-green-300"  :
                  e.kind === "stderr" ? "text-yellow-300" :
                  e.kind === "error"  ? "text-red-400"    :
                  "text-muted-foreground",
                )}
              >
                {e.text}
              </pre>
            ))
          )}
          <div ref={outputEndRef} />
        </div>
      </div>
    </div>
  );
}
