import * as THREE from "three";
import type { BillingEntry } from "./types";

const VS = /* glsl */`
  varying float vWorldY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldY = wp.y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FS = /* glsl */`
  uniform float uFillTop;
  uniform vec3  uColor;
  uniform float uOpacity;
  varying float vWorldY;
  void main() {
    if (vWorldY > uFillTop + 0.002) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

function degreeToColor(d: number): THREE.Color {
  if (d >= 100) return new THREE.Color(0x22c55e);
  const t = d / 100;
  return new THREE.Color(1.0 - t * 0.65, 0.38 + t * 0.58, 0.08);
}

interface Overlay { mesh: THREE.Mesh }

export class BillingVisualizer {
  private scene: THREE.Scene;
  private overlays = new Map<string, Overlay>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(entries: Record<string, BillingEntry>, meshMap: Map<string, THREE.Mesh[]>): void {
    for (const [key, ov] of this.overlays) {
      if (!entries[key]) {
        this.scene.remove(ov.mesh);
        ov.mesh.geometry.dispose();
        (ov.mesh.material as THREE.Material).dispose();
        this.overlays.delete(key);
      }
    }

    for (const [key, entry] of Object.entries(entries)) {
      const degree = entry.stages.length > 0
        ? entry.stages[entry.stages.length - 1].degree
        : 0;

      const meshes = meshMap.get(key) ?? [];
      if (!meshes.length) continue;

      const bbox = new THREE.Box3();
      for (const m of meshes) bbox.expandByObject(m);
      const height = bbox.max.y - bbox.min.y;
      const fillTop = bbox.min.y + height * Math.max(0, Math.min(100, degree)) / 100;
      const color = degreeToColor(degree);
      const opacity = degree >= 100 ? 0.50 : 0.42;

      const existing = this.overlays.get(key);
      if (existing) {
        const mat = existing.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uFillTop.value = fillTop;
        mat.uniforms.uColor.value = color;
        mat.uniforms.uOpacity.value = opacity;
      } else {
        const geo = this.mergeGeo(meshes);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VS, fragmentShader: FS,
          uniforms: {
            uFillTop:  { value: fillTop },
            uColor:    { value: color },
            uOpacity:  { value: opacity },
          },
          transparent: true, depthTest: true, depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.isBillingOverlay = true;
        mesh.renderOrder = 2;
        this.scene.add(mesh);
        this.overlays.set(key, { mesh });
      }
    }
  }

  private mergeGeo(meshes: THREE.Mesh[]): THREE.BufferGeometry {
    const pos: number[] = [];
    const idx: number[] = [];
    let base = 0;
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      const g = mesh.geometry;
      const p = g.attributes.position;
      const i = g.index;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(mesh.matrixWorld);
        pos.push(v.x, v.y, v.z);
      }
      if (i) { for (let k = 0; k < i.count; k++) idx.push(base + i.getX(k)); }
      else    { for (let k = 0; k < p.count; k++) idx.push(base + k); }
      base += p.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
  }

  clear(): void {
    for (const ov of this.overlays.values()) {
      this.scene.remove(ov.mesh);
      ov.mesh.geometry.dispose();
      (ov.mesh.material as THREE.Material).dispose();
    }
    this.overlays.clear();
  }

  dispose(): void { this.clear(); }
}
