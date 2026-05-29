import { useEffect, useState, useMemo, useCallback } from "react";
import {
  ChevronDown, ChevronRight, AlertTriangle, Check, Download,
  Eye, EyeOff, X, FileCheck2, ChevronsDownUp, ChevronsUpDown,
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

// Messages from idsValidator have format: `"PSetName.PropName" fehlt`
// or `"PSetName.PropName" = "val", erwartet: "x"`
function extractPset(msg: string): string {
  const m = msg.match(/^"([^."]+)\./);
  return m ? m[1] : "Unbekannter PSet";
}

function extractProp(msg: string): string {
  // `"PSetName.PropName" fehlt` → PropName
  const withPset = msg.match(/^"[^."]+\.([^"]+)"\s+fehlt/);
  if (withPset) return withPset[1];
  // `"PropName" fehlt` → PropName
  const plain = msg.match(/^"([^"]+)"\s+fehlt/);
  if (plain) return plain[1];
  // `Attribut "Name" fehlt oder leer` → Name
  const attr = msg.match(/Attribut "([^"]+)"/);
  if (attr) return attr[1];
  return msg.slice(0, 40);
}

function groupResults(
  report: IdsValidationReport,
  mode: GroupMode,
  modelNames: Map<string, string>,
): GroupSection[] {
  const sections = new Map<string, GroupSection>();

  const ensure = (key: string, label: string) => {
    if (!sections.has(key)) sections.set(key, { key, label, passCount: 0, failCount: 0, entries: [] });
    return sections.get(key)!;
  };

  for (const spec of report.results) {
    for (const el of spec.elements) {
      if (el.status === "passed") {
        if (mode === "spec") ensure(spec.specificationId, spec.specificationName).passCount++;
        continue;
      }

      const failures = el.failures.map((f) => f.message);

      if (mode === "spec") {
        const sec = ensure(spec.specificationId, spec.specificationName);
        sec.failCount++;
        sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures });
      } else if (mode === "pset") {
        const psets = new Map<string, string[]>();
        for (const f of el.failures) {
          const pset = extractPset(f.message);
          if (!psets.has(pset)) psets.set(pset, []);
          psets.get(pset)!.push(f.message);
        }
        for (const [pset, msgs] of psets) {
          const sec = ensure(pset, pset);
          sec.failCount++;
          sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures: msgs });
        }
      } else if (mode === "missingProp") {
        const props = new Map<string, string[]>();
        for (const f of el.failures) {
          if (!f.message.includes("fehlt") && !f.message.includes("leer")) continue;
          const prop = extractProp(f.message);
          if (!props.has(prop)) props.set(prop, []);
          props.get(prop)!.push(f.message);
        }
        if (props.size === 0) {
          // Value mismatch, not a missing prop — skip in this mode
          continue;
        }
        for (const [prop, msgs] of props) {
          const sec = ensure(prop, prop);
          sec.failCount++;
          sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures: msgs });
        }
      } else if (mode === "ifcClass") {
        const key = el.type ?? "UNBEKANNT";
        const sec = ensure(key, key);
        sec.failCount++;
        sec.entries.push({ modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type, specName: spec.specificationName, failures });
      } else if (mode === "ifcFile") {
        const label = modelNames.get(el.modelId) ?? el.modelId;
        const sec = ensure(el.modelId, label);
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

const VISIBLE_LIMIT = 200;

export function IdsResultsWindow() {
  const [report, setReport] = useState<IdsValidationReport | null>(null);
  const [modelNames, setModelNames] = useState<Map<string, string>>(new Map());
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
        if (msg.modelNames) setModelNames(new Map(Object.entries(msg.modelNames)));
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

  const groups = useMemo(
    () => report ? groupResults(report, groupMode, modelNames) : [],
    [report, groupMode, modelNames],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const expandAll = () => setExpandedKeys(new Set(groups.map((g) => g.key)));
  const collapseAll = () => setExpandedKeys(new Set());

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
    a.download = `ids-pruefbericht-${new Date().toISOString().slice(0, 10)}.csv`;
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
            <span className="text-muted-foreground truncate max-w-[260px]">{report.documentTitle}</span>
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
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/30 shrink-0 flex-wrap">
            <span className="font-medium">{totalSpecs} Specs</span>
            <span className="flex items-center gap-1 text-green-500"><Check size={11} /> {passedSpecs} OK</span>
            {failedSpecs > 0 && <span className="flex items-center gap-1 text-red-400"><AlertTriangle size={11} /> {failedSpecs} Fehler</span>}
            {skippedSpecs > 0 && <span className="text-muted-foreground">{skippedSpecs} übersprungen</span>}
            <span className="text-muted-foreground">|</span>
            <span className="text-muted-foreground">{totalElements} Elemente</span>
            {failedElements > 0 && <span className="text-red-400">{failedElements} fehlerhaft</span>}

            <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
              <label className="text-[10px] text-muted-foreground">Gruppe:</label>
              <select
                className="text-[10px] bg-muted/40 border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
                value={groupMode}
                onChange={(e) => { setGroupMode(e.target.value as GroupMode); setExpandedKeys(new Set()); }}
              >
                <option value="spec">Prüfregel</option>
                <option value="pset">PropertySet</option>
                <option value="missingProp">Fehlende Property</option>
                <option value="ifcClass">IFC-Klasse</option>
                <option value="ifcFile">IFC-Datei</option>
              </select>
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                onClick={expandAll}
                title="Alle aufklappen"
              >
                <ChevronsUpDown size={10} />
              </button>
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                onClick={collapseAll}
                title="Alle zuklappen"
              >
                <ChevronsDownUp size={10} />
              </button>
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
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
            {groups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <Check size={32} className="text-green-500 opacity-60" />
                <p className="text-sm">Alle Prüfregeln bestanden</p>
              </div>
            )}
            {groups.map((group) => {
              const isExpanded = expandedKeys.has(group.key);
              const hasFail = group.failCount > 0;

              return (
                <div
                  key={group.key}
                  className={cn(
                    "border rounded-lg overflow-hidden",
                    hasFail ? "border-red-500/25" : "border-green-500/25",
                  )}
                >
                  <button
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                      hasFail ? "hover:bg-red-500/5" : "hover:bg-green-500/5",
                    )}
                    onClick={() => toggleExpand(group.key)}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="text-muted-foreground shrink-0" />
                      : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
                    <span className="flex-1 text-xs font-medium min-w-0 break-words">{group.label}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {group.passCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-green-500">
                          <Check size={9} /> {group.passCount}
                        </span>
                      )}
                      {hasFail && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                          {group.failCount}✗
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && group.entries.length > 0 && (
                    <div className="border-t border-border/40 divide-y divide-border/15 bg-background/60">
                      {group.entries.slice(0, VISIBLE_LIMIT).map((entry, i) => (
                        <EntryRow
                          key={`${entry.modelId}:${entry.expressId}:${i}`}
                          entry={entry}
                          showSpec={groupMode !== "spec"}
                          onSelect={() => sendAction({ k: "select", modelId: entry.modelId, expressId: entry.expressId })}
                          onIsolate={() => sendAction({ k: "isolate", modelId: entry.modelId, expressId: entry.expressId })}
                        />
                      ))}
                      {group.entries.length > VISIBLE_LIMIT && (
                        <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60 italic">
                          … {group.entries.length - VISIBLE_LIMIT} weitere Einträge (CSV-Export für vollständige Liste)
                        </div>
                      )}
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

interface EntryRowProps {
  entry: FailEntry;
  showSpec: boolean;
  onSelect: () => void;
  onIsolate: () => void;
}

function EntryRow({ entry, showSpec, onSelect, onIsolate }: EntryRowProps) {
  return (
    <div
      className="px-3 py-1.5 hover:bg-muted/15 transition-colors cursor-pointer group"
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <AlertTriangle size={9} className="text-red-400 shrink-0 mt-px" />
        <span className="font-medium truncate flex-1 text-[11px]">{entry.name || `#${entry.expressId}`}</span>
        <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
          {entry.type && (
            <span className="text-[9px] text-muted-foreground bg-muted/30 px-1 py-px rounded">
              {entry.type.replace(/^IFC/i, "")}
            </span>
          )}
          <span className="text-[9px] text-muted-foreground/70">#{entry.expressId}</span>
          <button
            className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Element isolieren"
            onClick={(e) => { e.stopPropagation(); onIsolate(); }}
          >
            <EyeOff size={9} />
          </button>
        </div>
      </div>
      {showSpec && (
        <div className="text-[9px] text-muted-foreground/50 pl-3.5 leading-tight truncate">{entry.specName}</div>
      )}
      <div className="pl-3.5 mt-0.5 flex flex-col gap-px">
        {entry.failures.slice(0, 4).map((f, fi) => (
          <p key={fi} className="text-[9px] text-red-300/70 leading-tight break-words">{f}</p>
        ))}
        {entry.failures.length > 4 && (
          <p className="text-[9px] text-muted-foreground/40">+{entry.failures.length - 4} weitere</p>
        )}
      </div>
    </div>
  );
}
