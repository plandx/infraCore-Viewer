/**
 * CPU-based cross-section cap generator.
 *
 * For each mesh × clip-plane combination, finds all triangle-plane
 * intersection segments, chains them into closed loops, and triangulates
 * those loops using earcut (via THREE.ShapeUtils) to produce filled cap
 * geometry plus precise contour edge geometry.
 *
 * Caps belong in the main Three.js scene so they are correctly depth-tested
 * and clipped by other simultaneously active section planes.
 */

import * as THREE from "three";

// ─── Internal helpers ──────────────────────────────────────────────────────

const CHAIN_EPS = 1e-4;

function quantizeKey(x: number, y: number, z: number): string {
  const f = 1 / CHAIN_EPS;
  return `${Math.round(x * f)},${Math.round(y * f)},${Math.round(z * f)}`;
}

/** Returns true only when the plane's signed distance changes sign across the
 *  box (i.e. the plane actually cuts through the box). */
function planeCrossesBox(plane: THREE.Plane, box: THREE.Box3): boolean {
  let hasPos = false;
  let hasNeg = false;
  const v = new THREE.Vector3();
  for (let ix = 0; ix <= 1; ix++) {
    for (let iy = 0; iy <= 1; iy++) {
      for (let iz = 0; iz <= 1; iz++) {
        v.set(
          ix === 0 ? box.min.x : box.max.x,
          iy === 0 ? box.min.y : box.max.y,
          iz === 0 ? box.min.z : box.max.z,
        );
        const d = plane.distanceToPoint(v);
        if (d > 0) hasPos = true; else hasNeg = true;
        if (hasPos && hasNeg) return true;
      }
    }
  }
  return false;
}

interface Seg { a: THREE.Vector3; b: THREE.Vector3 }

/**
 * Walk every triangle in the mesh (in world space) and collect intersection
 * segments with the clip plane.  Returns [] when no intersections.
 */
function extractSegments(mesh: THREE.Mesh, plane: THREE.Plane): Seg[] {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos) return [];

  const mat = mesh.matrixWorld;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const segs: Seg[] = [];

  const faceCount = idx ? idx.count / 3 : pos.count / 3;

  for (let fi = 0; fi < faceCount; fi++) {
    let ia: number, ib: number, ic: number;
    if (idx) {
      ia = idx.getX(fi * 3);
      ib = idx.getX(fi * 3 + 1);
      ic = idx.getX(fi * 3 + 2);
    } else {
      ia = fi * 3; ib = fi * 3 + 1; ic = fi * 3 + 2;
    }

    va.fromBufferAttribute(pos, ia).applyMatrix4(mat);
    vb.fromBufferAttribute(pos, ib).applyMatrix4(mat);
    vc.fromBufferAttribute(pos, ic).applyMatrix4(mat);

    const da = plane.distanceToPoint(va);
    const db = plane.distanceToPoint(vb);
    const dc = plane.distanceToPoint(vc);

    const sA = da >= 0, sB = db >= 0, sC = dc >= 0;
    if (sA === sB && sB === sC) continue;

    const pts: THREE.Vector3[] = [];
    if (sA !== sB) {
      const t = da / (da - db);
      pts.push(pa.clone().lerpVectors(va, vb, t));
    }
    if (sB !== sC) {
      const t = db / (db - dc);
      pts.push(pa.clone().lerpVectors(vb, vc, t));
    }
    if (sC !== sA) {
      const t = dc / (dc - da);
      pts.push(pb.clone().lerpVectors(vc, va, t));
    }

    if (pts.length === 2) segs.push({ a: pts[0], b: pts[1] });
  }

  return segs;
}

/**
 * Chain unordered segments into closed loops using quantized point matching.
 * Segments from adjacent triangles share an endpoint exactly (same float
 * value), so the quantisation is just a safety net for world-space transforms.
 */
