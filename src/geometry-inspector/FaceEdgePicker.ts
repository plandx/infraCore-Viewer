import * as THREE from "three";
import type { InspFace, InspFaceBoundary, InspEdge, PickMode } from "./types";
import { analyzeMeshes } from "./GeometryAnalyzer";

const C_FACE_DEFAULT   = 0x22aa55;
const C_FACE_HOVER     = 0x33ee77;
const C_FACE_SELECT    = 0x00ff66;
const C_FACE_EDGE_MODE = 0x888888; // neutral — used as click target in boundary/edge mode

const C_BOUND_DEFAULT  = 0xcc2222;
const C_BOUND_HOVER    = 0xff5555;
const C_BOUND_SELECT   = 0xff8800;

const C_EDGE_DEFAULT   = 0xcc2222;
const C_EDGE_HOVER     = 0xff5555;
const C_EDGE_SELECT    = 0xff8800;

const FACE_OFFSET = 0.001;
const CYL_RADIUS  = 0.02;

export class FaceEdgePicker {
  faces: InspFace[] = [];
  faceBoundaries: InspFaceBoundary[] = [];
  edges: InspEdge[] = [];

  selectedFaceIds     = new Set<number>();
  selectedBoundaryIds = new Set<number>(); // keyed by faceId
  selectedEdgeIds     = new Set<number>();

  hoveredFaceId     = -1;
  hoveredBoundaryId = -1;
  hoveredEdgeId     = -1;

  currentMode: PickMode = "face";

  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();

  // Three independent sets of meshes — only one set visible at a time
  private faceMeshes:     THREE.Mesh[] = [];
  private boundaryMeshes: THREE.Mesh[] = []; // userData.inspBoundaryId = faceId
  private edgeMeshes:     THREE.Mesh[] = []; // userData.inspEdgeId = edgeId

  // vertex key → edge IDs sharing that endpoint (built in load())
  private vertexToEdges = new Map<string, number[]>();

  private onChange: (faces: Set<number>, boundaries: Set<number>, edges: Set<number>) => void;

  constructor(
    scene: THREE.Scene,
    onChange: (faces: Set<number>, boundaries: Set<number>, edges: Set<number>) => void,
  ) {
    this.scene    = scene;
    this.onChange = onChange;
  }

