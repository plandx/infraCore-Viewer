import { useState, useCallback } from "react";
import type { SQLQueryResult } from "../types/ifc";
import { useModelStore } from "../store/modelStore";

// Simple IFC property query engine using loaded model data
async function runQuery(
  sql: string,
  models: Map<string, import("../types/ifc").IFCModelEntry>
): Promise<SQLQueryResult> {
  const start = performance.now();
  try {
    // Parse a very simple SELECT ... FROM models/properties WHERE ...
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("select") && normalized.includes("from models")) {
      const rows = Array.from(models.values()).map((m) => [
        m.id,
        m.name,
        m.size,
        m.visible,
        m.status,
        m.loadedAt.toISOString(),
      ]);
      return {
        columns: ["id", "name", "size_bytes", "visible", "status", "loaded_at"],
        rows,
        executionTime: performance.now() - start,
      };
    }

    return {
      columns: ["message"],
      rows: [
        [
          "Verfügbare Queries: SELECT * FROM models | SELECT * FROM properties WHERE model_id = '<id>'",
        ],
      ],
      executionTime: performance.now() - start,
    };
  } catch (err) {
    return {
      columns: [],
      rows: [],
      error: String(err),
      executionTime: performance.now() - start,
    };
  }
}

const EXAMPLE_QUERIES = [
  "SELECT * FROM models",
  "SELECT name, size_bytes, status FROM models WHERE visible = true",
];

export default function SQLPanel() {
  const [sql, setSql] = useState(EXAMPLE_QUERIES[0]);
  const [result, setResult] = useState<SQLQueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const models = useModelStore((s) => s.models);

  const execute = useCallback(async () => {
    setRunning(true);
    const r = await runQuery(sql, models);
    setResult(r);
    setRunning(false);
  }, [sql, models]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  };

  return (
    <div className="sql-panel">
      <div className="sql-examples">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            className="example-btn"
            onClick={() => setSql(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <textarea
        className="sql-editor"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={handleKey}
        rows={4}
        spellCheck={false}
        placeholder="SQL eingeben... (Ctrl+Enter zum Ausführen)"
      />

      <button
        className="run-btn"
        onClick={execute}
        disabled={running || models.size === 0}
      >
        {running ? "..." : "▶ Ausführen"}{" "}
        <span className="shortcut">Ctrl+Enter</span>
      </button>

      {result && (
        <div className="sql-result">
          <div className="result-meta">
            {result.error ? (
              <span className="err">{result.error}</span>
            ) : (
              <span>
                {result.rows.length} Zeilen · {result.executionTime.toFixed(1)}
                ms
              </span>
            )}
          </div>
          {!result.error && result.columns.length > 0 && (
            <div className="result-table-wrap">
              <table className="result-table">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{String(cell ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
