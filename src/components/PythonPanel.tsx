import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Play, X, RefreshCw, Upload, Circle, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { useModelStore as useSettings } from "../store/modelStore";

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

// ── Component ──────────────────────────────────────────────────────────────────

export function PythonPanel() {
  const models           = useModelStore((s) => s.models);
  const settings         = useSettings((s) => s.settings);
  const setPythonPanelOpen = useModelStore((s) => s.setPythonPanelOpen);

  const isDark = settings.theme === "dark";

  const [script, setScript]           = useState(STARTER_SCRIPT);
  const [output, setOutput]           = useState<OutputEntry[]>([]);
  const [running, setRunning]         = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("unknown");
  const [serverModels, setServerModels] = useState<string[]>([]);
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
      pushOutput([{ kind: "error", text: "Server nicht erreichbar. Bitte python server/server.py starten." }]);
      return;
    }
    const visibleModels = [...models.values()].filter((m) => m.visible && m.file);
    if (visibleModels.length === 0) {
      pushOutput([{ kind: "info", text: "Keine sichtbaren Modelle mit Datei gefunden." }]);
      return;
    }
    setSyncing(true);
    pushOutput([{ kind: "info", text: `Übertrage ${visibleModels.length} Modell(e) an Server…` }]);
    for (const m of visibleModels) {
      const err = await uploadModel(m.name, m.file!);
      if (err) {
        pushOutput([{ kind: "error", text: `${m.name}: ${err}` }]);
      } else {
        pushOutput([{ kind: "info", text: `✓ ${m.name}` }]);
      }
    }
    setSyncing(false);
    const { models: sm } = await pingServer();
    setServerModels(sm);
  }, [models, serverStatus]);

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

  // Ctrl+Enter inside Monaco triggers execute
  const handleEditorMount = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor: any, monaco: any) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, execute);
    },
    [execute],
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

  return (
    <div className="flex flex-col h-full bg-card border-t border-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0 select-none">
        <span className="text-[10px] font-mono font-semibold text-primary flex-shrink-0">🐍 Python</span>

        {/* Server status */}
        <div className="flex items-center gap-1 text-[10px]">
          <Circle size={7} className={cn("fill-current", statusColor[serverStatus])} />
          <span className={cn("font-medium", statusColor[serverStatus])}>{statusLabel[serverStatus]}</span>
          {serverStatus === "online" && serverModels.length > 0 && (
            <span className="text-muted-foreground ml-1">· {serverModels.length} Modell(e)</span>
          )}
        </div>

        <div className="flex-1" />

        {/* Sync button */}
        <button
          title="Sichtbare Modelle an Server übertragen"
          disabled={syncing || serverStatus !== "online"}
          onClick={syncModels}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 transition-colors"
        >
          {syncing ? <RefreshCw size={10} className="animate-spin" /> : <Upload size={10} />}
          <span>Sync</span>
        </button>

        {/* Run button */}
        <button
          title="Skript ausführen (Ctrl+Enter)"
          disabled={running || serverStatus !== "online"}
          onClick={execute}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0",
            serverStatus === "online"
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Play size={10} />
          <span>Run</span>
        </button>

        {/* Clear output */}
        <button
          title="Ausgabe löschen"
          onClick={() => setOutput([])}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground"
        >
          <Trash2 size={11} />
        </button>

        {/* Close */}
        <button
          title="Panel schließen"
          onClick={() => setPythonPanelOpen(false)}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground"
        >
          <X size={13} />
        </button>
      </div>

      {/* Server offline hint */}
      {serverStatus === "offline" && (
        <div className="px-3 py-1.5 text-[10px] text-amber-400 bg-amber-400/10 border-b border-border shrink-0 font-mono">
          Server starten: <span className="font-semibold">python server/server.py</span>
          <span className="text-muted-foreground ml-2">(pip install -r server/requirements.txt)</span>
        </div>
      )}

      {/* Main split: editor top, console bottom */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Monaco Editor */}
        <div className="flex-1 min-h-0">
          <Editor
            defaultLanguage="python"
            value={script}
            onChange={(v) => setScript(v ?? "")}
            onMount={handleEditorMount}
            theme={isDark ? "vs-dark" : "light"}
            options={{
              fontSize: 12,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              wordWrap: "on",
              tabSize: 4,
              automaticLayout: true,
              padding: { top: 8, bottom: 8 },
              renderLineHighlight: "line",
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            }}
          />
        </div>

        {/* Console output */}
        <div className="h-36 shrink-0 border-t border-border bg-[#0d1117] overflow-y-auto font-mono text-[10.5px] leading-relaxed px-3 py-2 space-y-0.5">
          {output.length === 0 ? (
            <span className="text-muted-foreground/50">Ausgabe erscheint hier…</span>
          ) : (
            output.map((e, i) => (
              <pre
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  e.kind === "stdout" ? "text-green-300" :
                  e.kind === "stderr" ? "text-yellow-300" :
                  e.kind === "error"  ? "text-red-400"   :
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
