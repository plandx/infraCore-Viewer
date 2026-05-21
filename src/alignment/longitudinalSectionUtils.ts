import * as THREE from "three";

export interface LSLine {
  sta1: number; elev1: number;
  sta2: number; elev2: number;
  color: string;
  objectKey?: string;
}

export interface LSDepthLine {
  sta1: number; elev1: number;
  sta2: number; elev2: number;
  hidden: boolean;
  color: string;
}

export interface LSSegmentPlane {
  origin: THREE.Vector3;   // A in Three.js world space
  normal: THREE.Vector3;   // horizontal perpendicular to tangent (plane normal)
  right: THREE.Vector3;    // horizontal tangent (right = +station direction)
  staA: number;            // station at A
  staDiff: number;         // sta_B − sta_A (3D arc length of segment)
  hLen: number;            // horizontal distance A→B (for x→station mapping)
}

function isWorldVisLS(obj: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = obj;
  while (n) { if (!n.visible) return false; n = n.parent; }
  return true;
}

function shouldSkipMesh(obj: THREE.Mesh): boolean {
  if (obj.userData.isAlignment || obj.userData.isEdge ||
      (obj.name ?? "").startsWith("__")) return true;
  if (obj.userData.isHighlight || obj.userData.isSectionVisual ||
      obj.userData.isSectionCap || obj.userData.isBillingOverlay ||
      obj.userData.isXSSurface) return true;
  if (obj.userData.expressId == null) return true;
  return false;
}

/**
 * Slices the scene with a series of vertical planes, one per alignment polyline
 * segment, in a single scene traversal.
 *
 * Performance: each mesh's vertices are projected to world space once as a
 * Float32Array; the inner segment×triangle loop uses only raw arithmetic,
 * avoiding repeated applyMatrix4 and Vector3 allocations.
 */
export function sliceSceneLS(
  scene: THREE.Scene,
  segs: LSSegmentPlane[],
  staStart: number,
  staEnd: number,
): LSLine[] {
  if (segs.length === 0) return [];

  const EPS = 1e-5;
  const result: LSLine[] = [];

  scene.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!isWorldVisLS(obj)) return;
    if (shouldSkipMesh(obj)) return;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) return;
    if (!geom.boundingSphere) geom.computeBoundingSphere();

    const bs = geom.boundingSphere!;
    const bsC = bs.center.clone().applyMatrix4(obj.matrixWorld);
    const radius = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);
    const cX = bsC.x, cZ = bsC.z;

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888";

    let modelId = "";
    let n: THREE.Object3D | null = obj.parent;
    while (n) { if (n.userData.modelId) { modelId = n.userData.modelId as string; break; } n = n.parent; }
    const eid = obj.userData.expressId as number | undefined;
    const objectKey = (modelId && eid != null) ? `${modelId}:${eid}` : undefined;

    // Project all vertices to world space once
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const me  = obj.matrixWorld.elements;
    const m11 = me[0], m12 = me[4], m13 = me[8],  m14 = me[12];
    const m21 = me[1], m22 = me[5], m23 = me[9],  m24 = me[13];
    const m31 = me[2], m32 = me[6], m33 = me[10], m34 = me[14];
    const vCount = pos.count;
    const wp = new Float32Array(vCount * 3);
    for (let v = 0; v < vCount; v++) {
      const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
      const vi = v * 3;
      wp[vi]   = m11 * px + m12 * py + m13 * pz + m14;
      wp[vi+1] = m21 * px + m22 * py + m23 * pz + m24;
      wp[vi+2] = m31 * px + m32 * py + m33 * pz + m34;
    }
    const nTri = idx ? idx.count / 3 : Math.floor(vCount / 3);

    for (const seg of segs) {
      const so_x = seg.origin.x, so_z = seg.origin.z;
      const sn_x = seg.normal.x, sn_z = seg.normal.z;
      const sr_x = seg.right.x,  sr_z = seg.right.z;
      const hLen = seg.hLen;

      // Fast bounding-sphere reject (horizontal axes only — normal is horizontal)
      const cdx = cX - so_x, cdz = cZ - so_z;
      const distN = cdx * sn_x + cdz * sn_z;
      if (Math.abs(distN) > radius + EPS) continue;
      const distR = cdx * sr_x + cdz * sr_z;
      if (distR + radius < -EPS || distR - radius > hLen + EPS) continue;

      const scale = seg.staDiff / (hLen || 1);

      for (let t = 0; t < nTri; t++) {
        const i0 = idx ? idx.getX(t * 3)     : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const a3 = i0 * 3, b3 = i1 * 3, c3 = i2 * 3;

        const ax = wp[a3], ay = wp[a3+1], az = wp[a3+2];
        const bx = wp[b3], by = wp[b3+1], bz = wp[b3+2];
        const cx = wp[c3], cy = wp[c3+1], cz = wp[c3+2];

        const dA = (ax - so_x) * sn_x + (az - so_z) * sn_z;
        const dB = (bx - so_x) * sn_x + (bz - so_z) * sn_z;
        const dC = (cx - so_x) * sn_x + (cz - so_z) * sn_z;

        if (dA > -EPS && dB > -EPS && dC > -EPS) continue;
        if (dA <  EPS && dB <  EPS && dC <  EPS) continue;

        // Inline edge intersections — no array allocation, no Vector3 ops
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0, nc = 0;

        if ((dA > EPS && dB < -EPS) || (dA < -EPS && dB > EPS)) {
          const tt = dA / (dA - dB);
          const ix = ax + tt * (bx - ax), iy = ay + tt * (by - ay), iz = az + tt * (bz - az);
          x1 = (ix - so_x) * sr_x + (iz - so_z) * sr_z; y1 = iy; nc = 1;
        }
        if ((dB > EPS && dC < -EPS) || (dB < -EPS && dC > EPS)) {
          const tt = dB / (dB - dC);
          const ix = bx + tt * (cx - bx), iy = by + tt * (cy - by), iz = bz + tt * (cz - bz);
          if (nc === 0) { x1 = (ix - so_x) * sr_x + (iz - so_z) * sr_z; y1 = iy; nc = 1; }
          else          { x2 = (ix - so_x) * sr_x + (iz - so_z) * sr_z; y2 = iy; nc = 2; }
        }
        if (nc < 2 && ((dC > EPS && dA < -EPS) || (dC < -EPS && dA > EPS))) {
          const tt = dC / (dC - dA);
          const ix = cx + tt * (ax - cx), iy = cy + tt * (ay - cy), iz = cz + tt * (az - cz);
          if (nc === 0) { x1 = (ix - so_x) * sr_x + (iz - so_z) * sr_z; y1 = iy; }
          else          { x2 = (ix - so_x) * sr_x + (iz - so_z) * sr_z; y2 = iy; }
          nc++;
        }
        if (nc < 2) continue;

        if (Math.max(x1, x2) < -EPS || Math.min(x1, x2) > hLen + EPS) continue;

        const sta1 = seg.staA + x1 * scale;
        const sta2 = seg.staA + x2 * scale;
        if (Math.max(sta1, sta2) < staStart || Math.min(sta1, sta2) > staEnd) continue;

        result.push({ sta1, elev1: y1, sta2, elev2: y2, color, objectKey });
      }
    }
  });

  return result;
}

