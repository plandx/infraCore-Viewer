/**
 * SectionModule — self-contained BIM cross-section package.
 *
 * Responsibilities (all isolated from the rest of the viewer):
 *   • Section plane gizmos: circular disc, border ring, normal arrow, drag handle
 *   • Box-section gizmo: semi-transparent cube with 6 face-centre handles
 *   • Cross-section cap geometry (filled surfaces) + contour edge lines
 *   • renderer.clippingPlanes management
 *   • Handle drag interaction (pointer capture, smooth real-time drag)
 *   • Camera alignment on demand
 *   • Visibility toggle (visuals hidden, clipping still active)
 *   • Full cleanup on dispose()
 *
 * What it does NOT do:
 *   • Navigate / zoom camera (only aligns on explicit request)
 *   • Load or parse IFC geometry
 *   • Touch the Zustand store directly — changes flow back via callbacks
 */

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SectionPlane } from "../types/ifc";
import { computeCap } from "./CapGenerator";

// ─── Visual constants ──────────────────────────────────────────────────────

const HANDLE_R      = 0.5;          // fixed 1 m diameter sphere
const PLANE_MIN     = 10;           // minimum disc radius (m)
const PLANE_MAX     = 80;           // maximum disc radius (m)
const ARROW_MIN     = 1.5;
const ARROW_MAX     = 8;
const DISC_SEGS     = 64;           // smoothness of circular disc/border
const CAP_RENDER_ORDER   = 1;
const EDGE_RENDER_ORDER  = 2;
const GIZMO_RENDER_ORDER = 3;

// ─── Types ─────────────────────────────────────────────────────────────────

interface PlaneGizmo {
  /** Group containing disc + border + arrow — lives in handleScene (never clipped). */
  group: THREE.Group;
  /** Drag-handle sphere — lives in handleScene. */
  handle: THREE.Mesh;
  arrow: THREE.ArrowHelper;
}

interface BoxGizmo {
  /** Semi-transparent cube — in handleScene (own clip planes would self-clip it). */
  faceMesh: THREE.Mesh;
  edgeMesh: THREE.LineSegments;
  /** One handle per face (6 total) — in handleScene. */
  handles: THREE.Mesh[];
}

interface CapEntry {
  capMesh: THREE.Mesh;
  edgeMesh: THREE.LineSegments;
}

interface DragState {
  planeId: string;
  normal: THREE.Vector3;
  viewPlane: THREE.Plane;
  startIntersect: THREE.Vector3;
  startPoint: THREE.Vector3;
}

export interface SectionModuleConfig {
  canvas: HTMLElement;
  scene: THREE.Scene;
  /** Scene rendered without global clipping planes (handles live here). */
  handleScene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  /** Returns the currently active camera (perspective or ortho). */
  getCamera: () => THREE.Camera;
  getControls: () => OrbitControls | null;
  /** Returns the current model map — used for cap generation and bbox sizing. */
  getModels: () => Map<string, { mesh: THREE.Group; boundingBox: THREE.Box3 }>;
  /** Called when a handle drag ends with the plane's new world-space point. */
  onPlaneMoved: (id: string, point: [number, number, number]) => void;
  /** Called whenever the scene needs to re-render. */
  onNeedsRender: () => void;
}

// ─── SectionModule ─────────────────────────────────────────────────────────

export class SectionModule {
  private readonly scene: THREE.Scene;
  private readonly handleScene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly getCamera: () => THREE.Camera;
  private readonly getControls: () => OrbitControls | null;
  private readonly getModels: () => Map<string, { mesh: THREE.Group; boundingBox: THREE.Box3 }>;
  private readonly onPlaneMoved: (id: string, point: [number, number, number]) => void;
  private readonly onNeedsRender: () => void;
  private readonly canvas: HTMLElement;

  private planes: SectionPlane[] = [];
  private planeGizmos = new Map<string, PlaneGizmo>();
  private boxGizmos   = new Map<string, BoxGizmo>();

  // caps[planeId][meshUuid] = {capMesh, edgeMesh}
  private caps = new Map<string, Map<string, CapEntry>>();

  private hidden      = false;
  private dragState: DragState | null = null;
  private wasDragging = false;

  private capBuildTimer: ReturnType<typeof setTimeout> | null = null;
  /** Suppress cap rebuild while dragging for smooth 60 fps. */
  private isDragging  = false;