  load(meshes: THREE.Mesh[]): void {
    this.dispose();
    const { faces, faceBoundaries, edges, faceVertArrays } = analyzeMeshes(meshes);
    this.faces = faces;
    this.faceBoundaries = faceBoundaries;
    this.edges = edges;

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

    // ── Boundary cylinders (grouped by faceId) ────────────────────────────
    for (const boundary of faceBoundaries) {
      for (const seg of boundary.segments) {
        const s = new THREE.Vector3(...seg.start);
        const e = new THREE.Vector3(...seg.end);
        const dir = e.clone().sub(s);
        const len = dir.length();
        if (len < 1e-4) continue;
        const geo = new THREE.CylinderGeometry(CYL_RADIUS, CYL_RADIUS, len, 8, 1, false);
        const mat = new THREE.MeshBasicMaterial({ color: C_BOUND_DEFAULT, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(s.clone().add(e).multiplyScalar(0.5));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        mesh.renderOrder = 11;
        mesh.userData.inspBoundaryId = boundary.faceId;
        this.scene.add(mesh);
        this.boundaryMeshes.push(mesh);
      }
    }

    // ── Individual edge cylinders ─────────────────────────────────────────
    for (const edge of edges) {
      const s = new THREE.Vector3(...edge.start);
      const e = new THREE.Vector3(...edge.end);
      const dir = e.clone().sub(s);
      const len = dir.length();
      if (len < 1e-4) continue;
      const geo = new THREE.CylinderGeometry(CYL_RADIUS, CYL_RADIUS, len, 8, 1, false);
      const mat = new THREE.MeshBasicMaterial({ color: C_EDGE_DEFAULT, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(s.clone().add(e).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      mesh.renderOrder = 11;
      mesh.userData.inspEdgeId = edge.id;
      this.scene.add(mesh);
      this.edgeMeshes.push(mesh);
    }

    // Build vertex → edge adjacency for connected-edge flood-fill
    const PREC = 4000;
    const qv = (x: number, y: number, z: number) =>
      `${Math.round(x * PREC)},${Math.round(y * PREC)},${Math.round(z * PREC)}`;
    this.vertexToEdges.clear();
    for (const edge of edges) {
      for (const pt of [edge.start, edge.end]) {
        const k = qv(pt[0], pt[1], pt[2]);
        const arr = this.vertexToEdges.get(k) ?? [];
        arr.push(edge.id);
        this.vertexToEdges.set(k, arr);
      }
    }

    this.setMode("face");
  }

  setMode(mode: PickMode): void {
    this.currentMode = mode;
    this.hoveredFaceId = -1;
    this.hoveredBoundaryId = -1;
    this.hoveredEdgeId = -1;

    // Clear selections of inactive modes so they don't carry over to the next save
    if (mode === "face") {
      this.selectedBoundaryIds.clear();
      this.selectedEdgeIds.clear();
    } else if (mode === "boundary") {
      this.selectedFaceIds.clear();
      this.selectedEdgeIds.clear();
    } else {
      this.selectedFaceIds.clear();
      this.selectedBoundaryIds.clear();
    }

    if (mode === "face") {
      for (const m of this.faceMeshes) {
        m.visible = true;
        (m.material as THREE.MeshBasicMaterial).color.setHex(C_FACE_DEFAULT);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.15;
      }
      for (const m of this.boundaryMeshes) m.visible = false;
      for (const m of this.edgeMeshes)     m.visible = false;
    } else if (mode === "boundary") {
      for (const m of this.faceMeshes) {
        m.visible = true;
        (m.material as THREE.MeshBasicMaterial).color.setHex(C_FACE_EDGE_MODE);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.05;
      }
      for (const m of this.boundaryMeshes) m.visible = true;
      for (const m of this.edgeMeshes)     m.visible = false;
    } else {
      for (const m of this.faceMeshes)     m.visible = false;
      for (const m of this.boundaryMeshes) m.visible = false;
      for (const m of this.edgeMeshes)     m.visible = true;
    }
    this.updateColors();
    this.onChange(new Set(this.selectedFaceIds), new Set(this.selectedBoundaryIds), new Set(this.selectedEdgeIds));
  }

  onMouseMove(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    this.raycaster.setFromCamera(ndc, camera);

    let newFace = -1, newBoundary = -1, newEdge = -1;

    if (this.currentMode === "face") {
      const hit = this.raycaster.intersectObjects(this.faceMeshes);
      newFace = hit.length > 0 ? (hit[0].object.userData.inspFaceId as number) : -1;
    } else if (this.currentMode === "boundary") {
      // Cylinders take priority, face overlay as fallback
      const hitCyl = this.raycaster.intersectObjects(this.boundaryMeshes);
      if (hitCyl.length > 0) {
        newBoundary = hitCyl[0].object.userData.inspBoundaryId as number;
      } else {
        const hitFace = this.raycaster.intersectObjects(this.faceMeshes);
        if (hitFace.length > 0) newBoundary = hitFace[0].object.userData.inspFaceId as number;
      }
    } else {
      const hit = this.raycaster.intersectObjects(this.edgeMeshes);
      newEdge = hit.length > 0 ? (hit[0].object.userData.inspEdgeId as number) : -1;
    }

    if (newFace !== this.hoveredFaceId || newBoundary !== this.hoveredBoundaryId || newEdge !== this.hoveredEdgeId) {
      this.hoveredFaceId     = newFace;
      this.hoveredBoundaryId = newBoundary;
      this.hoveredEdgeId     = newEdge;
      this.updateColors();
      return true;
    }
    return false;
  }

  onClick(ndc: THREE.Vector2, camera: THREE.Camera, ctrl: boolean, mode: PickMode): boolean {
    this.raycaster.setFromCamera(ndc, camera);

    if (mode === "face") {
      const hits = this.raycaster.intersectObjects(this.faceMeshes);
      this._toggle(hits.length > 0 ? (hits[0].object.userData.inspFaceId as number) : undefined, this.selectedFaceIds, ctrl);
    } else if (mode === "boundary") {
      const hitCyl  = this.raycaster.intersectObjects(this.boundaryMeshes);
      const hitFace = hitCyl.length === 0 ? this.raycaster.intersectObjects(this.faceMeshes) : [];
      const id: number | undefined = hitCyl.length > 0
        ? (hitCyl[0].object.userData.inspBoundaryId as number)
        : hitFace.length > 0 ? (hitFace[0].object.userData.inspFaceId as number) : undefined;
      this._toggle(id, this.selectedBoundaryIds, ctrl);
    } else {
      const hits = this.raycaster.intersectObjects(this.edgeMeshes);
      this._toggle(hits.length > 0 ? (hits[0].object.userData.inspEdgeId as number) : undefined, this.selectedEdgeIds, ctrl);
    }

    this.updateColors();
    this.onChange(new Set(this.selectedFaceIds), new Set(this.selectedBoundaryIds), new Set(this.selectedEdgeIds));
    return true;
  }

  onDblClick(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    if (this.currentMode !== "edge") return false;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects(this.edgeMeshes);
    if (hits.length === 0) return false;
    const seedId = hits[0].object.userData.inspEdgeId as number;
    this.selectConnectedEdges(seedId);
    return true;
  }

  private selectConnectedEdges(seedId: number): void {
    const PREC = 4000;
    const qv = (pt: [number,number,number]) =>
      `${Math.round(pt[0] * PREC)},${Math.round(pt[1] * PREC)},${Math.round(pt[2] * PREC)}`;

    const edgeById = new Map(this.edges.map(e => [e.id, e]));
    const visited = new Set<number>();
    const stack = [seedId];

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const edge = edgeById.get(id);
      if (!edge) continue;
      for (const pt of [edge.start, edge.end]) {
        const neighbors = this.vertexToEdges.get(qv(pt)) ?? [];
        for (const nid of neighbors) {
          if (!visited.has(nid)) stack.push(nid);
        }
      }
    }

    // Add all connected edges to current selection (union, not replace)
    for (const id of visited) this.selectedEdgeIds.add(id);
    this.updateColors();
    this.onChange(new Set(this.selectedFaceIds), new Set(this.selectedBoundaryIds), new Set(this.selectedEdgeIds));
  }

  private _toggle(id: number | undefined, set: Set<number>, ctrl: boolean): void {
    if (id === undefined) { if (!ctrl) set.clear(); return; }
    if (ctrl) {
      if (set.has(id)) set.delete(id); else set.add(id);
    } else {
      set.clear(); set.add(id);
    }
  }

  private updateColors(): void {
    if (this.currentMode === "face") {
      for (const m of this.faceMeshes) {
        const id  = m.userData.inspFaceId as number;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (this.selectedFaceIds.has(id)) { mat.color.setHex(C_FACE_SELECT); mat.opacity = 0.70; }
        else if (id === this.hoveredFaceId) { mat.color.setHex(C_FACE_HOVER);  mat.opacity = 0.45; }
        else { mat.color.setHex(C_FACE_DEFAULT); mat.opacity = 0.15; }
      }
    } else if (this.currentMode === "boundary") {
      for (const m of this.boundaryMeshes) {
        const id  = m.userData.inspBoundaryId as number;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (this.selectedBoundaryIds.has(id))  mat.color.setHex(C_BOUND_SELECT);
        else if (id === this.hoveredBoundaryId) mat.color.setHex(C_BOUND_HOVER);
        else                                    mat.color.setHex(C_BOUND_DEFAULT);
      }
    } else {
      for (const m of this.edgeMeshes) {
        const id  = m.userData.inspEdgeId as number;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (this.selectedEdgeIds.has(id))   mat.color.setHex(C_EDGE_SELECT);
        else if (id === this.hoveredEdgeId) mat.color.setHex(C_EDGE_HOVER);
        else                                mat.color.setHex(C_EDGE_DEFAULT);
      }
    }
  }

  dispose(): void {
    const all = [...this.faceMeshes, ...this.boundaryMeshes, ...this.edgeMeshes];
    for (const m of all) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.faceMeshes = []; this.boundaryMeshes = []; this.edgeMeshes = [];
    this.faces = []; this.faceBoundaries = []; this.edges = [];
    this.selectedFaceIds.clear(); this.selectedBoundaryIds.clear(); this.selectedEdgeIds.clear();
    this.hoveredFaceId = -1; this.hoveredBoundaryId = -1; this.hoveredEdgeId = -1;
    this.vertexToEdges.clear();
  }
}
