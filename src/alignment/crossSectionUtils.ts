import * as THREE from "three";

export interface SectionLine {
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
  /** "modelId:expressId" — identifies the IFC element this segment belongs to */
  objectKey?: string;
}

export interface SectionPolygon {
  points: Array<[number, number]>;
  color: string;
}

function qKey(x: number, y: number, eps: number): string {
  return `${Math.round(x / eps)},${Math.round(y / eps)}`;
}

export function buildSectionPolygons(lines: SectionLine[], eps = 1e-3): SectionPolygon[] {
  if (lines.length === 0) return [];
  const results: SectionPolygon[] = [];

  // Group by color
  const byColor = new Map<string, SectionLine[]>();
  for (const l of lines) {
    let g = byColor.get(l.color);
    if (!g) { g = []; byColor.set(l.color, g); }
    g.push(l);
  }

  for (const [color, group] of byColor) {
    const used = new Uint8Array(group.length);

    // Build adjacency: quantized endpoint key → [(lineIdx, endIdx)]
    const adj = new Map<string, Array<[number, number]>>();
    const push = (key: string, li: number, ei: number) => {
      let a = adj.get(key);
      if (!a) { a = []; adj.set(key, a); }
      a.push([li, ei]);
    };
    for (let i = 0; i < group.length; i++) {
      const l = group[i];
      push(qKey(l.x1, l.y1, eps), i, 0);
      push(qKey(l.x2, l.y2, eps), i, 1);
    }

    for (let start = 0; start < group.length; start++) {
      if (used[start]) continue;
      used[start] = 1;
      const l0 = group[start];
      const startKey = qKey(l0.x1, l0.y1, eps);
      const chain: Array<[number, number]> = [[l0.x1, l0.y1], [l0.x2, l0.y2]];
      let nextKey = qKey(l0.x2, l0.y2, eps);
      let limit = group.length;

      while (nextKey !== startKey && limit-- > 0) {
        const cands = adj.get(nextKey) ?? [];
        let found = false;
        for (const [li, ei] of cands) {
          if (used[li]) continue;
          used[li] = 1;
          const l = group[li];
          if (ei === 0) {
            chain.push([l.x2, l.y2]);
            nextKey = qKey(l.x2, l.y2, eps);
          } else {
            chain.push([l.x1, l.y1]);
            nextKey = qKey(l.x1, l.y1, eps);
          }
          found = true;
          break;
        }
        if (!found) break;
      }

      if (nextKey !== startKey || chain.length < 3) continue;

      // Shoelace area test
      let area = 0;
      const n = chain.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += chain[i][0] * chain[j][1] - chain[j][0] * chain[i][1];
      }
      if (Math.abs(area) / 2 >= 0.01) results.push({ points: chain, color });
    }
  }

  return results;
}

// Pre-allocated to avoid GC pressure in the hot loop
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _dq = new THREE.Vector3();

function project2d(
  p: THREE.Vector3,
  origin: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
): [number, number] {
  _dq.copy(p).sub(origin);
  return [_dq.dot(right), _dq.dot(up)];
}

function isWorldVisible(obj: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = obj;
  while (n) { if (!n.visible) return false; n = n.parent; }
  return true;
}

/**
 * Slices all visible meshes in the scene with the given plane and returns
 * the intersection line segments projected into 2D cross-section space.
 *
 * origin  – world-space point on the plane
 * normal  – unit vector perpendicular to the plane (= alignment tangent direction)
 * right   – unit vector pointing "right" in the cross-section (positive X)
 * up      – unit vector pointing "up" in the cross-section (positive Y)
 */
export function sliceScene(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
): SectionLine[] {
  const lines: SectionLine[] = [];
  const EPS = 1e-5;

  scene.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!isWorldVisible(obj)) return;
    // Skip helper objects (alignment lines, edge overlays, grid, axes, section indicator)
    if (obj.userData.isAlignment || obj.userData.isEdge || (obj.name ?? "").startsWith("__")) return;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) return;

    // Bounding sphere pre-filter: skip meshes fully on one side of the plane
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    if (geom.boundingSphere) {
      const radius = geom.boundingSphere.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);
      _pt.copy(geom.boundingSphere.center).applyMatrix4(obj.matrixWorld);
      _dq.copy(_pt).sub(origin);
      if (Math.abs(_dq.dot(normal)) > radius + EPS) return;
    }

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888";

    // Resolve objectKey once per mesh (walk parent chain for modelId)
    let _mid: string | undefined;
    let _n: THREE.Object3D | null = obj.parent;
    while (_n) { if (_n.userData.modelId) { _mid = _n.userData.modelId as string; break; } _n = _n.parent; }
    const _eid = obj.userData.expressId as number | undefined;
    const objectKey = (_mid != null && _eid != null) ? `${_mid}:${_eid}` : undefined;

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const mx  = obj.matrixWorld;
    const triCount = idx ? idx.count / 3 : Math.floor(pos.count / 3);

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3)     : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      _vA.fromBufferAttribute(pos, i0).applyMatrix4(mx);
      _vB.fromBufferAttribute(pos, i1).applyMatrix4(mx);
      _vC.fromBufferAttribute(pos, i2).applyMatrix4(mx);

      _dq.copy(_vA).sub(origin); const dA = _dq.dot(normal);
      _dq.copy(_vB).sub(origin); const dB = _dq.dot(normal);
      _dq.copy(_vC).sub(origin); const dC = _dq.dot(normal);

      // Skip triangles entirely on one side of the plane
      if (dA > -EPS && dB > -EPS && dC > -EPS) continue;
      if (dA <  EPS && dB <  EPS && dC <  EPS) continue;

      const pts: [number, number][] = [];
      const edge = (va: THREE.Vector3, da: number, vb: THREE.Vector3, db: number) => {
        if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
          _pt.lerpVectors(va, vb, da / (da - db));
          pts.push(project2d(_pt, origin, right, up));
        }
      };

      edge(_vA, dA, _vB, dB);
      edge(_vB, dB, _vC, dC);
      edge(_vC, dC, _vA, dA);

      if (pts.length >= 2) {
        lines.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], color, objectKey });
      }
    }
  });

  return lines;
}
