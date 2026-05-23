import * as THREE from "three";

export interface AbwicklungLine {
  s1: number;      // station at start (m)
  t1: number;      // lateral at start (m, + = right of alignment, - = left)
  s2: number;      // station at end (m)
  t2: number;      // lateral at end (m)
  elevMid: number; // world-Y elevation at midpoint (add oz to get absolute)
  color: string;
  objectKey?: string;
}

// Preprocessed polyline segment in scene (world) XZ coordinates
interface PolylineSeg {
  sx: number; sz: number; // start point (scene X, Z)
  tx: number; tz: number; // unit tangent in XZ plane
  rx: number; rz: number; // unit right direction: perpendicular to tangent, pointing right
  sta: number;            // cumulative station at segment start
  len: number;            // horizontal segment length (m)
}

function buildPolylineSegs(
  pts: Array<{ x: number; y: number; z: number | null; sta: number; ox: number; oy: number }>,
): PolylineSeg[] {
  const segs: PolylineSeg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    // Convert geo coords to scene coords: scene_X = geo_x - ox, scene_Z = -(geo_y - oy)
    const ax = a.x - a.ox, az = -(a.y - a.oy);
    const bx = b.x - b.ox, bz = -(b.y - b.oy);
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-9) continue;
    const tx = dx / len, tz = dz / len;
    // right direction: (-tz, tx) — verified: east tangent → south right ✓
    segs.push({ sx: ax, sz: az, tx, tz, rx: -tz, rz: tx, sta: a.sta, len });
  }
  return segs;
}

function projectPoint(
  wx: number, wz: number,
  segs: PolylineSeg[],
): [station: number, lateral: number] {
  let bestDist2 = Infinity;
  let bestSta = 0;
  let bestLat = 0;
  for (const seg of segs) {
    const dx = wx - seg.sx;
    const dz = wz - seg.sz;
    const along = Math.max(0, Math.min(seg.len, dx * seg.tx + dz * seg.tz));
    const fpx = seg.sx + along * seg.tx;
    const fpz = seg.sz + along * seg.tz;
    const perpX = wx - fpx;
    const perpZ = wz - fpz;
    const d2 = perpX * perpX + perpZ * perpZ;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestSta = seg.sta + along;
      bestLat = perpX * seg.rx + perpZ * seg.rz;
    }
  }
  return [bestSta, bestLat];
}

function isWorldVisible(obj: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = obj;
  while (n) { if (!n.visible) return false; n = n.parent; }
  return true;
}

