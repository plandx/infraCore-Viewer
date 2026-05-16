import * as THREE from "three";
import type { InspFace, InspFaceBoundary } from "./types";

const COPLANAR_DOT = Math.cos(10 * Math.PI / 180); // triangles within 10° → same face
const PREC = 4000; // quantization: 0.25 mm

function qv(v: THREE.Vector3): string {
  return `${Math.round(v.x * PREC)},${Math.round(v.y * PREC)},${Math.round(v.z * PREC)}`;
}
function ek(a: string, b: string): string { return a <= b ? `${a}|${b}` : `${b}|${a}`; }

interface TriData {
  v0: THREE.Vector3; v1: THREE.Vector3; v2: THREE.Vector3;
  normal: THREE.Vector3; area: number;
}

export interface AnalysisResult {
  faces: InspFace[];
  faceBoundaries: InspFaceBoundary[];
  /** flat vertex array per face (9 floats per tri, world space) for building face geometries */
  faceVertArrays: Float32Array[];
}

export function analyzeMeshes(meshes: THREE.Mesh[]): AnalysisResult {
  const tris: TriData[] = [];

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const { geometry: geo, matrixWorld } = mesh;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;

    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i)     : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(matrixWorld);
      const v1 = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(matrixWorld);
      const v2 = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(matrixWorld);
      const e1 = v1.clone().sub(v0);
      const e2 = v2.clone().sub(v0);
      const cross = e1.cross(e2);
      const len = cross.length();
      if (len < 1e-12) continue;
      tris.push({ v0, v1, v2, normal: cross.divideScalar(len), area: len * 0.5 });
    }
  }

  if (tris.length === 0) return { faces: [], faceBoundaries: [], faceVertArrays: [] };

  // ── Edge → triangle adjacency ──────────────────────────────────────────────
  interface EdgeEntry { triIndices: number[]; va: THREE.Vector3; vb: THREE.Vector3 }
  const edgeMap = new Map<string, EdgeEntry>();

  for (let ti = 0; ti < tris.length; ti++) {
    const { v0, v1, v2 } = tris[ti];
    const verts = [v0, v1, v2];
    const keys  = verts.map(qv);
    for (let e = 0; e < 3; e++) {
      const k = ek(keys[e], keys[(e + 1) % 3]);
      if (!edgeMap.has(k)) edgeMap.set(k, { triIndices: [], va: verts[e], vb: verts[(e + 1) % 3] });
      edgeMap.get(k)!.triIndices.push(ti);
    }
  }

  // ── BFS flood-fill → face groups ──────────────────────────────────────────
  const triToFace = new Int32Array(tris.length).fill(-1);
  const faceTriLists: number[][] = [];

  for (let start = 0; start < tris.length; start++) {
    if (triToFace[start] !== -1) continue;
    const faceId = faceTriLists.length;
    const group: number[] = [];
    const stack = [start];
    triToFace[start] = faceId;

    while (stack.length > 0) {
      const ti = stack.pop()!;
      group.push(ti);
      const { v0, v1, v2 } = tris[ti];
      const keys = [qv(v0), qv(v1), qv(v2)];
      for (let e = 0; e < 3; e++) {
        const entry = edgeMap.get(ek(keys[e], keys[(e + 1) % 3]));
        if (!entry) continue;
        for (const ni of entry.triIndices) {
          if (triToFace[ni] !== -1) continue;
          if (tris[ti].normal.dot(tris[ni].normal) >= COPLANAR_DOT) {
            triToFace[ni] = faceId;
            stack.push(ni);
          }
        }
      }
    }
    faceTriLists.push(group);
  }

  // ── Face stats ────────────────────────────────────────────────────────────
  const faces: InspFace[] = faceTriLists.map((group, id) => {
    let area = 0, cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    for (const ti of group) {
      const t = tris[ti];
      area += t.area;
      cx += t.v0.x + t.v1.x + t.v2.x;
      cy += t.v0.y + t.v1.y + t.v2.y;
      cz += t.v0.z + t.v1.z + t.v2.z;
      nx += t.normal.x * t.area; ny += t.normal.y * t.area; nz += t.normal.z * t.area;
    }
    const n3 = group.length * 3;
    const invA = area > 0 ? 1 / area : 0;
    const normal = new THREE.Vector3(nx * invA, ny * invA, nz * invA).normalize();
    return { id, area, normal: normal.toArray() as [number, number, number], center: [cx / n3, cy / n3, cz / n3] };
  });

  // ── Face boundaries: per-face boundary edge segments ──────────────────────
  // For each face, collect all edges where one adjacent triangle belongs to this
  // face and the other does not (inter-face edges) or there is no other triangle
  // (mesh boundary edges). These segments form the complete perimeter of the face.
  const faceBoundarySegs: Map<number, Array<{ start: THREE.Vector3; end: THREE.Vector3 }>> = new Map();
  for (let fid = 0; fid < faces.length; fid++) faceBoundarySegs.set(fid, []);

  for (const [, entry] of edgeMap) {
    const { triIndices, va, vb } = entry;
    if (va.distanceTo(vb) < 5e-4) continue;

    if (triIndices.length === 1) {
      // Mesh boundary edge — belongs to the one adjacent face
      const fid = triToFace[triIndices[0]];
      faceBoundarySegs.get(fid)!.push({ start: va, end: vb });
    } else if (triIndices.length >= 2) {
      const fid0 = triToFace[triIndices[0]];
      const fid1 = triToFace[triIndices[1]];
      if (fid0 !== fid1) {
        // Inter-face edge — add to BOTH adjacent faces
        faceBoundarySegs.get(fid0)!.push({ start: va, end: vb });
        faceBoundarySegs.get(fid1)!.push({ start: va, end: vb });
      }
      // Same face → interior edge, skip
    }
  }

  const faceBoundaries: InspFaceBoundary[] = faces.map((face) => {
    const rawSegs = faceBoundarySegs.get(face.id)!;
    const merged = mergeCollinear(rawSegs);

    let totalLength = 0, cx = 0, cy = 0, cz = 0;
    const segments = merged.map(({ start: a, end: b }) => {
      const len = a.distanceTo(b);
      totalLength += len;
      cx += (a.x + b.x) / 2;
      cy += (a.y + b.y) / 2;
      cz += (a.z + b.z) / 2;
      return {
        start: a.toArray() as [number, number, number],
        end:   b.toArray() as [number, number, number],
      };
    });

    const n = segments.length || 1;
    return { id: face.id, faceId: face.id, totalLength, center: [cx / n, cy / n, cz / n], segments };
  });

  // ── Per-face flat vertex arrays ────────────────────────────────────────────
  const faceVertArrays: Float32Array[] = faceTriLists.map((group) => {
    const arr = new Float32Array(group.length * 9);
    group.forEach((ti, i) => {
      const t = tris[ti];
      arr[i*9+0]=t.v0.x; arr[i*9+1]=t.v0.y; arr[i*9+2]=t.v0.z;
      arr[i*9+3]=t.v1.x; arr[i*9+4]=t.v1.y; arr[i*9+5]=t.v1.z;
      arr[i*9+6]=t.v2.x; arr[i*9+7]=t.v2.y; arr[i*9+8]=t.v2.z;
    });
    return arr;
  });

  return { faces, faceBoundaries, faceVertArrays };
}