/**
 * Computes depth-view lines for the longitudinal section — edges of objects
 * within `maxDist` metres of the alignment plane series, projected to
 * (station, world-Y) coordinates.
 */
export function computeLSDepthLines(
  scene: THREE.Scene,
  segs: LSSegmentPlane[],
  staStart: number,
  staEnd: number,
  maxDist: number,
): LSDepthLine[] {
  if (segs.length === 0) return [];

  const result: LSDepthLine[] = [];
  const p1w = new THREE.Vector3();
  const p2w = new THREE.Vector3();

  scene.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!isWorldVisLS(obj)) return;
    if (shouldSkipMesh(obj)) return;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) return;
    if (!geom.boundingSphere) geom.computeBoundingSphere();

    const bs = geom.boundingSphere!;
    const center = bs.center.clone().applyMatrix4(obj.matrixWorld);
    const radius = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);

    // Quick reject: must be within maxDist of at least one segment
    let nearAny = false;
    for (const seg of segs) {
      const cdx = center.x - seg.origin.x, cdz = center.z - seg.origin.z;
      const absN = Math.abs(cdx * seg.normal.x + cdz * seg.normal.z);
      if (absN - radius > maxDist) continue;
      const distR = cdx * seg.right.x + cdz * seg.right.z;
      if (distR + radius < -1 || distR - radius > seg.hLen + 1) continue;
      nearAny = true; break;
    }
    if (!nearAny) return;

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888888";

    // Use existing edge child to avoid re-computing EdgesGeometry
    const edgeChild = obj.children.find(c => c.userData.isEdge) as THREE.LineSegments | undefined;
    let edgePos: THREE.BufferAttribute;
    let tempGeo: THREE.EdgesGeometry | null = null;
    if (edgeChild) {
      edgePos = edgeChild.geometry.attributes.position as THREE.BufferAttribute;
    } else {
      tempGeo = new THREE.EdgesGeometry(geom, 15);
      edgePos = tempGeo.attributes.position as THREE.BufferAttribute;
    }

    const wm = obj.matrixWorld;

    for (let i = 0; i < edgePos.count; i += 2) {
      p1w.fromBufferAttribute(edgePos, i).applyMatrix4(wm);
      p2w.fromBufferAttribute(edgePos, i + 1).applyMatrix4(wm);

      // Find the segment this edge is closest to (within maxDist)
      let bestSeg: LSSegmentPlane | null = null;
      let bestAbsN = Infinity;

      for (const seg of segs) {
        const dx1 = p1w.x - seg.origin.x, dz1 = p1w.z - seg.origin.z;
        const dx2 = p2w.x - seg.origin.x, dz2 = p2w.z - seg.origin.z;
        const d1 = Math.abs(dx1 * seg.normal.x + dz1 * seg.normal.z);
        const d2 = Math.abs(dx2 * seg.normal.x + dz2 * seg.normal.z);
        if (Math.min(d1, d2) > maxDist) continue;
        const r1 = dx1 * seg.right.x + dz1 * seg.right.z;
        const r2 = dx2 * seg.right.x + dz2 * seg.right.z;
        if (Math.min(r1, r2) > seg.hLen + 1 || Math.max(r1, r2) < -1) continue;
        const avg = (d1 + d2) / 2;
        if (avg < bestAbsN) { bestAbsN = avg; bestSeg = seg; }
      }
      if (!bestSeg) continue;

      const seg = bestSeg;
      const dx1 = p1w.x - seg.origin.x, dz1 = p1w.z - seg.origin.z;
      const dx2 = p2w.x - seg.origin.x, dz2 = p2w.z - seg.origin.z;
      const r1 = dx1 * seg.right.x + dz1 * seg.right.z;
      const r2 = dx2 * seg.right.x + dz2 * seg.right.z;
      const scale = seg.staDiff / (seg.hLen || 1);
      const sta1 = seg.staA + r1 * scale;
      const sta2 = seg.staA + r2 * scale;

      if (Math.max(sta1, sta2) < staStart || Math.min(sta1, sta2) > staEnd) continue;

      result.push({ sta1, elev1: p1w.y, sta2, elev2: p2w.y, hidden: false, color });
    }

    if (tempGeo) tempGeo.dispose();
  });

  return result;
}
