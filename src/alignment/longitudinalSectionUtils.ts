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

/**
 * Slices the scene with a series of vertical planes, one per alignment polyline
 * segment, in a single pass over the pre-filtered mesh list.
 *
 * Pass pickableMeshesRef.current (or equivalent); invisible elements are
 * skipped internally via isWorldVisLS.
 *
 * Performance: each mesh's vertices are projected to world space once as a
 * Float32Array; the inner segment×triangle loop uses only raw arithmetic.
 */
export function sliceSceneLS(
  meshes: THREE.Mesh[],
  segs: LSSegmentPlane[],
  staStart: number,
  staEnd: number,
): LSLine[] {
  if (segs.length === 0) return [];

  const EPS = 1e-5;
  const result: LSLine[] = [];

  for (const obj of meshes) {
    if (!isWorldVisLS(obj)) continue;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) continue;
    if (!geom.boundingSphere) geom.computeBoundingSphere();

    const bs = geom.boundingSphere!;
    const me = obj.matrixWorld.elements;
    // Transform bounding sphere center (no Vector3 allocation)
    const bsX = me[0]*bs.center.x + me[4]*bs.center.y + me[8]*bs.center.z + me[12];
    const bsZ = me[2]*bs.center.x + me[6]*bs.center.y + me[10]*bs.center.z + me[14];
    const radius = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888";

    let modelId = "";
    let n: THREE.Object3D | null = obj.parent;
    while (n) { if (n.userData.modelId) { modelId = n.userData.modelId as string; break; } n = n.parent; }
    const eid = obj.userData.expressId as number | undefined;
    const objectKey = (modelId && eid != null) ? `${modelId}:${eid}` : undefined;

    // Pre-transform all vertices to world space (Float32Array)
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
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
      const cdx = bsX - so_x, cdz = bsZ - so_z;
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
  }

  return result;
}

/**
 * Computes depth-view lines for the longitudinal section.
 *
 * Occlusion is tested per edge using 2D axis-aligned bounding boxes:
 *   1. Phase 1 — collect world-space AABB for every candidate mesh (8-corner
 *      transform, correct for any rotation).  No raycasting.
 *   2. Phase 2 — for each edge midpoint, test whether any other mesh whose AABB
 *      center is closer to the cut plane laterally covers that midpoint.
 *
 * This replaces the previous per-edge raycaster (O(E×M×T)) with an O(E×M)
 * AABB test, eliminating the dominant cost entirely.
 */