  // ── Constructor / destructor ──────────────────────────────────────────────

  constructor(cfg: SectionModuleConfig) {
    this.scene          = cfg.scene;
    this.handleScene    = cfg.handleScene;
    this.renderer       = cfg.renderer;
    this.getCamera      = cfg.getCamera;
    this.getControls    = cfg.getControls;
    this.getModels      = cfg.getModels;
    this.onPlaneMoved   = cfg.onPlaneMoved;
    this.onNeedsRender  = cfg.onNeedsRender;
    this.canvas         = cfg.canvas;

    // Bind then register canvas event listeners (capture so we intercept before OrbitControls)
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup",   this.onPointerUp);

    // Window events from SectionPanel UI
    window.addEventListener("viewer:sectionVisualsHidden", this.onVisualsHidden);
    window.addEventListener("viewer:alignToPlane",         this.onAlignToPlane);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown, { capture: true } as EventListenerOptions);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup",   this.onPointerUp);
    window.removeEventListener("viewer:sectionVisualsHidden", this.onVisualsHidden);
    window.removeEventListener("viewer:alignToPlane",         this.onAlignToPlane);

    if (this.capBuildTimer !== null) clearTimeout(this.capBuildTimer);

    this.removeAllCaps();
    this.removeAllGizmos();
    this.renderer.clippingPlanes = [];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Called whenever the sectionPlanes array changes in the store.
   * Idempotent: safe to call on every render cycle if needed.
   */
  syncPlanes(planes: SectionPlane[]): void {
    this.planes = planes;
    this.updateGizmos(planes);
    this.updateClipPlanes(planes);
    this.scheduleCapRebuild(planes);
    this.onNeedsRender();
  }