function mergeCollinear(
  rawEdges: { start: THREE.Vector3; end: THREE.Vector3 }[],
): { start: THREE.Vector3; end: THREE.Vector3 }[] {
  if (rawEdges.length === 0) return [];

  type Edge = { start: THREE.Vector3; end: THREE.Vector3; alive: boolean };
  const edges: Edge[] = rawEdges.map(e => ({ start: e.start.clone(), end: e.end.clone(), alive: true }));

  let merged = true;
  while (merged) {
    merged = false;
    const vMap = new Map<string, number[]>();
    for (let i = 0; i < edges.length; i++) {
      if (!edges[i].alive) continue;
      for (const v of [edges[i].start, edges[i].end]) {
        const k = qv(v);
        const arr = vMap.get(k) ?? [];
        arr.push(i);
        vMap.set(k, arr);
      }
    }
    for (const [vk, eIdxs] of vMap) {
      if (eIdxs.length !== 2) continue;
      const [i0, i1] = eIdxs;
      const e0 = edges[i0], e1 = edges[i1];
      const o0 = qv(e0.start) === vk ? e0.end : e0.start;
      const o1 = qv(e1.start) === vk ? e1.end : e1.start;
      const parts = vk.split(",");
      const vp = new THREE.Vector3(+parts[0] / PREC, +parts[1] / PREC, +parts[2] / PREC);
      const d0 = o0.clone().sub(vp).normalize();
      const d1 = o1.clone().sub(vp).normalize();
      if (d0.dot(d1) < -0.999) {
        edges.push({ start: o0, end: o1, alive: true });
        e0.alive = false;
        e1.alive = false;
        merged = true;
        break;
      }
    }
  }

  return edges.filter(e => e.alive);
}