export function computeLSDepthLines(
  meshes: THREE.Mesh[],
  segs: LSSegmentPlane[],
  staStart: number,
  staEnd: number,
  maxDist: number,
): LSDepthLine[] {
  if (segs.length === 0 || meshes.length === 0) return [];

  // ── Phase 1: Build per-mesh metadata (world AABB, best segment, edge buffer) ─

  interface MeshInfo {
    mesh:     THREE.Mesh;
    seg:      LSSegmentPlane;
    absN:     number;       // distance from seg.normal (for segment assignment only)
    color:    string;
    // World-space AABB (8-corner transform — correct even for rotated meshes)
    wxMin: number; wxMax: number;
    wyMin: number; wyMax: number;
    wzMin: number; wzMax: number;
    // XZ center for signed-depth projection
    wxCenter: number; wzCenter: number;
    edgePos:  THREE.BufferAttribute;
    tempGeo:  THREE.EdgesGeometry | null;
  }

  const infos: MeshInfo[] = [];

  for (const obj of meshes) {
    if (!isWorldVisLS(obj)) continue;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) continue;
    if (!geom.boundingSphere) geom.computeBoundingSphere();

    const bs  = geom.boundingSphere!;
    const me  = obj.matrixWorld.elements;
    // Transform bounding sphere center to world XZ (no Vector3 allocation)
    const cX  = me[0]*bs.center.x + me[4]*bs.center.y + me[8]*bs.center.z + me[12];
    const cZ  = me[2]*bs.center.x + me[6]*bs.center.y + me[10]*bs.center.z + me[14];
    const radius = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);

    // Find closest segment that covers this mesh
    let bestSeg: LSSegmentPlane | null = null;
    let bestAbsN = Infinity;
    for (const seg of segs) {
      const cdx = cX - seg.origin.x, cdz = cZ - seg.origin.z;
      const dn   = cdx * seg.normal.x + cdz * seg.normal.z;
      const absN = Math.abs(dn);
      if (absN - radius > maxDist) continue;
      const distR = cdx * seg.right.x + cdz * seg.right.z;
      if (distR + radius < -1 || distR - radius > seg.hLen + 1) continue;
      if (absN < bestAbsN) { bestAbsN = absN; bestSeg = seg; }
    }
    if (!bestSeg) continue;

    const mat   = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col   = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888888";

    // Exact world-space AABB via 8-corner transform (handles arbitrary rotation)
    if (!geom.boundingBox) geom.computeBoundingBox();
    const bb   = geom.boundingBox!;
    const m11 = me[0], m12 = me[4], m13 = me[8],  m14 = me[12];
    const m21 = me[1], m22 = me[5], m23 = me[9],  m24 = me[13];
    const m31 = me[2], m32 = me[6], m33 = me[10], m34 = me[14];
    let wxMin = Infinity, wxMax = -Infinity;
    let wyMin = Infinity, wyMax = -Infinity;
    let wzMin = Infinity, wzMax = -Infinity;
    for (let bx = 0; bx < 2; bx++) {
      for (let by = 0; by < 2; by++) {
        for (let bz = 0; bz < 2; bz++) {
          const lx = bx ? bb.max.x : bb.min.x;
          const ly = by ? bb.max.y : bb.min.y;
          const lz = bz ? bb.max.z : bb.min.z;
          const wx = m11*lx + m12*ly + m13*lz + m14;
          const wy = m21*lx + m22*ly + m23*lz + m24;
          const wz = m31*lx + m32*ly + m33*lz + m34;
          if (wx < wxMin) wxMin = wx; if (wx > wxMax) wxMax = wx;
          if (wy < wyMin) wyMin = wy; if (wy > wyMax) wyMax = wy;
          if (wz < wzMin) wzMin = wz; if (wz > wzMax) wzMax = wz;
        }
      }
    }

    // Edge buffer: prefer pre-built edge child, otherwise compute temporarily
    const edgeChild = obj.children.find(c => c.userData.isEdge) as THREE.LineSegments | undefined;
    let edgePos: THREE.BufferAttribute;
    let tempGeo: THREE.EdgesGeometry | null = null;
    if (edgeChild) {
      edgePos = edgeChild.geometry.attributes.position as THREE.BufferAttribute;
    } else {
      tempGeo = new THREE.EdgesGeometry(geom, 15);
      edgePos = tempGeo.attributes.position as THREE.BufferAttribute;
    }

    infos.push({
      mesh: obj, seg: bestSeg, absN: bestAbsN, color,
      wxMin, wxMax, wyMin, wyMax, wzMin, wzMax,
      wxCenter: (wxMin + wxMax) * 0.5,
      wzCenter: (wzMin + wzMax) * 0.5,
      edgePos, tempGeo,
    });
  }

  // ── Phase 2: Per-edge with AABB occlusion test (no raycasting) ───────────────

  const p1w = new THREE.Vector3();
  const p2w = new THREE.Vector3();
  const result: LSDepthLine[] = [];

  for (const info of infos) {
    const { edgePos, tempGeo, color } = info;
    const wm = info.mesh.matrixWorld;

    for (let i = 0; i < edgePos.count; i += 2) {
      p1w.fromBufferAttribute(edgePos, i).applyMatrix4(wm);
      p2w.fromBufferAttribute(edgePos, i + 1).applyMatrix4(wm);

      // Find edge's closest segment plane
      let edgeSeg: LSSegmentPlane | null = null;
      let edgeBestAvg = Infinity;
      for (const s of segs) {
        const dx1 = p1w.x - s.origin.x, dz1 = p1w.z - s.origin.z;
        const dx2 = p2w.x - s.origin.x, dz2 = p2w.z - s.origin.z;
        const d1 = Math.abs(dx1 * s.normal.x + dz1 * s.normal.z);
        const d2 = Math.abs(dx2 * s.normal.x + dz2 * s.normal.z);
        if (Math.min(d1, d2) > maxDist) continue;
        const r1 = dx1 * s.right.x + dz1 * s.right.z;
        const r2 = dx2 * s.right.x + dz2 * s.right.z;
        if (Math.min(r1, r2) > s.hLen + 1 || Math.max(r1, r2) < -1) continue;
        const avg = (d1 + d2) * 0.5;
        if (avg < edgeBestAvg) { edgeBestAvg = avg; edgeSeg = s; }
      }
      if (!edgeSeg) continue;

      const s    = edgeSeg;
      const snx  = s.normal.x, snz = s.normal.z;
      const sox  = s.origin.x, soz = s.origin.z;
      const srx  = s.right.x,  srz = s.right.z;
      const dx1  = p1w.x - sox, dz1 = p1w.z - soz;
      const dx2  = p2w.x - sox, dz2 = p2w.z - soz;
      const r1   = dx1 * srx + dz1 * srz;
      const r2   = dx2 * srx + dz2 * srz;
      const scale = s.staDiff / (s.hLen || 1);
      const sta1 = s.staA + r1 * scale;
      const sta2 = s.staA + r2 * scale;

      if (Math.max(sta1, sta2) < staStart || Math.min(sta1, sta2) > staEnd) continue;

      // Midpoint in edge's segment frame
      const mx = (p1w.x + p2w.x) * 0.5;
      const mz = (p1w.z + p2w.z) * 0.5;
      const mElev     = (p1w.y + p2w.y) * 0.5;
      const mrMid     = (r1 + r2) * 0.5;
      // Signed depth from cut plane (positive = element side)
      const mSignedN  = (mx - sox) * snx + (mz - soz) * snz;
      const mAbsN     = Math.abs(mSignedN);

      // AABB occlusion: check if any other mesh's world AABB, projected onto
      // the edge's segment coordinate frame, covers the edge midpoint AND is
      // closer to the cut plane than the edge.
      let isHidden = false;
      for (const other of infos) {
        if (other === info) continue;

        // Occluder must be on the same side of the cut plane and strictly closer
        const oSignedN = (other.wxCenter - sox) * snx + (other.wzCenter - soz) * snz;
        if (oSignedN * mSignedN <= 0) continue;          // opposite side
        if (Math.abs(oSignedN) >= mAbsN - 0.05) continue; // not closer

        // Fast elevation check
        if (mElev < other.wyMin || mElev > other.wyMax) continue;

        // Project occluder's XZ bounding box onto edge's right direction for r-range
        // (correct for any alignment curvature — all projections in edgeSeg frame)
        const dxMin = other.wxMin - sox, dzMin = other.wzMin - soz;
        const dxMax = other.wxMax - sox, dzMax = other.wzMax - soz;
        const rA = dxMin*srx + dzMin*srz;
        const rB = dxMax*srx + dzMin*srz;
        const rC = dxMax*srx + dzMax*srz;
        const rD = dxMin*srx + dzMax*srz;
        const oRMin = Math.min(rA, rB, rC, rD);
        const oRMax = Math.max(rA, rB, rC, rD);

        if (mrMid >= oRMin && mrMid <= oRMax) { isHidden = true; break; }
      }

      result.push({ sta1, elev1: p1w.y, sta2, elev2: p2w.y, hidden: isHidden, color });
    }

    if (tempGeo) tempGeo.dispose();
  }

  return result;
}
