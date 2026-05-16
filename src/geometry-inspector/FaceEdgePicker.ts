import * as THREE from "three";
import type { InspFace, InspEdge, PickMode } from "./types";
import { analyzeMeshes } from "./GeometryAnalyzer";

const C_FACE_DEFAULT = 0x22aa55;  // subtle green
const C_FACE_HOVER   = 0x33ee77;  // bright green
const C_FACE_SELECT  = 0x00ff66;  // vivid green

const C_EDGE_DEFAULT = 0xcc2222;  // red
const C_EDGE_HOVER   = 0xff5555;  // bright red
const C_EDGE_SELECT  = 0xff8800;  // orange-red (clearly different from hover)

const FACE_OFFSET  = 0.001; // 1 mm outward to avoid z-fighting
const EDGE_RADIUS  = 0.02;  // 2 cm cylinder radius — thicker than normal edge lines

export class FaceEdgePicker {
  faces: InspFace[] = [];
  edges: InspEdge[] = [];

  selectedFaceIds = new Set<number>();
  selectedEdgeIds = new Set<number>();
  hoveredFaceId   = -1;
  hoveredEdgeId   = -1;
  currentMode: PickMode = "face";

  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private faceMeshes: THREE.Mesh[] = [];
  private edgeMeshes: THREE.Mesh[] = []; // visible cylinders — both visual and raycasted

  private onChange: (faces: Set<number>, edges: Set<number>) => void;

  constructor(scene: THREE.Scene, onChange: (faces: Set<number>, edges: Set<number>) => void) {
    this.scene    = scene;
    this.onChange = onChange;
  }

  load(meshes: THREE.Mesh[]): void {
    this.dispose();
    const { faces, edges, faceVertArrays } = analyzeMeshes(meshes);
    this.faces = faces;
    this.edges = edges;

    // ── Face overlays ──────────────────────────────────────────────────────────
    for (const face of faces) {
      const verts = faceVertArrays[face.id];
      const n = new THREE.Vector3(...face.normal);
      const offsetVerts = verts.slice();
      for (let i = 0; i < offsetVerts.length; i += 3) {
        offsetVerts[i]   += n.x * FACE_OFFSET;
        offsetVerts[i+1] += n.y * FACE_OFFSET;
        offsetVerts[i+2] += n.z * FACE_OFFSET;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(offsetVerts, 3));
      const mat = new THREE.MeshBasicMaterial({
        color: C_FACE_DEFAULT, transparent: true, opacity: 0.15,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 10;
      mesh.userData.inspFaceId = face.id;
      this.scene.add(mesh);
      this.faceMeshes.push(mesh);
    }

    // ── Edge cylinders — visible AND raycasted ─────────────────────────────────
    // Using CylinderGeometry instead of LineSegments + invisible boxes.
    // LineBasicMaterial.linewidth > 1 is not supported in WebGL; invisible boxes
    // are skipped by the raycaster (visible=false). Cylinders solve both problems.
    for (const edge of edges) {
      const s = new THREE.Vector3(...edge.start);
      const e = new THREE.Vector3(...edge.end);
      const dir = e.clone().sub(s);
      const len = dir.length();
      if (len < 1e-4) continue;

      const mid = s.clone().add(e).multiplyScalar(0.5);

      // CylinderGeometry is oriented along Y by default — same as BoxGeometry was
      const geo = new THREE.CylinderGeometry(EDGE_RADIUS, EDGE_RADIUS, len, 8, 1, false);
      const mat = new THREE.MeshBasicMaterial({
        color: C_EDGE_DEFAULT, depthTest: false, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      mesh.renderOrder = 11;
      mesh.userData.inspEdgeId = edge.id;
      this.scene.add(mesh);
      this.edgeMeshes.push(mesh);
    }

    // Start in face mode: show faces, hide edges
    this.setMode("face");
  }

  setMode(mode: PickMode): void {
    this.currentMode = mode;
    for (const m of this.faceMeshes) m.visible = (mode === "face");
    for (const m of this.edgeMeshes) m.visible = (mode === "edge");
    // Clear hover for the mode we're leaving
    this.hoveredFaceId = -1;
    this.hoveredEdgeId = -1;
  }

  onMouseMove(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    this.raycaster.setFromCamera(ndc, camera);

    // Only raycast against the active mode's objects (the other set is already invisible)
    let newFace = -1, newEdge = -1;
    if (this.currentMode === "face") {
      const hit = this.raycaster.intersectObjects(this.faceMeshes);
      newFace = hit.length > 0 ? (hit[0].object.userData.inspFaceId as number) : -1;
    } else {
      const hit = this.raycaster.intersectObjects(this.edgeMeshes);
      newEdge = hit.length > 0 ? (hit[0].object.userData.inspEdgeId as number) : -1;
    }

    if (newFace !== this.hoveredFaceId || newEdge !== this.hoveredEdgeId) {
      this.hoveredFaceId = newFace;
      this.hoveredEdgeId = newEdge;
      this.updateColors();
      return true;
    }
    return false;
  }

  onClick(ndc: THREE.Vector2, camera: THREE.Camera, ctrl: boolean, mode: PickMode): boolean {
    this.raycaster.setFromCamera(ndc, camera);

    if (mode === "face") {
      const hits = this.raycaster.intersectObjects(this.faceMeshes);
      if (hits.length === 0) {
        if (!ctrl) this.selectedFaceIds.clear();
      } else {
        const id = hits[0].object.userData.inspFaceId as number;
        if (ctrl) {
          if (this.selectedFaceIds.has(id)) this.selectedFaceIds.delete(id);
          else this.selectedFaceIds.add(id);
        } else {
          this.selectedFaceIds.clear();
          this.selectedFaceIds.add(id);
        }
      }
    } else {
      const hits = this.raycaster.intersectObjects(this.edgeMeshes);
      if (hits.length === 0) {
        if (!ctrl) this.selectedEdgeIds.clear();
      } else {
        const id = hits[0].object.userData.inspEdgeId as number;
        if (ctrl) {
          if (this.selectedEdgeIds.has(id)) this.selectedEdgeIds.delete(id);
          else this.selectedEdgeIds.add(id);
        } else {
          this.selectedEdgeIds.clear();
          this.selectedEdgeIds.add(id);
        }
      }
    }

    this.updateColors();
    this.onChange(new Set(this.selectedFaceIds), new Set(this.selectedEdgeIds));
    return true;
  }

  private updateColors(): void {
    for (const m of this.faceMeshes) {
      const id  = m.userData.inspFaceId as number;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (this.selectedFaceIds.has(id)) {
        mat.color.setHex(C_FACE_SELECT); mat.opacity = 0.70;
      } else if (id === this.hoveredFaceId) {
        mat.color.setHex(C_FACE_HOVER);  mat.opacity = 0.45;
      } else {
        mat.color.setHex(C_FACE_DEFAULT); mat.opacity = 0.15;
      }
      mat.needsUpdate = true;
    }
    for (const m of this.edgeMeshes) {
      const id  = m.userData.inspEdgeId as number;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (this.selectedEdgeIds.has(id))   mat.color.setHex(C_EDGE_SELECT);
      else if (id === this.hoveredEdgeId) mat.color.setHex(C_EDGE_HOVER);
      else                                mat.color.setHex(C_EDGE_DEFAULT);
      mat.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.faceMeshes) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    for (const m of this.edgeMeshes) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.faceMeshes = []; this.edgeMeshes = [];
    this.faces = []; this.edges = [];
    this.selectedFaceIds.clear(); this.selectedEdgeIds.clear();
    this.hoveredFaceId = -1; this.hoveredEdgeId = -1;
  }
}
