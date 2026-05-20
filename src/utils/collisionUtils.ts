import * as THREE from "three";
import type { IFCModelEntry } from "../types/ifc";
import type { ClashRule, ClashResult, PropCondition, ComponentFilter } from "./windowSync";
export type { ClashRule, ClashResult, PropCondition, ComponentFilter } from "./windowSync";
export { DEFAULT_CLASH_RULES } from "./windowSync";

// ── AABB helpers ───────────────────────────────────────────────────────────────

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

// ── Element collection ─────────────────────────────────────────────────────────

export interface ElementRecord {
  modelId: string;
  expressId: number;
  name: string;
  type: string;
  box: THREE.Box3;
  props: Record<string, string>;
}

export function collectElements(models: Map<string, IFCModelEntry>): ElementRecord[] {
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

// ── Property filter evaluation ─────────────────────────────────────────────────

export function matchesPropConditions(props: Record<string, string>, conditions: PropCondition[]): boolean {
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

export function matchesFilter(el: ElementRecord, filter: ComponentFilter): boolean {
  if (filter.ifcTypes.length > 0 && !filter.ifcTypes.includes(el.type)) return false;
  return matchesPropConditions(el.props, filter.conditions);
}

// ── Detection engine ───────────────────────────────────────────────────────────

const MAX_RESULTS_PER_RULE = 500;

export function runRuleBasedDetection(
  elements: ElementRecord[],
  rules: ClashRule[],
  onProgress: (pct: number) => void,
): Promise<ClashResult[]> {
  return new Promise(resolve => {
    const results: ClashResult[] = [];
    const enabledRules = rules.filter(r => r.enabled);
    if (enabledRules.length === 0) { resolve([]); return; }

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
