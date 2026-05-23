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
  objectKey?: string;
  /** 2D bounding box for fast rejection before full point-in-polygon test */
  minX: number; minY: number; maxX: number; maxY: number;
}

function qKey(x: number, y: number, eps: number): string {
  return `${Math.round(x / eps)},${Math.round(y / eps)}`;
}

export function buildSectionPolygons(lines: SectionLine[], eps = 1e-3): SectionPolygon[] {
  if (lines.length === 0) return [];
  const results: SectionPolygon[] = [];

  // Group by (objectKey + color) so each element gets its own polygon set
  const byKey = new Map<string, SectionLine[]>();
  for (const l of lines) {
    const k = `${l.objectKey ?? ""}|${l.color}`;
    let g = byKey.get(k);
    if (!g) { g = []; byKey.set(k, g); }
    g.push(l);
  }

  for (const [, group] of byKey) {
    const color = group[0].color;
    const objectKey = group[0].objectKey;
    const used = new Uint8Array(group.length);

    // Build adjacency: quantized endpoint key → [(lineIdx, endIdx)]
    const adj = new Map<string, Array<[number, number]>>();
    const pushAdj = (key: string, li: number, ei: number) => {
      let a = adj.get(key);
      if (!a) { a = []; adj.set(key, a); }
      a.push([li, ei]);
    };
    for (let i = 0; i < group.length; i++) {
      const l = group[i];
      pushAdj(qKey(l.x1, l.y1, eps), i, 0);
      pushAdj(qKey(l.x2, l.y2, eps), i, 1);
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

      // Shoelace area + AABB in one pass
      let area = 0;
      const n = chain.length;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += chain[i][0] * chain[j][1] - chain[j][0] * chain[i][1];
        if (chain[i][0] < minX) minX = chain[i][0];
        if (chain[i][1] < minY) minY = chain[i][1];
        if (chain[i][0] > maxX) maxX = chain[i][0];
        if (chain[i][1] > maxY) maxY = chain[i][1];
      }
      if (Math.abs(area) / 2 >= 0.01)
        results.push({ points: chain, color, objectKey, minX, minY, maxX, maxY });
    }
  }

  return results;
}

/**
 * Point-in-polygon test using ray-casting algorithm.
 * Returns true if the point (px, py) is inside the given polygon.
 */
