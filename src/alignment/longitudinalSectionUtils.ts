import * as THREE from "three";

export interface LSLine {
  sta1: number; elev1: number;
  sta2: number; elev2: number;
  color: string;
  objectKey?: string;
}

export interface LSSegmentPlane {
  origin: THREE.Vector3;   // A in Three.js world space
  normal: THREE.Vector3;   // horizontal perpendicular to tangent (plane normal)
  right: THREE.Vector3;    // horizontal tangent (right = +station direction)
  staA: number;            // station at A
  staDiff: number;         // sta_B − sta_A (3D arc length of segment)
  hLen: number;            // horizontal distance A→B (for x→station mapping)
}

// Pre-allocated vectors — safe because this is a synchronous, non-reentrant function
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _dq = new THREE.Vector3();

function isWorldVisLS(obj: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = obj;
  while (n) { if (!n.visible) return false; n = n.parent; }
  return true;
}

/**
 * Slices the scene with a series of vertical planes, one per alignment polyline
 * segment, in a single scene traversal.  Far more efficient than calling
 * sliceScene() once per segment.
 *
 * result unit: LSLine with sta in metres (display station), elev in Three.js
 * world Y (elevation minus origin offset).
 */
export function sliceSceneLS(
  scene: THREE.Scene,
  segs: LSSegmentPlane[],
  staStart: number,
  staEnd: number,
): LSLine[] {
  if (segs.length === 0) return [];

  const EPS   = 1e-5;
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const result: LSLine[] = [];

  scene.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!isWorldVisLS(obj)) return;
    if (obj.userData.isAlignment || obj.userData.isEdge ||
        (obj.name ?? "").startsWith("__")) return;
    if (obj.userData.isHighlight || obj.userData.isSectionVisual ||
        obj.userData.isSectionCap || obj.userData.isBillingOverlay ||
        obj.userData.isXSSurface) return;
    if (obj.userData.expressId == null) return;

    const geom = obj.geometry as THREE.BufferGeometry;
    if (!geom?.attributes?.position) return;
    if (!geom.boundingSphere) geom.computeBoundingSphere();

    const bs     = geom.boundingSphere!;
    const center = bs.center.clone().applyMatrix4(obj.matrixWorld);
    const radius = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis?.() ?? 1);

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color;
    const color = col ? `#${col.getHexString()}` : "#888";

    let modelId = "";
    let n: THREE.Object3D | null = obj.parent;
    while (n) { if (n.userData.modelId) { modelId = n.userData.modelId as string; break; } n = n.parent; }
    const eid = obj.userData.expressId as number | undefined;
    const objectKey = (modelId && eid != null) ? `${modelId}:${eid}` : undefined;

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const mx  = obj.matrixWorld;
    const nTri = idx ? idx.count / 3 : Math.floor(pos.count / 3);

    for (const seg of segs) {
      // Fast per-segment bounding-sphere reject
      _dq.copy(center).sub(seg.origin);
      const distN = _dq.dot(seg.normal);
      if (Math.abs(distN) > radius + EPS) continue;

      const distR = _dq.dot(seg.right);
      if (distR + radius < -EPS || distR - radius > seg.hLen + EPS) continue;

      for (let t = 0; t < nTri; t++) {
        const i0 = idx ? idx.getX(t * 3)     : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

        _vA.fromBufferAttribute(pos, i0).applyMatrix4(mx);
        _vB.fromBufferAttribute(pos, i1).applyMatrix4(mx);
        _vC.fromBufferAttribute(pos, i2).applyMatrix4(mx);

        _dq.copy(_vA).sub(seg.origin); const dA = _dq.dot(seg.normal);
        _dq.copy(_vB).sub(seg.origin); const dB = _dq.dot(seg.normal);
        _dq.copy(_vC).sub(seg.origin); const dC = _dq.dot(seg.normal);

        if (dA > -EPS && dB > -EPS && dC > -EPS) continue;
        if (dA <  EPS && dB <  EPS && dC <  EPS) continue;

        const crossings: [number, number][] = [];

        const tryEdge = (va: THREE.Vector3, da: number, vb: THREE.Vector3, db: number) => {
          if (!((da > EPS && db < -EPS) || (da < -EPS && db > EPS))) return;
          _pt.lerpVectors(va, vb, da / (da - db));
          _dq.copy(_pt).sub(seg.origin);
          const x = _dq.dot(seg.right);
          const y = _pt.y;  // absolute world Y, not relative to segment origin
          crossings.push([x, y]);
        };

        tryEdge(_vA, dA, _vB, dB);
        tryEdge(_vB, dB, _vC, dC);
        tryEdge(_vC, dC, _vA, dA);
        if (crossings.length < 2) continue;

        const [x1, y1] = crossings[0];
        const [x2, y2] = crossings[1];

        // Keep only the part within the horizontal extent of this segment
        if (Math.max(x1, x2) < -EPS || Math.min(x1, x2) > seg.hLen + EPS) continue;

        // Map x (horizontal offset) → station
        const scale = seg.staDiff / (seg.hLen || 1);
        const sta1  = seg.staA + x1 * scale;
        const sta2  = seg.staA + x2 * scale;

        if (Math.max(sta1, sta2) < staStart || Math.min(sta1, sta2) > staEnd) continue;

        result.push({ sta1, elev1: y1, sta2, elev2: y2, color, objectKey });
      }
    }
  });

  return result;
}
