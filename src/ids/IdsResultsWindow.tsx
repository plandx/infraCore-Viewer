import { useEffect, useState, useMemo } from "react";
import {
  ChevronDown, ChevronRight, AlertTriangle, Check, Download,
  Eye, EyeOff, X, FileCheck2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { SYNC_CHANNEL, IDS_RESULTS_CHANNEL } from "../utils/windowSync";
import type { IdsResultsMsg } from "../utils/windowSync";
import type { SyncMsg, SyncAction } from "../utils/windowSync";
import type { IdsValidationReport } from "./idsTypes";

type GroupMode = "spec" | "pset" | "missingProp" | "ifcClass" | "ifcFile";

interface FailEntry {
  modelId: string;
  expressId: number;
  name?: string;
  type?: string;
  specName: string;
  failures: string[];
}

interface GroupSection {
  key: string;
  label: string;
  passCount: number;
  failCount: number;
  entries: FailEntry[];
}

function groupResults(report: IdsValidationReport, mode: GroupMode): GroupSection[] {
  const sections = new Map<string, GroupSection>();

  const ensure = (key: string, label: string) => {
    if (!sections.has(key)) sections.set(key, { key, label, passCount: 0, failCount: 0, entries: [] });
    return sections.get(key)!;
  };

  for (const spec of report.results) {
    for (const el of spec.elements) {
      if (el.status === "passed") {
        if (mode === "spec") {
          ensure(spec.specificationId, spec.specificationName).passCount++;
        }
        continue;
      }

      const failures = el.failures.map((f) => f.message);

      if (mode === "spec") {
        const sec = ensure(spec.specificationId, spec.specificationName);
        sec.failCount++;
        sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures });
      } else if (mode === "pset") {
        const psets = new Set<string>();
        for (const f of el.failures) {
          const m = f.message.match(/^([^.]+)\./);
          const key = m ? m[1] : "Unbekannter PSet";
          psets.add(key);
        }
        for (const pset of psets) {
          const sec = ensure(pset, pset);
          sec.failCount++;
          sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures: failures.filter((f) => f.startsWith(pset)) });
        }
      } else if (mode === "missingProp") {
        const props = new Set<string>();
        for (const f of el.failures) {
          const m = f.message.match(/^(?:[^.]+\.)?(.+?)\s+fehlt/);
          const key = m ? m[1] : f.message;
          props.add(key);
        }
        for (const prop of props) {
          const sec = ensure(prop, prop);
          sec.failCount++;
          sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures: failures.filter((f) => f.includes(prop)) });
        }
      } else if (mode === "ifcClass") {
        const key = el.type?.toUpperCase() ?? "UNBEKANNT";
        const sec = ensure(key, key);
        sec.failCount++;
        sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures });
      } else if (mode === "ifcFile") {
        const sec = ensure(el.modelId, el.modelId);
        sec.failCount++;
        sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures });
      }
    }

    if (mode === "spec") {
      ensure(spec.specificationId, spec.specificationName).passCount += spec.passCount;
    }
  }

  return Array.from(sections.values()).sort((a, b) => b.failCount - a.failCount);
}

