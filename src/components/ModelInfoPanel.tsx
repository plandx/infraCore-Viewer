import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { cn } from "../lib/utils";

export function ModelInfoPanel() {
  const models = useModelStore((s) => s.models);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const loaded = Array.from(models.values()).filter((m) => m.status === "loaded");
  if (loaded.length === 0) return null;

  const active = loaded.find((m) => m.id === activeId) ?? loaded[0];
  const h = active.header;

  const rows: [string, string][] = [
    ["Schema", h?.schema || "—"],
    ["Autor", h?.authors?.join(", ") || "—"],
    ["Organisation", h?.organizations?.join(", ") || "—"],
    ["Software", h?.preprocessor || "—"],
    ["Datum", h?.timestamp ? formatTimestamp(h.timestamp) : "—"],
  ];

  return (
    <div className="shrink-0 border-b border-border text-xs">
      {/* Header bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-muted/30 transition-colors bg-card/30"
        onClick={() => setOpen((v) => !v)}
      >
        <FileText size={12} className="text-muted-foreground shrink-0" />
        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide flex-1">Modellinformationen</span>
        <ChevronDown size={12} className={cn("text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
      </div>

      {open && (
        <div className="bg-card/10">
          {/* Model tabs — only when more than one model */}
          {loaded.length > 1 && (
            <div className="flex overflow-x-auto border-b border-border/60 px-2 pt-1 gap-0.5">
              {loaded.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setActiveId(m.id)}
                  className={cn(
                    "shrink-0 px-2 py-0.5 rounded-[4px] text-[10px] truncate max-w-[120px] transition-colors",
                    active.id === m.id
                      ? "bg-background border border-b-background border-border font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title={m.name}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-[2px] mr-1 shrink-0"
                    style={{ backgroundColor: m.color }}
                  />
                  {m.name.replace(/\.ifc$/i, "")}
                </button>
              ))}
            </div>
          )}

          {/* Metadata rows */}
          <div className="px-3 py-1.5 space-y-0.5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="w-24 shrink-0 text-[10px] text-muted-foreground/70">{label}</span>
                <span className="flex-1 min-w-0 text-[10px] text-foreground/80 truncate" title={value}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ts: string): string {
  if (!ts) return "";
  // ISO-like: "2024-03-15T10:30:00" or "2024-03-15T10:30:00.000"
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1];
  return ts;
}
