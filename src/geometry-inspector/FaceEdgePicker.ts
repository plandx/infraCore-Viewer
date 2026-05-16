import * as THREE from "three";
import type { InspFace, InspFaceBoundary, PickMode } from "./types";
import { analyzeMeshes } from "./GeometryAnalyzer";

const C_FACE_DEFAULT = 0x22aa55;
const C_FACE_HOVER   = 0x33ee77;
const C_FACE_SELECT  = 0x00ff66;

// In edge mode, face overlays are neutral "click targets" — barely visible
const C_FACE_EDGE_MODE = 0x888888;

const C_EDGE_DEFAULT = 0xcc2222;
const C_EDGE_HOVER   = 0xff5555;
const C_EDGE_SELECT  = 0xff8800;

const FACE_OFFSET  = 0.001;
const EDGE_RADIUS  = 0.02;

export class FaceEdgePicker {
  faces: InspFace[] = [];
  faceBoundaries: InspFaceBoundary[] = [];

  selectedFaceIds     = new Set<number>();
  selectedBoundaryIds = new Set<number>(); // keyed by faceId
  hoveredFaceId       = -1;
  hoveredBoundaryId   = -1;
  currentMode: PickMode = "face";

  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private faceMeshes: THREE.Mesh[] = [];
  // All boundary cylinders; userData.inspBoundaryId = faceId so the full boundary is selected at once
  private boundaryMeshes: THREE.Mesh[] = [];

  private onChange: (faces: Set<number>, boundaries: Set<number>) => void;

  constructor(scene: THREE.Scene, onChange: (faces: Set<number>, boundaries: Set<number>) => void) {
    this.scene    = scene;
    this.onChange = onChange;
  }

  load(meshes: THREE.Mesh[]): void {
    this.dispose();
    const { faces, faceBoundaries, faceVertArrays } = analyzeMeshes(meshes);
    this.faces = faces;
    this.faceBoundaries = faceBoundaries;

    // ── Face overlays ────────────────────────────────────────────────────────
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

    // ── Boundary cylinders — one per segment, grouped by faceId ─────────────
    // userData.inspBoundaryId = faceId so clicking any segment selects the whole boundary.
    for (const boundary of faceBoundaries) {
      for (const seg of boundary.segments) {
        const s = new THREE.Vector3(...seg.start);
        const e = new THREE.Vector3(...seg.end);
        const dir = e.clone().sub(s);
        const len = dir.length();
        if (len < 1e-4) continue;

        const mid = s.clone().add(e).multiplyScalar(0.5);
        const geo = new THREE.CylinderGeometry(EDGE_RADIUS, EDGE_RADIUS, len, 8, 1, false);
        const mat = new THREE.MeshBasicMaterial({
          color: C_EDGE_DEFAULT, depthTest: false, depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(mid);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        mesh.renderOrder = 11;
        mesh.userData.inspBoundaryId = boundary.faceId;
        this.scene.add(mesh);
        this.boundaryMeshes.push(mesh);
      }
    }

    this.setMode("face");
  }

  setMode(mode: PickMode): void {
    this.currentMode = mode;
    if (mode === "face") {
      // Face mode: green face overlays visible, cylinders hidden
      for (const m of this.faceMeshes) {
        m.visible = true;
        (m.material as THREE.MeshBasicMaterial).color.setHex(C_FACE_DEFAULT);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.15;
      }
      for (const m of this.boundaryMeshes) m.visible = false;
    } else {
      // Edge mode: face overlays visible as neutral click-targets + cylinders visible
      for (const m of this.faceMeshes) {
        m.visible = true;
        (m.material as THREE.MeshBasicMaterial).color.setHex(C_FACE_EDGE_MODE);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.05;
      }
      for (const m of this.boundaryMeshes) m.visible = true;
    }
    this.hoveredFaceId = -1;
    this.hoveredBoundaryId = -1;
  }

  onMouseMove(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    this.raycaster.setFromCamera(ndc, camera);

    let newFace = -1, newBoundary = -1;
    if (this.currentMode === "face") {
      const hit = this.raycaster.intersectObjects(this.faceMeshes);
      newFace = hit.length > 0 ? (hit[0].object.userData.inspFaceId as number) : -1;
    } else {
      // Cylinders take priority; fall back to face overlay for boundary selection
      const hitCyl = this.raycaster.intersectObjects(this.boundaryMeshes);
      if (hitCyl.length > 0) {
        newBoundary = hitCyl[0].object.userData.inspBoundaryId as number;
      } else {
        const hitFace = this.raycaster.intersectObjects(this.faceMeshes);
        if (hitFace.length > 0) newBoundary = hitFace[0].object.userData.inspFaceId as number;
      }
    }

    if (newFace !== this.hoveredFaceId || newBoundary !== this.hoveredBoundaryId) {
      this.hoveredFaceId     = newFace;
      this.hoveredBoundaryId = newBoundary;
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
      // Cylinders take priority; fall back to face overlay for boundary selection
      const hitCyl  = this.raycaster.intersectObjects(this.boundaryMeshes);
      const hitFace = hitCyl.length === 0 ? this.raycaster.intersectObjects(this.faceMeshes) : [];
      const id: number | undefined = hitCyl.length > 0
        ? (hitCyl[0].object.userData.inspBoundaryId as number)
        : hitFace.length > 0
          ? (hitFace[0].object.userData.inspFaceId as number)
          : undefined;

      if (id === undefined) {
        if (!ctrl) this.selectedBoundaryIds.clear();
      } else {
        if (ctrl) {
          if (this.selectedBoundaryIds.has(id)) this.selectedBoundaryIds.delete(id);
          else this.selectedBoundaryIds.add(id);
        } else {
          this.selectedBoundaryIds.clear();
          this.selectedBoundaryIds.add(id);
        }
      }
    }

    this.updateColors();
    this.onChange(new Set(this.selectedFaceIds), new Set(this.selectedBoundaryIds));
    return true;
  }

  private updateColors(): void {
    if (this.currentMode === "face") {
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
      }
    } else {
      // Edge mode: face overlays stay neutral; only cylinders show selection/hover
      for (const m of this.boundaryMeshes) {
        const id  = m.userData.inspBoundaryId as number;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (this.selectedBoundaryIds.has(id))   mat.color.setHex(C_EDGE_SELECT);
        else if (id === this.hoveredBoundaryId)  mat.color.setHex(C_EDGE_HOVER);
        else                                     mat.color.setHex(C_EDGE_DEFAULT);
      }
    }
  }

  dispose(): void {
    for (const m of this.faceMeshes)     { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    for (const m of this.boundaryMeshes) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.faceMeshes = []; this.boundaryMeshes = [];
    this.faces = []; this.faceBoundaries = [];
    this.selectedFaceIds.clear(); this.selectedBoundaryIds.clear();
    this.hoveredFaceId = -1; this.hoveredBoundaryId = -1;
  }
}
