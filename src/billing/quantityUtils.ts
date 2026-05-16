import * as THREE from "three";
import type { ElementQuantities } from "./types";
import type { QuantityItem } from "./quantityTypes";
import { qid } from "./quantityTypes";

export function computeQuantities(meshes: THREE.Mesh[]): ElementQuantities {
  const bbox = new THREE.Box3();
  let surfaceArea = 0;
  let volume = 0;

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
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      surfaceArea += ab.clone().cross(ac).length() * 0.5;
      const cross = new THREE.Vector3().crossVectors(b, c);
      volume += a.dot(cross) / 6;
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

// ── Extended computation — returns QuantityItems for the QuantitySet ──────────

export function computeQuantityItems(meshes: THREE.Mesh[]): QuantityItem[] {
  const q = computeQuantities(meshes);
  const items: QuantityItem[] = [];

  const dims = [q.bboxX, q.bboxY, q.bboxZ].sort((a, b) => a - b);
  const [minDim, midDim, maxDim] = dims;

  if (q.volume > 0) {
    items.push({ id: qid(), type: "volume",    label: "Volumen (Geometrie)",    value: q.volume,      unit: "m³", source: "geometry" });
  }
  if (q.surfaceArea > 0) {
    items.push({ id: qid(), type: "area",      label: "Oberfläche (Geometrie)", value: q.surfaceArea, unit: "m²", source: "geometry" });
  }
  if (maxDim > 0) {
    items.push({ id: qid(), type: "height",    label: "Größte Ausdehnung",      value: maxDim,        unit: "m",  source: "geometry" });
  }
  if (midDim > 0) {
    items.push({ id: qid(), type: "width",     label: "Mittlere Ausdehnung",    value: midDim,        unit: "m",  source: "geometry" });
  }
  if (minDim > 0) {
    items.push({ id: qid(), type: "thickness", label: "Kleinste Ausdehnung",    value: minDim,        unit: "m",  source: "geometry" });
  }

  return items;
}