export function pointInPolygon(px: number, py: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function isWorldVisible(obj: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = obj;
  while (n) { if (!n.visible) return false; n = n.parent; }
  return true;
}

/**
 * Slices a pre-filtered array of IFC meshes with the given plane and returns
 * the intersection line segments projected into 2D cross-section space.
 *
 * Pass pickableMeshesRef.current (or equivalent) — invisible (hidden/isolated)
 * elements are skipped via isWorldVisible.
 *
 * All vertex-to-world transforms are done once per mesh as a flat Float32Array;
 * edge intersections are fully inlined (no per-triangle closures, no Vector3
 * allocations) so the hot triangle loop is JIT-friendly.
 *
 * origin  – world-space point on the plane
 * normal  – unit vector perpendicular to the plane (= alignment tangent direction)
 * right   – unit vector pointing "right" in the cross-section (positive X)
 * up      – unit vector pointing "up" in the cross-section (positive Y)
 */
export function sliceScene(
  meshes: THREE.Mesh[],
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
): SectionLine[] {
  const lines: SectionLine[] = [];
  const EPS = 1e-5;
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const nx = normal.x, ny = normal.y, nz = normal.z;
  const rx = right.x,  ry = right.y,  rz = right.z;
  const ux = up.x,     uy = up.y,     uz = up.z;

  for (const obj of meshes) {
    if (!isWorldVisible(obj)) continue;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) continue;

    // Bounding sphere pre-filter: skip meshes fully on one side of the plane
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    if (geom.boundingSphere) {
      const bs  = geom.boundingSphere;
      const me  = obj.matrixWorld.elements;
      // Transform sphere center to world space (no Vector3 allocation)
      const bcx = me[0]*bs.center.x + me[4]*bs.center.y + me[8]*bs.center.z + me[12];
      const bcy = me[1]*bs.center.x + me[5]*bs.center.y + me[9]*bs.center.z + me[13];
      const bcz = me[2]*bs.center.x + me[6]*bs.center.y + me[10]*bs.center.z + me[14];
      const rad = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);
      if (Math.abs((bcx-ox)*nx + (bcy-oy)*ny + (bcz-oz)*nz) > rad + EPS) continue;
    }

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888";

    let _mid = "";
    let _n: THREE.Object3D | null = obj.parent;
    while (_n) { if (_n.userData.modelId) { _mid = _n.userData.modelId as string; break; } _n = _n.parent; }
    const _eid = obj.userData.expressId as number | undefined;
    const objectKey = (_mid && _eid != null) ? `${_mid}:${_eid}` : undefined;

    // Pre-transform all vertices to world space (Float32Array, cache-friendly)
    const pos    = geom.attributes.position as THREE.BufferAttribute;
    const idx    = geom.index;
    const me     = obj.matrixWorld.elements;
    const m11 = me[0], m12 = me[4], m13 = me[8],  m14 = me[12];
    const m21 = me[1], m22 = me[5], m23 = me[9],  m24 = me[13];
    const m31 = me[2], m32 = me[6], m33 = me[10], m34 = me[14];
    const vCount = pos.count;
    const wp = new Float32Array(vCount * 3);
    for (let v = 0; v < vCount; v++) {
      const lx = pos.getX(v), ly = pos.getY(v), lz = pos.getZ(v);
      const vi = v * 3;
      wp[vi]   = m11*lx + m12*ly + m13*lz + m14;
      wp[vi+1] = m21*lx + m22*ly + m23*lz + m24;
      wp[vi+2] = m31*lx + m32*ly + m33*lz + m34;
    }

    const nTri = idx ? idx.count / 3 : Math.floor(vCount / 3);
    for (let t = 0; t < nTri; t++) {
      const i0 = idx ? idx.getX(t * 3)     : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a3 = i0 * 3, b3 = i1 * 3, c3 = i2 * 3;

      const ax = wp[a3], ay = wp[a3+1], az = wp[a3+2];
      const bx = wp[b3], by = wp[b3+1], bz = wp[b3+2];
      const cx = wp[c3], cy = wp[c3+1], cz = wp[c3+2];

      const dA = (ax-ox)*nx + (ay-oy)*ny + (az-oz)*nz;
      const dB = (bx-ox)*nx + (by-oy)*ny + (bz-oz)*nz;
      const dC = (cx-ox)*nx + (cy-oy)*ny + (cz-oz)*nz;

      if (dA > -EPS && dB > -EPS && dC > -EPS) continue;
      if (dA <  EPS && dB <  EPS && dC <  EPS) continue;

      // Inline edge intersections — no closure, no array allocation per triangle
      let p1r = 0, p1u = 0, p2r = 0, p2u = 0, nc = 0;

      if ((dA > EPS && dB < -EPS) || (dA < -EPS && dB > EPS)) {
        const tt = dA / (dA - dB);
        const ix = ax+tt*(bx-ax)-ox, iy = ay+tt*(by-ay)-oy, iz = az+tt*(bz-az)-oz;
        p1r = ix*rx+iy*ry+iz*rz; p1u = ix*ux+iy*uy+iz*uz; nc = 1;
      }
      if ((dB > EPS && dC < -EPS) || (dB < -EPS && dC > EPS)) {
        const tt = dB / (dB - dC);
        const ix = bx+tt*(cx-bx)-ox, iy = by+tt*(cy-by)-oy, iz = bz+tt*(cz-bz)-oz;
        if (nc === 0) { p1r = ix*rx+iy*ry+iz*rz; p1u = ix*ux+iy*uy+iz*uz; nc = 1; }
        else          { p2r = ix*rx+iy*ry+iz*rz; p2u = ix*ux+iy*uy+iz*uz; nc = 2; }
      }
      if (nc < 2 && ((dC > EPS && dA < -EPS) || (dC < -EPS && dA > EPS))) {
        const tt = dC / (dC - dA);
        const ix = cx+tt*(ax-cx)-ox, iy = cy+tt*(ay-cy)-oy, iz = cz+tt*(az-cz)-oz;
        if (nc === 0) { p1r = ix*rx+iy*ry+iz*rz; p1u = ix*ux+iy*uy+iz*uz; }
        else          { p2r = ix*rx+iy*ry+iz*rz; p2u = ix*ux+iy*uy+iz*uz; }
        nc++;
      }

      if (nc >= 2) lines.push({ x1: p1r, y1: p1u, x2: p2r, y2: p2u, color, objectKey });
    }
  }

  return lines;
}
