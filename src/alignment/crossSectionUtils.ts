import * as THREE from "three";

export interface SectionLine {
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
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
        lines.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], color });
      }
    }
  });

  return lines;
}
