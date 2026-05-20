import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { AlertTriangle, Play, Loader2, ChevronDown, ChevronRight, Download, Plus, Trash2, Check, AlertCircle, X, Focus, ArrowUpDown } from "lucide-react";
import { cn } from "../lib/utils";
import {
  COLLISION_CHANNEL,
  DEFAULT_CLASH_RULES,
} from "../utils/windowSync";
import type {
  CollisionMsg, CollisionSyncState, ClashRule, ClashResult, ClashStatus, Severity, PropCondition, ComponentFilter,
} from "../utils/windowSync";

type GroupBy = "none" | "rule" | "severity" | "typePair" | "status";
type SortBy = "severity" | "rule" | "nameA" | "overlap" | "status";

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const STATUS_ORDER: Record<ClashStatus, number> = { new: 0, approved: 1, resolved: 2 };

export function CollisionWindow() {
  const chRef = useRef<BroadcastChannel | null>(null);
  const [state, setState] = useState<CollisionSyncState>({
    rules: DEFAULT_CLASH_RULES,
    results: [],
    running: false,
    progress: 0,
    allTypes: [],
    loadedPropKeys: [],
    theme: "dark",
  });
  const [activeRule, setActiveRule] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editRule, setEditRule] = useState<ClashRule | null>(null);
  const [localRules, setLocalRules] = useState<ClashRule[]>(DEFAULT_CLASH_RULES);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortBy, setSortBy] = useState<SortBy>("severity");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.theme !== "light");
  }, [state.theme]);

  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(COLLISION_CHANNEL); } catch { return; }
    chRef.current = ch;

    ch.onmessage = (e: MessageEvent<CollisionMsg>) => {
      const msg = e.data;
      if (msg.t === "state") {
        setState(msg.s);
        setLocalRules(msg.s.rules);
      }
    };

    ch.postMessage({ t: "req" } satisfies CollisionMsg);

    return () => { ch.close(); chRef.current = null; };
  }, []);

  const sendRun = useCallback(() => {
    chRef.current?.postMessage({ t: "run", rules: localRules } satisfies CollisionMsg);
  }, [localRules]);

  const sendSetStatus = useCallback((result: ClashResult, status: ClashStatus) => {
    const key = `${result.ruleId}|${result.modelIdA}:${result.expressIdA}|${result.modelIdB}:${result.expressIdB}`;
    chRef.current?.postMessage({ t: "setStatus", key, status } satisfies CollisionMsg);
  }, []);

  const sendIsolate = useCallback((result: ClashResult) => {
    chRef.current?.postMessage({
      t: "isolate",
      modelIdA: result.modelIdA, expressIdA: result.expressIdA,
      modelIdB: result.modelIdB, expressIdB: result.expressIdB,
    } satisfies CollisionMsg);
  }, []);

  const baseResults = useMemo(() =>
    activeRule ? state.results.filter(r => r.ruleId === activeRule) : state.results,
    [state.results, activeRule]
  );

  const sortedResults = useMemo(() => {
    const arr = [...baseResults];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "severity": cmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]; break;
        case "rule":     cmp = a.ruleName.localeCompare(b.ruleName); break;
        case "nameA":    cmp = a.nameA.localeCompare(b.nameA); break;
        case "overlap":  cmp = b.overlap - a.overlap; break;
        case "status":   cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [baseResults, sortBy, sortAsc]);

  const groupedResults = useMemo((): Array<{ label: string; items: ClashResult[] }> => {
    if (groupBy === "none") return [{ label: "", items: sortedResults }];
    const map = new Map<string, ClashResult[]>();
    for (const r of sortedResults) {
      const key =
        groupBy === "rule"     ? r.ruleName :
        groupBy === "severity" ? r.severity.toUpperCase() :
        groupBy === "typePair" ? `${r.typeA.replace("Ifc","")} ↔ ${r.typeB.replace("Ifc","")}` :
        /* status */             r.status.toUpperCase();
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [sortedResults, groupBy]);

  const ruleStats = useMemo(() => {
    const map = new Map<string, { total: number; new: number; approved: number; resolved: number }>();
    for (const r of state.results) {
      let s = map.get(r.ruleId);
      if (!s) { s = { total: 0, new: 0, approved: 0, resolved: 0 }; map.set(r.ruleId, s); }
      s.total++;
      s[r.status]++;
    }
    return map;
  }, [state.results]);

  const hasRun = state.results.length > 0 || (!state.running && state.progress === 100);

  const exportCSV = () => {
    const rows = [
      ["Regel","Typ","Status","TypeA","NameA","TypeB","NameB","Wert","ModelA","ModelB"],
      ...sortedResults.map(r => [
        r.ruleName, r.severity, r.status,
        r.typeA, r.nameA, r.typeB, r.nameB,
        r.overlap.toFixed(4), r.modelIdA, r.modelIdB,
      ]),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(";")).join("\n")], { type: "text/csv" }));
    a.download = `clashes-${Date.now()}.csv`;
    a.click();
  };

  const severityColor = (s: Severity) =>
    s === "error" ? "text-red-400" : s === "warning" ? "text-amber-400" : "text-blue-400";
  const severityBg = (s: Severity) =>
    s === "error" ? "bg-red-400/10 border-red-400/30" : s === "warning" ? "bg-amber-400/10 border-amber-400/30" : "bg-blue-400/10 border-blue-400/30";
  const statusIcon = (st: ClashStatus) =>
    st === "approved" ? <Check size={10} className="text-green-400" /> :
    st === "resolved" ? <Check size={10} className="text-blue-400" /> :
    <AlertCircle size={10} className="text-amber-400" />;

  const toggleSort = (s: SortBy) => {
    if (sortBy === s) setSortAsc(p => !p);
    else { setSortBy(s); setSortAsc(true); }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={15} className="text-amber-400" />
          <h2 className="text-sm font-semibold">Regelbasierte Kollisionsprüfung</h2>
          {hasRun && (
            <span className="text-xs text-muted-foreground">
              · {state.results.length} Konflikte · {state.results.filter(r => r.status === "new").length} offen
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasRun && state.results.length > 0 && (
            <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">
              <Download size={12} /> CSV
            </button>
          )}
          <button onClick={() => window.close()} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Rules panel */}
        <div className="w-64 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Regeln ({localRules.length})</span>
            <button
              onClick={() => {
                const id = `rule-${Date.now()}`;
                setEditRule({
                  id, name: "Neue Regel", enabled: true, severity: "warning",
                  checkType: "hard-clash", tolerance: 0.001,
                  componentA: { ifcTypes: [], conditions: [] },
                  componentB: { ifcTypes: [], conditions: [] },
                });
              }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {localRules.map(rule => {
              const stats = ruleStats.get(rule.id);
              return (
                <div
                  key={rule.id}
                  onClick={() => setActiveRule(activeRule === rule.id ? null : rule.id)}
                  className={cn(
                    "px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors",
                    activeRule === rule.id ? "bg-muted" : "hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setLocalRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: e.target.checked } : r))}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{rule.name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={cn("text-[9px] font-mono", severityColor(rule.severity))}>
                            {rule.severity.toUpperCase()}
                          </span>
                          <span className="text-[9px] text-muted-foreground">·</span>
                          <span className="text-[9px] text-muted-foreground">
                            {rule.checkType === "hard-clash" ? "Kollision" : rule.checkType === "clearance" ? `Abstand ${rule.tolerance}m` : "Duplikat"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 mt-0.5">
                      <button
                        onClick={e => { e.stopPropagation(); setEditRule({ ...rule }); }}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                      >
                        <ChevronRight size={11} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setLocalRules(prev => prev.filter(r => r.id !== rule.id)); }}
                        className="text-muted-foreground hover:text-red-400 p-0.5 rounded"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  {stats && (
                    <div className="flex gap-2 mt-1.5 ml-5">
                      <span className="text-[9px] text-amber-400">{stats.new} neu</span>
                      <span className="text-[9px] text-green-400/70">{stats.approved} OK</span>
                      <span className="text-[9px] text-muted-foreground">{stats.resolved} gel.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-border shrink-0">
            <button
              onClick={sendRun}
              disabled={state.running}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {state.running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {state.running ? `${state.progress}%` : "Prüfung starten"}
            </button>
            {state.running && (
              <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${state.progress}%` }} />
              </div>
            )}
          </div>
        </div>

        {/* Center: Results */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!hasRun && !state.running && (
            <div className="flex-1 flex items-center justify-center text-center text-muted-foreground p-8">
              <div>
                <AlertTriangle size={28} className="mx-auto mb-3 opacity-25" />
                <p className="text-sm font-medium">Regelbasierte Prüfung</p>
                <p className="text-xs mt-1 opacity-60 max-w-xs">
                  Definiere Regeln links und starte die Prüfung. Jede Regel filtert Elemente nach IFC-Typ und Eigenschaften.
                </p>
              </div>
            </div>
          )}

          {state.running && (
            <div className="flex-1 flex items-center justify-center flex-col gap-3">
              <Loader2 size={22} className="animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analysiere Regelkonflikte… {state.progress}%</p>
            </div>
          )}

          {hasRun && !state.running && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Summary bar */}
              <div className="px-4 py-2 border-b border-border shrink-0 flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-4">
                  {(["error","warning","info"] as Severity[]).map(s => {
                    const cnt = sortedResults.filter(r => r.severity === s).length;
                    return cnt > 0 ? (
                      <span key={s} className={cn("text-xs font-medium", severityColor(s))}>
                        ⬤ {cnt} {s === "error" ? "Fehler" : s === "warning" ? "Warnungen" : "Info"}
                      </span>
                    ) : null;
                  })}
                  {sortedResults.length === 0 && (
                    <span className="text-xs text-green-400">✓ Keine Konflikte in dieser Auswahl</span>
                  )}
                </div>
                {activeRule && (
                  <button onClick={() => setActiveRule(null)} className="text-[10px] text-primary hover:underline">
                    Alle anzeigen
                  </button>
                )}
              </div>

              {/* Sort / Group toolbar */}
              <div className="px-4 py-1.5 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Sortieren:</span>
                {([
                  ["severity", "Schwere"],
                  ["rule", "Regel"],
                  ["nameA", "Element A"],
                  ["overlap", "Wert"],
                  ["status", "Status"],
                ] as [SortBy, string][]).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() => toggleSort(s)}
                    className={cn(
                      "flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                      sortBy === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {label}
                    {sortBy === s && <ArrowUpDown size={8} className={sortAsc ? "" : "rotate-180"} />}
                  </button>
                ))}

                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide ml-2">Gruppieren:</span>
                {([
                  ["none", "Keine"],
                  ["rule", "Regel"],
                  ["severity", "Schwere"],
                  ["typePair", "Typpaar"],
                  ["status", "Status"],
                ] as [GroupBy, string][]).map(([g, label]) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                      groupBy === g
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Result list */}
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {groupedResults.map(({ label, items }) => (
                  <div key={label || "_all"}>
                    {label && (
                      <div className="sticky top-0 z-10 px-4 py-1 bg-muted/80 border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {label} <span className="font-normal normal-case">({items.length})</span>
                      </div>
                    )}
                    {items.map((r, idx) => {
                      const key = `${r.ruleId}|${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}`;
                      const expanded = expandedId === key;
                      return (
                        <div key={idx} className={cn("border-b border-border/40 last:border-0", r.status === "resolved" && "opacity-40")}>
                          <div className="w-full flex items-start gap-2 px-3 py-2 hover:bg-muted/25 transition-colors">
                            <button
                              onClick={() => setExpandedId(expanded ? null : key)}
                              className="shrink-0 mt-0.5"
                            >
                              {expanded
                                ? <ChevronDown size={11} className="text-muted-foreground" />
                                : <ChevronRight size={11} className="text-muted-foreground" />
                              }
                            </button>
                            <div className={cn("shrink-0 w-1 self-stretch rounded-full mt-0.5", r.severity === "error" ? "bg-red-400" : r.severity === "warning" ? "bg-amber-400" : "bg-blue-400")} />
                            <button
                              onClick={() => setExpandedId(expanded ? null : key)}
                              className="flex-1 min-w-0 grid grid-cols-2 gap-x-3 text-left"
                            >
                              <div className="min-w-0">
                                <span className="text-[9px] text-muted-foreground font-mono">{r.typeA.replace("Ifc","")}</span>
                                <p className="text-xs text-foreground truncate leading-snug">{r.nameA}</p>
                              </div>
                              <div className="min-w-0">
                                <span className="text-[9px] text-muted-foreground font-mono">{r.typeB.replace("Ifc","")}</span>
                                <p className="text-xs text-foreground truncate leading-snug">{r.nameB}</p>
                              </div>
                            </button>
                            <div className="shrink-0 flex items-center gap-1.5">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-[9px] text-muted-foreground font-mono">
                                  {r.checkType === "clearance" ? `${r.overlap.toFixed(3)} m Abst.` : r.checkType === "duplicate" ? "Duplikat" : "Kollision"}
                                </span>
                                <span className="flex items-center gap-1">{statusIcon(r.status)}</span>
                              </div>
                              <button
                                title="Nur diese Elemente anzeigen"
                                onClick={() => sendIsolate(r)}
                                className="text-muted-foreground hover:text-primary p-0.5 rounded transition-colors"
                              >
                                <Focus size={12} />
                              </button>
                            </div>
                          </div>

                          {expanded && (
                            <div className="px-6 pb-2.5 pt-1 flex flex-col gap-2">
                              <div className={cn("text-[10px] px-2 py-1 rounded border w-fit", severityBg(r.severity))}>
                                <span className={severityColor(r.severity)}>{r.ruleName}</span>
                              </div>
                              {(r.propsA && Object.keys(r.propsA).length > 0) && (
                                <div className="grid grid-cols-2 gap-2">
                                  <PropTable title="Element A" props={r.propsA} />
                                  <PropTable title="Element B" props={r.propsB ?? {}} />
                                </div>
                              )}
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-muted-foreground text-[9px] mx-1">Status:</span>
                                {(["new","approved","resolved"] as ClashStatus[]).map(s => (
                                  <button
                                    key={s}
                                    onClick={() => sendSetStatus(r, s)}
                                    className={cn(
                                      "text-[9px] px-1.5 py-0.5 rounded border transition-colors",
                                      r.status === s
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:border-primary/50"
                                    )}
                                  >
                                    {s === "new" ? "Neu" : s === "approved" ? "Akzeptiert" : "Gelöst"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Rule editor */}
        {editRule && (
          <RuleEditor
            rule={editRule}
            allTypes={state.allTypes}
            loadedPropKeys={state.loadedPropKeys}
            onSave={r => {
              setLocalRules(prev => {
                const idx = prev.findIndex(x => x.id === r.id);
                return idx >= 0 ? prev.map(x => x.id === r.id ? r : x) : [...prev, r];
              });
              setEditRule(null);
            }}
            onClose={() => setEditRule(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── PropTable ─────────────────────────────────────────────────────────────────

function PropTable({ title, props }: { title: string; props: Record<string, string> }) {
  const entries = Object.entries(props).slice(0, 8);
  if (entries.length === 0) return null;
  return (
    <div className="text-[9px]">
      <p className="text-muted-foreground font-semibold mb-0.5">{title}</p>
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <span className="text-muted-foreground shrink-0 truncate" style={{ maxWidth: 90 }}>{k}:</span>
          <span className="text-foreground truncate">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── RuleEditor ────────────────────────────────────────────────────────────────

function RuleEditor({ rule, allTypes, loadedPropKeys, onSave, onClose }: {
  rule: ClashRule;
  allTypes: string[];
  loadedPropKeys: string[];
  onSave(r: ClashRule): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<ClashRule>({ ...rule,
    componentA: { ...rule.componentA, ifcTypes: [...rule.componentA.ifcTypes], conditions: rule.componentA.conditions.map(c => ({ ...c })) },
    componentB: { ...rule.componentB, ifcTypes: [...rule.componentB.ifcTypes], conditions: rule.componentB.conditions.map(c => ({ ...c })) },
  });

  const toggleType = (side: "A" | "B", t: string) => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => {
      const types = prev[key].ifcTypes;
      return { ...prev, [key]: { ...prev[key], ifcTypes: types.includes(t) ? types.filter(x => x !== t) : [...types, t] } };
    });
  };

  const addCondition = (side: "A" | "B") => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({
      ...prev,
      [key]: { ...prev[key], conditions: [...prev[key].conditions, { propName: "", operator: "contains" as const, value: "" }] },
    }));
  };

  const updateCondition = (side: "A" | "B", idx: number, patch: Partial<PropCondition>) => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({
      ...prev,
      [key]: { ...prev[key], conditions: prev[key].conditions.map((c, i) => i === idx ? { ...c, ...patch } : c) },
    }));
  };

  const removeCondition = (side: "A" | "B", idx: number) => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], conditions: prev[key].conditions.filter((_, i) => i !== idx) } }));
  };

  return (
    <div className="w-72 shrink-0 border-l border-border flex flex-col overflow-hidden bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold">Regel bearbeiten</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5"><X size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 flex flex-col gap-3">
        <FieldRow label="Name">
          <input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
        </FieldRow>

        <FieldRow label="Schwere">
          <select value={draft.severity} onChange={e => setDraft(p => ({ ...p, severity: e.target.value as Severity }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded">
            <option value="error">Fehler</option>
            <option value="warning">Warnung</option>
            <option value="info">Info</option>
          </select>
        </FieldRow>

        <FieldRow label="Prüftyp">
          <select value={draft.checkType} onChange={e => setDraft(p => ({ ...p, checkType: e.target.value as import("../utils/windowSync").CheckType }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded">
            <option value="hard-clash">Harte Kollision</option>
            <option value="clearance">Mindestabstand</option>
            <option value="duplicate">Duplikat</option>
          </select>
        </FieldRow>

        <FieldRow label={draft.checkType === "clearance" ? "Mindestabstand (m)" : "Toleranz (m³)"}>
          <input type="number" step={draft.checkType === "clearance" ? "0.05" : "0.0001"} min="0"
            value={draft.tolerance}
            onChange={e => setDraft(p => ({ ...p, tolerance: parseFloat(e.target.value) || 0 }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
        </FieldRow>

        {(["A","B"] as const).map(side => (
          <FilterEditor
            key={side}
            title={`Komponente ${side}`}
            filter={side === "A" ? draft.componentA : draft.componentB}
            allTypes={allTypes}
            loadedPropKeys={loadedPropKeys}
            onToggleType={t => toggleType(side, t)}
            onAddCondition={() => addCondition(side)}
            onUpdateCondition={(i, p) => updateCondition(side, i, p)}
            onRemoveCondition={i => removeCondition(side, i)}
          />
        ))}
      </div>
      <div className="px-3 py-2.5 border-t border-border shrink-0">
        <button onClick={() => onSave(draft)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 transition-opacity">
          <Check size={12} /> Speichern
        </button>
      </div>
    </div>
  );
}

function FilterEditor({ title, filter, allTypes, loadedPropKeys, onToggleType, onAddCondition, onUpdateCondition, onRemoveCondition }: {
  title: string;
  filter: ComponentFilter;
  allTypes: string[];
  loadedPropKeys: string[];
  onToggleType(t: string): void;
  onAddCondition(): void;
  onUpdateCondition(i: number, p: Partial<PropCondition>): void;
  onRemoveCondition(i: number): void;
}) {
  const [showTypes, setShowTypes] = useState(false);
  const datalistId = `props-${title.replace(/\s/g,"")}`;
  return (
    <div className="border border-border rounded p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="text-[9px] text-primary/70">{filter.ifcTypes.length === 0 ? "alle Typen" : `${filter.ifcTypes.length} Typen`}</span>
      </div>

      <button onClick={() => setShowTypes(!showTypes)} className="text-[10px] text-primary hover:underline text-left">
        {showTypes ? "▲" : "▼"} IFC-Typen auswählen
      </button>
      {showTypes && (
        <div className="max-h-28 overflow-y-auto scrollbar-thin flex flex-col gap-0.5">
          {allTypes.map(t => (
            <label key={t} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={filter.ifcTypes.includes(t)}
                onChange={() => onToggleType(t)} className="shrink-0" />
              <span className="text-[9px] text-foreground truncate">{t}</span>
            </label>
          ))}
        </div>
      )}

      {loadedPropKeys.length > 0 && (
        <datalist id={datalistId}>
          {loadedPropKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      )}

      <div className="flex flex-col gap-1">
        {filter.conditions.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={c.propName}
              placeholder="Eigenschaft"
              list={loadedPropKeys.length > 0 ? datalistId : undefined}
              onChange={e => onUpdateCondition(i, { propName: e.target.value })}
              className="flex-1 px-1.5 py-0.5 text-[10px] bg-background border border-border rounded focus:outline-none"
              style={{ minWidth: 0 }}
            />
            <select value={c.operator} onChange={e => onUpdateCondition(i, { operator: e.target.value as PropCondition["operator"] })}
              className="px-1 py-0.5 text-[10px] bg-background border border-border rounded" style={{ width: 70 }}>
              <option value="contains">enthält</option>
              <option value="equals">gleich</option>
              <option value="startsWith">beginnt</option>
              <option value="notEmpty">nicht leer</option>
            </select>
            {c.operator !== "notEmpty" && (
              <input value={c.value} placeholder="Wert" onChange={e => onUpdateCondition(i, { value: e.target.value })}
                className="w-16 px-1.5 py-0.5 text-[10px] bg-background border border-border rounded focus:outline-none" />
            )}
            <button onClick={() => onRemoveCondition(i)} className="text-muted-foreground hover:text-red-400 shrink-0">
              <X size={10} />
            </button>
          </div>
        ))}
        <button onClick={onAddCondition} className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary">
          <Plus size={10} /> Bedingung
        </button>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
