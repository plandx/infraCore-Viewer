import { useState, useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { X, Play, Loader2, AlertTriangle, ChevronDown, ChevronRight, Download, Plus, Trash2, Check, Clock, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import type { IFCModelEntry } from "../types/ifc";

// ── Rule types ─────────────────────────────────────────────────────────────────

type Severity   = "error" | "warning" | "info";
type CheckType  = "hard-clash" | "clearance" | "duplicate";
type ClashStatus = "new" | "approved" | "resolved";

interface PropCondition {
  propName: string;
  operator: "contains" | "equals" | "startsWith" | "notEmpty";
  value: string;
}

interface ComponentFilter {
  ifcTypes: string[];       // empty = all types
  conditions: PropCondition[]; // AND-combined
}

interface ClashRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: Severity;
  checkType: CheckType;
  componentA: ComponentFilter;
  componentB: ComponentFilter;
  tolerance: number;      // m³ for hard-clash; m for clearance
}

interface ClashResult {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  modelIdA: string; expressIdA: number; nameA: string; typeA: string;
  modelIdB: string; expressIdB: number; nameB: string; typeB: string;
  overlap: number;  // m³ (hard-clash) or gap (clearance, negative = violation)
  status: ClashStatus;
  propsA?: Record<string, string>;
  propsB?: Record<string, string>;
}

// ── Default rules ─────────────────────────────────────────────────────────────

const MEP_TYPES   = ["IfcDuctSegment","IfcPipeSegment","IfcCableCarrierSegment","IfcFlowSegment","IfcDistributionFlowElement","IfcDuctFitting","IfcPipeFitting","IfcFlowController","IfcFlowTerminal"];
const STRUCT_TYPES= ["IfcBeam","IfcColumn","IfcWall","IfcSlab","IfcFoundation","IfcPile","IfcMember"];
const ARCH_TYPES  = ["IfcWall","IfcSlab","IfcRoof","IfcCurtainWall","IfcStair","IfcRamp"];

const DEFAULT_RULES: ClashRule[] = [
  {
    id: "rule-struct-mep",
    name: "Tragwerk / TGA Kollision",
    enabled: true,
    severity: "error",
    checkType: "hard-clash",
    tolerance: 0.0005,
    componentA: { ifcTypes: STRUCT_TYPES, conditions: [] },
    componentB: { ifcTypes: MEP_TYPES,   conditions: [] },
  },
  {
    id: "rule-arch-struct",
    name: "Architektur / Tragwerk Kollision",
    enabled: true,
    severity: "warning",
    checkType: "hard-clash",
    tolerance: 0.001,
    componentA: { ifcTypes: ARCH_TYPES,   conditions: [] },
    componentB: { ifcTypes: STRUCT_TYPES, conditions: [] },
  },
  {
    id: "rule-mep-clearance",
    name: "TGA Mindestabstand (0.3 m)",
    enabled: true,
    severity: "warning",
    checkType: "clearance",
    tolerance: 0.3,
    componentA: { ifcTypes: MEP_TYPES, conditions: [] },
    componentB: { ifcTypes: MEP_TYPES, conditions: [] },
  },
  {
    id: "rule-duplicate",
    name: "Duplikat-Elemente",
    enabled: true,
    severity: "info",
    checkType: "duplicate",
    tolerance: 0.01,
    componentA: { ifcTypes: [], conditions: [] },
    componentB: { ifcTypes: [], conditions: [] },
  },
];

// ── AABB helpers ──────────────────────────────────────────────────────────────

function aabbOverlap(a: THREE.Box3, b: THREE.Box3): number {
  const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return ox * oy * oz;
}

function aabbGap(a: THREE.Box3, b: THREE.Box3): number {
  const gx = Math.max(a.min.x, b.min.x) - Math.min(a.max.x, b.max.x);
  const gy = Math.max(a.min.y, b.min.y) - Math.min(a.max.y, b.max.y);
  const gz = Math.max(a.min.z, b.min.z) - Math.min(a.max.z, b.max.z);
  return Math.max(gx, gy, gz);
}

function aabbNearlyEqual(a: THREE.Box3, b: THREE.Box3, tol: number): boolean {
  return (
    Math.abs(a.min.x - b.min.x) < tol && Math.abs(a.max.x - b.max.x) < tol &&
    Math.abs(a.min.y - b.min.y) < tol && Math.abs(a.max.y - b.max.y) < tol &&
    Math.abs(a.min.z - b.min.z) < tol && Math.abs(a.max.z - b.max.z) < tol
  );
}

// ── Element collection ────────────────────────────────────────────────────────

interface ElementRecord {
  modelId: string;
  expressId: number;
  name: string;
  type: string;
  box: THREE.Box3;
  props: Record<string, string>;
}

function collectElements(models: Map<string, IFCModelEntry>): ElementRecord[] {
  const result: ElementRecord[] = [];
  for (const [modelId, model] of models) {
    if (!model.visible || model.status !== "loaded") continue;
    const typeByExpr  = new Map<number, string>();
    const nameByExpr  = new Map<number, string>();
    const propsByExpr = new Map<number, Record<string, string>>();
    for (const [type, els] of Object.entries(model.elementsByType)) {
      for (const el of els as Array<{ expressId: number; name: string; properties?: Record<string, string> }>) {
        typeByExpr.set(el.expressId, type);
        nameByExpr.set(el.expressId, el.name || type);
        propsByExpr.set(el.expressId, el.properties ?? {});
      }
    }
    model.mesh.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const eid = mesh.userData?.expressId as number | undefined;
      if (!eid) return;
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) return;
      result.push({
        modelId,
        expressId: eid,
        name: nameByExpr.get(eid) ?? `Element ${eid}`,
        type: typeByExpr.get(eid) ?? "Unknown",
        box,
        props: propsByExpr.get(eid) ?? {},
      });
    });
  }
  return result;
}