export function IdsResultsWindow() {
  const [report, setReport] = useState<IdsValidationReport | null>(null);
  const [theme, setTheme] = useState("dark");
  const [groupMode, setGroupMode] = useState<GroupMode>("spec");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme !== "light");
  }, [theme]);

  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(IDS_RESULTS_CHANNEL); } catch { return; }

    ch.onmessage = (e: MessageEvent<IdsResultsMsg>) => {
      const msg = e.data;
      if (msg.t === "state") {
        setReport(msg.report);
        setTheme(msg.theme);
      }
    };

    ch.postMessage({ t: "req" } satisfies IdsResultsMsg);

    return () => ch.close();
  }, []);

  const syncCh = useMemo(() => {
    try { return new BroadcastChannel(SYNC_CHANNEL); } catch { return null; }
  }, []);

  useEffect(() => () => { syncCh?.close(); }, [syncCh]);

  const sendAction = (a: SyncAction) => {
    syncCh?.postMessage({ t: "act", a } satisfies SyncMsg);
  };

  const groups = useMemo(() => report ? groupResults(report, groupMode) : [], [report, groupMode]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const totalSpecs = report?.results.length ?? 0;
  const passedSpecs = report?.results.filter((r) => r.status === "passed").length ?? 0;
  const failedSpecs = report?.results.filter((r) => r.status === "failed").length ?? 0;
  const skippedSpecs = report?.results.filter((r) => r.status === "skipped").length ?? 0;
  const totalElements = report?.results.reduce((s, r) => s + r.applicableCount, 0) ?? 0;
  const failedElements = report?.results.reduce((s, r) => s + r.failCount, 0) ?? 0;

  const exportCSV = () => {
    if (!report) return;
    const rows: string[][] = [["Spezifikation", "ModelId", "ExpressId", "Name", "Typ", "Fehler"]];
    for (const spec of report.results) {
      for (const el of spec.elements.filter((e) => e.status === "failed")) {
        rows.push([spec.specificationName, el.modelId, String(el.expressId), el.name ?? "", el.type ?? "", el.failures.map((f) => f.message).join("; ")]);
      }
    }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ids-prüfbericht-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/60 shrink-0">
        <FileCheck2 size={15} className="text-primary shrink-0" />
        <span className="font-semibold text-sm">IDS Prüfbericht</span>
        {report && (
          <>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground truncate max-w-xs">{report.documentTitle}</span>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground text-[10px]">{new Date(report.timestamp).toLocaleString("de-AT")}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {report && (
            <button
              className="flex items-center gap-1 px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors text-[10px]"
              onClick={exportCSV}
            >
              <Download size={10} /> CSV
            </button>
          )}
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={() => window.close()}
            title="Fenster schließen"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {!report ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <FileCheck2 size={40} className="opacity-20" />
          <p className="text-sm">Warte auf Prüfergebnis vom Hauptfenster…</p>
          <p className="text-[10px] text-muted-foreground/50">Prüfung im IDS-Panel ausführen, um Ergebnisse hier anzuzeigen.</p>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-card/30 shrink-0 flex-wrap">
            <span className="font-medium">{totalSpecs} Specs</span>
            <span className="flex items-center gap-1 text-green-500"><Check size={11} /> {passedSpecs} OK</span>
            {failedSpecs > 0 && <span className="flex items-center gap-1 text-red-400"><AlertTriangle size={11} /> {failedSpecs} FAIL</span>}
            {skippedSpecs > 0 && <span className="text-muted-foreground">{skippedSpecs} übersprungen</span>}
            <span className="text-muted-foreground">|</span>
            <span className="text-muted-foreground">{totalElements} Elemente gesamt</span>
            {failedElements > 0 && <span className="text-red-400">{failedElements} Fehler</span>}

            <div className="ml-auto flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground">Gruppierung:</label>
              <select
                className="text-[10px] bg-muted/40 border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
              >
                <option value="spec">Prüfregel</option>
                <option value="pset">PropertySet</option>
                <option value="missingProp">Fehlende Property</option>
                <option value="ifcClass">IFC-Klasse</option>
                <option value="ifcFile">IFC-Datei</option>
              </select>
              <button
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                onClick={() => sendAction({ k: "showAll" })}
                title="Alle Elemente einblenden"
              >
                <Eye size={10} /> Alles anzeigen
              </button>
            </div>
          </div>

          {/* Groups list */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {groups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <Check size={32} className="text-green-500 opacity-60" />
                <p className="text-sm">Alle Prüfregeln bestanden</p>
              </div>
            )}
            {groups.map((group) => {
              const isExpanded = expandedKeys.has(group.key);
              const statusColor = group.failCount > 0
                ? "text-red-400 bg-red-400/10 border-red-400/20"
                : "text-green-500 bg-green-500/10 border-green-500/20";

              return (
                <div key={group.key} className={cn("border rounded-lg overflow-hidden", group.failCount > 0 ? "border-red-400/20" : "border-border")}>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                    onClick={() => toggleExpand(group.key)}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="text-muted-foreground shrink-0" />
                      : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
                    <span className="flex-1 text-xs font-medium truncate">{group.label}</span>
                    {group.passCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-green-500 shrink-0">
                        <Check size={9} /> {group.passCount}
                      </span>
                    )}
                    {group.failCount > 0 && (
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0", statusColor)}>
                        {group.failCount} Fehler
                      </span>
                    )}
                  </button>

                  {isExpanded && group.entries.length > 0 && (
                    <div className="border-t border-border/50 divide-y divide-border/20 bg-muted/5 max-h-96 overflow-y-auto">
                      {group.entries.map((entry, i) => (
                        <div
                          key={`${entry.modelId}:${entry.expressId}:${i}`}
                          className="px-3 py-2 hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => sendAction({ k: "select", modelId: entry.modelId, expressId: entry.expressId })}
                        >
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={10} className="text-red-400 shrink-0" />
                            <span className="font-medium truncate flex-1">{entry.name || `#${entry.expressId}`}</span>
                            {entry.type && <span className="text-[10px] text-muted-foreground shrink-0">{entry.type}</span>}
                            <span className="text-[10px] text-muted-foreground/60 shrink-0">#{entry.expressId}</span>
                            <button
                              className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
                              title="Element isolieren"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendAction({ k: "isolate", modelId: entry.modelId, expressId: entry.expressId });
                              }}
                            >
                              <EyeOff size={10} />
                            </button>
                          </div>
                          {groupMode !== "spec" && (
                            <div className="text-[10px] text-muted-foreground/60 pl-4 mt-0.5">{entry.specName}</div>
                          )}
                          {entry.failures.slice(0, 3).map((f, fi) => (
                            <p key={fi} className="text-[10px] text-red-300/80 pl-4 mt-0.5 leading-tight">{f}</p>
                          ))}
                          {entry.failures.length > 3 && (
                            <p className="text-[10px] text-muted-foreground/50 pl-4">… +{entry.failures.length - 3} weitere</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
