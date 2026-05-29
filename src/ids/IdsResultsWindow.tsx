import { useEffect, useState, useMemo, useCallback } from "react";
import {
  ChevronDown, ChevronRight, AlertTriangle, Check, Download,
  Eye, EyeOff, X, FileCheck2,
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
          <button
            className="flex items-center gap-1 border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={exportCSV}
          >
            <Download size={11} /> CSV
          </button>
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
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
            className="border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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
            className="border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={expandAll}
            title="Alle aufklappen"
          >
            Alle ↓
          </button>
          <button
            className="border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            style={{ fontSize: 11 }}
            onClick={collapseAll}
            title="Alle zuklappen"
          >
            Alle ↑
          </button>
          <button
            className="border border-border rounded px-2 py-1 flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
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
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── GroupRow ───────────────────────────────────────────────────────────────────

interface GroupRowProps {
  group: GroupSection;
  isExpanded: boolean;
  showSpec: boolean;
  onToggle: () => void;
  onSelect: (modelId: string, expressId: number) => void;
  onIsolate: (modelId: string, expressId: number) => void;
}

const ENTRY_LIMIT = 300;

function GroupRow({ group, isExpanded, showSpec, onToggle, onSelect, onIsolate }: GroupRowProps) {
  const hasFail = group.failCount > 0;

  return (
    <div className="border-b border-border">
      {/* Group header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 text-foreground bg-card hover:bg-muted/40 transition-colors text-left"
        style={{ minHeight: 40, fontSize: 13 }}
      >
        <span className="text-muted-foreground shrink-0">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="flex-1 font-medium" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {group.label}
        </span>
        <span className="shrink-0 flex items-center gap-3" style={{ fontSize: 12 }}>
          {group.passCount > 0 && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Check size={11} /> {group.passCount}
            </span>
          )}
          {hasFail && (
            <span
              className="font-semibold px-2 rounded"
              style={{
                color: "#ef4444",
                backgroundColor: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.3)",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {group.failCount} ✗
            </span>
          )}
        </span>
      </button>

      {/* Entries */}
      {isExpanded && (
        <div className="bg-background">
          {/* Column headers */}
          <div
            className="grid border-b border-border bg-muted/20 text-muted-foreground"
            style={{
              gridTemplateColumns: "1fr 140px 80px 28px",
              fontSize: 11,
              padding: "4px 16px 4px 40px",
              gap: 8,
            }}
          >
            <span>Name / Element</span>
            {showSpec && <span>Prüfregel</span>}
            <span style={{ gridColumn: showSpec ? undefined : "2" }}>Typ</span>
            <span style={{ textAlign: "right" }}>ID</span>
            <span />
          </div>

          {group.entries.slice(0, ENTRY_LIMIT).map((entry, i) => (
            <EntryRow
              key={`${entry.modelId}:${entry.expressId}:${i}`}
              entry={entry}
              showSpec={showSpec}
              onSelect={() => onSelect(entry.modelId, entry.expressId)}
              onIsolate={() => onIsolate(entry.modelId, entry.expressId)}
            />
          ))}

          {group.entries.length > ENTRY_LIMIT && (
            <div
              className="px-4 py-2 text-muted-foreground border-t border-border"
              style={{ fontSize: 11, paddingLeft: 40 }}
            >
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
}

function EntryRow({ entry, showSpec, onSelect, onIsolate }: EntryRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
      style={{ cursor: "pointer" }}
      onClick={() => { onSelect(); setOpen((v) => !v); }}
    >
      {/* Main row */}
      <div
        className="grid items-center text-foreground"
        style={{
          gridTemplateColumns: showSpec ? "1fr 140px 80px 60px 28px" : "1fr 80px 60px 28px",
          fontSize: 12,
          padding: "6px 16px 6px 40px",
          gap: 8,
          minHeight: 36,
        }}
      >
        {/* Name */}
        <span
          className="flex items-center gap-2 font-medium"
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <AlertTriangle size={11} className="text-red-500 shrink-0" />
          {entry.name || `#${entry.expressId}`}
        </span>

        {/* Spec (optional) */}
        {showSpec && (
          <span
            className="text-muted-foreground"
            style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={entry.specName}
          >
            {entry.specName}
          </span>
        )}

        {/* Type */}
        <span
          className="text-muted-foreground"
          style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {entry.type?.replace(/^IFC/i, "") ?? "–"}
        </span>

        {/* Express ID */}
        <span className="text-muted-foreground" style={{ fontSize: 11, textAlign: "right" }}>
          #{entry.expressId}
        </span>

        {/* Isolate button */}
        <button
          className="flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          style={{ width: 24, height: 24 }}
          title="Isolieren & Zoomen"
          onClick={(e) => { e.stopPropagation(); onIsolate(); }}
        >
          <EyeOff size={12} />
        </button>
      </div>

      {/* Failure messages — shown inline below row */}
      {entry.failures.length > 0 && (
        <div
          className="text-red-500"
          style={{
            fontSize: 11,
            padding: "0 16px 6px 64px",
            lineHeight: 1.5,
            display: open ? undefined : "-webkit-box",
            WebkitLineClamp: open ? undefined : 1,
            WebkitBoxOrient: open ? undefined : "vertical" as const,
            overflow: open ? undefined : "hidden",
          }}
        >
          {entry.failures.map((f, fi) => (
            <div key={fi}>{f}</div>
          ))}
        </div>
      )}
    </div>
  );
}