export function computeAbwicklung(
  meshes: THREE.Mesh[],
  pts: Array<{ x: number; y: number; z: number | null; sta: number; ox: number; oy: number; oz: number }>,
  staStart: number,
  staEnd: number,
  leftOffset: number,
  rightOffset: number,
): AbwicklungLine[] {
  if (pts.length < 2) return [];

  // Only use segments within the station range (with buffer)
  const BUF = 5;
  const filteredPts = pts.filter((p, i) =>
    (p.sta >= staStart - BUF && p.sta <= staEnd + BUF) ||
    (i > 0 && pts[i - 1].sta >= staStart - BUF) ||
    (i < pts.length - 1 && pts[i + 1].sta <= staEnd + BUF),
  );
  if (filteredPts.length < 2) return [];

  const segs = buildPolylineSegs(filteredPts as typeof pts);
  if (segs.length === 0) return [];

  // Corridor AABB in world XZ for broad mesh rejection
  const maxLat = Math.max(leftOffset, rightOffset) + 1;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const seg of segs) {
    const ex = seg.sx + seg.len * seg.tx, ez = seg.sz + seg.len * seg.tz;
    minX = Math.min(minX, seg.sx, ex) - maxLat;
    maxX = Math.max(maxX, seg.sx, ex) + maxLat;
    minZ = Math.min(minZ, seg.sz, ez) - maxLat;
    maxZ = Math.max(maxZ, seg.sz, ez) + maxLat;
  }

  const lines: AbwicklungLine[] = [];

  for (const mesh of meshes) {
    if (!isWorldVisible(mesh)) continue;

    // Bounding sphere rejection against corridor AABB
    const geomMain = mesh.geometry as THREE.BufferGeometry;
    if (geomMain?.boundingSphere) {
      const bs = geomMain.boundingSphere;
      const me = mesh.matrixWorld.elements;
      const bcx = me[0] * bs.center.x + me[4] * bs.center.y + me[8] * bs.center.z + me[12];
      const bcz = me[2] * bs.center.x + me[6] * bs.center.y + me[10] * bs.center.z + me[14];
      const rad = bs.radius * (mesh.matrixWorld.getMaxScaleOnAxis?.() ?? 1);
      if (bcx + rad < minX || bcx - rad > maxX || bcz + rad < minZ || bcz - rad > maxZ) continue;
    }

    // Find edge child (isEdge LineSegments), fall back to temporary EdgesGeometry
    let edgeGeo: THREE.BufferGeometry | null = null;
    let tempGeo: THREE.EdgesGeometry | null = null;
    for (const child of mesh.children) {
      if ((child as THREE.LineSegments).isLineSegments && child.userData.isEdge) {
        edgeGeo = (child as THREE.LineSegments).geometry as THREE.BufferGeometry;
        break;
      }
    }
    if (!edgeGeo) {
      tempGeo = new THREE.EdgesGeometry(mesh.geometry, 15);
      edgeGeo = tempGeo;
    }
    const pos = edgeGeo.attributes.position as THREE.BufferAttribute;
    if (!pos) { tempGeo?.dispose(); continue; }

    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888";

    let mid = "";
    let n: THREE.Object3D | null = mesh.parent;
    while (n) { if (n.userData.modelId) { mid = n.userData.modelId as string; break; } n = n.parent; }
    const eid = mesh.userData.expressId as number | undefined;
    const objectKey = (mid && eid != null) ? `${mid}:${eid}` : undefined;

    const me = mesh.matrixWorld.elements;
    const m11 = me[0], m12 = me[4], m13 = me[8],  m14 = me[12];
    const m21 = me[1], m22 = me[5], m23 = me[9],  m24 = me[13];
    const m31 = me[2], m32 = me[6], m33 = me[10], m34 = me[14];

    const vCount = pos.count;
    // EdgesGeometry: non-indexed vertex pairs — each pair = one edge
    for (let i = 0; i + 1 < vCount; i += 2) {
      const lx1 = pos.getX(i),   ly1 = pos.getY(i),   lz1 = pos.getZ(i);
      const lx2 = pos.getX(i+1), ly2 = pos.getY(i+1), lz2 = pos.getZ(i+1);

      const wx1 = m11*lx1 + m12*ly1 + m13*lz1 + m14;
      const wy1 = m21*lx1 + m22*ly1 + m23*lz1 + m24;
      const wz1 = m31*lx1 + m32*ly1 + m33*lz1 + m34;

      const wx2 = m11*lx2 + m12*ly2 + m13*lz2 + m14;
      const wy2 = m21*lx2 + m22*ly2 + m23*lz2 + m24;
      const wz2 = m31*lx2 + m32*ly2 + m33*lz2 + m34;

      const [s1, t1] = projectPoint(wx1, wz1, segs);
      const [s2, t2] = projectPoint(wx2, wz2, segs);

      // Station range filter
      if (s1 < staStart - BUF && s2 < staStart - BUF) continue;
      if (s1 > staEnd   + BUF && s2 > staEnd   + BUF) continue;

      // Lateral range filter (both endpoints must be within corridor or one partially inside)
      if (t1 < -leftOffset - 1 && t2 < -leftOffset - 1) continue;
      if (t1 > rightOffset + 1 && t2 > rightOffset + 1) continue;

      const elevMid = (wy1 + wy2) * 0.5;
      lines.push({ s1, t1, s2, t2, elevMid, color, objectKey });
    }

    tempGeo?.dispose();
  }

  return lines;
}
