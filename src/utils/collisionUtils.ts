import * as THREE from "three";
import { MeshBVH, StaticGeometryGenerator } from "three-mesh-bvh";
import type { IFCModelEntry } from "../types/ifc";
import type { ClashRule, ClashResult, PropCondition, ComponentFilter } from "./windowSync";
export type { ClashRule, ClashResult, PropCondition, ComponentFilter } from "./windowSync";
export { DEFAULT_CLASH_RULES } from "./windowSync";

// ── Element record ─────────────────────────────────────────────────────────────

export interface ElementRecord {
  modelId: string;
  expressId: number;
  name: string;
  type: string;
  /** World-space merged geometry for precise triangle intersection tests */
  geometry: THREE.BufferGeometry;
  /** World-space AABB — used for quick pre-filter before expensive BVH test */
  box: THREE.Box3;
  props: Record<string, string>;
}

// Tags that mark non-IFC overlay meshes
const OVERLAY_FLAGS = [
  "isHighlight", "isBillingOverlay", "isXSSurface",
  "isSectionVisual", "isSectionCap", "isGeometryInspector",
  "isEdge", "isAlignment",
] as const;

// ── Element collection ─────────────────────────────────────────────────────────

/**
 * Builds one ElementRecord per IFC element by:
 * 1. Ensuring all world matrices are current
 * 2. Collecting every sub-mesh that belongs to the element
 * 3. Using StaticGeometryGenerator to merge them into a single world-space
 *    BufferGeometry — this preserves the exact shape including rotations,
 *    openings, and arbitrary placements
 */
export function collectElements(models: Map<string, IFCModelEntry>): ElementRecord[] {
  const result: ElementRecord[] = [];
  for (const [modelId, model] of models) {
    if (!model.visible || model.status !== "loaded") continue;

    // Ensure all world matrices are current before reading matrixWorld
    model.mesh.updateWorldMatrix(true, true);

    const typeByExpr   = new Map<number, string>();
    const nameByExpr   = new Map<number, string>();
    const propsByExpr  = new Map<number, Record<string, string>>();
    const meshByExpr   = new Map<number, THREE.Mesh[]>();

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
      if (OVERLAY_FLAGS.some(f => mesh.userData[f])) return;
      const pos = mesh.geometry?.getAttribute("position");
      if (!pos || pos.count === 0) return;

      const arr = meshByExpr.get(eid) ?? [];
      arr.push(mesh);
      meshByExpr.set(eid, arr);
    });

    for (const [eid, meshes] of meshByExpr) {
      // Build one world-space geometry per element by transforming each
      // sub-mesh's vertices into world space and merging them.
      const worldGeos: THREE.BufferGeometry[] = [];
      for (const m of meshes) {
        const g = m.geometry.clone();
        // Transform vertex positions to world space
        g.applyMatrix4(m.matrixWorld);
        // Keep only position + index (normal not needed for intersection)
        const stripped = new THREE.BufferGeometry();
        stripped.setAttribute("position", g.getAttribute("position"));
        if (g.index) stripped.setIndex(g.index);
        worldGeos.push(stripped);
      }
      if (worldGeos.length === 0) continue;

      let merged: THREE.BufferGeometry;
      if (worldGeos.length === 1) {
        merged = worldGeos[0];
      } else {
        // Merge all sub-geometries into one world-space geometry.
        // We use StaticGeometryGenerator — pass Meshes with identity matrix
        // since vertices are already in world space.
        const dummyMeshes = worldGeos.map(g => {
          const m = new THREE.Mesh(g);
          m.matrixAutoUpdate = false;
          m.matrix.identity();
          m.matrixWorld.identity();
          return m;
        });
        const gen = new StaticGeometryGenerator(dummyMeshes);
        gen.useGroups = false;
        merged = gen.generate();
        worldGeos.forEach(g => g.dispose());
      }

      const box = new THREE.Box3().setFromBufferAttribute(
        merged.getAttribute("position") as THREE.BufferAttribute
      );
      if (box.isEmpty()) { merged.dispose(); continue; }

      result.push({
        modelId, expressId: eid,
        name:  nameByExpr.get(eid)  ?? `Element ${eid}`,
        type:  typeByExpr.get(eid)  ?? "Unknown",
        geometry: merged,
        box,
        props: propsByExpr.get(eid) ?? {},
      });
    }
  }
  return result;
}