function chainSegments(segs: Seg[]): THREE.Vector3[][] {
  if (!segs.length) return [];

  const key = (v: THREE.Vector3) => quantizeKey(v.x, v.y, v.z);

  // adj[key] = list of (segIdx, end: 0→.a  1→.b)
  const adj = new Map<string, [number, number][]>();
  for (let i = 0; i < segs.length; i++) {
    for (const end of [0, 1] as (0 | 1)[]) {
      const k = key(end === 0 ? segs[i].a : segs[i].b);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push([i, end]);
    }
  }

  const used = new Uint8Array(segs.length);
  const loops: THREE.Vector3[][] = [];

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;

    const loop: THREE.Vector3[] = [];
    let curIdx = start;
    let enterEnd: 0 | 1 = 0;

    while (!used[curIdx]) {
      used[curIdx] = 1;
      loop.push(enterEnd === 0 ? segs[curIdx].a : segs[curIdx].b);
      const leaveVert = enterEnd === 0 ? segs[curIdx].b : segs[curIdx].a;
      const lk = key(leaveVert);
      const nbrs = adj.get(lk) ?? [];
      let found = false;
      for (const [ni, ne] of nbrs) {
        if (!used[ni]) {
          curIdx = ni;
          enterEnd = ne;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

/** Orthonormal basis for the plane so we can project loop points to 2D. */
function planeBasis(N: THREE.Vector3): { bx: THREE.Vector3; by: THREE.Vector3 } {
  let bx = new THREE.Vector3(1, 0, 0);
  if (Math.abs(N.dot(bx)) > 0.9) bx = new THREE.Vector3(0, 1, 0);
  const by = new THREE.Vector3().crossVectors(N, bx).normalize();
  bx.crossVectors(by, N).normalize();
  return { bx, by };
}

function signedArea2D(pts: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface CapResult {
  /** Filled cap surface geometry (world-space vertices). */
  capGeo: THREE.BufferGeometry;
  /** Contour edge geometry (world-space LineSegments pairs). */
  edgeGeo: THREE.BufferGeometry;
  /** Colour derived from the source mesh material. */
  color: THREE.Color;
}

/**
 * Compute cap + edge geometry for one mesh/plane pair.
 * Returns null when the mesh doesn't straddle the plane or has no geometry.
 * The cap vertices are nudged 1 mm along plane.normal (toward the kept side)
 * to prevent z-fighting with the clipped mesh surface.
 */
export function computeCap(mesh: THREE.Mesh, plane: THREE.Plane): CapResult | null {
  const geo = mesh.geometry;
  if (!geo.attributes.position) return null;

  // Fast bbox pre-check (avoids per-triangle work on the majority of meshes)
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (geo.boundingBox) {
    const bb = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (!planeCrossesBox(plane, bb)) return null;
  }

  const segs = extractSegments(mesh, plane);
  if (segs.length < 2) return null;

  const loops = chainSegments(segs);
  if (!loops.length) return null;

  const N = plane.normal.clone().normalize();
  const { bx, by } = planeBasis(N);

  // 1 mm nudge along plane normal (toward kept side) prevents z-fighting
  const nudge = 0.001;
  const nx = N.x * nudge, ny = N.y * nudge, nz = N.z * nudge;

  const allPos: number[] = [];
  const allIdx: number[] = [];
  const edgePos: number[] = [];

  for (const loop of loops) {
    if (loop.length < 3) continue;

    // Project loop to 2D for earcut
    const pts2D = loop.map(p => new THREE.Vector2(p.dot(bx), p.dot(by)));

    // earcut/ShapeUtils wants CCW orientation
    if (signedArea2D(pts2D) < 0) {
      pts2D.reverse();
      loop.reverse();
    }

    let triIdxs: number[][] = [];
    try {
      triIdxs = THREE.ShapeUtils.triangulateShape(pts2D, []);
    } catch { continue; }
    if (!triIdxs.length) continue;

    const base = allPos.length / 3;
    for (const p of loop) allPos.push(p.x + nx, p.y + ny, p.z + nz);
    for (const [a, b, c] of triIdxs) allIdx.push(base + a, base + b, base + c);

    // Contour edges sit on the exact plane (no nudge) so they align with geometry
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      edgePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  if (!allIdx.length) return null;

  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
  capGeo.setIndex(allIdx);
  capGeo.computeVertexNormals();

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePos, 3));

  // Derive cap colour from mesh material — slightly lighter for a matte look
  let color = new THREE.Color(0xc8c4bc);
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (mat && (mat as THREE.MeshLambertMaterial).color instanceof THREE.Color) {
    const src = (mat as THREE.MeshLambertMaterial).color;
    const { h, s, l } = { h: 0, s: 0, l: 0 };
    const hsl = src.getHSL({ h, s, l });
    color = new THREE.Color().setHSL(hsl.h, hsl.s * 0.7, Math.min(hsl.l * 1.2 + 0.08, 0.96));
  }

  return { capGeo, edgeGeo, color };
}
