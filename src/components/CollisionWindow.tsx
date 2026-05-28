import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  AlertTriangle, Play, Loader2, ChevronDown, ChevronRight,
  Download, Plus, Trash2, Check, X, Focus, ArrowUpDown,
  Circle, Pencil, ArrowLeft,
} from "lucide-react";
import { cn } from "../lib/utils";
import { COLLISION_CHANNEL, DEFAULT_CLASH_RULES } from "../utils/windowSync";
import type {
  CollisionMsg, CollisionSyncState, ClashRule, ClashResult, ClashStatus,
  Severity, PropCondition, ComponentFilter, CheckType,
} from "../utils/windowSync";

type ViewMode = "results" | "editor";
type GroupBy  = "none" | "rule" | "severity" | "typePair" | "status";
type SortBy   = "severity" | "rule" | "nameA" | "overlap" | "status";

const SEV_ORDER:  Record<Severity, number>    = { error: 0, warning: 1, info: 2 };
const STAT_ORDER: Record<ClashStatus, number> = { new: 0, approved: 1, resolved: 2 };

const ROW = "grid items-center gap-0" as const;
const COL_TEMPLATE = "grid-cols-[4px_1fr_18px_1fr_90px_76px_34px]" as const;

// ── CollisionWindow ───────────────────────────────────────────────────────────

