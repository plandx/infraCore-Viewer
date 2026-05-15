import * as THREE from "three";
import type { ElementQuantities } from "./types";

export function computeQuantities(meshes: THREE.Mesh[]): ElementQuantities {
  const bbox = new THREE.Box3();
  let surfaceArea = 0;
  let volume = 0;

  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;

    bbox.expandByObject(mesh);

    const count = idx ? idx.count : pos.count;

    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i)     : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;

      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

      // Surface area: half the cross-product magnitude
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      surfaceArea += ab.clone().cross(ac).length() * 0.5;

      // Signed volume contribution via divergence theorem
      // V = (1/6) * a · (b × c)  (sum over all triangles gives total volume)
      v.crossVectors(b, c);
      volume += a.dot(v) / 6;
    }
  }

  const size = new THREE.Vector3();
  bbox.getSize(size);

  return {
    volume: Math.abs(volume),
    surfaceArea,
    bboxX: size.x,
    bboxY: size.y,
    bboxZ: size.z,
    computedAt: new Date().toISOString(),
  };
}
