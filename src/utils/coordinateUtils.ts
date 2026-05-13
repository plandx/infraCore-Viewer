import * as THREE from "three";

/**
 * IFC models in civil/infrastructure projects can have coordinates in the
 * millions (e.g. Swiss LV95: 2'600'000 / 1'200'000). Three.js uses 32-bit
 * floats for geometry, which loses precision above ~16'000 units.
 *
 * Strategy: detect the bounding-box center of the first model, store it as
 * the "world origin offset", and shift all subsequent models relative to it.
 * The camera stays in a small coordinate range (< 50'000 units) while the
 * logical geo-coordinates are preserved in originOffset per model.
 */

export const LARGE_COORD_THRESHOLD = 10_000;

export function computeModelOffset(
  bbox: THREE.Box3,
  worldOrigin: THREE.Vector3 | null
): THREE.Vector3 {
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  if (!worldOrigin) {
    // First model: use its center as the world origin
    return center.clone();
  }
  // Subsequent models: keep using the established world origin
  return worldOrigin.clone();
}

export function needsCoordinateShift(bbox: THREE.Box3): boolean {
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  return (
    Math.abs(center.x) > LARGE_COORD_THRESHOLD ||
    Math.abs(center.y) > LARGE_COORD_THRESHOLD ||
    Math.abs(center.z) > LARGE_COORD_THRESHOLD
  );
}

export function applyOriginOffset(
  object: THREE.Object3D,
  offset: THREE.Vector3
): void {
  object.position.sub(offset);
}

export function getSceneExtentKm(bbox: THREE.Box3): string {
  if (bbox.isEmpty()) return "–";
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim >= 1000) return `${(maxDim / 1000).toFixed(1)} km`;
  return `${maxDim.toFixed(0)} m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateModelColor(index: number): string {
  const palette = [
    "#4f8ef7",
    "#e05c5c",
    "#5cb85c",
    "#f0ad4e",
    "#9b59b6",
    "#1abc9c",
    "#e74c3c",
    "#3498db",
    "#f39c12",
    "#2ecc71",
  ];
  return palette[index % palette.length];
}