/** Free geometry memory after detection is complete */
export function disposeElements(elements: ElementRecord[]): void {
  for (const e of elements) e.geometry.dispose();
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

// ── Intersection helpers ───────────────────────────────────────────────────────

/**
 * True geometry intersection test using BVH triangle-triangle queries.
 * Geometries are already in world space so the transform passed to
 * intersectsGeometry is identity.
 */
function geometriesIntersect(geoA: THREE.BufferGeometry, geoB: THREE.BufferGeometry): boolean {
  // Build BVH on A (cheaper than building on both; B is queried against it)
  if (!(geoA as { boundsTree?: MeshBVH }).boundsTree) {
    (geoA as { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(geoA, { maxLeafTris: 8 });
  }
  const bvh = (geoA as { boundsTree: MeshBVH }).boundsTree;
  return bvh.intersectsGeometry(geoB, new THREE.Matrix4()); // identity — already world space
}

/**
 * AABB gap in metres — negative means overlap.
 * Used for clearance checks where we want the signed distance between boxes.
 */
function aabbSignedGap(a: THREE.Box3, b: THREE.Box3): number {
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
    const checkedPairs = new Set<string>();

    const step = () => {
      const { rule, setA, setB } = setsByRule[ruleIdx];
      const batchEnd = Math.min(iA + 20, setA.length); // smaller batches — BVH tests are heavier

      for (; iA < batchEnd; iA++) {
        const a = setA[iA];
        if (results.filter(r => r.ruleId === rule.id).length >= MAX_RESULTS_PER_RULE) {
          iA = setA.length;
          break;
        }

        for (const b of setB) {
          if (a.modelId === b.modelId && a.expressId === b.expressId) continue;

          // Canonical pair key (order-independent)
          const kA = `${a.modelId}:${a.expressId}`;
          const kB = `${b.modelId}:${b.expressId}`;
          const pairKey = `${rule.id}|${kA < kB ? kA + "|" + kB : kB + "|" + kA}`;
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          let triggered = false;
          let measure = 0;

          if (rule.checkType === "hard-clash") {
            // Fast AABB pre-filter — if boxes don't overlap the geometries can't either
            const overlapX = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
            const overlapY = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
            const overlapZ = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
            if (overlapX > -rule.tolerance && overlapY > -rule.tolerance && overlapZ > -rule.tolerance) {
              triggered = geometriesIntersect(a.geometry, b.geometry);
            }
          } else if (rule.checkType === "clearance") {
            const gap = aabbSignedGap(a.box, b.box);
            // Report if elements are close (within tolerance) but not already hard-clashing
            if (gap >= 0 && gap < rule.tolerance) {
              triggered = true;
              measure = gap;
            }
          } else if (rule.checkType === "duplicate") {
            if (aabbNearlyEqual(a.box, b.box, rule.tolerance)) {
              triggered = geometriesIntersect(a.geometry, b.geometry);
            }
          }

          if (triggered) {
            results.push({
              ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
              checkType: rule.checkType,
              modelIdA: a.modelId, expressIdA: a.expressId, nameA: a.name, typeA: a.type,
              modelIdB: b.modelId, expressIdB: b.expressId, nameB: b.name, typeB: b.type,
              overlap: measure,
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
        // Free BVH memory
        for (const el of elements) {
          const g = el.geometry as { boundsTree?: MeshBVH };
          if (g.boundsTree) {
            g.boundsTree = undefined;
          }
        }
        resolve(results);
      }
    };
    setTimeout(step, 0);
  });
}