// ── Property filter evaluation ────────────────────────────────────────────────

function matchesPropConditions(props: Record<string, string>, conditions: PropCondition[]): boolean {
  for (const c of conditions) {
    const val = props[c.propName] ?? "";
    switch (c.operator) {
      case "contains":   if (!val.toLowerCase().includes(c.value.toLowerCase())) return false; break;
      case "equals":     if (val.toLowerCase() !== c.value.toLowerCase()) return false; break;
      case "startsWith": if (!val.toLowerCase().startsWith(c.value.toLowerCase())) return false; break;
      case "notEmpty":   if (!val.trim()) return false; break;
    }
  }
  return true;
}

function matchesFilter(el: ElementRecord, filter: ComponentFilter): boolean {
  if (filter.ifcTypes.length > 0 && !filter.ifcTypes.includes(el.type)) return false;
  return matchesPropConditions(el.props, filter.conditions);
}

// ── Detection engine ──────────────────────────────────────────────────────────

const MAX_RESULTS_PER_RULE = 500;

function runRuleBasedDetection(
  elements: ElementRecord[],
  rules: ClashRule[],
  onProgress: (pct: number) => void,
): Promise<ClashResult[]> {
  return new Promise(resolve => {
    const results: ClashResult[] = [];
    const enabledRules = rules.filter(r => r.enabled);
    if (enabledRules.length === 0) { resolve([]); return; }

    // Pre-filter element sets per rule
    const setsByRule = enabledRules.map(r => ({
      rule: r,
      setA: elements.filter(e => matchesFilter(e, r.componentA)),
      setB: elements.filter(e => matchesFilter(e, r.componentB)),
    }));

    const totalWork = setsByRule.reduce((acc, { setA }) => acc + setA.length, 0);
    let done = 0;
    let ruleIdx = 0;
    let iA = 0;

    const step = () => {
      const { rule, setA, setB } = setsByRule[ruleIdx];
      const batchEnd = Math.min(iA + 30, setA.length);

      for (; iA < batchEnd; iA++) {
        const a = setA[iA];
        const ruleResults = results.filter(r => r.ruleId === rule.id);
        if (ruleResults.length >= MAX_RESULTS_PER_RULE) { iA = setA.length; break; }

        for (const b of setB) {
          if (a.modelId === b.modelId && a.expressId === b.expressId) continue;
          // Avoid duplicate A-B / B-A pairs
          const keyFwd = `${a.modelId}:${a.expressId}|${b.modelId}:${b.expressId}`;
          const keyRev = `${b.modelId}:${b.expressId}|${a.modelId}:${a.expressId}`;
          const existing = results.some(r => r.ruleId === rule.id && (
            (`${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}` === keyFwd) ||
            (`${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}` === keyRev)
          ));
          if (existing) continue;

          let triggered = false;
          let measure = 0;

          if (rule.checkType === "hard-clash") {
            const vol = aabbOverlap(a.box, b.box);
            if (vol > rule.tolerance) { triggered = true; measure = vol; }
          } else if (rule.checkType === "clearance") {
            const gap = aabbGap(a.box, b.box);
            if (gap < rule.tolerance && gap > -0.001) { triggered = true; measure = gap; }
          } else if (rule.checkType === "duplicate") {
            if (aabbNearlyEqual(a.box, b.box, rule.tolerance)) { triggered = true; measure = 0; }
          }

          if (triggered) {
            results.push({
              ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
              modelIdA: a.modelId, expressIdA: a.expressId, nameA: a.name, typeA: a.type,
              modelIdB: b.modelId, expressIdB: b.expressId, nameB: b.name, typeB: b.type,
              overlap: Math.round(measure * 10000) / 10000,
              status: "new",
              propsA: a.props, propsB: b.props,
            });
          }
        }
      }

      done += (batchEnd - Math.max(0, iA - (batchEnd - iA)));
      onProgress(Math.min(99, Math.round((done / totalWork) * 100)));

      if (iA >= setA.length) {
        ruleIdx++;
        iA = 0;
      }

      if (ruleIdx < setsByRule.length && results.length < enabledRules.length * MAX_RESULTS_PER_RULE) {
        setTimeout(step, 0);
      } else {
        onProgress(100);
        resolve(results);
      }
    };
    setTimeout(step, 0);
  });
}

