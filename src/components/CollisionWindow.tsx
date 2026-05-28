import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { AlertTriangle, Play, Loader2, ChevronDown, ChevronRight, Download, Plus, Trash2, Check, AlertCircle, X, Focus, ArrowUpDown, Circle } from "lucide-react";
import { cn } from "../lib/utils";
import {
  COLLISION_CHANNEL,
  DEFAULT_CLASH_RULES,
} from "../utils/windowSync";
import type {
  CollisionMsg, CollisionSyncState, ClashRule, ClashResult, ClashStatus, Severity, PropCondition, ComponentFilter, CheckType,
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
  const [useServer, setUseServer] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.theme !== "light");
  }, [state.theme]);

  useEffect(() => {
    const check = () =>
      fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(1500) })
        .then(() => setServerOnline(true))
        .catch(() => setServerOnline(false));
    check();
    const id = setInterval(check, 6000);
    return () => clearInterval(id);
  }, []);

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
    chRef.current?.postMessage({ t: "run", rules: localRules, useServer } satisfies CollisionMsg);
  }, [localRules, useServer]);

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
      <div
        className="flex items-center justify-between px-5 shrink-0 border-b border-border"
        style={{ height: '44px', background: 'var(--toolbar-bg)', borderTop: '3px solid var(--color-primary)', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}
      >
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

          <div className="p-3 border-t border-border shrink-0 space-y-2">
            {/* Engine toggle */}
            <div className="flex items-center gap-1 p-0.5 bg-muted rounded-md text-[10px]">
              <button
                onClick={() => setUseServer(false)}
                className={cn("flex-1 py-1 rounded transition-colors font-medium",
                  !useServer ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                Lokal (BVH)
              </button>
              <button
                onClick={() => setUseServer(true)}
                className={cn("flex-1 py-1 rounded transition-colors font-medium",
                  useServer ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                IfcOpenShell
              </button>
            </div>

            {/* Server status when IfcOpenShell mode */}
            {useServer && (
              <div className={cn("flex items-center gap-1.5 text-[10px] px-1",
                serverOnline ? "text-green-400" : "text-red-400")}>
                <Circle size={6} className="fill-current shrink-0" />
                {serverOnline === null ? "Prüfe Server…" :
                 serverOnline ? "Python Server verbunden" :
                 "Server offline — python server/server.py starten"}
              </div>
            )}

            <button
              onClick={sendRun}
              disabled={state.running || (useServer && !serverOnline)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {state.running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {state.running ? `${state.progress}%` : "Prüfung starten"}
            </button>
            {state.running && (
              <div className="h-1 bg-border rounded-full overflow-hidden">
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
      </div>

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
  const [draft, setDraft] = useState<ClashRule>({
    ...rule,
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

  const severityDotColor = (s: Severity) =>
    s === "error" ? "bg-red-400" : s === "warning" ? "bg-amber-400" : "bg-blue-400";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl">

        {/* Modal header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Prüfregel konfigurieren</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Definiere welche Elemente geprüft werden und nach welchen Kriterien</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors shrink-0 ml-4">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 flex flex-col gap-5">

          {/* Basic settings row */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-32">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Name</label>
              <input
                value={draft.name}
                onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex flex-col gap-1 w-40">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Prüftyp</label>
              <select
                value={draft.checkType}
                onChange={e => setDraft(p => ({ ...p, checkType: e.target.value as CheckType }))}
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="hard-clash">Harte Kollision</option>
                <option value="clearance">Mindestabstand</option>
                <option value="duplicate">Duplikat</option>
              </select>
            </div>

            <div className="flex flex-col gap-1 w-36">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Schwere</label>
              <div className="relative">
                <span className={cn("absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full shrink-0", severityDotColor(draft.severity))} />
                <select
                  value={draft.severity}
                  onChange={e => setDraft(p => ({ ...p, severity: e.target.value as Severity }))}
                  className="w-full pl-7 pr-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                >
                  <option value="error">Fehler</option>
                  <option value="warning">Warnung</option>
                  <option value="info">Info</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1 w-36">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {draft.checkType === "clearance" ? "Mindestabstand (m)" : "Toleranz (m)"}
              </label>
              <input
                type="number"
                step={draft.checkType === "clearance" ? "0.05" : "0.0001"}
                min="0"
                value={draft.tolerance}
                onChange={e => setDraft(p => ({ ...p, tolerance: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Two-column group editors */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
            {/* Gruppe A */}
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">A</span>
                <div>
                  <p className="text-xs font-semibold text-foreground">Gruppe A — Geprüfte Elemente</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">Elemente die aktiv auf Kollision geprüft werden (z.B. Tragwerk, Wände)</p>
                </div>
              </div>
              <FilterEditor
                filter={draft.componentA}
                allTypes={allTypes}
                loadedPropKeys={loadedPropKeys}
                onToggleType={t => toggleType("A", t)}
                onAddCondition={() => addCondition("A")}
                onUpdateCondition={(i, p) => updateCondition("A", i, p)}
                onRemoveCondition={i => removeCondition("A", i)}
              />
            </div>

            {/* Center divider + badge */}
            <div className="flex flex-col items-center pt-8 gap-2 self-stretch">
              <div className="w-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5 shrink-0">↔</span>
              <div className="w-px flex-1 bg-border" />
            </div>

            {/* Gruppe B */}
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">B</span>
                <div>
                  <p className="text-xs font-semibold text-foreground">Gruppe B — Referenzelemente</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">Elemente gegen die Gruppe A geprüft wird (z.B. TGA, Leitungen)</p>
                </div>
              </div>
              <FilterEditor
                filter={draft.componentB}
                allTypes={allTypes}
                loadedPropKeys={loadedPropKeys}
                onToggleType={t => toggleType("B", t)}
                onAddCondition={() => addCondition("B")}
                onUpdateCondition={(i, p) => updateCondition("B", i, p)}
                onRemoveCondition={i => removeCondition("B", i)}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={() => onSave(draft)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Check size={14} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FilterEditor ──────────────────────────────────────────────────────────────

const IFC_PRESETS: Array<{ label: string; types: string[] }> = [
  { label: "Tragwerk", types: ["IfcBeam", "IfcColumn", "IfcWall", "IfcSlab", "IfcFoundation", "IfcPile", "IfcMember"] },
  { label: "TGA", types: ["IfcDuctSegment", "IfcPipeSegment", "IfcCableCarrierSegment", "IfcFlowSegment", "IfcDistributionFlowElement", "IfcDuctFitting", "IfcPipeFitting", "IfcFlowController", "IfcFlowTerminal"] },
  { label: "Architektur", types: ["IfcWall", "IfcSlab", "IfcRoof", "IfcCurtainWall", "IfcStair", "IfcRamp"] },
];

function FilterEditor({ filter, allTypes, loadedPropKeys, onToggleType, onAddCondition, onUpdateCondition, onRemoveCondition }: {
  filter: ComponentFilter;
  allTypes: string[];
  loadedPropKeys: string[];
  onToggleType(t: string): void;
  onAddCondition(): void;
  onUpdateCondition(i: number, p: Partial<PropCondition>): void;
  onRemoveCondition(i: number): void;
}) {
  const anyPresetSelected = IFC_PRESETS.some(preset => {
    const available = preset.types.filter(t => allTypes.includes(t));
    return available.length > 0 && available.every(t => filter.ifcTypes.includes(t));
  });
  const [typeListOpen, setTypeListOpen] = useState(!anyPresetSelected && filter.ifcTypes.length === 0);
  const [typeSearch, setTypeSearch] = useState("");

  const sortedTypes = useMemo(() => [...allTypes].sort(), [allTypes]);
  const filteredTypes = useMemo(
    () => typeSearch.trim() ? sortedTypes.filter(t => t.toLowerCase().includes(typeSearch.toLowerCase())) : sortedTypes,
    [sortedTypes, typeSearch]
  );

  const togglePreset = (preset: typeof IFC_PRESETS[number]) => {
    const available = preset.types.filter(t => allTypes.includes(t));
    const allSelected = available.every(t => filter.ifcTypes.includes(t));
    available.forEach(t => {
      const isSelected = filter.ifcTypes.includes(t);
      if (allSelected && isSelected) onToggleType(t);
      else if (!allSelected && !isSelected) onToggleType(t);
    });
  };

  const typeCount = filter.ifcTypes.length;

  return (
    <div className="flex flex-col gap-4">

      {/* Section A: IFC-Typen */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">IFC-Typen</span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", typeCount > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
            {typeCount > 0 ? `${typeCount} gewählt` : "alle"}
          </span>
        </div>

        {/* Quick presets */}
        {IFC_PRESETS.some(p => p.types.some(t => allTypes.includes(t))) && (
          <div className="flex flex-wrap gap-1.5">
            {IFC_PRESETS.map(preset => {
              const available = preset.types.filter(t => allTypes.includes(t));
              if (available.length === 0) return null;
              const allSelected = available.every(t => filter.ifcTypes.includes(t));
              return (
                <button
                  key={preset.label}
                  onClick={() => togglePreset(preset)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded border transition-colors",
                    allSelected
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-muted border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Selected type chips */}
        {typeCount > 0 && (
          <div className="flex flex-wrap gap-1">
            {filter.ifcTypes.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-primary/10 border border-primary/25 text-primary rounded"
              >
                {t}
                <button onClick={() => onToggleType(t)} className="hover:text-red-400 transition-colors">
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}
        {typeCount === 0 && (
          <p className="text-[10px] text-muted-foreground italic">(leer = alle Typen geprüft)</p>
        )}

        {/* Collapsible type list */}
        <button
          onClick={() => setTypeListOpen(o => !o)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors self-start"
        >
          {typeListOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Alle Typen {typeListOpen ? "ausblenden" : "anzeigen"}
        </button>
        {typeListOpen && (
          <div className="flex flex-col gap-1.5 border border-border rounded-lg p-2 bg-background/50">
            <input
              value={typeSearch}
              onChange={e => setTypeSearch(e.target.value)}
              placeholder="Typ suchen…"
              className="w-full px-2 py-1 text-[10px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <div className="max-h-40 overflow-y-auto scrollbar-thin flex flex-col gap-0.5">
              {filteredTypes.map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer py-0.5 hover:text-foreground text-muted-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={filter.ifcTypes.includes(t)}
                    onChange={() => onToggleType(t)}
                    className="shrink-0"
                  />
                  <span className="text-[10px] truncate">{t}</span>
                </label>
              ))}
              {filteredTypes.length === 0 && (
                <p className="text-[10px] text-muted-foreground py-1 px-1">Keine Typen gefunden</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section B: Eigenschaftsfilter */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-foreground">Eigenschaftsfilter</span>

        {loadedPropKeys.length === 0 && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-400/8 border border-amber-400/25 rounded-lg text-[10px] text-amber-400">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Properties nicht geladen</p>
              <p className="text-amber-400/80 mt-0.5">Für Filterbedingungen nach Eigenschaften bitte im Hauptfenster: Analyse → Properties laden</p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {filter.conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                value={c.propName}
                onChange={e => onUpdateCondition(i, { propName: e.target.value })}
                className="flex-1 min-w-0 px-2 py-1 text-[10px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Eigenschaft wählen…</option>
                {loadedPropKeys.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <select
                value={c.operator}
                onChange={e => onUpdateCondition(i, { operator: e.target.value as PropCondition["operator"] })}
                className="px-2 py-1 text-[10px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/50 w-24 shrink-0"
              >
                <option value="contains">enthält</option>
                <option value="equals">gleich</option>
                <option value="startsWith">beginnt mit</option>
                <option value="notEmpty">nicht leer</option>
              </select>
              {c.operator !== "notEmpty" && (
                <input
                  value={c.value}
                  placeholder="Wert"
                  onChange={e => onUpdateCondition(i, { value: e.target.value })}
                  className="w-20 shrink-0 px-2 py-1 text-[10px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              )}
              <button onClick={() => onRemoveCondition(i)} className="text-muted-foreground hover:text-red-400 shrink-0 transition-colors p-0.5">
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={onAddCondition}
            disabled={loadedPropKeys.length === 0}
            className="flex items-center gap-1.5 text-[10px] text-primary/70 hover:text-primary transition-colors self-start disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={11} /> Filterbedingung
          </button>
        </div>
      </div>
    </div>
  );
}