export function CollisionWindow() {
  const chRef = useRef<BroadcastChannel | null>(null);

  const [state, setState] = useState<CollisionSyncState>({
    rules: DEFAULT_CLASH_RULES, results: [], running: false, progress: 0,
    allTypes: [], loadedPropKeys: [], propValues: {}, theme: "dark",
  });
  const [localRules,   setLocalRules]   = useState<ClashRule[]>(DEFAULT_CLASH_RULES);
  const [viewMode,     setViewMode]     = useState<ViewMode>("results");
  const [editingRule,  setEditingRule]  = useState<ClashRule | null>(null);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [expandedKey,  setExpandedKey]  = useState<string | null>(null);
  const [groupBy,  setGroupBy]  = useState<GroupBy>("none");
  const [sortBy,   setSortBy]   = useState<SortBy>("severity");
  const [sortAsc,  setSortAsc]  = useState(true);
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
      if (msg.t === "state") { setState(msg.s); setLocalRules(msg.s.rules); }
    };
    ch.postMessage({ t: "req" } satisfies CollisionMsg);
    return () => { ch.close(); chRef.current = null; };
  }, []);

  const sendRun = useCallback(() =>
    chRef.current?.postMessage({ t: "run", rules: localRules } satisfies CollisionMsg),
    [localRules]);

  const sendSetStatus = useCallback((r: ClashResult, status: ClashStatus) => {
    const key = `${r.ruleId}|${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}`;
    chRef.current?.postMessage({ t: "setStatus", key, status } satisfies CollisionMsg);
  }, []);

  const sendIsolate = useCallback((r: ClashResult) =>
    chRef.current?.postMessage({
      t: "isolate",
      modelIdA: r.modelIdA, expressIdA: r.expressIdA,
      modelIdB: r.modelIdB, expressIdB: r.expressIdB,
    } satisfies CollisionMsg), []);

  // ── Rule editing — replaces right panel, no modal ─────────────────────────

  const openEditor = useCallback((rule: ClashRule) => {
    setEditingRule({
      ...rule,
      componentA: { ...rule.componentA, ifcTypes: [...rule.componentA.ifcTypes], conditions: rule.componentA.conditions.map(c => ({ ...c })) },
      componentB: { ...rule.componentB, ifcTypes: [...rule.componentB.ifcTypes], conditions: rule.componentB.conditions.map(c => ({ ...c })) },
    });
    setViewMode("editor");
  }, []);

  const closeEditor = useCallback(() => { setEditingRule(null); setViewMode("results"); }, []);

  const saveRule = useCallback((rule: ClashRule) => {
    setLocalRules(prev => {
      const idx = prev.findIndex(x => x.id === rule.id);
      return idx >= 0 ? prev.map(x => x.id === rule.id ? rule : x) : [...prev, rule];
    });
    closeEditor();
  }, [closeEditor]);

  const deleteRule = (id: string) => {
    setLocalRules(prev => prev.filter(r => r.id !== id));
    if (editingRule?.id === id) closeEditor();
  };

  const newEmptyRule = (): ClashRule => ({
    id: `rule-${Date.now()}`, name: "Neue Regel", enabled: true,
    severity: "warning", checkType: "hard-clash", tolerance: 0.001,
    componentA: { ifcTypes: [], conditions: [] },
    componentB: { ifcTypes: [], conditions: [] },
  });

  // ── Derived results ───────────────────────────────────────────────────────

  const baseResults = useMemo(() =>
    activeRuleId ? state.results.filter(r => r.ruleId === activeRuleId) : state.results,
    [state.results, activeRuleId]);

  const sortedResults = useMemo(() => {
    const arr = [...baseResults];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "severity": cmp = SEV_ORDER[a.severity]  - SEV_ORDER[b.severity]; break;
        case "rule":     cmp = a.ruleName.localeCompare(b.ruleName);            break;
        case "nameA":    cmp = a.nameA.localeCompare(b.nameA);                  break;
        case "overlap":  cmp = b.overlap - a.overlap;                           break;
        case "status":   cmp = STAT_ORDER[a.status]   - STAT_ORDER[b.status];  break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [baseResults, sortBy, sortAsc]);

  const groupedResults = useMemo((): { label: string; items: ClashResult[] }[] => {
    if (groupBy === "none") return [{ label: "", items: sortedResults }];
    const map = new Map<string, ClashResult[]>();
    for (const r of sortedResults) {
      const key = groupBy === "rule"     ? r.ruleName :
                  groupBy === "severity" ? r.severity :
                  groupBy === "typePair" ? `${r.typeA.replace("Ifc","")} ↔ ${r.typeB.replace("Ifc","")}` :
                  r.status;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [sortedResults, groupBy]);

  const ruleStats = useMemo(() => {
    const m = new Map<string, { total: number; new: number; approved: number; resolved: number }>();
    for (const r of state.results) {
      const s = m.get(r.ruleId) ?? { total: 0, new: 0, approved: 0, resolved: 0 };
      s.total++; s[r.status]++; m.set(r.ruleId, s);
    }
    return m;
  }, [state.results]);

  const hasRun = state.results.length > 0 || (!state.running && state.progress === 100);

  const errCnt  = useMemo(() => state.results.filter(r => r.severity === "error").length,   [state.results]);
  const warnCnt = useMemo(() => state.results.filter(r => r.severity === "warning").length, [state.results]);
  const infoCnt = useMemo(() => state.results.filter(r => r.severity === "info").length,    [state.results]);
  const openCnt = useMemo(() => state.results.filter(r => r.status === "new").length,       [state.results]);

  const exportCSV = () => {
    const rows = [
      ["Regel","Schwere","Status","TypeA","NameA","TypeB","NameB","Wert"],
      ...sortedResults.map(r => [r.ruleName, r.severity, r.status, r.typeA, r.nameA, r.typeB, r.nameB, r.overlap.toFixed(4)]),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(";")).join("\n")], { type: "text/csv" }));
    a.download = `clashes-${Date.now()}.csv`;
    a.click();
  };

  const sevDot  = (s: Severity) => s === "error" ? "bg-red-500"    : s === "warning" ? "bg-amber-400"  : "bg-blue-400";
  const sevText = (s: Severity) => s === "error" ? "text-red-400"  : s === "warning" ? "text-amber-400": "text-blue-400";
  const sevBg   = (s: Severity) => s === "error" ? "bg-red-400/10 border-red-400/30 text-red-400"
                                 : s === "warning" ? "bg-amber-400/10 border-amber-400/30 text-amber-400"
                                 : "bg-blue-400/10 border-blue-400/30 text-blue-400";

  const toggleSort = (s: SortBy) => {
    if (sortBy === s) setSortAsc(p => !p);
    else { setSortBy(s); setSortAsc(true); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">

      {/* ── Window header ── */}
      <div
        className="flex items-center gap-3 px-4 shrink-0 border-b border-border"
        style={{ height: 44, background: "var(--toolbar-bg)", borderTop: "3px solid var(--color-primary)" }}
      >
        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
        <span className="text-sm font-semibold">Kollisionsprüfung</span>
        {hasRun && (
          <div className="flex items-center gap-3 ml-1">
            {errCnt  > 0 && <span className={cn("flex items-center gap-1 text-xs", sevText("error"))}><span className={cn("w-1.5 h-1.5 rounded-full", sevDot("error"))} />{errCnt}</span>}
            {warnCnt > 0 && <span className={cn("flex items-center gap-1 text-xs", sevText("warning"))}><span className={cn("w-1.5 h-1.5 rounded-full", sevDot("warning"))} />{warnCnt}</span>}
            {infoCnt > 0 && <span className={cn("flex items-center gap-1 text-xs", sevText("info"))}><span className={cn("w-1.5 h-1.5 rounded-full", sevDot("info"))} />{infoCnt}</span>}
            <span className="text-xs text-muted-foreground">· {openCnt} offen</span>
          </div>
        )}
        <div className="flex-1" />
        {hasRun && state.results.length > 0 && (
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">
            <Download size={12} /> CSV
          </button>
        )}
        <button onClick={() => window.close()} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: Rules sidebar ── */}
        <div className="w-60 shrink-0 flex flex-col border-r border-border bg-muted/10 overflow-hidden">

          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Regeln ({localRules.length})
            </span>
            <button onClick={() => openEditor(newEmptyRule())}
              title="Neue Regel"
              className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors">
              <Plus size={13} />
            </button>
          </div>

          {/* Rule list */}
          <div className="flex-1 overflow-y-auto">
            {localRules.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <p className="text-[10px] text-muted-foreground">Keine Regeln definiert</p>
                <button onClick={() => openEditor(newEmptyRule())}
                  className="text-[10px] text-primary mt-2 hover:underline">
                  Erste Regel anlegen
                </button>
              </div>
            )}
            {localRules.map(rule => {
              const stats    = ruleStats.get(rule.id);
              const isActive = activeRuleId === rule.id;
              const isEditing = editingRule?.id === rule.id && viewMode === "editor";
              return (
                <div
                  key={rule.id}
                  className={cn(
                    "group relative border-b border-border/40 transition-colors",
                    isEditing  ? "bg-primary/8 border-l-2 border-l-primary pl-[10px]" : "pl-3",
                    !isEditing && (isActive ? "bg-muted/50" : "hover:bg-muted/25")
                  )}
                >
                  <div className="flex items-start gap-2 pr-2 py-2.5">
                    <input type="checkbox" checked={rule.enabled}
                      onChange={e => setLocalRules(p => p.map(r => r.id === rule.id ? { ...r, enabled: e.target.checked } : r))}
                      className="mt-0.5 shrink-0 cursor-pointer" />
                    <span className={cn("mt-1 w-2 h-2 rounded-full shrink-0 ring-1 ring-white/10", sevDot(rule.severity))} />
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => {
                        setActiveRuleId(p => p === rule.id ? null : rule.id);
                        if (viewMode === "editor") closeEditor();
                      }}
                    >
                      <p className="text-[11px] font-medium truncate leading-snug">{rule.name}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">
                        {rule.checkType === "hard-clash" ? "Kollision" :
                         rule.checkType === "clearance"  ? `Abstand ${rule.tolerance}m` : "Duplikat"}
                      </p>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditor(rule)} title="Bearbeiten"
                        className={cn("p-1 rounded transition-colors", isEditing ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                        <Pencil size={10} />
                      </button>
                      <button onClick={() => deleteRule(rule.id)} title="Löschen"
                        className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {stats && stats.total > 0 && (
                    <div className="flex gap-3 pb-2 ml-8">
                      {stats.new      > 0 && <span className="text-[9px] text-amber-400 font-medium">{stats.new} offen</span>}
                      {stats.approved > 0 && <span className="text-[9px] text-green-400">{stats.approved} ok</span>}
                      {stats.resolved > 0 && <span className="text-[9px] text-muted-foreground">{stats.resolved} gel.</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Server status + Run */}
          <div className="p-3 border-t border-border shrink-0 space-y-2 bg-muted/5">
            <div className={cn("flex items-center gap-1.5 text-[9px] px-0.5",
              serverOnline === true  ? "text-green-400" :
              serverOnline === false ? "text-red-400" :
              "text-muted-foreground")}>
              <Circle size={6} className="fill-current shrink-0" />
              {serverOnline === null  ? "Python Server wird geprüft…" :
               serverOnline === true  ? "Python Server verbunden" :
               "Server offline — start-python-server.bat starten"}
            </div>
            <button onClick={sendRun}
              disabled={state.running || serverOnline === false}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
              {state.running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {state.running ? `Analysiere… ${state.progress}%` : "Prüfung starten"}
            </button>
            {state.running && (
              <div className="h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${state.progress}%` }} />
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: Rule editor OR Results ── */}
        {viewMode === "editor" && editingRule ? (
          <RuleEditorPanel
            rule={editingRule}
            allTypes={state.allTypes}
            loadedPropKeys={state.loadedPropKeys}
            propValues={state.propValues ?? {}}
            onSave={saveRule}
            onClose={closeEditor}
          />
        ) : (

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* Empty / running states */}
            {!hasRun && !state.running && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-xs">
                  <AlertTriangle size={30} className="mx-auto mb-3 text-muted-foreground/15" />
                  <p className="text-sm font-medium text-muted-foreground">Bereit zur Prüfung</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Regeln links konfigurieren, dann „Prüfung starten" klicken.
                  </p>
                </div>
              </div>
            )}
            {state.running && (
              <div className="flex-1 flex items-center justify-center flex-col gap-3">
                <Loader2 size={22} className="animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Kollisionen analysieren… {state.progress}%</p>
              </div>
            )}

            {/* Results view */}
            {hasRun && !state.running && (
              <div className="flex flex-col flex-1 min-h-0">

                {/* Toolbar */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 flex-wrap">
                  <div className="flex items-center gap-3">
                    {sortedResults.length === 0
                      ? <span className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> Keine Konflikte</span>
                      : <span className="text-xs text-muted-foreground">{sortedResults.length} Treffer</span>}
                    {activeRuleId && (
                      <button onClick={() => setActiveRuleId(null)}
                        className="text-[10px] text-primary hover:underline">
                        Regelfilter aufheben
                      </button>
                    )}
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">Gruppe:</span>
                    {([
                      ["none",     "—"],
                      ["rule",     "Regel"],
                      ["severity", "Schwere"],
                      ["typePair", "Typpaar"],
                      ["status",   "Status"],
                    ] as [GroupBy, string][]).map(([g, label]) => (
                      <button key={g} onClick={() => setGroupBy(g)}
                        className={cn("px-1.5 py-0.5 rounded border transition-colors",
                          groupBy === g ? "border-primary/60 bg-primary/10 text-primary" : "border-border hover:border-primary/30")}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table header */}
                <div className={cn(ROW, COL_TEMPLATE, "px-4 py-1.5 border-b border-border shrink-0 bg-muted/30 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground")}>
                  <span />
                  <button onClick={() => toggleSort("nameA")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Element A {sortBy === "nameA" && <ArrowUpDown size={8} />}
                  </button>
                  <span />
                  <span>Element B</span>
                  <button onClick={() => toggleSort("overlap")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Wert {sortBy === "overlap" && <ArrowUpDown size={8} />}
                  </button>
                  <button onClick={() => toggleSort("status")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Status {sortBy === "status" && <ArrowUpDown size={8} />}
                  </button>
                  <span />
                </div>

                {/* Result rows */}
                <div className="flex-1 overflow-y-auto">
                  {groupedResults.map(({ label, items }) => (
                    <div key={label || "_all"}>
                      {label && (
                        <div className="sticky top-0 z-10 px-4 py-1 bg-muted/70 backdrop-blur-sm border-b border-border">
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {label} <span className="font-normal normal-case opacity-60">({items.length})</span>
                          </span>
                        </div>
                      )}
                      {items.map((r, idx) => {
                        const key = `${r.ruleId}|${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}`;
                        const expanded = expandedKey === key;
                        return (
                          <div key={idx} className={cn("border-b border-border/30 last:border-0", r.status === "resolved" && "opacity-40")}>
                            <div
                              className={cn(ROW, COL_TEMPLATE, "px-4 py-2 cursor-pointer hover:bg-muted/20 transition-colors")}
                              onClick={() => setExpandedKey(expanded ? null : key)}
                            >
                              {/* Severity bar */}
                              <span className={cn("self-stretch w-1 rounded-full mr-2", sevDot(r.severity))} />

                              {/* Element A */}
                              <div className="min-w-0 pr-2">
                                <p className="text-[9px] text-muted-foreground font-mono">{r.typeA.replace("Ifc","")}</p>
                                <p className="text-[11px] truncate">{r.nameA || "—"}</p>
                              </div>

                              {/* Separator */}
                              <span className="text-[9px] text-muted-foreground text-center">↔</span>

                              {/* Element B */}
                              <div className="min-w-0 pl-2">
                                <p className="text-[9px] text-muted-foreground font-mono">{r.typeB.replace("Ifc","")}</p>
                                <p className="text-[11px] truncate">{r.nameB || "—"}</p>
                              </div>

                              {/* Value */}
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {r.checkType === "clearance" ? `${r.overlap.toFixed(3)} m` :
                                 r.checkType === "duplicate" ? "Duplikat" : "Kollision"}
                              </span>

                              {/* Status chip */}
                              <StatusChip status={r.status} />

                              {/* Focus button */}
                              <button
                                onClick={e => { e.stopPropagation(); sendIsolate(r); }}
                                title="Nur diese Elemente anzeigen"
                                className="text-muted-foreground hover:text-primary p-1 rounded transition-colors justify-self-center">
                                <Focus size={11} />
                              </button>
                            </div>

                            {/* Expanded details */}
                            {expanded && (
                              <div className="px-5 pb-3 pt-2 border-t border-border/30 bg-muted/5">
                                <div className="flex flex-col gap-2.5">
                                  <div className={cn("text-[9px] px-2 py-0.5 rounded border w-fit", sevBg(r.severity))}>
                                    {r.ruleName}
                                  </div>
                                  {(r.propsA && Object.keys(r.propsA).length > 0) && (
                                    <div className="grid grid-cols-2 gap-4">
                                      <PropTable title={`Element A${r.nameA ? ` — ${r.nameA}` : ""}`} props={r.propsA} />
                                      <PropTable title={`Element B${r.nameB ? ` — ${r.nameB}` : ""}`} props={r.propsB ?? {}} />
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[9px] text-muted-foreground">Status:</span>
                                    {(["new","approved","resolved"] as ClashStatus[]).map(s => (
                                      <button key={s} onClick={() => sendSetStatus(r, s)}
                                        className={cn("text-[9px] px-2 py-0.5 rounded border transition-colors",
                                          r.status === s ? "border-primary bg-primary/10 text-primary" :
                                          "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                                        {s === "new" ? "Offen" : s === "approved" ? "Akzeptiert" : "Gelöst"}
                                      </button>
                                    ))}
                                  </div>
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
        )}
      </div>
    </div>
  );
}

// ── StatusChip ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: ClashStatus }) {
  const cls =
    status === "new"      ? "bg-amber-400/10 text-amber-400 border-amber-400/30" :
    status === "approved" ? "bg-green-400/10 text-green-400 border-green-400/30" :
    "bg-muted/50 text-muted-foreground border-border";
  const label = status === "new" ? "Offen" : status === "approved" ? "Akzeptiert" : "Gelöst";
  return <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-medium", cls)}>{label}</span>;
}

// ── PropTable ─────────────────────────────────────────────────────────────────

function PropTable({ title, props }: { title: string; props: Record<string, string> }) {
  const entries = Object.entries(props).slice(0, 8);
  if (entries.length === 0) return null;
  return (
    <div className="text-[9px]">
      <p className="text-muted-foreground font-semibold mb-1">{title}</p>
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 mb-0.5">
          <span className="text-muted-foreground shrink-0 truncate" style={{ maxWidth: 100 }}>{k}:</span>
          <span className="text-foreground truncate">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── IFC Presets ───────────────────────────────────────────────────────────────

const IFC_PRESETS = [
  { label: "Tragwerk",    types: ["IfcBeam","IfcColumn","IfcWall","IfcSlab","IfcFoundation","IfcPile","IfcMember"] },
  { label: "TGA",         types: ["IfcDuctSegment","IfcPipeSegment","IfcCableCarrierSegment","IfcFlowSegment","IfcDistributionFlowElement","IfcDuctFitting","IfcPipeFitting","IfcFlowController","IfcFlowTerminal"] },
  { label: "Architektur", types: ["IfcWall","IfcSlab","IfcRoof","IfcCurtainWall","IfcStair","IfcRamp"] },
];

// ── RuleEditorPanel — inline right panel, no modal ────────────────────────────

function RuleEditorPanel({ rule, allTypes, loadedPropKeys, propValues, onSave, onClose }: {
  rule: ClashRule;
  allTypes: string[];
  loadedPropKeys: string[];
  propValues: Record<string, string[]>;
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

  const setTypes = (side: "A" | "B", types: string[]) => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], ifcTypes: types } }));
  };

  const addCondition = (side: "A" | "B") => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], conditions: [...prev[key].conditions, { propName: "", operator: "contains" as const, value: "" }] } }));
  };

  const updateCondition = (side: "A" | "B", idx: number, patch: Partial<PropCondition>) => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], conditions: prev[key].conditions.map((c, i) => i === idx ? { ...c, ...patch } : c) } }));
  };

  const removeCondition = (side: "A" | "B", idx: number) => {
    const key = side === "A" ? "componentA" : "componentB";
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], conditions: prev[key].conditions.filter((_, i) => i !== idx) } }));
  };

  const sevDotCls = (s: Severity) => s === "error" ? "bg-red-500" : s === "warning" ? "bg-amber-400" : "bg-blue-400";

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* Editor header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-muted/10">
        <button onClick={onClose}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={13} /> Zurück
        </button>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <span className="text-xs font-medium text-foreground truncate">{draft.name || "Neue Regel"}</span>
        <div className="flex-1" />
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

        {/* Basic settings */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-32">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Name</label>
            <input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
              className="px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="flex flex-col gap-1 w-40">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prüftyp</label>
            <select value={draft.checkType} onChange={e => setDraft(p => ({ ...p, checkType: e.target.value as CheckType }))}
              className="px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="hard-clash">Harte Kollision</option>
              <option value="clearance">Mindestabstand</option>
              <option value="duplicate">Duplikat</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Schwere</label>
            <div className="relative">
              <span className={cn("absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full shrink-0", sevDotCls(draft.severity))} />
              <select value={draft.severity} onChange={e => setDraft(p => ({ ...p, severity: e.target.value as Severity }))}
                className="w-full pl-7 pr-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none">
                <option value="error">Fehler</option>
                <option value="warning">Warnung</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {draft.checkType === "clearance" ? "Min. Abstand (m)" : "Toleranz (m)"}
            </label>
            <input type="number" min="0"
              step={draft.checkType === "clearance" ? "0.05" : "0.0001"}
              value={draft.tolerance}
              onChange={e => setDraft(p => ({ ...p, tolerance: parseFloat(e.target.value) || 0 }))}
              className="px-3 py-1.5 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Group A / B editors */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
          <FilterEditor side="A" filter={draft.componentA} allTypes={allTypes}
            loadedPropKeys={loadedPropKeys} propValues={propValues}
            onToggleType={t => toggleType("A", t)} onSetTypes={ts => setTypes("A", ts)}
            onAddCondition={() => addCondition("A")}
            onUpdateCondition={(i, p) => updateCondition("A", i, p)}
            onRemoveCondition={i => removeCondition("A", i)} />

          <div className="flex flex-col items-center self-stretch gap-1 pt-8">
            <div className="w-px flex-1 bg-border/50" />
            <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 bg-muted">↔</span>
            <div className="w-px flex-1 bg-border/50" />
          </div>

          <FilterEditor side="B" filter={draft.componentB} allTypes={allTypes}
            loadedPropKeys={loadedPropKeys} propValues={propValues}
            onToggleType={t => toggleType("B", t)} onSetTypes={ts => setTypes("B", ts)}
            onAddCondition={() => addCondition("B")}
            onUpdateCondition={(i, p) => updateCondition("B", i, p)}
            onRemoveCondition={i => removeCondition("B", i)} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border shrink-0">
        <button onClick={onClose}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/60 rounded-lg transition-colors">
          Abbrechen
        </button>
        <button onClick={() => onSave(draft)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
          <Check size={14} /> Speichern
        </button>
      </div>
    </div>
  );
}

// ── FilterEditor ──────────────────────────────────────────────────────────────

function FilterEditor({ side, filter, allTypes, loadedPropKeys, propValues, onToggleType, onSetTypes, onAddCondition, onUpdateCondition, onRemoveCondition }: {
  side: "A" | "B";
  filter: ComponentFilter;
  allTypes: string[];
  loadedPropKeys: string[];
  propValues: Record<string, string[]>;
  onToggleType(t: string): void;
  onSetTypes(types: string[]): void;
  onAddCondition(): void;
  onUpdateCondition(i: number, p: Partial<PropCondition>): void;
  onRemoveCondition(i: number): void;
}) {
  const [typeSearch,    setTypeSearch]    = useState("");
  const [typeListOpen,  setTypeListOpen]  = useState(false);

  const isA = side === "A";
  const badgeCls = isA
    ? "bg-blue-500/20 text-blue-400 border-blue-400/30"
    : "bg-orange-500/20 text-orange-400 border-orange-400/30";

  const filteredTypes = useMemo(
    () => allTypes.filter(t => t.toLowerCase().includes(typeSearch.toLowerCase())),
    [allTypes, typeSearch],
  );

  const togglePreset = (preset: typeof IFC_PRESETS[number]) => {
    const available = preset.types.filter(t => allTypes.includes(t));
    const allSel = available.every(t => filter.ifcTypes.includes(t));
    available.forEach(t => {
      if (allSel && filter.ifcTypes.includes(t)) onToggleType(t);
      else if (!allSel && !filter.ifcTypes.includes(t)) onToggleType(t);
    });
  };

  return (
    <div className="flex flex-col gap-3 min-w-0">

      {/* Group header */}
      <div className="flex items-start gap-2">
        <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border shrink-0 mt-0.5", badgeCls)}>{side}</span>
        <div>
          <p className="text-xs font-semibold">
            {isA ? "Gruppe A — Geprüfte Elemente" : "Gruppe B — Referenzelemente"}
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">
            {isA ? "Elemente die aktiv auf Kollision geprüft werden (z.B. Tragwerk, Wände)"
                 : "Elemente gegen die geprüft wird (z.B. TGA-Leitungen, Rohre)"}
          </p>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-1">
        {IFC_PRESETS.map(preset => {
          const available = preset.types.filter(t => allTypes.includes(t));
          if (available.length === 0) return null;
          const allSel = available.every(t => filter.ifcTypes.includes(t));
          return (
            <button key={preset.label} onClick={() => togglePreset(preset)}
              className={cn("text-[9px] px-2 py-0.5 rounded border transition-colors",
                allSel ? "bg-primary/15 border-primary/40 text-primary" :
                "bg-muted border-border text-muted-foreground hover:border-primary/30 hover:text-foreground")}>
              {preset.label}
            </button>
          );
        })}
        {filter.ifcTypes.length > 0 && (
          <button onClick={() => onSetTypes([])}
            className="text-[9px] px-2 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-foreground transition-colors">
            Alle Typen
          </button>
        )}
      </div>

      {/* Selected chips */}
      {filter.ifcTypes.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {filter.ifcTypes.map(t => (
            <span key={t} className={cn("flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border", badgeCls)}>
              {t.replace("Ifc","")}
              <button onClick={() => onToggleType(t)} className="hover:opacity-70 transition-opacity"><X size={8} /></button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[9px] text-muted-foreground italic">(leer = alle Typen werden geprüft)</p>
      )}

      {/* Collapsible type list */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setTypeListOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
          <span>IFC-Typen ({allTypes.length})</span>
          {typeListOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {typeListOpen && (
          <>
            <input value={typeSearch} onChange={e => setTypeSearch(e.target.value)}
              placeholder="Typ suchen…"
              className="w-full px-3 py-1.5 text-[10px] bg-background border-t border-border focus:outline-none" />
            <div className="max-h-36 overflow-y-auto scrollbar-thin border-t border-border">
              {filteredTypes.length === 0
                ? <p className="px-3 py-2 text-[9px] text-muted-foreground">Keine Typen</p>
                : filteredTypes.map(t => (
                  <label key={t} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/30 cursor-pointer">
                    <input type="checkbox" checked={filter.ifcTypes.includes(t)}
                      onChange={() => onToggleType(t)} className="h-3 w-3 shrink-0" />
                    <span className="text-[10px]">{t}</span>
                  </label>
                ))
              }
            </div>
          </>
        )}
      </div>

      {/* Property conditions */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Eigenschaftsfilter
          </span>
          {loadedPropKeys.length === 0 && (
            <span className="text-[9px] text-amber-400 flex items-center gap-1">
              <AlertTriangle size={9} /> Properties laden
            </span>
          )}
        </div>

        {filter.conditions.map((c, i) => (
          <ConditionRow key={i} condition={c}
            loadedPropKeys={loadedPropKeys}
            valueOptions={c.propName ? (propValues[c.propName] ?? []) : []}
            onUpdate={p => onUpdateCondition(i, p)}
            onRemove={() => onRemoveCondition(i)} />
        ))}

        <button onClick={onAddCondition}
          disabled={loadedPropKeys.length === 0}
          className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors mt-1 disabled:opacity-35 disabled:cursor-not-allowed">
          <Plus size={10} /> Bedingung
        </button>
      </div>
    </div>
  );
}

// ── ConditionRow ──────────────────────────────────────────────────────────────

function ConditionRow({ condition, loadedPropKeys, valueOptions, onUpdate, onRemove }: {
  condition: PropCondition;
  loadedPropKeys: string[];
  valueOptions: string[];
  onUpdate(p: Partial<PropCondition>): void;
  onRemove(): void;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      {/* Property key */}
      <select value={condition.propName}
        onChange={e => onUpdate({ propName: e.target.value, value: "" })}
        className="flex-1 min-w-0 px-2 py-1 text-[10px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40">
        <option value="">Eigenschaft…</option>
        {loadedPropKeys.map(k => <option key={k} value={k}>{k}</option>)}
      </select>

      {/* Operator */}
      <select value={condition.operator}
        onChange={e => onUpdate({ operator: e.target.value as PropCondition["operator"] })}
        className="px-1.5 py-1 text-[10px] bg-background border border-border rounded-md focus:outline-none shrink-0"
        style={{ width: 76 }}>
        <option value="contains">enthält</option>
        <option value="equals">gleich</option>
        <option value="startsWith">beginnt</option>
        <option value="notEmpty">nicht leer</option>
      </select>

      {/* Value — dropdown when known values exist, text input otherwise */}
      {condition.operator !== "notEmpty" && (
        valueOptions.length > 0 ? (
          <select value={condition.value}
            onChange={e => onUpdate({ value: e.target.value })}
            className="w-24 shrink-0 px-1.5 py-1 text-[10px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40">
            <option value="">Wert…</option>
            {valueOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        ) : (
          <input value={condition.value} placeholder="Wert"
            onChange={e => onUpdate({ value: e.target.value })}
            className="w-24 shrink-0 px-2 py-1 text-[10px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40" />
        )
      )}

      <button onClick={onRemove}
        className="text-muted-foreground hover:text-red-400 shrink-0 p-0.5 transition-colors">
        <X size={10} />
      </button>
    </div>
  );
}