// ── CollisionPanel component ──────────────────────────────────────────────────

interface Props { onClose(): void; }

export function CollisionPanel({ onClose }: Props) {
  const models      = useModelStore(s => s.models);
  const setSelected = useModelStore(s => s.setSelected);

  const [rules, setRules]          = useState<ClashRule[]>(DEFAULT_RULES);
  const [running, setRunning]      = useState(false);
  const [progress, setProgress]    = useState(0);
  const [results, setResults]      = useState<ClashResult[]>([]);
  const [hasRun, setHasRun]        = useState(false);
  const [activeRule, setActiveRule]= useState<string | null>(null);
  const [expandedId, setExpandedId]= useState<string | null>(null);
  const [editRule, setEditRule]    = useState<ClashRule | null>(null);
  const statusRef = useRef<Map<string, ClashStatus>>(new Map());

  const run = useCallback(async () => {
    setRunning(true);
    setHasRun(false);
    setResults([]);
    setActiveRule(null);
    const elements = collectElements(models);
    const raw = await runRuleBasedDetection(elements, rules, setProgress);
    // Restore persisted statuses
    const merged = raw.map(r => {
      const key = `${r.ruleId}|${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}`;
      return { ...r, status: statusRef.current.get(key) ?? r.status };
    });
    setResults(merged);
    setRunning(false);
    setHasRun(true);
  }, [models, rules]);

  const setStatus = (result: ClashResult, status: ClashStatus) => {
    const key = `${result.ruleId}|${result.modelIdA}:${result.expressIdA}|${result.modelIdB}:${result.expressIdB}`;
    statusRef.current.set(key, status);
    setResults(prev => prev.map(r =>
      r.ruleId === result.ruleId && r.modelIdA === result.modelIdA && r.expressIdA === result.expressIdA &&
      r.modelIdB === result.modelIdB && r.expressIdB === result.expressIdB
        ? { ...r, status } : r
    ));
  };

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const [, m] of models) for (const t of Object.keys(m.elementsByType)) s.add(t);
    return [...s].sort();
  }, [models]);

  const filteredResults = useMemo(() =>
    activeRule ? results.filter(r => r.ruleId === activeRule) : results,
    [results, activeRule]
  );

  const ruleStats = useMemo(() => {
    const map = new Map<string, { total: number; new: number; approved: number; resolved: number }>();
    for (const r of results) {
      let s = map.get(r.ruleId);
      if (!s) { s = { total: 0, new: 0, approved: 0, resolved: 0 }; map.set(r.ruleId, s); }
      s.total++;
      s[r.status]++;
    }
    return map;
  }, [results]);

  const exportCSV = () => {
    const rows = [
      ["Regel","Typ","Status","TypeA","NameA","TypeB","NameB","Wert","ModelA","ModelB"],
      ...filteredResults.map(r => [
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

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[920px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={15} className="text-amber-400" />
            <h2 className="text-sm font-semibold">Regelbasierte Kollisionsprüfung</h2>
            {hasRun && (
              <span className="text-xs text-muted-foreground">
                · {results.length} Konflikte · {results.filter(r => r.status === "new").length} offen
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasRun && results.length > 0 && (
              <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">
                <Download size={12} /> CSV
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: Rules panel */}
          <div className="w-64 shrink-0 border-r border-border flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Regeln ({rules.length})</span>
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
              {rules.map(rule => {
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
                          onChange={e => setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: e.target.checked } : r))}
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
                          onClick={e => { e.stopPropagation(); setRules(prev => prev.filter(r => r.id !== rule.id)); }}
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
                onClick={run}
                disabled={running || models.size === 0}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {running ? `${progress}%` : "Prüfung starten"}
              </button>
              {running && (
                <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>

          {/* Center: Results */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {!hasRun && !running && (
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

            {running && (
              <div className="flex-1 flex items-center justify-center flex-col gap-3">
                <Loader2 size={22} className="animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analysiere Regelkonflikte… {progress}%</p>
              </div>
            )}

            {hasRun && !running && (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* Summary bar */}
                <div className="px-4 py-2 border-b border-border shrink-0 flex items-center justify-between">
                  <div className="flex gap-4">
                    {(["error","warning","info"] as Severity[]).map(s => {
                      const cnt = filteredResults.filter(r => r.severity === s).length;
                      return cnt > 0 ? (
                        <span key={s} className={cn("text-xs font-medium", severityColor(s))}>
                          {s === "error" ? "⬤" : s === "warning" ? "⬤" : "⬤"} {cnt} {s === "error" ? "Fehler" : s === "warning" ? "Warnungen" : "Info"}
                        </span>
                      ) : null;
                    })}
                    {filteredResults.length === 0 && (
                      <span className="text-xs text-green-400">✓ Keine Konflikte in dieser Auswahl</span>
                    )}
                  </div>
                  {activeRule && (
                    <button onClick={() => setActiveRule(null)} className="text-[10px] text-primary hover:underline">
                      Alle anzeigen
                    </button>
                  )}
                </div>

                {/* Result list */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {filteredResults.map((r, idx) => {
                    const key = `${r.ruleId}|${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}`;
                    const expanded = expandedId === key;
                    return (
                      <div key={idx} className={cn("border-b border-border/40 last:border-0", r.status === "resolved" && "opacity-40")}>
                        <button
                          onClick={() => setExpandedId(expanded ? null : key)}
                          className={cn(
                            "w-full flex items-start gap-2 px-3 py-2 hover:bg-muted/25 text-left transition-colors",
                          )}
                        >
                          {expanded
                            ? <ChevronDown size={11} className="shrink-0 mt-0.5 text-muted-foreground" />
                            : <ChevronRight size={11} className="shrink-0 mt-0.5 text-muted-foreground" />
                          }
                          <div className={cn("shrink-0 w-1 self-stretch rounded-full mt-0.5", r.severity === "error" ? "bg-red-400" : r.severity === "warning" ? "bg-amber-400" : "bg-blue-400")} />
                          <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-3">
                            <div className="min-w-0">
                              <span className="text-[9px] text-muted-foreground font-mono">{r.typeA.replace("Ifc","")}</span>
                              <p className="text-xs text-foreground truncate leading-snug">{r.nameA}</p>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] text-muted-foreground font-mono">{r.typeB.replace("Ifc","")}</span>
                              <p className="text-xs text-foreground truncate leading-snug">{r.nameB}</p>
                            </div>
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-0.5">
                            <span className="text-[9px] text-muted-foreground font-mono">
                              {r.overlap > 0 ? `${r.overlap.toFixed(4)} m³` : "clearance"}
                            </span>
                            <span className="flex items-center gap-1">{statusIcon(r.status)}</span>
                          </div>
                        </button>

                        {expanded && (
                          <div className="px-6 pb-2.5 pt-1 flex flex-col gap-2">
                            <div className={cn("text-[10px] px-2 py-1 rounded border w-fit", severityBg(r.severity))}>
                              <span className={severityColor(r.severity)}>{r.ruleName}</span>
                            </div>
                            {/* Props */}
                            {(r.propsA && Object.keys(r.propsA).length > 0) && (
                              <div className="grid grid-cols-2 gap-2">
                                <PropTable title="Element A" props={r.propsA} />
                                <PropTable title="Element B" props={r.propsB ?? {}} />
                              </div>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                              <button
                                onClick={() => setSelected({ modelId: r.modelIdA, expressId: r.expressIdA, properties: {}, psets: [] })}
                                className="text-[10px] text-primary hover:underline"
                              >→ A auswählen</button>
                              <button
                                onClick={() => setSelected({ modelId: r.modelIdB, expressId: r.expressIdB, properties: {}, psets: [] })}
                                className="text-[10px] text-primary hover:underline"
                              >→ B auswählen</button>
                              <span className="text-muted-foreground text-[9px] mx-1">Status:</span>
                              {(["new","approved","resolved"] as ClashStatus[]).map(s => (
                                <button
                                  key={s}
                                  onClick={() => setStatus(r, s)}
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
              </div>
            )}
          </div>

          {/* Right: Rule editor */}
          {editRule && (
            <RuleEditor
              rule={editRule}
              allTypes={allTypes}
              onSave={r => {
                setRules(prev => {
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

function RuleEditor({ rule, allTypes, onSave, onClose }: {
  rule: ClashRule;
  allTypes: string[];
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
      [key]: { ...prev[key], conditions: [...prev[key].conditions, { propName: "", operator: "contains", value: "" }] },
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
        {/* Name */}
        <FieldRow label="Name">
          <input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
        </FieldRow>

        {/* Severity */}
        <FieldRow label="Schwere">
          <select value={draft.severity} onChange={e => setDraft(p => ({ ...p, severity: e.target.value as Severity }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded">
            <option value="error">Fehler</option>
            <option value="warning">Warnung</option>
            <option value="info">Info</option>
          </select>
        </FieldRow>

        {/* Check type */}
        <FieldRow label="Prüftyp">
          <select value={draft.checkType} onChange={e => setDraft(p => ({ ...p, checkType: e.target.value as CheckType }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded">
            <option value="hard-clash">Harte Kollision</option>
            <option value="clearance">Mindestabstand</option>
            <option value="duplicate">Duplikat</option>
          </select>
        </FieldRow>

        {/* Tolerance */}
        <FieldRow label={draft.checkType === "clearance" ? "Mindestabstand (m)" : "Toleranz (m³)"}>
          <input type="number" step={draft.checkType === "clearance" ? "0.05" : "0.0001"} min="0"
            value={draft.tolerance}
            onChange={e => setDraft(p => ({ ...p, tolerance: parseFloat(e.target.value) || 0 }))}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
        </FieldRow>

        {/* Component filters */}
        {(["A","B"] as const).map(side => (
          <FilterEditor
            key={side}
            title={`Komponente ${side}`}
            filter={side === "A" ? draft.componentA : draft.componentB}
            allTypes={allTypes}
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

function FilterEditor({ title, filter, allTypes, onToggleType, onAddCondition, onUpdateCondition, onRemoveCondition }: {
  title: string;
  filter: ComponentFilter;
  allTypes: string[];
  onToggleType(t: string): void;
  onAddCondition(): void;
  onUpdateCondition(i: number, p: Partial<PropCondition>): void;
  onRemoveCondition(i: number): void;
}) {
  const [showTypes, setShowTypes] = useState(false);
  return (
    <div className="border border-border rounded p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="text-[9px] text-primary/70">{filter.ifcTypes.length === 0 ? "alle Typen" : `${filter.ifcTypes.length} Typen`}</span>
      </div>

      {/* IFC type picker */}
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

      {/* Property conditions */}
      <div className="flex flex-col gap-1">
        {filter.conditions.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={c.propName} placeholder="Eigenschaft" onChange={e => onUpdateCondition(i, { propName: e.target.value })}
              className="flex-1 px-1.5 py-0.5 text-[10px] bg-background border border-border rounded focus:outline-none" style={{ minWidth: 0 }} />
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
