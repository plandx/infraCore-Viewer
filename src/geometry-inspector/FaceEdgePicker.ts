import * as THREE from "three";
import type { InspFace, InspEdge, PickMode } from "./types";
import { analyzeMeshes } from "./GeometryAnalyzer";

const C_FACE_DEFAULT = 0x4488ff;
const C_FACE_HOVER   = 0x66aaff;
const C_FACE_SELECT  = 0x22cc88;
const C_EDGE_DEFAULT = 0xccddff;
const C_EDGE_HOVER   = 0x88ccff;
const C_EDGE_SELECT  = 0x44ff88;
const FACE_OFFSET    = 0.001; // 1 mm outward to avoid z-fighting

export class FaceEdgePicker {
  faces: InspFace[] = [];
  edges: InspEdge[] = [];

  selectedFaceIds = new Set<number>();
  selectedEdgeIds = new Set<number>();
  hoveredFaceId   = -1;
  hoveredEdgeId   = -1;

  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private faceMeshes: THREE.Mesh[]         = [];
  private edgeLines:  THREE.LineSegments[] = [];
  private edgePickMeshes: THREE.Mesh[]     = []; // invisible boxes for reliable edge picking
  private onChange: (faces: Set<number>, edges: Set<number>) => void;

  constructor(scene: THREE.Scene, onChange: (faces: Set<number>, edges: Set<number>) => void) {
    this.scene    = scene;
    this.onChange = onChange;
    this.raycaster.params.Line = { threshold: 0.03 };
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
      // offset each vertex by 1 mm along face normal
      const offsetVerts = verts.slice();
      for (let i = 0; i < offsetVerts.length; i += 3) {
        offsetVerts[i]   += n.x * FACE_OFFSET;
        offsetVerts[i+1] += n.y * FACE_OFFSET;
        offsetVerts[i+2] += n.z * FACE_OFFSET;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(offsetVerts, 3));
      const mat = new THREE.MeshBasicMaterial({
        color: C_FACE_DEFAULT, transparent: true, opacity: 0.12,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 10;
      mesh.userData.inspFaceId = face.id;
      this.scene.add(mesh);
      this.faceMeshes.push(mesh);
    }

    // ── Edge visuals + invisible pick boxes ────────────────────────────────────
    for (const edge of edges) {
      const s = new THREE.Vector3(...edge.start);
      const e = new THREE.Vector3(...edge.end);

      // Visual line
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute([s.x, s.y, s.z, e.x, e.y, e.z], 3));
      const lineMat = new THREE.LineBasicMaterial({ color: C_EDGE_DEFAULT, depthTest: false });
      const line = new THREE.LineSegments(lineGeo, lineMat);
      line.renderOrder = 11;
      line.userData.inspEdgeId = edge.id;
      this.scene.add(line);
      this.edgeLines.push(line);

      // Invisible pick box (thin box aligned along edge)
      const dir = e.clone().sub(s);
      const mid = s.clone().add(e).multiplyScalar(0.5);
      const len = dir.length();
      const boxGeo = new THREE.BoxGeometry(0.025, len, 0.025);
      const boxMat = new THREE.MeshBasicMaterial({ visible: false });
      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.copy(mid);
      box.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      box.userData.inspEdgeId = edge.id;
      this.scene.add(box);
      this.edgePickMeshes.push(box);
    }
  }

  onMouseMove(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    this.raycaster.setFromCamera(ndc, camera);

    const faceHit = this.raycaster.intersectObjects(this.faceMeshes);
    const newFace = faceHit.length > 0 ? (faceHit[0].object.userData.inspFaceId as number) : -1;

    const edgeHit = this.raycaster.intersectObjects(this.edgePickMeshes);
    const newEdge = edgeHit.length > 0 ? (edgeHit[0].object.userData.inspEdgeId as number) : -1;

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
      const hits = this.raycaster.intersectObjects(this.edgePickMeshes);
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
        mat.color.setHex(C_FACE_SELECT); mat.opacity = 0.65;
      } else if (id === this.hoveredFaceId) {
        mat.color.setHex(C_FACE_HOVER);  mat.opacity = 0.40;
      } else {
        mat.color.setHex(C_FACE_DEFAULT); mat.opacity = 0.12;
      }
      mat.needsUpdate = true;
    }
    for (const l of this.edgeLines) {
      const id  = l.userData.inspEdgeId as number;
      const mat = l.material as THREE.LineBasicMaterial;
      if (this.selectedEdgeIds.has(id))  mat.color.setHex(C_EDGE_SELECT);
      else if (id === this.hoveredEdgeId) mat.color.setHex(C_EDGE_HOVER);
      else                                mat.color.setHex(C_EDGE_DEFAULT);
      mat.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.faceMeshes)    { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    for (const l of this.edgeLines)     { this.scene.remove(l); l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
    for (const b of this.edgePickMeshes){ this.scene.remove(b); b.geometry.dispose(); (b.material as THREE.Material).dispose(); }
    this.faceMeshes = []; this.edgeLines = []; this.edgePickMeshes = [];
    this.faces = []; this.edges = [];
    this.selectedFaceIds.clear(); this.selectedEdgeIds.clear();
    this.hoveredFaceId = -1; this.hoveredEdgeId = -1;
  }
}
