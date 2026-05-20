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

function boxVolume(b: THREE.Box3): number {
  const s = b.getSize(new THREE.Vector3());
  return s.x * s.y * s.z;
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

// Tags that mark non-IFC overlay meshes — must not contribute to element AABBs
const OVERLAY_FLAGS = [
  "isHighlight", "isBillingOverlay", "isXSSurface",
  "isSectionVisual", "isSectionCap", "isGeometryInspector",
  "isEdge", "isAlignment",
] as const;

export function collectElements(models: Map<string, IFCModelEntry>): ElementRecord[] {
  const result: ElementRecord[] = [];
  for (const [modelId, model] of models) {
    if (!model.visible || model.status !== "loaded") continue;

    // Ensure all world matrices are current before computing world-space AABBs.
    // Without this, recently-shifted models return stale transforms.
    model.mesh.updateWorldMatrix(true, true);

    const typeByExpr  = new Map<number, string>();
    const nameByExpr  = new Map<number, string>();
    const propsByExpr = new Map<number, Record<string, string>>();
    // One merged AABB per IFC element — union of all its sub-mesh geometries.
    const boxByExpr   = new Map<number, THREE.Box3>();

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

      // Skip overlays — their userData flags differ from IFC elements
      if (OVERLAY_FLAGS.some(f => mesh.userData[f])) return;

      // Compute AABB from this mesh's OWN geometry only (no children).
      // setFromObject() recurses into children which can inflate the box when
      // edge-overlays, highlights, or inspector geometry are attached.
      const posAttr = mesh.geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!posAttr || posAttr.count === 0) return;

      const geomBox = new THREE.Box3().setFromBufferAttribute(posAttr);
      if (geomBox.isEmpty()) return;

      // Transform local-space AABB into world space using the already-updated matrix.
      geomBox.applyMatrix4(mesh.matrixWorld);

      const existing = boxByExpr.get(eid);
      if (existing) {
        existing.union(geomBox);
      } else {
        boxByExpr.set(eid, geomBox);
      }
    });

    for (const [eid, box] of boxByExpr) {
      result.push({
        modelId,
        expressId: eid,
        name: nameByExpr.get(eid) ?? `Element ${eid}`,
        type: typeByExpr.get(eid) ?? "Unknown",
        box,
        props: propsByExpr.get(eid) ?? {},
      });
    }
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

// Minimum overlap as a fraction of the smaller element's AABB volume.
// Filters out cases where two large-box elements just barely touch —
// a strong indicator of AABB approximation noise rather than real intersection.
const MIN_RELATIVE_OVERLAP = 0.01; // 1 %

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

    // Deduplicate set by rule-level key to avoid re-checking swapped pairs
    const checkedPairs = new Set<string>();

    const step = () => {
      const { rule, setA, setB } = setsByRule[ruleIdx];
      const batchEnd = Math.min(iA + 30, setA.length);

      for (; iA < batchEnd; iA++) {
        const a = setA[iA];
        if (results.filter(r => r.ruleId === rule.id).length >= MAX_RESULTS_PER_RULE) {
          iA = setA.length;
          break;
        }

        for (const b of setB) {
          if (a.modelId === b.modelId && a.expressId === b.expressId) continue;

          // Canonical key (smaller id first) avoids checking A↔B and B↔A
          const kA = `${a.modelId}:${a.expressId}`;
          const kB = `${b.modelId}:${b.expressId}`;
          const pairKey = `${rule.id}|${kA < kB ? kA + "|" + kB : kB + "|" + kA}`;
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          let triggered = false;
          let measure = 0;

          if (rule.checkType === "hard-clash") {
            const vol = aabbOverlap(a.box, b.box);
            if (vol > rule.tolerance) {
              // Require overlap to represent at least MIN_RELATIVE_OVERLAP of
              // the smaller element's box volume.  This suppresses false positives
              // that arise from AABB over-approximation of curved / complex geometry.
              const minVol = Math.min(boxVolume(a.box), boxVolume(b.box));
              if (minVol <= 0 || vol / minVol >= MIN_RELATIVE_OVERLAP) {
                triggered = true;
                measure = vol;
              }
            }
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