  /**
   * Toggle gizmo visibility without disabling the clip planes themselves.
   * Called by SectionPanel eye-toggle (also via window event internally).
   */
  setVisualsHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyVisibility(this.planes);
    // Also hide/show caps
    for (const planeMap of this.caps.values()) {
      for (const { capMesh, edgeMesh } of planeMap.values()) {
        capMesh.visible  = !hidden;
        edgeMesh.visible = !hidden;
      }
    }
    this.onNeedsRender();
  }

  // ── Clip planes ───────────────────────────────────────────────────────────

  private updateClipPlanes(planes: SectionPlane[]): void {
    this.renderer.clippingPlanes = planes
      .filter(p => p.enabled)
      .map(p => {
        const N  = new THREE.Vector3(...p.normal);
        const Pt = new THREE.Vector3(...p.point);
        return new THREE.Plane(N, -N.dot(Pt));
      });
  }

  // ── Gizmo management ─────────────────────────────────────────────────────

  private computeSceneSpan(): number {
    const box = new THREE.Box3();
    this.getModels().forEach(m => { if (!m.boundingBox.isEmpty()) box.union(m.boundingBox); });
    return box.isEmpty() ? 50 : box.getSize(new THREE.Vector3()).length();
  }

  private updateGizmos(planes: SectionPlane[]): void {
    const span      = this.computeSceneSpan();
    const discR     = Math.min(Math.max(span * 0.22, PLANE_MIN), PLANE_MAX);
    const arrowLen  = Math.min(Math.max(span * 0.05, ARROW_MIN), ARROW_MAX);

    // ── Separate into box groups and solo planes ──
    const boxMap = new Map<string, SectionPlane[]>();
    const solo: SectionPlane[] = [];
    for (const p of planes) {
      if (p.boxId) { const g = boxMap.get(p.boxId) ?? []; g.push(p); boxMap.set(p.boxId, g); }
      else solo.push(p);
    }

    // ── Remove stale box gizmos ──
    const liveBoxIds = new Set(boxMap.keys());
    for (const [boxId, bg] of this.boxGizmos) {
      if (!liveBoxIds.has(boxId)) {
        this.handleScene.remove(bg.faceMesh, bg.edgeMesh, ...bg.handles);
        bg.faceMesh.geometry.dispose();  (bg.faceMesh.material  as THREE.Material).dispose();
        bg.edgeMesh.geometry.dispose();  (bg.edgeMesh.material  as THREE.Material).dispose();
        bg.handles.forEach(h => { h.geometry.dispose(); (h.material as THREE.Material).dispose(); });
        this.boxGizmos.delete(boxId);
      }
    }

    // ── Remove stale solo gizmos ──
    const liveSoloIds = new Set(solo.map(p => p.id));
    for (const [id, pg] of this.planeGizmos) {
      if (!liveSoloIds.has(id)) {
        this.handleScene.remove(pg.group, pg.handle);
        pg.group.traverse(o => {
          if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine) {
            (o as THREE.Mesh).geometry?.dispose();
            const m = (o as THREE.Mesh).material;
            (Array.isArray(m) ? m : [m]).forEach(x => (x as THREE.Material)?.dispose());
          }
        });
        pg.handle.geometry.dispose(); (pg.handle.material as THREE.Material).dispose();
        this.planeGizmos.delete(id);
      }
    }

    // ── Create / update box gizmos ──
    for (const [boxId, bPlanes] of boxMap) {
      const color   = new THREE.Color(bPlanes[0]?.color ?? "#7aa2f7");
      const enabled = bPlanes.some(p => p.enabled);

      if (!this.boxGizmos.has(boxId)) {
        const faceMesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false })
        );
        faceMesh.renderOrder = GIZMO_RENDER_ORDER;
        faceMesh.userData.isSectionVisual = true;

        const edgeMesh = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
          new THREE.LineBasicMaterial({ color })
        );
        edgeMesh.userData.isSectionVisual = true;

        const handles: THREE.Mesh[] = [];
        for (const p of bPlanes) {
          const h = new THREE.Mesh(
            new THREE.SphereGeometry(HANDLE_R, 14, 10),
            new THREE.MeshBasicMaterial({ color, depthTest: false })
          );
          h.renderOrder = GIZMO_RENDER_ORDER + 1;
          h.userData.isSectionHandle = true;
          h.userData.planeId = p.id;
          handles.push(h);
          this.handleScene.add(h);
        }

        this.handleScene.add(faceMesh, edgeMesh);
        this.boxGizmos.set(boxId, { faceMesh, edgeMesh, handles });
      }

      const bg = this.boxGizmos.get(boxId)!;
      (bg.faceMesh.material as THREE.MeshBasicMaterial).color.copy(color);
      (bg.edgeMesh.material as THREE.LineBasicMaterial).color.copy(color);
      bg.handles.forEach(h => (h.material as THREE.MeshBasicMaterial).color.copy(color));

      this.applyBoxGeometry(bg, bPlanes);

      const on = !this.hidden && enabled;
      bg.faceMesh.visible = on;
      bg.edgeMesh.visible = on;
      bg.handles.forEach(h => { h.visible = on; });
    }

    // ── Create / update solo plane gizmos ──
    for (const plane of solo) {
      const N     = new THREE.Vector3(...plane.normal).normalize();
      const P     = new THREE.Vector3(...plane.point);
      const color = new THREE.Color(plane.color);

      if (!this.planeGizmos.has(plane.id)) {
        const group = new THREE.Group();
        group.name = `__sp_${plane.id}`;

        // Circular disc
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(discR, DISC_SEGS),
          new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
          })
        );
        disc.renderOrder = GIZMO_RENDER_ORDER;
        disc.userData.isSectionVisual = true;
        group.add(disc);

        // Circle border
        const borderPts: number[] = [];
        for (let i = 0; i <= DISC_SEGS; i++) {
          const a = (i / DISC_SEGS) * Math.PI * 2;
          borderPts.push(Math.cos(a) * discR, Math.sin(a) * discR, 0);
        }
        const border = new THREE.Line(
          new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(borderPts, 3)),
          new THREE.LineBasicMaterial({ color })
        );
        border.renderOrder = GIZMO_RENDER_ORDER;
        border.userData.isSectionVisual = true;
        group.add(border);

        // Normal arrow
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(),
          arrowLen, color.getHex(), arrowLen * 0.28, arrowLen * 0.14
        );
        arrow.userData.isSectionVisual = true;
        group.add(arrow);

        // Handle sphere (in handleScene — not clipped)
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(HANDLE_R, 14, 10),
          new THREE.MeshBasicMaterial({ color, depthTest: false })
        );
        handle.renderOrder = GIZMO_RENDER_ORDER + 1;
        handle.userData.isSectionHandle = true;
        handle.userData.planeId = plane.id;

        this.handleScene.add(group, handle);
        this.planeGizmos.set(plane.id, { group, handle, arrow });
      }

      const pg = this.planeGizmos.get(plane.id)!;

      // Update position & orientation
      const fwd = new THREE.Vector3(0, 0, 1);
      const quat = N.dot(fwd) > 0.9999
        ? new THREE.Quaternion()
        : N.dot(fwd) < -0.9999
          ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
          : new THREE.Quaternion().setFromUnitVectors(fwd, N);

      pg.group.position.copy(P);
      pg.group.quaternion.copy(quat);
      pg.handle.position.copy(P);

      // Update colours
      pg.group.traverse(o => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.copy(color);
        if ((o as THREE.Line).isLine)  (o as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>).material.color.copy(color);
      });
      (pg.handle.material as THREE.MeshBasicMaterial).color.copy(color);
      pg.arrow.setColor(color.getHex());

      const on = !this.hidden && plane.enabled;
      pg.group.visible  = on;
      pg.handle.visible = on;
    }
  }

  private applyVisibility(planes: SectionPlane[]): void {
    for (const [id, pg] of this.planeGizmos) {
      const p  = planes.find(x => x.id === id);
      const on = !this.hidden && (p?.enabled ?? false);
      pg.group.visible  = on;
      pg.handle.visible = on;
    }
    for (const [boxId, bg] of this.boxGizmos) {
      const enabled = planes.filter(p => p.boxId === boxId).some(p => p.enabled);
      const on = !this.hidden && enabled;
      bg.faceMesh.visible = on;
      bg.edgeMesh.visible = on;
      bg.handles.forEach(h => { h.visible = on; });
    }
  }

  /** Apply world-space position + scale to the box cube gizmo from current plane points. */
  private applyBoxGeometry(bg: BoxGizmo, bPlanes: SectionPlane[]): void {
    const pxP = bPlanes.find(p => p.normal[0] > 0.5);
    const mxP = bPlanes.find(p => p.normal[0] < -0.5);
    const pyP = bPlanes.find(p => p.normal[1] > 0.5);
    const myP = bPlanes.find(p => p.normal[1] < -0.5);
    const pzP = bPlanes.find(p => p.normal[2] > 0.5);
    const mzP = bPlanes.find(p => p.normal[2] < -0.5);

    const px = pxP?.point[0] ?? 10,  mx = mxP?.point[0] ?? -10;
    const py = pyP?.point[1] ?? 10,  my = myP?.point[1] ?? -10;
    const pz = pzP?.point[2] ?? 10,  mz = mzP?.point[2] ?? -10;

    const cx = (px + mx) / 2, cy = (py + my) / 2, cz = (pz + mz) / 2;
    const w  = Math.max(px - mx, 0.01);
    const h  = Math.max(py - my, 0.01);
    const d  = Math.max(pz - mz, 0.01);

    bg.faceMesh.position.set(cx, cy, cz);
    bg.faceMesh.scale.set(w, h, d);
    bg.edgeMesh.position.set(cx, cy, cz);
    bg.edgeMesh.scale.set(w, h, d);

    const centers: Record<string, [number, number, number]> = {};
    if (pxP) centers[pxP.id] = [px, cy, cz];
    if (mxP) centers[mxP.id] = [mx, cy, cz];
    if (pyP) centers[pyP.id] = [cx, py, cz];
    if (myP) centers[myP.id] = [cx, my, cz];
    if (pzP) centers[pzP.id] = [cx, cy, pz];
    if (mzP) centers[mzP.id] = [cx, cy, mz];

    for (const h of bg.handles) {
      const c = centers[h.userData.planeId as string];
      if (c) h.position.set(c[0], c[1], c[2]);
    }
  }

  // ── Cap management ────────────────────────────────────────────────────────

  private scheduleCapRebuild(planes: SectionPlane[]): void {
    if (this.capBuildTimer !== null) clearTimeout(this.capBuildTimer);
    this.capBuildTimer = setTimeout(() => {
      this.capBuildTimer = null;
      if (!this.isDragging) this.rebuildCaps(planes);
    }, 150);
  }

  private rebuildCaps(planes: SectionPlane[]): void {
    const enabledPlanes = planes.filter(p => p.enabled);

    // Remove caps for planes that are no longer enabled/present
    const liveIds = new Set(enabledPlanes.map(p => p.id));
    for (const planeId of [...this.caps.keys()]) {
      if (!liveIds.has(planeId)) this.removeCapsForPlane(planeId);
    }

    if (!enabledPlanes.length) return;

    // Collect all model meshes
    const meshes: THREE.Mesh[] = [];
    this.getModels().forEach(m => {
      m.mesh.traverse(obj => {
        if (
          obj instanceof THREE.Mesh &&
          !obj.userData.isHighlight &&
          !obj.userData.isEdge &&
          !obj.userData.isSectionVisual &&
          !obj.userData.isBasketOverlay
        ) meshes.push(obj);
      });
    });

    for (const plane of enabledPlanes) {
      const clipPlane = new THREE.Plane(
        new THREE.Vector3(...plane.normal),
        -new THREE.Vector3(...plane.normal).dot(new THREE.Vector3(...plane.point))
      );

      // Remove stale entries for this plane
      this.removeCapsForPlane(plane.id);
      const planeMap = new Map<string, CapEntry>();
      this.caps.set(plane.id, planeMap);

      for (const mesh of meshes) {
        const result = computeCap(mesh, clipPlane);
        if (!result) continue;

        const capMat = new THREE.MeshLambertMaterial({
          color: result.color,
          side: THREE.DoubleSide,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const capMesh = new THREE.Mesh(result.capGeo, capMat);
        capMesh.renderOrder = CAP_RENDER_ORDER;
        capMesh.matrixAutoUpdate = false;
        capMesh.matrix.identity();
        capMesh.userData.isSectionCap = true;

        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x111111,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        });
        const edgeMesh = new THREE.LineSegments(result.edgeGeo, edgeMat);
        edgeMesh.renderOrder = EDGE_RENDER_ORDER;
        edgeMesh.matrixAutoUpdate = false;
        edgeMesh.matrix.identity();
        edgeMesh.userData.isSectionCap = true;

        const visible = !this.hidden;
        capMesh.visible  = visible;
        edgeMesh.visible = visible;

        this.scene.add(capMesh, edgeMesh);
        planeMap.set(mesh.uuid, { capMesh, edgeMesh });
      }
    }

    this.onNeedsRender();
  }

  private removeCapsForPlane(planeId: string): void {
    const planeMap = this.caps.get(planeId);
    if (!planeMap) return;
    for (const { capMesh, edgeMesh } of planeMap.values()) {
      this.scene.remove(capMesh, edgeMesh);
      capMesh.geometry.dispose();  (capMesh.material  as THREE.Material).dispose();
      edgeMesh.geometry.dispose(); (edgeMesh.material as THREE.Material).dispose();
    }
    this.caps.delete(planeId);
  }

  private removeAllCaps(): void {
    for (const planeId of [...this.caps.keys()]) this.removeCapsForPlane(planeId);
  }

  private removeAllGizmos(): void {
    for (const [, pg] of this.planeGizmos) {
      this.handleScene.remove(pg.group, pg.handle);
      pg.group.traverse(o => {
        if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry?.dispose(); }
      });
      pg.handle.geometry.dispose();
    }
    this.planeGizmos.clear();

    for (const [, bg] of this.boxGizmos) {
      this.handleScene.remove(bg.faceMesh, bg.edgeMesh, ...bg.handles);
      bg.faceMesh.geometry.dispose();
      bg.edgeMesh.geometry.dispose();
      bg.handles.forEach(h => h.geometry.dispose());
    }
    this.boxGizmos.clear();
  }

  // ── Drag interaction ──────────────────────────────────────────────────────

  private getAllHandles(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const pg of this.planeGizmos.values()) {
      if (pg.handle.visible) out.push(pg.handle);
    }
    for (const bg of this.boxGizmos.values()) {
      bg.handles.forEach(h => { if (h.visible) out.push(h); });
    }
    return out;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    const handles = this.getAllHandles();
    if (!handles.length) return;

    const camera = this.getCamera();
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      -((e.clientY - rect.top) / rect.height) *  2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);

    const hits = ray.intersectObjects(handles, false);
    if (!hits.length) return;

    const hitHandle = hits[0].object as THREE.Mesh;
    const planeId = hitHandle.userData.planeId as string;
    const plane = this.planes.find(p => p.id === planeId);
    if (!plane) return;

    const N = new THREE.Vector3(...plane.normal).normalize();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const handlePos = hitHandle.getWorldPosition(new THREE.Vector3());
    const viewPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, handlePos);
    const startIntersect = new THREE.Vector3();
    ray.ray.intersectPlane(viewPlane, startIntersect);
    if (!startIntersect) return;

    this.dragState  = {
      planeId,
      normal: N,
      viewPlane,
      startIntersect: startIntersect.clone(),
      startPoint: new THREE.Vector3(...plane.point),
    };
    this.isDragging  = false;
    this.wasDragging = false;

    const controls = this.getControls();
    if (controls) controls.enabled = false;

    // Capture pointer so move/up fire even when cursor leaves canvas
    this.canvas.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragState) return;

    this.isDragging  = true;
    this.wasDragging = true;

    const camera = this.getCamera();
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      -((e.clientY - rect.top) / rect.height) *  2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);

    const { planeId, viewPlane, startIntersect, startPoint, normal } = this.dragState;
    const curIntersect = new THREE.Vector3();
    if (!ray.ray.intersectPlane(viewPlane, curIntersect)) return;

    const travel = curIntersect.clone().sub(startIntersect).dot(normal);
    const newP   = startPoint.clone().addScaledVector(normal, travel);

    // Update gizmo positions immediately (bypass React state for smooth drag)
    const pg = this.planeGizmos.get(planeId);
    if (pg) {
      pg.group.position.copy(newP);
      pg.handle.position.copy(newP);
    }

    // Box: find which box this plane belongs to and update cube geometry
    const movingPlane = this.planes.find(p => p.id === planeId);
    if (movingPlane?.boxId) {
      const bg = this.boxGizmos.get(movingPlane.boxId);
      if (bg) {
        const tempPlanes = this.planes
          .filter(p => p.boxId === movingPlane.boxId)
          .map(p => p.id === planeId
            ? { ...p, point: [newP.x, newP.y, newP.z] as [number, number, number] }
            : p
          );
        this.applyBoxGeometry(bg, tempPlanes);
      }
    }

    // Update clipping planes in real time (smooth visual feedback)
    this.renderer.clippingPlanes = this.planes
      .filter(p => p.enabled)
      .map(p => {
        if (p.id === planeId) return new THREE.Plane(normal, -normal.dot(newP));
        const n = new THREE.Vector3(...p.normal);
        const pt = new THREE.Vector3(...p.point);
        return new THREE.Plane(n, -n.dot(pt));
      });

    this.onNeedsRender();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragState) return;

    const { planeId, normal } = this.dragState;
    const controls = this.getControls();
    if (controls) controls.enabled = true;

    if (this.wasDragging) {
      // Determine final position from gizmo (works for both solo and box planes)
      let finalPoint: THREE.Vector3 | null = null;
      const pg = this.planeGizmos.get(planeId);
      if (pg) {
        finalPoint = pg.handle.position.clone();
      } else {
        // Box plane: find handle for this planeId
        for (const bg of this.boxGizmos.values()) {
          const h = bg.handles.find(h => h.userData.planeId === planeId);
          if (h) { finalPoint = h.position.clone(); break; }
        }
      }
      if (finalPoint) {
        this.onPlaneMoved(planeId, [finalPoint.x, finalPoint.y, finalPoint.z]);
      }
    }

    this.dragState  = null;
    this.isDragging  = false;
    this.wasDragging = false;

    // Release pointer capture
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    // Rebuild caps now that dragging is done
    this.scheduleCapRebuild(this.planes);
    e.stopPropagation();
  };

  // ── Window event handlers (from SectionPanel UI) ──────────────────────────

  private onVisualsHidden = (e: Event): void => {
    this.setVisualsHidden((e as CustomEvent<boolean>).detail);
  };

  private onAlignToPlane = (e: Event): void => {
    const { normal, point } = (e as CustomEvent<{
      normal: [number, number, number];
      point:  [number, number, number];
    }>).detail;

    const camera   = this.getCamera();
    const controls = this.getControls();
    if (!(camera instanceof THREE.PerspectiveCamera) || !controls) return;

    const N    = new THREE.Vector3(...normal).normalize();
    const P    = new THREE.Vector3(...point);
    const dist = Math.max(camera.position.distanceTo(P), 20);
    // Camera on the "kept" side: −N direction from P, looking toward P
    camera.position.copy(P).addScaledVector(N, -dist);
    controls.target.copy(P);
    controls.update();
    this.onNeedsRender();
  };
}
