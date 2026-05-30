import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  ChevronDown, ChevronRight, AlertTriangle, Check, Download,
  Eye, EyeOff, X, FileCheck2, Wrench,
} from "lucide-react";
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

function extractPset(msg: string): string {
  const m = msg.match(/^"([^."]+)\./);
  return m ? m[1] : "Unbekannter PSet";
}

function extractProp(msg: string): string {
  const withPset = msg.match(/^"[^."]+\.([^"]+)"\s+fehlt/);
  if (withPset) return withPset[1];
  const plain = msg.match(/^"([^"]+)"\s+fehlt/);
  if (plain) return plain[1];
  const attr = msg.match(/Attribut "([^"]+)"/);
  if (attr) return attr[1];
  return msg.slice(0, 50);
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
        if (props.size === 0) continue;
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

  const sendAction = useCallback((a: SyncAction) => {
    syncCh?.postMessage({ t: "act", a } satisfies SyncMsg);
  }, [syncCh]);

  const [fixStatus, setFixStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const fixStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFixes = useCallback(async (fixes: Array<{ modelId: string; expressId: number; pset: string; prop: string; value: string }>) => {
    if (fixes.length === 0) return;
    setFixStatus("running");

    // Group fixes by modelId
    const byModel = new Map<string, typeof fixes>();
    for (const f of fixes) {
      const arr = byModel.get(f.modelId) ?? [];
      arr.push(f);
      byModel.set(f.modelId, arr);
    }

    let anyError = false;
    for (const [modelId, modelFixes] of byModel) {
      const modelName = modelNames.get(modelId);
      if (!modelName) { anyError = true; continue; }

      try {
        const res = await fetch("http://127.0.0.1:8765/patch-properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: modelName,
            fixes: modelFixes.map(f => ({ express_id: f.expressId, pset: f.pset, prop: f.prop, value: f.value })),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) { anyError = true; continue; }
        // Trigger model reload in main window
        sendAction({ k: "reloadModelFromServer", modelId });
      } catch {
        anyError = true;
      }
    }

    setFixStatus(anyError ? "error" : "done");
    if (fixStatusTimer.current) clearTimeout(fixStatusTimer.current);
    fixStatusTimer.current = setTimeout(() => setFixStatus("idle"), 8000);
  }, [modelNames, sendAction]);

  const groups = useMemo(
    () => report ? groupResults(report, groupMode, modelNames) : [],
    [report, groupMode, modelNames],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setExpandedKeys(new Set(groups.map((g) => g.key))), [groups]);
  const collapseAll = useCallback(() => setExpandedKeys(new Set()), []);

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

  // ── Waiting state ──────────────────────────────────────────────────────────
  if (!report) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "system-ui, sans-serif", color: "#888" }}>
        <FileCheck2 size={40} style={{ opacity: 0.2 }} />
        <p style={{ fontSize: 14, margin: 0 }}>Warte auf Prüfergebnis vom Hauptfenster…</p>
        <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>Prüfung im IDS-Panel starten, um Ergebnisse hier anzuzeigen.</p>
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden" style={{ fontSize: 13 }}>

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 border-b border-border bg-card" style={{ minHeight: 44 }}>
        <FileCheck2 size={15} className="text-primary shrink-0" />
        <span className="font-semibold">IDS Prüfbericht</span>
        <span className="text-muted-foreground mx-1">·</span>
        <span className="text-muted-foreground truncate" style={{ maxWidth: 280, fontSize: 12 }}>{report.documentTitle}</span>
        <span className="text-muted-foreground mx-1">·</span>
        <span className="text-muted-foreground" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{new Date(report.timestamp).toLocaleString("de-AT")}</span>
        <div className="ml-auto flex items-center gap-2">
          {fixStatus === "running" && (
            <span className="text-[11px] text-amber-500 flex items-center gap-1">
              <Wrench size={11} className="animate-pulse" /> Ergänze…
            </span>
          )}
          {fixStatus === "done" && (
            <span className="text-[11px] text-green-500 flex items-center gap-1">
              <Check size={11} /> Properties angelegt — Modell wird im Hintergrund neu geladen
            </span>
          )}
          {fixStatus === "error" && (
            <span className="text-[11px] text-red-400 flex items-center gap-1">
              <AlertTriangle size={11} /> Server nicht erreichbar
            </span>
          )}
          <button
            className="flex items-center gap-1 border border-border rounded-[4px] px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={exportCSV}
          >
            <Download size={11} /> CSV
          </button>
          <button
            className="p-1 rounded-[4px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            onClick={() => window.close()}
            title="Fenster schließen"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Summary + Toolbar ── */}
      <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 flex items-center gap-4 flex-wrap" style={{ fontSize: 12 }}>
        {/* Stats */}
        <span className="font-medium">{totalSpecs} Specs</span>
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <Check size={12} /> {passedSpecs} OK
        </span>
        {failedSpecs > 0 && (
          <span className="flex items-center gap-1 text-red-500">
            <AlertTriangle size={12} /> {failedSpecs} fehlgeschlagen
          </span>
        )}
        {skippedSpecs > 0 && (
          <span className="text-muted-foreground">{skippedSpecs} übersprungen</span>
        )}
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground">{totalElements.toLocaleString()} Elemente</span>
        {failedElements > 0 && (
          <span className="font-medium text-red-500">{failedElements.toLocaleString()} fehlerhaft</span>
        )}

        {/* Controls */}
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <label className="text-muted-foreground" style={{ fontSize: 11 }}>Gruppierung:</label>
          <select
            className="border border-border rounded-[4px] px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            style={{ fontSize: 12 }}
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
            className="border border-border rounded-[4px] px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={expandAll}
            title="Alle aufklappen"
          >
            Alle ↓
          </button>
          <button
            className="border border-border rounded-[4px] px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={collapseAll}
            title="Alle zuklappen"
          >
            Alle ↑
          </button>
          <button
            className="border border-border rounded-[4px] px-2 py-1 flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={() => sendAction({ k: "showAll" })}
          >
            <Eye size={11} /> Einblenden
          </button>
        </div>
      </div>

      {/* ── Groups ── */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Check size={36} className="text-green-500 opacity-50" />
            <p style={{ fontSize: 14 }}>Alle Prüfregeln bestanden</p>
          </div>
        ) : (
          groups.map((group) => (
            <GroupRow
              key={group.key}
              group={group}
              isExpanded={expandedKeys.has(group.key)}
              showSpec={groupMode !== "spec"}
              onToggle={() => toggleExpand(group.key)}
              onSelect={(modelId, expressId) => sendAction({ k: "select", modelId, expressId })}
              onIsolate={(modelId, expressId) => sendAction({ k: "isolate", modelId, expressId })}
              onFix={applyFixes}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Fix helpers ────────────────────────────────────────────────────────────────

function parseMissingFixes(entry: FailEntry): Array<{ pset: string; prop: string }> {
  return entry.failures
    .filter(f => f.includes("fehlt") || f.includes("leer"))
    .map(f => {
      const withPset = f.match(/^"([^."]+)\.([^"]+)"\s+fehlt/);
      if (withPset) return { pset: withPset[1], prop: withPset[2] };
      const plain = f.match(/^"([^"]+)"\s+fehlt/);
      if (plain) return { pset: "", prop: plain[1] };
      const attr = f.match(/Attribut "([^"]+)"/);
      if (attr) return { pset: "", prop: attr[1] };
      return null;
    })
    .filter((x): x is { pset: string; prop: string } => x !== null);
}

// ── GroupRow ───────────────────────────────────────────────────────────────────

interface GroupRowProps {
  group: GroupSection;
  isExpanded: boolean;
  showSpec: boolean;
  onToggle: () => void;
  onSelect: (modelId: string, expressId: number) => void;
  onIsolate: (modelId: string, expressId: number) => void;
  onFix: (fixes: Array<{ modelId: string; expressId: number; pset: string; prop: string; value: string }>) => void;
}

const ENTRY_LIMIT = 300;

function GroupRow({ group, isExpanded, showSpec, onToggle, onSelect, onIsolate, onFix }: GroupRowProps) {
  const hasFail = group.failCount > 0;

  const allGroupFixes = group.entries.flatMap(entry =>
    parseMissingFixes(entry).map(f => ({ modelId: entry.modelId, expressId: entry.expressId, pset: f.pset, prop: f.prop, value: "" }))
  );

  return (
    <div className="border-b border-border">
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-4 bg-card hover:bg-muted/30 transition-colors border-l-4"
        style={{ minHeight: 44, borderLeftColor: hasFail ? "rgb(239 68 68 / 0.7)" : "transparent" }}
      >
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left py-2">
          <span className="text-muted-foreground shrink-0">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="flex-1 font-semibold text-[13px] truncate">{group.label}</span>
        </button>
        <div className="shrink-0 flex items-center gap-2 text-[12px]">
          {group.passCount > 0 && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 bg-green-500/10 rounded-[4px] px-2 py-0.5">
              <Check size={11} /> {group.passCount}
            </span>
          )}
          {hasFail && (
            <span className="font-semibold px-2 py-0.5 rounded-[4px] bg-red-500/10 border border-red-500/30 text-red-500">
              {group.failCount} Fehler
            </span>
          )}
          {allGroupFixes.length > 0 && (
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-[11px] transition-colors"
              title={`${allGroupFixes.length} fehlende Properties automatisch ergänzen`}
              onClick={e => { e.stopPropagation(); onFix(allGroupFixes); }}
            >
              <Wrench size={11} /> Alle ergänzen ({allGroupFixes.length})
            </button>
          )}
        </div>
      </div>

      {/* Entries */}
      {isExpanded && (
        <div className="bg-background">
          {group.entries.slice(0, ENTRY_LIMIT).map((entry, i) => (
            <EntryRow
              key={`${entry.modelId}:${entry.expressId}:${i}`}
              entry={entry}
              showSpec={showSpec}
              onSelect={() => onSelect(entry.modelId, entry.expressId)}
              onIsolate={() => onIsolate(entry.modelId, entry.expressId)}
              onFix={onFix}
            />
          ))}

          {group.entries.length > ENTRY_LIMIT && (
            <div className="px-10 py-2 text-muted-foreground border-t border-border text-[11px]">
              … {(group.entries.length - ENTRY_LIMIT).toLocaleString()} weitere Einträge – CSV-Export für vollständige Liste
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EntryRow ───────────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: FailEntry;
  showSpec: boolean;
  onSelect: () => void;
  onIsolate: () => void;
  onFix: (fixes: Array<{ modelId: string; expressId: number; pset: string; prop: string; value: string }>) => void;
}

function EntryRow({ entry, showSpec, onSelect, onIsolate, onFix }: EntryRowProps) {
  const fixes = parseMissingFixes(entry);

  return (
    <div
      className="border-b border-border/40 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={onSelect}
    >
      {/* Main info row */}
      <div className="flex items-start gap-3 px-4 py-2.5 pl-10">
        <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="font-medium text-[12px] text-foreground">{entry.name || `#${entry.expressId}`}</span>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0 rounded-[3px] border border-border font-mono">
              {entry.type?.replace(/^IFC/i, "") ?? "–"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 font-mono">#{entry.expressId}</span>
            {showSpec && (
              <span className="text-[10px] text-muted-foreground italic truncate max-w-[200px]" title={entry.specName}>{entry.specName}</span>
            )}
          </div>
          {/* Failure badges */}
          <div className="flex flex-wrap gap-1.5">
            {entry.failures.map((f, fi) => (
              <span
                key={fi}
                className="inline-flex items-center bg-red-500/8 text-red-500 dark:text-red-400 border border-red-500/20 rounded-[4px] px-2 py-0.5 text-[10px] leading-snug"
                title={f}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {fixes.length > 0 && (
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-[4px] bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-[10px] transition-colors"
              title="Fehlende Properties ergänzen"
              onClick={e => {
                e.stopPropagation();
                onFix(fixes.map(f => ({ modelId: entry.modelId, expressId: entry.expressId, pset: f.pset, prop: f.prop, value: "" })));
              }}
            >
              <Wrench size={10} /> Ergänzen
            </button>
          )}
          <button
            className="flex items-center justify-center w-7 h-7 rounded-[4px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Isolieren & Zoomen"
            onClick={e => { e.stopPropagation(); onIsolate(); }}
          >
            <EyeOff size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
