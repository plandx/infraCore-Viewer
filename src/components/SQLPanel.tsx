import { useState, useCallback, useEffect, useRef } from "react";
import { Play, RotateCcw, X, Database, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { runSQL, rebuildElementTable, SAMPLE_QUERIES } from "../utils/sqlEngine";
import type { SQLQueryResult } from "../types/ifc";

export function SQLPanel() {
  const models = useModelStore((s) => s.models);
  const setSqlPanelOpen = useModelStore((s) => s.setSqlPanelOpen);
  const [query, setQuery] = useState(SAMPLE_QUERIES[0].sql);
  const [result, setResult] = useState<SQLQueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Rebuild DB whenever models change
  useEffect(() => {
    rebuildElementTable(models);
  }, [models]);

  const execute = useCallback(() => {
    if (!query.trim()) return;
    setRunning(true);
    try {
      const res = runSQL(query);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border-t border-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
        <Database size={13} className="text-primary" />
        <span className="text-xs font-semibold flex-1">SQL Abfrage</span>
        <span className="text-[10px] text-muted-foreground">
          Tabelle: <code className="text-primary font-mono">elements</code>
          {" "}(modelName, type, name, expressId)
        </span>
        <button
          className="toolbar-button p-0.5 hover:text-destructive ml-2"
          onClick={() => setSqlPanelOpen(false)}
          title="SQL-Panel schließen"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Editor */}
        <div className="flex flex-col w-1/2 border-r border-border">
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20 shrink-0">
            {/* Sample queries dropdown */}
            <div className="relative">
              <button
                className="toolbar-button flex items-center gap-1 text-[11px] px-2"
                onClick={() => setShowSamples((v) => !v)}
              >
                Beispiele <ChevronDown size={11} />
              </button>
              {showSamples && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-xl min-w-[220px]">
                  {SAMPLE_QUERIES.map((sq) => (
                    <button
                      key={sq.label}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/60 text-foreground"
                      onClick={() => { setQuery(sq.sql); setShowSamples(false); textareaRef.current?.focus(); }}
                    >
                      {sq.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="toolbar-button p-1 text-muted-foreground"
              onClick={() => { setQuery(""); setResult(null); }}
              title="Löschen"
            >
              <RotateCcw size={11} />
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground">Ctrl+Enter</span>
            <button
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium",
                "bg-primary text-primary-foreground hover:opacity-90",
                running && "opacity-60 pointer-events-none"
              )}
              onClick={execute}
            >
              <Play size={11} />
              Ausführen
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "flex-1 p-3 font-mono text-[12px] resize-none",
              "bg-[#16161e] text-[#a9b1d6] outline-none",
              "placeholder:text-muted-foreground/40"
            )}
            placeholder="SELECT * FROM elements WHERE type = 'Wand' LIMIT 50"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <div className="flex flex-col w-1/2 min-h-0">
          {!result ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              Abfrage ausführen, um Ergebnisse zu sehen
            </div>
          ) : result.error ? (
            <div className="flex-1 p-4">
              <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-xs text-destructive font-mono whitespace-pre-wrap">
                {result.error}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/20 shrink-0">
                <span className="text-[11px] text-muted-foreground">
                  {result.rows.length} Zeile{result.rows.length !== 1 ? "n" : ""}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {result.executionTime.toFixed(1)} ms
                </span>
                {result.rows.length > 0 && (
                  <button
                    className="ml-auto toolbar-button text-[10px] px-2"
                    onClick={() => exportCSV(result)}
                    title="Als CSV exportieren"
                  >
                    CSV
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {result.rows.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                    Keine Ergebnisse
                  </div>
                ) : (
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                      <tr>
                        {result.columns.map((col) => (
                          <th
                            key={col}
                            className="px-3 py-1.5 text-left font-semibold text-muted-foreground border-b border-border/50 whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, ri) => (
                        <tr
                          key={ri}
                          className="border-b border-border/20 hover:bg-muted/20"
                        >
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="px-3 py-1 text-foreground/80 font-mono max-w-[200px] truncate"
                              title={String(cell ?? "")}
                            >
                              {cell == null ? (
                                <span className="text-muted-foreground/40">NULL</span>
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function exportCSV(result: SQLQueryResult) {
  const lines = [
    result.columns.join(","),
    ...result.rows.map((row) =>
      row
        .map((v) => {
          const s = String(v ?? "");
          return s.includes(",") || s.includes('"') || s.includes("\n")
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "abfrage.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
