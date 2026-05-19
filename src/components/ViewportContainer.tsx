import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { useModelStore } from "../store/modelStore";
import { useShallow } from "zustand/react/shallow";
import type { SpatialNode, SectionPlane } from "../types/ifc";
import { SectionPanel } from "./SectionPanel";
import { v4 as uuidv4 } from "uuid";
import { SectionModule } from "../section";
import { cn } from "../lib/utils";
import { BillingVisualizer } from "../billing/BillingVisualizer";
import { useBillingStore, BILLING_CHANNEL } from "../billing/billingStore";
import { openBillingWindow } from "../utils/windowSync";
import type { BillingMsg } from "../billing/types";
import { computeQuantities } from "../billing/quantityUtils";
import { extractQuantitiesFromPsets } from "../billing/IfcQuantityExtractor";
import { loadIFCProperties } from "../utils/ifcLoader";
import { FaceEdgePicker } from "../geometry-inspector/FaceEdgePicker";
import { GeometryInspectorPanel } from "../geometry-inspector/GeometryInspectorPanel";
import type { PickMode, InspFace, InspFaceBoundary, InspEdge, InspectionSession } from "../geometry-inspector/types";
import { useAlignmentStore } from "../alignment/alignmentStore";
import type { PlacedLabel, OffsetMeasurement } from "../alignment/alignmentStore";
import { buildRobustPolyline, sampleAtDisplayStation, evaluateProfile } from "../alignment/landXmlParser";
import { sliceScene } from "../alignment/crossSectionUtils";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

// Build EdgesGeometry + LineSegments in idle-time batches of 30 meshes.
// Uses a single shared material — never clones it.
function scheduleEdgeBuild(
  queue: THREE.Mesh[],
  mat: THREE.LineBasicMaterial,
  edgeLinesRef: React.MutableRefObject<THREE.LineSegments[]>,
  needsRenderRef: React.MutableRefObject<boolean>,
) {
  if (queue.length === 0) return;
  const run = () => {
    const batch = queue.splice(0, 30);
    for (const mesh of batch) {
      if (mesh.children.some(c => c.userData.isEdge)) continue; // already built
      const geo  = new THREE.EdgesGeometry(mesh.geometry, 15);
      const line = new THREE.LineSegments(geo, mat);   // shared mat — no .clone()
      line.userData.isEdge = true;
      mesh.add(line);
      edgeLinesRef.current.push(line);
    }
    needsRenderRef.current = true;
    if (queue.length > 0) {
      ("requestIdleCallback" in window)
        ? requestIdleCallback(run, { timeout: 500 })
        : setTimeout(run, 0);
    }
  };
  ("requestIdleCallback" in window)
    ? requestIdleCallback(run, { timeout: 500 })
    : setTimeout(run, 0);
}

// Patch Three.js prototypes once at module load — enables O(log N) BVH raycasting
// and adds computeBoundsTree / disposeBoundsTree helpers to BufferGeometry.
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

interface Props {
  onElementClick: (modelId: string, expressId: number) => void;
}

interface MeasureLabel {
  x: number;
  y: number;
  text: string;
}


// Pre-allocated objects reused across hot paths — avoids GC pressure at 60fps.
// Safe as module-level singletons because ViewportContainer mounts only once.
const _v3  = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
// Frustum culling pre-allocations
const _frustum  = new THREE.Frustum();
const _projMat  = new THREE.Matrix4();
const _bSphere  = new THREE.Sphere();

export function ViewportContainer({ onElementClick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef<number>(0);
  const highlightRef = useRef<THREE.Mesh[]>([]);
  const sceneModelIds = useRef<Set<string>>(new Set());

  const handleSceneRef    = useRef<THREE.Scene | null>(null);
  const sectionModuleRef  = useRef<SectionModule | null>(null);

  // Suppress click after any significant mouse movement (orbit/pan/drag)
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const clickSuppressedRef = useRef(false);


  // Measurement state
  const measureLinesRef = useRef<THREE.Line[]>([]);
  const measureSpheresRef = useRef<THREE.Mesh[]>([]);
  const pendingPointRef = useRef<THREE.Vector3 | null>(null);
  const measureMidpointsRef = useRef<Array<{ a: THREE.Vector3; b: THREE.Vector3 }>>([]);
  const [measureLabels, setMeasureLabels] = useState<MeasureLabel[]>([]);
  const [measurePending, setMeasurePending] = useState(false);

  // Annotation label overlay (station ticks, placed labels, offset measurements)
  interface AnnotLabel {
    id: string;
    storeId?: string;             // original store ID for delete actions
    x: number; y: number;
    type: "station" | "placed" | "offset";
    lines: string[];
    color: string;
    footX?: number; footY?: number;   // screen coords for offset line endpoint
    clickSX?: number; clickSY?: number;
  }
  const [annotLabels, setAnnotLabels] = useState<AnnotLabel[]>([]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; modelId: string; expressId: number;
    elementName: string; ifcType: string;
    faceNormal?: [number, number, number]; hitPoint?: [number, number, number];
  } | null>(null);

  const models = useModelStore((s) => s.models);
  const settings = useModelStore((s) => s.settings);
  const sectionPlanes = useModelStore((s) => s.sectionPlanes);
  const activeTool = useModelStore((s) => s.activeTool);
  const hiddenElements = useModelStore((s) => s.hiddenElements);
  const isolatedElements = useModelStore((s) => s.isolatedElements);
  const selectedElement = useModelStore((s) => s.selectedElement);
  const colorGroups = useModelStore((s) => s.colorGroups);

  // Basket state — always used together
  const { selectionBasket, basketMode } = useModelStore(
    useShallow((s) => ({ selectionBasket: s.selectionBasket, basketMode: s.basketMode }))
  );

  // SmartView UI — always used together
  const { stagedSmartViewId, activeSmartViewId } = useModelStore(
    useShallow((s) => ({ stagedSmartViewId: s.stagedSmartViewId, activeSmartViewId: s.activeSmartViewId }))
  );

  // Actions — stable references, grouped to reduce subscription count from 9 → 1
  const {
    addMeasurement, clearMeasurements, hideElement, isolateElement, showAll,
    applySmartView, addToBasket, removeFromBasket, setBasket,
  } = useModelStore(useShallow((s) => ({
    addMeasurement: s.addMeasurement,
    clearMeasurements: s.clearMeasurements,
    hideElement: s.hideElement,
    isolateElement: s.isolateElement,
    showAll: s.showAll,
    applySmartView: s.applySmartView,
    addToBasket: s.addToBasket,
    removeFromBasket: s.removeFromBasket,
    setBasket: s.setBasket,
  })));

  const billingVizRef    = useRef<BillingVisualizer | null>(null);
  const billingMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  const alignGroupRef  = useRef<THREE.Group | null>(null);
  const annotGroupRef  = useRef<THREE.Group | null>(null);
  const alignPolylineRef = useRef<Map<number, { pts: Array<{ x: number; y: number; z: number | null; sta: number; ox: number; oy: number; oz: number }>; name: string }>>(new Map());
  // Cached 3D world positions for station tick labels — rebuilt only on alignment change
  interface StationTickWorld { wx: number; wy: number; wz: number; color: string; sta: number; alignId: number; }
  const stationTicksWorldRef = useRef<StationTickWorld[]>([]);
  const annotRafRef = useRef(0);
  const pickerRef      = useRef<FaceEdgePicker | null>(null);
  const pendingSelectKeyRef = useRef<string | null>(null);
  const [inspSession,  setInspSession]  = useState<InspectionSession | null>(null);
  const [inspPickMode, setInspPickMode] = useState<PickMode>("face");
  const inspPickModeRef = useRef<PickMode>("face");
  const [inspFaces,      setInspFaces]      = useState<InspFace[]>([]);
  const [inspBoundaries, setInspBoundaries] = useState<InspFaceBoundary[]>([]);
  const [inspEdges,      setInspEdges]      = useState<InspEdge[]>([]);
  const [inspSelFaces,      setInspSelFaces]      = useState<Set<number>>(new Set());
  const [inspSelBoundaries, setInspSelBoundaries] = useState<Set<number>>(new Set());
  const [inspSelEdges,      setInspSelEdges]      = useState<Set<number>>(new Set());
  const [inspShowMesh,   setInspShowMesh]   = useState(false);
  const [inspShowLabels, setInspShowLabels] = useState(false);
  const [inspMaxBend,    setInspMaxBend]    = useState(35);
  const inspMaxBendRef = useRef(35);
  const inspMeshesRef = useRef<THREE.Mesh[]>([]); // IFC meshes of the inspected element
  const [inspLabels,   setInspLabels]   = useState<Array<{
    id: number; text: string; x: number; y: number;
    type: "face" | "edge"; selected: boolean;
  }>>([]);
  const labelScheduledRef    = useRef(false);
  const updateInspLabelsRef  = useRef<() => void>(() => {});

  // Compute 3D→2D label positions for all faces + edges in inspection mode
  const updateInspLabels = useCallback(() => {
    const picker   = pickerRef.current;
    const camera   = cameraRef.current;
    const renderer = rendererRef.current;
    if (!picker || !camera || !renderer) { setInspLabels([]); return; }
    const rect = domRectRef.current ?? renderer.domElement.getBoundingClientRect();
    const fmt  = (n: number) => n.toFixed(2).replace(".", ",");
    const mode = inspPickModeRef.current;
    const out: typeof inspLabels = [];

    if (mode === "face") {
      for (const face of picker.faces) {
        _v3.set(...face.center).project(camera);
        if (_v3.z >= 1) continue;
        out.push({
          id: face.id, type: "face",
          text: `F${face.id + 1} · ${fmt(face.area)} m²`,
          x: (_v3.x + 1) / 2 * rect.width,
          y: (-_v3.y + 1) / 2 * rect.height,
          selected: picker.selectedFaceIds.has(face.id),
        });
      }
    } else if (mode === "boundary") {
      for (const boundary of picker.faceBoundaries) {
        _v3.set(...boundary.center).project(camera);
        if (_v3.z >= 1) continue;
        out.push({
          id: boundary.id, type: "edge",
          text: `U${boundary.id + 1} · ${fmt(boundary.totalLength)} m`,
          x: (_v3.x + 1) / 2 * rect.width,
          y: (-_v3.y + 1) / 2 * rect.height,
          selected: picker.selectedBoundaryIds.has(boundary.id),
        });
      }
    } else {
      for (const edge of picker.edges) {
        _v3.set(
          (edge.start[0] + edge.end[0]) / 2,
          (edge.start[1] + edge.end[1]) / 2,
          (edge.start[2] + edge.end[2]) / 2,
        ).project(camera);
        if (_v3.z >= 1) continue;
        out.push({
          id: edge.id, type: "edge",
          text: `K${edge.id + 1} · ${fmt(edge.length)} m`,
          x: (_v3.x + 1) / 2 * rect.width,
          y: (-_v3.y + 1) / 2 * rect.height,
          selected: picker.selectedEdgeIds.has(edge.id),
        });
      }
    }

    setInspLabels(out);
  }, []); // all reads through stable refs

  useEffect(() => { updateInspLabelsRef.current = updateInspLabels; }, [updateInspLabels]);

  // Combined mode-change handler: updates state + ref + picker visibility + labels
  const handlePickModeChange = useCallback((m: PickMode) => {
    setInspPickMode(m);
    inspPickModeRef.current = m;
    pickerRef.current?.setMode(m);
    needsRenderRef.current = true;
    updateInspLabelsRef.current();
  }, []);

  // Recompute labels whenever inspection session or data changes
  useEffect(() => {
    if (inspSession) updateInspLabels();
    else setInspLabels([]);
  }, [inspSession, inspFaces, inspBoundaries, inspEdges, updateInspLabels]);

  // Track color-override materials for disposal
  const colorMaterialsRef = useRef<THREE.Material[]>([]);
  // Meshes that have an originalMaterial override applied (for O(k) restore)
  const colorOverrideMeshesRef = useRef<THREE.Mesh[]>([]);

  const basketOutlinesRef = useRef<THREE.LineSegments[]>([]);

  // Basket material overrides: stores original material per mesh for restore
  const basketMatsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());

  // ── Mesh index: built once per model-load, used by all per-element effects ──
  // Key: "modelId:expressId" → avoids O(scene) traversal on every interaction.
  const meshIndexRef     = useRef<Map<string, THREE.Mesh[]>>(new Map());
  const edgeLinesRef     = useRef<THREE.LineSegments[]>([]);
  const pickableMeshesRef = useRef<THREE.Mesh[]>([]);
  // Shared edge material — one instance for the entire scene, never cloned
  const edgeMatRef       = useRef<THREE.LineBasicMaterial | null>(null);

  // Profile hover marker sphere
  const profileSphereRef = useRef<THREE.Mesh | null>(null);
  // Cross-section plane indicator
  const sectionIndicatorRef = useRef<THREE.Mesh | null>(null);

  // Render-on-demand: only draw when something changed
  const needsRenderRef = useRef(true);
  const domRectRef = useRef<DOMRect | null>(null);

  // ── Init scene ───────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    domRectRef.current = renderer.domElement.getBoundingClientRect();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b26");
    sceneRef.current = scene;

    billingVizRef.current = new BillingVisualizer(scene);

    const alignGroup = new THREE.Group();
    alignGroup.name = "__alignments";
    scene.add(alignGroup);
    alignGroupRef.current = alignGroup;

    const annotGroup = new THREE.Group();
    annotGroup.name = "__annotations";
    scene.add(annotGroup);
    annotGroupRef.current = annotGroup;

    // Separate scene for section handles/gizmos — rendered without clip planes
    const handleScene = new THREE.Scene();
    handleSceneRef.current = handleScene;

    // Section module — owns all section visuals, caps, drag logic
    const sectionModule = new SectionModule({
      canvas: renderer.domElement,
      scene,
      handleScene,
      renderer,
      getCamera: () => {
        const isOrtho = useModelStore.getState().settings.orthographic;
        return (isOrtho ? orthoCameraRef.current : cameraRef.current) ?? camera;
      },
      getControls: () => controlsRef.current,
      getModels: () => useModelStore.getState().models,
      onPlaneMoved: (id, point) => useModelStore.getState().updateSectionPlane(id, { point }),
      onNeedsRender: () => { needsRenderRef.current = true; },
    });
    sectionModuleRef.current = sectionModule;

    // Perspective camera
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.01, 500_000);
    camera.position.set(50, 50, 100);
    cameraRef.current = camera;

    // Orthographic camera (same starting frustum, updated on resize)
    const aspect = mount.clientWidth / mount.clientHeight;
    const orthoSize = 100;
    const ortho = new THREE.OrthographicCamera(
      -orthoSize * aspect, orthoSize * aspect, orthoSize, -orthoSize, 0.01, 500_000
    );
    ortho.position.copy(camera.position);
    orthoCameraRef.current = ortho;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 1.4;
    controls.panSpeed = 1.2;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(200, 400, 200);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x8899ff, 0x443300, 0.45));

    // Grid
    const grid = new THREE.GridHelper(10_000, 100, 0x3b4261, 0x3b4261);
    grid.name = "__grid";
    scene.add(grid);

    // Axes
    const axes = new THREE.AxesHelper(500);
    axes.name = "__axes";
    scene.add(axes);

    // Profile hover sphere (always-on-top marker)
    const sphereGeo = new THREE.SphereGeometry(0.8, 8, 6);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    const profileSphere = new THREE.Mesh(sphereGeo, sphereMat);
    profileSphere.renderOrder = 999;
    profileSphere.visible = false;
    profileSphere.name = "__profileSphere";
    scene.add(profileSphere);
    profileSphereRef.current = profileSphere;

    // Cross-section plane indicator (semi-transparent rectangle at section station)
    const indGeo = new THREE.PlaneGeometry(100, 60);
    const indMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthTest: false });
    const indMesh = new THREE.Mesh(indGeo, indMat);
    indMesh.renderOrder = 997;
    indMesh.visible = false;
    indMesh.name = "__sectionIndicator";
    scene.add(indMesh);
    sectionIndicatorRef.current = indMesh;

    // Trigger a render whenever the camera moves; throttle inspector label updates via RAF
    controls.addEventListener("change", () => {
      needsRenderRef.current = true;
      if (!pickerRef.current) return;
      if (!labelScheduledRef.current) {
        labelScheduledRef.current = true;
        requestAnimationFrame(() => {
          labelScheduledRef.current = false;
          updateInspLabelsRef.current();
        });
      }
    });

    // Render-on-demand loop: only calls renderer.render() when needsRenderRef is set.
    // With enableDamping=false, controls.update() is a no-op so we skip it here.
    let running = true;
    const animate = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(animate);
      if (!needsRenderRef.current) return;
      needsRenderRef.current = false;

      const isOrtho = useModelStore.getState().settings.orthographic;

      if (isOrtho) {
        // Mirror position + orientation from perspective controls
        ortho.position.copy(camera.position);
        ortho.quaternion.copy(camera.quaternion);

        // Recompute frustum from perspective distance so wheel-zoom works
        const dist = camera.position.distanceTo(controls.target);
        const halfH = dist * Math.tan((camera.fov / 2) * (Math.PI / 180));
        const rw = renderer.domElement.clientWidth || 1;
        const rh = renderer.domElement.clientHeight || 1;
        const asp = rw / rh;
        ortho.left   = -halfH * asp;
        ortho.right  =  halfH * asp;
        ortho.top    =  halfH;
        ortho.bottom = -halfH;
        ortho.near   = camera.near;
        ortho.far    = camera.far;
        ortho.updateProjectionMatrix();
      }

      const activeCamera = isOrtho ? ortho : camera;
      renderer.render(scene, activeCamera);

      // Render section handles without clip planes — global clippingPlanes are set once per frame
      // so onBeforeRender cannot override them; a separate pass is the only reliable fix.
      if (handleScene.children.length > 0) {
        const savedPlanes = renderer.clippingPlanes.slice();
        renderer.autoClear = false;
        renderer.clippingPlanes = [];
        renderer.render(handleScene, activeCamera);
        renderer.autoClear = true;
        renderer.clippingPlanes = savedPlanes;
      }
    };
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth, h = mount.clientHeight;
      domRectRef.current = renderer.domElement.getBoundingClientRect();
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const a = w / h;
      const s = orthoSize;
      ortho.left = -s * a; ortho.right = s * a;
      ortho.top = s; ortho.bottom = -s;
      ortho.updateProjectionMatrix();
      needsRenderRef.current = true;
    });
    ro.observe(mount);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      sectionModuleRef.current?.dispose();
      sectionModuleRef.current = null;
      billingVizRef.current?.dispose();
      billingVizRef.current = null;
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      handleSceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Alignment scene: rebuild Three.js lines when store changes ───────────
  useEffect(() => {
    function rebuild() {
      const group = alignGroupRef.current;
      if (!group) return;

      // Dispose and clear existing alignment lines
      while (group.children.length > 0) {
        const child = group.children[0] as THREE.Line;
        child.geometry?.dispose();
        (child.material as THREE.Material)?.dispose();
        group.remove(child);
      }

      const { files, visibleIds, colors, geoOrigin } = useAlignmentStore.getState();

      // Determine scene origin to subtract from LandXML coordinates.
      // LandXML coordinate convention:   x = Easting,  y = Northing,  z = Elevation
      // Three.js scene convention:        X = Easting,  Y = Elevation, Z = -Northing
      //
      // When an IFC model is loaded we use its originOffset as the geographic
      // reference (it is the bounding-box centre of the raw IFC geometry and
      // carries the same Easting/Elevation/Northing components depending on
      // which Y-up vs Z-up convention the IFC file uses).
      // When no IFC is loaded we use geoOrigin = first segment start point.
      const ifc = useModelStore.getState().models.values().next().value as import("../types/ifc").IFCModelEntry | undefined;
      let ox: number, oy: number, oz: number;
      if (ifc) {
        ox = ifc.originOffset.x;    // Easting
        oy = -ifc.originOffset.z;   // Northing = -Z_threejs
        oz = ifc.originOffset.y;    // Elevation = Y_threejs
      } else if (geoOrigin) {
        ox = geoOrigin.x; // Easting
        oy = geoOrigin.y; // Northing
        oz = geoOrigin.z; // Elevation
      } else {
        ox = 0; oy = 0; oz = 0;
      }

      alignPolylineRef.current.clear();

      for (const file of files) {
        for (const alignment of file.alignments) {
          if (!visibleIds.has(alignment.id)) continue;

          const { sampleInterval } = useAlignmentStore.getState();
          const approxPts = buildRobustPolyline(alignment, sampleInterval);

          // Cache pts for station tool (in world coords + original coords)
          alignPolylineRef.current.set(alignment.id, {
            pts: approxPts.map(p => ({ ...p, ox, oy, oz })),
            name: alignment.displayName,
          });

          const pts: THREE.Vector3[] = [];
          for (const p of approxPts) {
            pts.push(new THREE.Vector3(p.x - ox, p.z - oz, -(p.y - oy)));
          }
          if (pts.length < 2) continue;
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const mat = new THREE.LineBasicMaterial({ color: colors[alignment.id] ?? "#ff7043" });
          const line = new THREE.Line(geo, mat);
          line.userData.isAlignment = true;
          line.userData.alignmentId = alignment.id;
          group.add(line);
        }
      }
      needsRenderRef.current = true;
    }

    rebuild();
    let prevModelCount = useModelStore.getState().models.size;
    const unsubAlign = useAlignmentStore.subscribe((state, prev) => {
      if (state.files !== prev.files ||
          state.visibleIds !== prev.visibleIds ||
          state.colors !== prev.colors ||
          state.sampleInterval !== prev.sampleInterval ||
          state.geoOrigin !== prev.geoOrigin) {
        rebuild();
      }
    });
    const unsubModel = useModelStore.subscribe((state, prev) => {
      if (state.models.size !== prev.models.size) {
        prevModelCount = state.models.size;
        rebuild();
      }
    });
    return () => { unsubAlign(); unsubModel(); };
  }, []);

  // ── Station measurement tool ───────────────────────────────────────────
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    // Reusable objects — allocated once, reused on every mousemove.
    const raycaster = new THREE.Raycaster();
    const ndcVec    = new THREE.Vector2();
    const p0        = new THREE.Vector3();
    const p1        = new THREE.Vector3();
    const seg3      = new THREE.Vector3();
    const w3        = new THREE.Vector3();
    const closest3  = new THREE.Vector3();
    const rayPt3    = new THREE.Vector3();

    const onMouseMove = (e: MouseEvent) => {
      const { stationToolActive, setHoveredStation, files, visibleIds } = useAlignmentStore.getState();
      if (!stationToolActive) return;

      const camera = cameraRef.current;
      if (!camera) return;

      const rect = domRectRef.current ?? canvas.getBoundingClientRect();
      ndcVec.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
       -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndcVec, camera);
      const rayOrigin = raycaster.ray.origin;
      const rayDir    = raycaster.ray.direction;

      const clampVal = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;
      const lerpVal  = (a: number, b: number, t: number)   => a + (b - a) * t;

      let bestDist = Infinity;
      let bestInfo: { alignmentId: number; station: number; name: string } | null = null;

      const allIds = new Set(files.flatMap(f => f.alignments.map(a => a.id)));
      const c = rayDir.dot(rayDir);

      for (const [alignId, cache] of alignPolylineRef.current.entries()) {
        if (!visibleIds.has(alignId) || !allIds.has(alignId)) continue;
        const { pts, name } = cache;
        for (let i = 0; i < pts.length - 1; i++) {
          const A = pts[i], B = pts[i + 1];
          const { ox, oy, oz } = A;
          p0.set(A.x - ox, A.z - oz, -(A.y - oy));
          p1.set(B.x - ox, B.z - oz, -(B.y - oy));

          seg3.subVectors(p1, p0);
          w3.subVectors(p0, rayOrigin);
          const a   = seg3.dot(seg3);
          const b   = seg3.dot(rayDir);
          const d   = seg3.dot(w3);
          const ev  = rayDir.dot(w3);
          const denom = a * c - b * b;
          let sc = denom > 1e-10 ? clampVal((b * ev - c * d) / denom, 0, 1) : 0;
          const tc = (b * sc + ev) / c;
          if (tc < 0) sc = clampVal(-d / a, 0, 1);

          closest3.copy(p0).addScaledVector(seg3, sc);
          rayPt3.copy(rayOrigin).addScaledVector(rayDir, Math.max(0, (b * sc + ev) / c));
          const dist = closest3.distanceTo(rayPt3);

          if (dist < bestDist) {
            bestDist = dist;
            bestInfo = {
              alignmentId: alignId,
              station: lerpVal(A.sta, B.sta, sc),
              name,
            };
          }
        }
      }

      setHoveredStation(bestDist < 20 ? bestInfo : null);
    };

    canvas.addEventListener("mousemove", onMouseMove);
    return () => canvas.removeEventListener("mousemove", onMouseMove);
  }, []);

  // ── Section module: sync planes from store ───────────────────────────────
  useEffect(() => {
    sectionModuleRef.current?.syncPlanes(sectionPlanes);
  }, [sectionPlanes]);

  // Billing meshMap is now rebuilt inside the models effect (combined traversal above).

  // ── Billing visualizer: subscribe to store, update viz without scene traversal
  useEffect(() => {
    function runViz() {
      const { entries, moduleActive } = useBillingStore.getState();
      const viz = billingVizRef.current;
      if (!viz) return;
      if (!moduleActive) { viz.clear(); needsRenderRef.current = true; return; }
      viz.update(entries, billingMeshMapRef.current);
      needsRenderRef.current = true;
    }
    runViz();
    return useBillingStore.subscribe(runViz);
  }, []);

  // Reusable inspection starter — called from both BroadcastChannel and context menu
  const startInspectionForElement = useCallback((
    modelId: string,
    expressId: number,
    elementName: string,
    billingKey: string | null,
    ifcType = "",
  ) => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Look up meshes via index — O(1) instead of O(scene).
    const meshes = (meshIndexRef.current.get(`${modelId}:${expressId}`) ?? []).filter(
      (obj) => !obj.userData.isBillingOverlay && !obj.userData.isGeometryInspector
    );
    if (meshes.length === 0) return;

    useModelStore.getState().isolateEntries([{ modelId, expressId }]);

    let picker: FaceEdgePicker;
    try {
      pickerRef.current?.dispose();
      picker = new FaceEdgePicker(scene, (faceIds, boundaryIds, edgeIds) => {
        setInspSelFaces(new Set(faceIds));
        setInspSelBoundaries(new Set(boundaryIds));
        setInspSelEdges(new Set(edgeIds));
        needsRenderRef.current = true;
        updateInspLabelsRef.current();
      });
      picker.load(meshes);
    } catch (err) {
      console.error("Geometry inspector failed to analyse element:", err);
      useModelStore.getState().showAll();
      needsRenderRef.current = true;
      return;
    }
    picker.connectedEdgeMaxBend = inspMaxBendRef.current;
    pickerRef.current = picker;

    scene.traverse((obj) => {
      if (obj.userData.inspFaceId !== undefined || obj.userData.inspBoundaryId !== undefined || obj.userData.inspEdgeId !== undefined) {
        obj.userData.isGeometryInspector = true;
      }
    });

    inspMeshesRef.current = meshes;
    setInspSession({ modelId, expressId, elementName, billingKey, ifcType });
    setInspPickMode("face");
    inspPickModeRef.current = "face";
    setInspFaces(picker.faces);
    setInspBoundaries(picker.faceBoundaries);
    setInspEdges(picker.edges);
    setInspSelFaces(new Set());
    setInspSelBoundaries(new Set());
    setInspSelEdges(new Set());
    setInspShowMesh(true);
    needsRenderRef.current = true;
  }, []);

  // Handle requestQuantities + startInspection from billing window
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(BILLING_CHANNEL); } catch { return; }

    function collectMeshesForKey(key: string): THREE.Mesh[] {
      return billingMeshMapRef.current.get(key) ?? [];
    }

    bc.addEventListener("message", (ev) => {
      const msg = ev.data as BillingMsg;

      if (msg.t === "ready") {
        const pending = pendingSelectKeyRef.current;
        if (pending) {
          bc?.postMessage({ t: "selectEntry", key: pending } satisfies BillingMsg);
          pendingSelectKeyRef.current = null;
        }
        return;
      }

      if (msg.t === "requestQuantities") {
        const meshes = collectMeshesForKey(msg.key);
        const data = meshes.length > 0 ? computeQuantities(meshes) : null;
        if (data) {
          // key is IFC GlobalId — reverse-lookup to find the model's originOffset so
          // bboxCenter is stored as raw IFC coordinates (scene-order-independent).
          let offset: THREE.Vector3 | undefined;
          useModelStore.getState().models.forEach((m) => {
            if (offset) return;
            for (const els of Object.values(m.elementsByType)) {
              if ((els as { guid?: string }[]).some(e => e.guid === msg.key)) {
                offset = m.originOffset;
                break;
              }
            }
          });
          if (offset) {
            data.bboxCenterX = (data.bboxCenterX ?? 0) + offset.x;
            data.bboxCenterY = (data.bboxCenterY ?? 0) + offset.y;
            data.bboxCenterZ = (data.bboxCenterZ ?? 0) + offset.z;
          }
        }
        bc?.postMessage({ t: "quantities", key: msg.key, data } satisfies BillingMsg);
        return;
      }

      if (msg.t === "requestIfcQuantities") {
        // key is IFC GlobalId — reverse-lookup to find the model file and expressId
        const guid = msg.key;
        let modelFile: File | null = null;
        let foundExpressId = 0;
        useModelStore.getState().models.forEach((m) => {
          if (modelFile) return;
          for (const els of Object.values(m.elementsByType)) {
            const found = (els as { expressId: number; guid?: string }[]).find(e => e.guid === guid);
            if (found) { modelFile = m.file; foundExpressId = found.expressId; break; }
          }
        });
        if (!modelFile) { bc?.postMessage({ t: "ifcQuantities", key: msg.key, items: null } satisfies BillingMsg); return; }
        (async () => {
          try {
            const { psets } = await loadIFCProperties(modelFile!, foundExpressId);
            const items = extractQuantitiesFromPsets(psets);
            bc?.postMessage({ t: "ifcQuantities", key: msg.key, items: items.length > 0 ? items : null } satisfies BillingMsg);
          } catch {
            bc?.postMessage({ t: "ifcQuantities", key: msg.key, items: null } satisfies BillingMsg);
          }
        })();
        return;
      }

      if (msg.t === "startInspection") {
        // key is IFC GlobalId — reverse-lookup to find modelId and expressId
        const guid = msg.key;
        let foundModelId = "";
        let foundExpressId = 0;
        useModelStore.getState().models.forEach((m, id) => {
          if (foundModelId) return;
          for (const els of Object.values(m.elementsByType)) {
            const found = (els as { expressId: number; guid?: string }[]).find(e => e.guid === guid);
            if (found) { foundModelId = id; foundExpressId = found.expressId; break; }
          }
        });
        if (!foundModelId) return;
        startInspectionForElement(foundModelId, foundExpressId, msg.elementName, msg.key);
      }

      if (msg.t === "focusElement") {
        window.dispatchEvent(new CustomEvent("viewer:zoomToElement", {
          detail: { modelId: msg.modelId, expressIds: [msg.expressId] },
        }));
      }

      if (msg.t === "isolateElement") {
        useModelStore.getState().isolateEntries([{ modelId: msg.modelId, expressId: msg.expressId }]);
        window.dispatchEvent(new CustomEvent("viewer:zoomToElement", {
          detail: { modelId: msg.modelId, expressIds: [msg.expressId] },
        }));
      }
    });

    return () => bc?.close();
  }, []);

  // Dead code below kept as tombstone start — replaced by SectionModule

  // ── Grid / axes visibility ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const grid = scene.getObjectByName("__grid");
    if (grid) grid.visible = settings.grid ?? true;
    const axes = scene.getObjectByName("__axes");
    if (axes) axes.visible = settings.axes ?? true;
    needsRenderRef.current = true;
  }, [settings.grid, settings.axes]);

  // ── Scene background follows theme ────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.background = new THREE.Color(
      settings.theme === "light" ? "#e8edf2" : (settings.background ?? "#1a1b26")
    );
    needsRenderRef.current = true;
  }, [settings.theme, settings.background]);

  // ── Sync models into scene ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const storeIds = new Set(models.keys());
    for (const id of Array.from(sceneModelIds.current)) {
      if (!storeIds.has(id)) {
        const obj = scene.getObjectByName(`model:${id}`);
        if (obj) {
          // Free BVH memory before removing from scene
          obj.traverse((child) => {
            if (child instanceof THREE.Mesh && (child.geometry as any).boundsTree) {
              (child.geometry as any).disposeBoundsTree();
            }
          });
          scene.remove(obj);
        }
        sceneModelIds.current.delete(id);
      }
    }

    models.forEach((model) => {
      const existing = scene.getObjectByName(`model:${model.id}`);

      if (!existing) {
        model.mesh.name = `model:${model.id}`;
        model.mesh.userData.modelId = model.id;
        scene.add(model.mesh);
        sceneModelIds.current.add(model.id);
      } else if (existing !== model.mesh) {
        scene.remove(existing);
        model.mesh.name = `model:${model.id}`;
        model.mesh.userData.modelId = model.id;
        scene.add(model.mesh);
      }

      if (model.status === "loaded" && existing !== model.mesh) {
        requestAnimationFrame(() => fitAllLoaded());
        sectionModuleRef.current?.syncPlanes(useModelStore.getState().sectionPlanes);
      }

      // Model-level visibility
      const sceneObj = scene.getObjectByName(`model:${model.id}`);
      if (sceneObj) sceneObj.visible = model.visible;
    });

    // Rebuild mesh index + billing meshMap in one pass.
    // This single O(scene) traversal replaces per-effect traversals in visibility,
    // highlight, basket, color, raycast — all of which become O(k) lookups.
    const newIndex  = new Map<string, THREE.Mesh[]>();
    const newPickable: THREE.Mesh[] = [];
    const newBillingMap = new Map<string, THREE.Mesh[]>();
    const sessionModels = useModelStore.getState().models;
    scene.traverse((obj) => {
      if (obj instanceof THREE.LineSegments && obj.userData.isEdge) return; // managed separately
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData.expressId == null) return;
      if (obj.userData.isHighlight || obj.userData.isSectionVisual ||
          obj.userData.isSectionCap || obj.userData.isBillingOverlay) return;

      let modelId = "";
      let node: THREE.Object3D | null = obj;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }
      if (!modelId) return;

      const key = `${modelId}:${obj.userData.expressId}`;
      let list = newIndex.get(key);
      if (!list) { list = []; newIndex.set(key, list); }
      list.push(obj);
      newPickable.push(obj);

      // Billing mesh map keyed by IFC GlobalId for cross-file identity checks
      const modelEntry = sessionModels.get(modelId);
      if (modelEntry) {
        const eid = obj.userData.expressId as number;
        let guid = "";
        for (const els of Object.values(modelEntry.elementsByType)) {
          const found = (els as { expressId: number; guid?: string }[]).find(e => e.expressId === eid);
          if (found?.guid) { guid = found.guid; break; }
        }
        if (guid) {
          let bList = newBillingMap.get(guid);
          if (!bList) { bList = []; newBillingMap.set(guid, bList); }
          bList.push(obj);
        }
      }
    });
    meshIndexRef.current = newIndex;
    pickableMeshesRef.current = newPickable;
    billingMeshMapRef.current = newBillingMap;

    // Remove stale edge refs (their parent mesh may have been removed with a model)
    edgeLinesRef.current = edgeLinesRef.current.filter(l => l.parent !== null);

    // If edges are enabled, queue building for meshes that don't have edges yet
    if (useModelStore.getState().settings.edges) {
      const mat = edgeMatRef.current ?? (edgeMatRef.current = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
      const queue = newPickable.filter(m => !m.children.some(c => c.userData.isEdge));
      scheduleEdgeBuild(queue, mat, edgeLinesRef, needsRenderRef);
    }

    // Build BVHs in idle-time batches — never blocks the main thread.
    const bvhQueue = newPickable
      .map(m => m.geometry)
      .filter((g, i, arr) => arr.indexOf(g) === i && !(g as any).boundsTree);
    if (bvhQueue.length > 0) {
      const processBatch = () => {
        const batch = bvhQueue.splice(0, 20);
        for (const geo of batch) {
          if (!(geo as any).boundsTree) (geo as any).computeBoundsTree();
        }
        if (bvhQueue.length > 0) {
          ("requestIdleCallback" in window)
            ? requestIdleCallback(processBatch, { timeout: 500 })
            : setTimeout(processBatch, 0);
        }
      };
      ("requestIdleCallback" in window)
        ? requestIdleCallback(processBatch, { timeout: 500 })
        : setTimeout(processBatch, 0);
    }

    // If 5D module is active, re-run viz with the freshly built mesh map.
    // The billing store subscription only fires on billing changes, not model changes —
    // so without this call, enabling 5D before/during model load would never show overlays.
    const { entries, moduleActive } = useBillingStore.getState();
    const viz = billingVizRef.current;
    if (viz) {
      if (moduleActive) viz.update(entries, newBillingMap);
      else viz.clear();
    }

    needsRenderRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // ── Edge visibility: lazy build on first enable, full removal on disable ──
  useEffect(() => {
    if (settings.edges) {
      const mat = edgeMatRef.current ?? (edgeMatRef.current = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
      const queue = pickableMeshesRef.current.filter(m => !m.children.some(c => c.userData.isEdge));
      scheduleEdgeBuild(queue, mat, edgeLinesRef, needsRenderRef);
    } else {
      // Remove all edge LineSegments from the scene graph and free geometry memory.
      for (const line of edgeLinesRef.current) {
        line.geometry.dispose();
        line.parent?.remove(line);
      }
      edgeLinesRef.current = [];
      needsRenderRef.current = true;
    }
  }, [settings.edges]);

  // ── Element-level visibility (hide/isolate) ───────────────────────────────
  // O(index entries) instead of O(scene): meshIndexRef keys are "modelId:expressId"
  useEffect(() => {
    const state = useModelStore.getState();
    const { basketMode: bm, selectionBasket: basket, isolatedElements: iso, hiddenElements: hidden } = state;
    const basketIsolate = bm === "isolate" && basket.size > 0;

    meshIndexRef.current.forEach((meshes, key) => {
      const colonIdx = key.indexOf(":");
      const modelId = key.slice(0, colonIdx);
      const model = state.models.get(modelId);
      if (!model || !model.visible) {
        for (const m of meshes) m.visible = false;
        return;
      }
      let vis: boolean;
      if (basketIsolate) {
        vis = basket.has(key) && !hidden.has(key);
      } else if (iso !== null) {
        vis = iso.has(key) && !hidden.has(key);
      } else {
        vis = !hidden.has(key);
      }
      for (const m of meshes) m.visible = vis;
    });
    needsRenderRef.current = true;
    sectionModuleRef.current?.invalidateCaps();
  // selectionBasket only matters when basketMode === "isolate"; basketMode covers both
  }, [hiddenElements, isolatedElements, models, basketMode,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      basketMode === "isolate" ? selectionBasket : null]);

  // ── Inspector mesh hide/show (runs AFTER element visibility effect) ─────────
  // Declared after the element-visibility effect so it can override its result.
  useEffect(() => {
    for (const m of inspMeshesRef.current) m.visible = inspShowMesh;
    needsRenderRef.current = true;
    // hiddenElements / isolatedElements in deps: re-apply after visibility effect runs
  }, [inspShowMesh, inspSession, hiddenElements, isolatedElements]);

  // ── Color group override ──────────────────────────────────────────────────
  // O(k) via meshIndexRef: restore only previously overridden meshes, apply only new entries.
  useEffect(() => {
    // Restore previous overrides using tracked mesh list (no scene traversal)
    for (const obj of colorOverrideMeshesRef.current) {
      if (obj.userData.originalMaterial !== undefined) {
        obj.material = obj.userData.originalMaterial as THREE.Material;
        obj.userData.originalMaterial = undefined;
      }
    }
    colorOverrideMeshesRef.current = [];
    colorMaterialsRef.current.forEach((m) => m.dispose());
    colorMaterialsRef.current = [];

    if (!colorGroups || colorGroups.length === 0) {
      needsRenderRef.current = true;
      return;
    }

    const colorMap = new Map<string, { color: string; opacity: number }>();
    for (const group of colorGroups) {
      if (!group.visible) continue;
      const opacity = group.opacity ?? 1;
      for (const { modelId, expressId } of group.entries) {
        colorMap.set(`${modelId}:${expressId}`, { color: group.color, opacity });
      }
    }
    if (colorMap.size === 0) { needsRenderRef.current = true; return; }

    const newMats: THREE.Material[] = [];
    const overridden: THREE.Mesh[] = [];
    // One material per unique (color, opacity) — avoids N duplicate materials
    // when many elements share the same visual style.
    const matCache = new Map<string, THREE.MeshLambertMaterial>();

    colorMap.forEach((entry, key) => {
      const meshes = meshIndexRef.current.get(key);
      if (!meshes) return;
      const matKey = `${entry.color}:${entry.opacity}`;
      let mat = matCache.get(matKey);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(entry.color),
          transparent: entry.opacity < 1,
          opacity: entry.opacity,
        });
        matCache.set(matKey, mat);
        newMats.push(mat);
      }
      for (const obj of meshes) {
        obj.userData.originalMaterial = obj.material;
        obj.material = mat;
        overridden.push(obj);
      }
    });

    colorMaterialsRef.current = newMats;
    colorOverrideMeshesRef.current = overridden;
    needsRenderRef.current = true;
  }, [colorGroups]);

  // ── Basket visuals: outlines + material override (highlight / ghost) ────────
  // highlight mode: O(basket_size) via meshIndexRef lookups.
  // ghost mode: O(index_size) — inherently needs all meshes.
  useEffect(() => {
    // Cleanup previous state
    basketOutlinesRef.current.forEach((line) => {
      line.parent?.remove(line);
      (line.material as THREE.Material).dispose();
    });
    basketOutlinesRef.current = [];
    basketMatsRef.current.forEach((orig, mesh) => { mesh.material = orig as THREE.Material; });
    basketMatsRef.current.clear();

    needsRenderRef.current = true;

    if (selectionBasket.size === 0) return;

    const createdMats: THREE.Material[] = [];

    if (basketMode === "highlight") {
      // Only process basket members — O(basket_size)
      selectionBasket.forEach((key) => {
        const meshes = meshIndexRef.current.get(key);
        if (!meshes) return;
        for (const obj of meshes) {
          if (!obj.userData._basketEdgesGeo) {
            obj.userData._basketEdgesGeo = new THREE.EdgesGeometry(obj.geometry, 15);
          }
          const edgesGeo = obj.userData._basketEdgesGeo as THREE.EdgesGeometry;
          const lineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false });
          const lines = new THREE.LineSegments(edgesGeo, lineMat);
          lines.userData.isBasketOutline = true;
          lines.renderOrder = 998;
          obj.add(lines);
          basketOutlinesRef.current.push(lines);

          const orig = obj.material as THREE.Material;
          const hlMat = new THREE.MeshStandardMaterial({
            color: 0xf59e0b, emissive: new THREE.Color(0xf59e0b),
            emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.1,
          });
          basketMatsRef.current.set(obj, orig);
          obj.material = hlMat;
          createdMats.push(hlMat);
        }
      });
    } else if (basketMode === "ghost") {
      // Ghost all non-basket meshes — must visit full index
      meshIndexRef.current.forEach((meshes, key) => {
        if (selectionBasket.has(key)) return;
        for (const obj of meshes) {
          const orig = obj.material as THREE.Material;
          const ghost = orig.clone() as THREE.MeshLambertMaterial;
          ghost.transparent = true;
          ghost.opacity = 0.10;
          ghost.needsUpdate = true;
          basketMatsRef.current.set(obj, orig);
          obj.material = ghost;
          createdMats.push(ghost);
        }
      });
    }

    return () => {
      basketOutlinesRef.current.forEach((line) => {
        line.parent?.remove(line);
        (line.material as THREE.Material).dispose();
      });
      basketOutlinesRef.current = [];
      basketMatsRef.current.forEach((orig, mesh) => { mesh.material = orig as THREE.Material; });
      basketMatsRef.current.clear();
      createdMats.forEach((m) => m.dispose());
      needsRenderRef.current = true;
    };
  }, [selectionBasket, basketMode, models]);

  // ── Highlight selected element ────────────────────────────────────────────
  // O(1) lookup via meshIndexRef — no scene traversal.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    for (const h of highlightRef.current) {
      scene.remove(h);
      if (Array.isArray(h.material)) h.material.forEach((m) => m.dispose());
      else h.material.dispose();
    }
    highlightRef.current = [];
    needsRenderRef.current = true;

    if (!selectedElement) return;

    const key = `${selectedElement.modelId}:${selectedElement.expressId}`;
    if (hiddenElements.has(key)) return;
    if (isolatedElements !== null && !isolatedElements.has(key)) return;

    const hlMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xf59e0b),
      emissive: new THREE.Color(0xf59e0b),
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    const targetMeshes = meshIndexRef.current.get(key) ?? [];
    for (const obj of targetMeshes) {
      const hl = new THREE.Mesh(obj.geometry, hlMat);
      obj.updateWorldMatrix(true, false);
      hl.matrixAutoUpdate = false;
      hl.matrix.copy(obj.matrixWorld);
      hl.renderOrder = 999;
      hl.userData = { isHighlight: true };
      scene.add(hl);
      highlightRef.current.push(hl);
    }
    needsRenderRef.current = true;
  }, [selectedElement, hiddenElements, isolatedElements]);

  // ── Camera fit helpers ────────────────────────────────────────────────────
  const fitCameraToBox = useCallback((box: THREE.Box3) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || box.isEmpty()) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera.fov * Math.PI) / 180;
    const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.6;

    camera.position.copy(center).addScaledVector(
      new THREE.Vector3(1, 0.7, 1).normalize(), distance
    );
    controls.target.copy(center);
    camera.near = Math.max(0.01, distance * 0.0001);
    camera.far = distance * 250;
    camera.updateProjectionMatrix();

    // Sync ortho frustum to same scale
    const ortho = orthoCameraRef.current;
    if (ortho) {
      const aspect = (rendererRef.current?.domElement.clientWidth ?? 1) /
                     (rendererRef.current?.domElement.clientHeight ?? 1);
      const s = maxDim * 0.8;
      ortho.left = -s * aspect; ortho.right = s * aspect;
      ortho.top = s; ortho.bottom = -s;
      ortho.position.copy(camera.position);
      ortho.updateProjectionMatrix();
    }

    controls.update();
    needsRenderRef.current = true;
  }, []);

  const fitAllLoaded = useCallback(() => {
    const allBox = new THREE.Box3();
    useModelStore.getState().models.forEach((m) => {
      if (m.visible && !m.boundingBox.isEmpty()) allBox.union(m.boundingBox);
    });
    if (!allBox.isEmpty()) fitCameraToBox(allBox);
  }, [fitCameraToBox]);

  // ── Camera preset views ───────────────────────────────────────────────────
  const setPresetView = useCallback((preset: string) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const allBox = new THREE.Box3();
    useModelStore.getState().models.forEach((m) => {
      if (m.visible && !m.boundingBox.isEmpty()) allBox.union(m.boundingBox);
    });
    if (allBox.isEmpty()) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    allBox.getCenter(center);
    allBox.getSize(size);
    const d = Math.max(size.x, size.y, size.z) * 1.5;

    const dirs: Record<string, THREE.Vector3> = {
      top:   new THREE.Vector3(0, d, 0),
      bottom:new THREE.Vector3(0, -d, 0),
      front: new THREE.Vector3(0, 0, d),
      back:  new THREE.Vector3(0, 0, -d),
      left:  new THREE.Vector3(-d, 0, 0),
      right: new THREE.Vector3(d, 0, 0),
    };

    const dir = dirs[preset];
    if (!dir) return;
    camera.position.copy(center).add(dir);
    controls.target.copy(center);
    camera.up.set(0, preset === "top" || preset === "bottom" ? 0 : 1,
                      preset === "top" ? -1 : preset === "bottom" ? 1 : 0);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.update();
  }, []);

  // ── Global events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onFitAll = () => fitAllLoaded();
    const onFitTo = (e: Event) => {
      const box = (e as CustomEvent<THREE.Box3>).detail;
      if (box) fitCameraToBox(box);
    };
    const onZoomToElement = (e: Event) => {
      const { modelId, expressIds } = (e as CustomEvent<{ modelId: string; expressIds: number[] }>).detail;
      ctxZoomTo(modelId, expressIds);
    };
    const onPreset = (e: Event) => {
      const preset = (e as CustomEvent<string>).detail;
      setPresetView(preset);
    };
    const onExportGLTF = () => exportGLTF();
    const onScreenshot = () => takeScreenshot();
    const onClearMeasure = () => clearMeasure();

    window.addEventListener("viewer:fitAll", onFitAll);
    window.addEventListener("viewer:fitTo", onFitTo);
    window.addEventListener("viewer:zoomToElement", onZoomToElement);
    window.addEventListener("viewer:preset", onPreset);
    window.addEventListener("viewer:exportGLTF", onExportGLTF);
    window.addEventListener("viewer:screenshot", onScreenshot);
    window.addEventListener("viewer:clearMeasure", onClearMeasure);
    return () => {
      window.removeEventListener("viewer:fitAll", onFitAll);
      window.removeEventListener("viewer:fitTo", onFitTo);
      window.removeEventListener("viewer:zoomToElement", onZoomToElement);
      window.removeEventListener("viewer:preset", onPreset);
      window.removeEventListener("viewer:exportGLTF", onExportGLTF);
      window.removeEventListener("viewer:screenshot", onScreenshot);
      window.removeEventListener("viewer:clearMeasure", onClearMeasure);
    };
  }, [fitAllLoaded, fitCameraToBox, setPresetView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Measure label update (on controls change) ─────────────────────────────
  const updateMeasureLabels = useCallback(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer || measureMidpointsRef.current.length === 0) return;

    const rect = domRectRef.current ?? renderer.domElement.getBoundingClientRect();
    const labels: MeasureLabel[] = measureMidpointsRef.current.map(({ a, b }) => {
      _v3.addVectors(a, b).multiplyScalar(0.5).project(camera);
      const x = ((_v3.x + 1) / 2) * rect.width;
      const y = (-(_v3.y - 1) / 2) * rect.height;
      const dist = a.distanceTo(b);
      const text = dist >= 1 ? `${dist.toFixed(3)} m` : `${(dist * 100).toFixed(1)} cm`;
      return { x, y, text };
    });
    setMeasureLabels(labels);
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.addEventListener("change", updateMeasureLabels);
    return () => controls.removeEventListener("change", updateMeasureLabels);
  }, [updateMeasureLabels]);

  // ── Annotation label screen-position computation ───────────────────────────
  const rebuildStationTicksWorld = useCallback(() => {
    const store = useAlignmentStore.getState();
    if (!store.stationLabelVisible) { stationTicksWorldRef.current = []; return; }
    const interval = store.stationLabelInterval;
    const ticks: StationTickWorld[] = [];
    for (const [alignId, cache] of alignPolylineRef.current.entries()) {
      if (!store.visibleIds.has(alignId)) continue;
      const { pts } = cache;
      if (pts.length < 2) continue;
      const color = store.colors[alignId] ?? "#ff7043";
      const staStart = pts[0].sta;
      const staEnd   = pts[pts.length - 1].sta;
      const firstTick = Math.ceil(staStart / interval) * interval;
      for (let sta = firstTick; sta <= staEnd + 1e-6; sta += interval) {
        for (let i = 0; i < pts.length - 1; i++) {
          const A = pts[i], B = pts[i + 1];
          if (sta < A.sta - 1e-6 || sta > B.sta + 1e-6) continue;
          const t = Math.min(1, Math.max(0, (sta - A.sta) / Math.max(1e-9, B.sta - A.sta)));
          const { ox, oy, oz } = A;
          const az = A.z ?? oz, bz = B.z ?? oz;
          ticks.push({
            wx: A.x + t * (B.x - A.x) - ox,
            wy: az + t * (bz - az) - oz,
            wz: -((A.y + t * (B.y - A.y)) - oy),
            color, sta, alignId,
          });
          break;
        }
      }
    }
    stationTicksWorldRef.current = ticks;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtSta = (sta: number) => {
    const km = Math.floor(sta / 1000);
    return `${km}+${(sta - km * 1000).toFixed(0).padStart(3, "0")}`;
  };

  const updateAnnotLabels = useCallback(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer) return;

    const rect = domRectRef.current ?? renderer.domElement.getBoundingClientRect();
    const store = useAlignmentStore.getState();
    const out: typeof annotLabels = [];

    const project = (wx: number, wy: number, wz: number) => {
      _v3.set(wx, wy, wz).project(camera);
      return {
        x: (_v3.x + 1) / 2 * rect.width,
        y: (-_v3.y + 1) / 2 * rect.height,
        ok: _v3.z < 1,
      };
    };

    // Station tick labels — from pre-computed world positions cache (culled to 2500 m radius)
    if (store.stationLabelVisible) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (const tick of stationTicksWorldRef.current) {
        if (!store.visibleIds.has(tick.alignId)) continue;
        const dx = tick.wx - cx, dy = tick.wy - cy, dz = tick.wz - cz;
        if (dx*dx + dy*dy + dz*dz > 2500*2500) continue;
        const s = project(tick.wx, tick.wy, tick.wz);
        if (s.ok) {
          out.push({ id: `tick-${tick.alignId}-${tick.sta}`, x: s.x, y: s.y, type: "station", lines: [fmtSta(tick.sta)], color: tick.color });
        }
      }
    }

    // Placed labels
    for (const lbl of store.placedLabels) {
      const s = project(lbl.worldX, lbl.worldY, lbl.worldZ);
      if (!s.ok) continue;
      const color = store.colors[lbl.alignmentId] ?? "#ff7043";
      const lines = [
        fmtSta(lbl.station),
        `X ${lbl.easting.toFixed(3)}`,
        `Y ${lbl.northing.toFixed(3)}`,
        ...(lbl.elevation !== null ? [`Z ${lbl.elevation.toFixed(3)}`] : []),
      ];
      out.push({ id: `placed-${lbl.id}`, storeId: lbl.id, x: s.x, y: s.y, type: "placed", lines, color });
    }

    // Offset labels
    for (const m of store.offsetMeasurements) {
      const foot  = project(m.footWorldX,  m.footWorldY,  m.footWorldZ);
      const click = project(m.clickWorldX, m.clickWorldY, m.clickWorldZ);
      if (!foot.ok && !click.ok) continue;
      const color = store.colors[m.alignmentId] ?? "#ff7043";
      const side  = m.offset >= 0 ? "R" : "L";
      const dV    = m.clickWorldY - m.footWorldY;
      out.push({
        id: `offset-${m.id}`,
        storeId: m.id,
        x: (foot.x + click.x) / 2,
        y: (foot.y + click.y) / 2,
        type: "offset",
        lines: [
          fmtSta(m.station),
          `${side} ${Math.abs(m.offset).toFixed(3)} m`,
          `V ${dV >= 0 ? "+" : ""}${dV.toFixed(3)} m`,
        ],
        color,
        footX: foot.x, footY: foot.y,
        clickSX: click.x, clickSY: click.y,
      });
    }

    setAnnotLabels(out);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleAnnotLabels = useCallback(() => {
    if (annotRafRef.current) return;
    annotRafRef.current = requestAnimationFrame(() => {
      annotRafRef.current = 0;
      updateAnnotLabels();
    });
  }, [updateAnnotLabels]);

  // Rebuild 3D offset lines when offsetMeasurements changes; reproject labels on annotation data change
  useEffect(() => {
    function rebuildAnnotLines() {
      const group = annotGroupRef.current;
      if (!group) return;
      while (group.children.length > 0) {
        const child = group.children[0] as THREE.Line;
        child.geometry?.dispose();
        (child.material as THREE.Material)?.dispose();
        group.remove(child);
      }
      const { offsetMeasurements, colors } = useAlignmentStore.getState();
      for (const m of offsetMeasurements) {
        const A = new THREE.Vector3(m.footWorldX,  m.footWorldY,  m.footWorldZ);
        const B = new THREE.Vector3(m.clickWorldX, m.clickWorldY, m.clickWorldZ);
        const geo = new THREE.BufferGeometry().setFromPoints([A, B]);
        const col = new THREE.Color(colors[m.alignmentId] ?? "#4caf50");
        const mat = new THREE.LineDashedMaterial({ color: col, dashSize: 0.3, gapSize: 0.15 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.renderOrder = 997;
        group.add(line);
      }
      needsRenderRef.current = true;
    }

    rebuildAnnotLines();
    rebuildStationTicksWorld();
    updateAnnotLabels();

    const unsub = useAlignmentStore.subscribe((state, prev) => {
      if (state.offsetMeasurements !== prev.offsetMeasurements) rebuildAnnotLines();
      if (state.stationLabelVisible !== prev.stationLabelVisible ||
          state.stationLabelInterval !== prev.stationLabelInterval ||
          state.files !== prev.files ||
          state.visibleIds !== prev.visibleIds ||
          state.colors !== prev.colors) {
        rebuildStationTicksWorld();
      }
      if (state.stationLabelVisible !== prev.stationLabelVisible ||
          state.stationLabelInterval !== prev.stationLabelInterval ||
          state.placedLabels !== prev.placedLabels ||
          state.offsetMeasurements !== prev.offsetMeasurements ||
          state.visibleIds !== prev.visibleIds ||
          state.files !== prev.files ||
          state.colors !== prev.colors) {
        scheduleAnnotLabels();
      }
    });
    return () => unsub();
  }, [rebuildStationTicksWorld, updateAnnotLabels, scheduleAnnotLabels]);

  // Re-project annotation labels on camera pan/zoom (RAF-throttled)
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.addEventListener("change", scheduleAnnotLabels);
    return () => controls.removeEventListener("change", scheduleAnnotLabels);
  }, [scheduleAnnotLabels]);

  // Profile hover → 3D marker sphere
  useEffect(() => {
    const updateSphere = () => {
      const sphere = profileSphereRef.current;
      if (!sphere) return;
      const { profileHoverStation, profileHoverAlignmentId, files, geoOrigin, visibleIds } = useAlignmentStore.getState();
      if (profileHoverStation === null) {
        sphere.visible = false;
        needsRenderRef.current = true;
        return;
      }

      // Use same origin logic as alignment line builder
      const ifc = useModelStore.getState().models.values().next().value as import("../types/ifc").IFCModelEntry | undefined;
      let ox: number, oy: number, oz: number;
      if (ifc) {
        ox = ifc.originOffset.x;
        oy = -ifc.originOffset.z;
        oz = ifc.originOffset.y;
      } else if (geoOrigin) {
        ox = geoOrigin.x; oy = geoOrigin.y; oz = geoOrigin.z;
      } else {
        ox = 0; oy = 0; oz = 0;
      }

      const allAligns = files.flatMap(f => f.alignments);
      const alignment = profileHoverAlignmentId !== null
        ? allAligns.find(a => a.id === profileHoverAlignmentId)
        : allAligns.find(a => visibleIds.has(a.id));
      if (!alignment) { sphere.visible = false; needsRenderRef.current = true; return; }

      const pt = sampleAtDisplayStation(alignment, profileHoverStation);
      if (!pt) { sphere.visible = false; needsRenderRef.current = true; return; }

      sphere.position.set(
        pt.x - ox,
        (pt.z ?? oz) - oz,
        -(pt.y - oy)
      );
      sphere.visible = true;
      needsRenderRef.current = true;
    };

    const unsub = useAlignmentStore.subscribe((state, prev) => {
      if (state.profileHoverStation !== prev.profileHoverStation ||
          state.profileHoverAlignmentId !== prev.profileHoverAlignmentId) {
        updateSphere();
      }
    });
    return () => unsub();
  }, []);

  // Cross-section: compute slice and update 3D plane indicator
  useEffect(() => {
    const computeSection = () => {
      const scene = sceneRef.current;
      if (!scene) return;
      const { crossSectionStation, crossSectionAlignmentId, crossSectionMode, files, geoOrigin } = useAlignmentStore.getState();
      const indicator = sectionIndicatorRef.current;

      if (crossSectionStation === null) {
        if (indicator) indicator.visible = false;
        needsRenderRef.current = true;
        return;
      }

      // Origin (same logic as alignment lines)
      const ifc = useModelStore.getState().models.values().next().value as import("../types/ifc").IFCModelEntry | undefined;
      let ox: number, oy: number, oz: number;
      if (ifc) { ox = ifc.originOffset.x; oy = -ifc.originOffset.z; oz = ifc.originOffset.y; }
      else if (geoOrigin) { ox = geoOrigin.x; oy = geoOrigin.y; oz = geoOrigin.z; }
      else { ox = 0; oy = 0; oz = 0; }

      const allAligns = files.flatMap(f => f.alignments);
      const alignment = allAligns.find(a => a.id === crossSectionAlignmentId) ?? allAligns[0];
      if (!alignment) return;

      const pt = sampleAtDisplayStation(alignment, crossSectionStation);
      if (!pt) return;

      const wx = pt.x - ox;
      const wz = -(pt.y - oy);

      // Compute horizontal tangent numerically from two nearby samples.
      // This avoids relying on tangentRad convention and works for all segment types.
      const dS = Math.min(2.0, (alignment.staEnd - alignment.staStart) * 0.005 + 0.1);
      const ptA = sampleAtDisplayStation(alignment, Math.max(alignment.staStart, crossSectionStation - dS));
      const ptB = sampleAtDisplayStation(alignment, Math.min(alignment.staEnd,   crossSectionStation + dS));
      if (!ptA || !ptB) return;

      // Three.js direction: X = ΔEasting, Z = -ΔNorthing
      const dxH = ptB.x - ptA.x;
      const dzH = -(ptB.y - ptA.y);
      const hLen = Math.sqrt(dxH * dxH + dzH * dzH);
      if (hLen < 1e-9) return;

      const tangentDir = new THREE.Vector3(dxH / hLen, 0, dzH / hLen);
      // rightDir = tangentDir × worldUp = (-tz, 0, tx)
      const rightDir = new THREE.Vector3(-tangentDir.z, 0, tangentDir.x);

      let planeNormal: THREE.Vector3;
      let upDir: THREE.Vector3;

      if (crossSectionMode === "normal") {
        // True normal section: include grade from profile in the 3D tangent
        const delta = 1.0;
        const e1 = evaluateProfile(alignment.profileGeom, crossSectionStation + delta);
        const e0 = evaluateProfile(alignment.profileGeom, crossSectionStation - delta);
        const grade = (e1 !== null && e0 !== null) ? (e1 - e0) / (2 * delta) : 0;
        planeNormal = new THREE.Vector3(dxH / hLen, grade, dzH / hLen).normalize();
        // "Up" in the tilted section plane: rightDir × planeNormal
        upDir = new THREE.Vector3().crossVectors(rightDir, planeNormal).normalize();
      } else {
        // Vertikal: plane is vertical, normal = horizontal tangent
        planeNormal = tangentDir.clone();
        upDir = new THREE.Vector3(0, 1, 0);
      }

      // World Y of alignment at this station
      const wy = (pt.z ?? oz) - oz;
      const origin3 = new THREE.Vector3(wx, wy, wz);

      // Update indicator plane (orient its face normal = planeNormal)
      if (indicator) {
        indicator.position.copy(origin3);
        indicator.lookAt(origin3.clone().add(planeNormal));
        indicator.visible = true;
        needsRenderRef.current = true;
      }

      // Compute slice (deferred to avoid blocking frame)
      setTimeout(() => {
        const sc = sceneRef.current;
        if (!sc) return;
        const lines = sliceScene(sc, origin3, planeNormal, rightDir, upDir);
        useAlignmentStore.getState().setCrossSectionResult(lines);
      }, 0);
    };

    const unsub = useAlignmentStore.subscribe((state, prev) => {
      if (state.crossSectionStation !== prev.crossSectionStation ||
          state.crossSectionAlignmentId !== prev.crossSectionAlignmentId ||
          state.crossSectionMode !== prev.crossSectionMode ||
          state.crossSectionComputing !== prev.crossSectionComputing) {
        if (state.crossSectionComputing) computeSection();
      }
      if (!state.crossSectionOpen && prev.crossSectionOpen) {
        const indicator = sectionIndicatorRef.current;
        if (indicator) { indicator.visible = false; needsRenderRef.current = true; }
      }
    });
    return () => unsub();
  }, []);

  // ── Alignment click helpers ────────────────────────────────────────────────
  // Returns the closest point on visible alignment polylines to the mouse ray.
  const findClosestAlignPoint = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const camera   = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer) return null;

    const rect = domRectRef.current ?? renderer.domElement.getBoundingClientRect();
    _ndc.set(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    _ray.setFromCamera(_ndc, camera);
    const ro = _ray.ray.origin;
    const rd = _ray.ray.direction;
    const c  = rd.dot(rd);

    const { visibleIds } = useAlignmentStore.getState();
    let bestDist = Infinity;
    let bestAlignId = -1;
    let bestStation = 0;
    const bestFoot  = new THREE.Vector3();
    let bestLandXML = { x: 0, y: 0, z: null as number | null };

    for (const [alignId, cache] of alignPolylineRef.current.entries()) {
      if (!visibleIds.has(alignId)) continue;
      const { pts } = cache;
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        const { ox, oy, oz } = A;
        _v3.set(A.x - ox, (A.z ?? oz) - oz, -(A.y - oy));   // p0
        _v3b.set(B.x - ox, (B.z ?? oz) - oz, -(B.y - oy));  // p1
        const segX = _v3b.x - _v3.x, segY = _v3b.y - _v3.y, segZ = _v3b.z - _v3.z;
        const wX = _v3.x - ro.x, wY = _v3.y - ro.y, wZ = _v3.z - ro.z;
        const a   = segX*segX + segY*segY + segZ*segZ;
        const b   = segX*rd.x + segY*rd.y + segZ*rd.z;
        const d   = segX*wX   + segY*wY   + segZ*wZ;
        const ev  = rd.x*wX   + rd.y*wY   + rd.z*wZ;
        const den = a * c - b * b;
        let sc = den > 1e-10 ? Math.min(1, Math.max(0, (b * ev - c * d) / den)) : 0;
        const tc = (b * sc + ev) / c;
        if (tc < 0) sc = Math.min(1, Math.max(0, -d / a));
        // foot = p0 + sc * seg (reuse _v3 for foot)
        _v3.x += sc * segX; _v3.y += sc * segY; _v3.z += sc * segZ;
        // dist = |foot - rayPt|
        const tc2 = Math.max(0, (b * sc + ev) / c);
        const fpX = _v3.x - (ro.x + tc2*rd.x);
        const fpY = _v3.y - (ro.y + tc2*rd.y);
        const fpZ = _v3.z - (ro.z + tc2*rd.z);
        const dist = Math.sqrt(fpX*fpX + fpY*fpY + fpZ*fpZ);
        if (dist < bestDist) {
          bestDist    = dist;
          bestAlignId = alignId;
          bestStation = A.sta + sc * (B.sta - A.sta);
          bestFoot.copy(_v3);
          const az = A.z ?? null, bz = B.z ?? null;
          bestLandXML = {
            x: A.x + sc * (B.x - A.x),
            y: A.y + sc * (B.y - A.y),
            z: az !== null && bz !== null ? az + sc * (bz - az) : null,
          };
        }
      }
    }
    if (bestAlignId < 0 || bestDist > 50) return null;
    return { alignId: bestAlignId, station: bestStation, foot: bestFoot, landXML: bestLandXML };
  }, []);

  // ── Measurement helper functions ──────────────────────────────────────────
  const clearMeasure = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    measureLinesRef.current.forEach((l) => scene.remove(l));
    measureSpheresRef.current.forEach((s) => scene.remove(s));
    measureLinesRef.current = [];
    measureSpheresRef.current = [];
    measureMidpointsRef.current = [];
    pendingPointRef.current = null;
    setMeasureLabels([]);
    setMeasurePending(false);
    clearMeasurements();
  }, [clearMeasurements]);

  const addSphere = useCallback((pos: THREE.Vector3) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x7aa2f7, depthTest: false })
    );
    sphere.position.copy(pos);
    sphere.renderOrder = 999;
    scene.add(sphere);
    measureSpheresRef.current.push(sphere);
  }, []);

  // ── Raycasting helper ─────────────────────────────────────────────────────
  const raycastPoint = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): {
      mesh: THREE.Mesh; point: THREE.Vector3; expressId: number; modelId: string;
      faceNormal: THREE.Vector3 | null;
    } | null => {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      if (!renderer || !camera || !scene) return null;

      const rect = domRectRef.current ?? renderer.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const activeCamera = useModelStore.getState().settings.orthographic
        ? orthoCameraRef.current ?? camera
        : camera;
      _ray.setFromCamera(_ndc, activeCamera);

      // Frustum culling: discard meshes outside the view before raycasting.
      _projMat.multiplyMatrices(activeCamera.projectionMatrix, activeCamera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projMat);
      const meshes = pickableMeshesRef.current.filter(mesh => {
        if (!isWorldVisible(mesh)) return false;
        const bs = mesh.geometry.boundingSphere;
        if (!bs) return true;
        _bSphere.copy(bs).applyMatrix4(mesh.matrixWorld);
        return _frustum.intersectsSphere(_bSphere);
      });

      const hits = _ray.intersectObjects(meshes, false);
      if (!hits.length) return null;

      // Reject hits whose point is on the clipped side of any active section plane
      const clipPlanes = rendererRef.current?.clippingPlanes ?? [];
      const hit = clipPlanes.length
        ? hits.find(h => clipPlanes.every(cp => cp.distanceToPoint(h.point) >= -0.01)) ?? null
        : hits[0];
      if (!hit) return null;

      const hitMesh = hit.object as THREE.Mesh;
      const expressId = hitMesh.userData.expressId as number;

      let modelId = "";
      let node: THREE.Object3D | null = hitMesh;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }

      // Face normal in world space
      let faceNormal: THREE.Vector3 | null = null;
      if (hit.face) {
        faceNormal = hit.face.normal.clone().transformDirection(hitMesh.matrixWorld).normalize();
      }

      return { mesh: hitMesh, point: hit.point, expressId, modelId, faceNormal };
    },
    []
  );

  // ── Left click handler ────────────────────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setContextMenu(null);
    if (clickSuppressedRef.current) { clickSuppressedRef.current = false; return; }

    // Inspection mode: route clicks to picker (check ref only — inspSession is React state and would be stale in this closure)
    if (pickerRef.current && rendererRef.current && cameraRef.current) {
      const rect = domRectRef.current ?? rendererRef.current.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      pickerRef.current.onClick(_ndc, cameraRef.current, e.ctrlKey, inspPickModeRef.current);
      needsRenderRef.current = true;
      return;
    }

    const hit = raycastPoint(e);

    // ── Alignment annotation tools ───────────────────────────────────────────
    const annotStore = useAlignmentStore.getState();

    if (annotStore.labelToolActive) {
      // Label tool: snap to closest point on alignment (ray-to-polyline)
      const closest = findClosestAlignPoint(e);
      if (!closest) return;
      const { alignId, station, foot, landXML } = closest;
      const alignName = alignPolylineRef.current.get(alignId)?.name ?? "";
      const lbl: PlacedLabel = {
        id: crypto.randomUUID(),
        alignmentId: alignId,
        alignmentName: alignName,
        station,
        easting:   landXML.x,
        northing:  landXML.y,
        elevation: landXML.z,
        worldX: foot.x,
        worldY: foot.y,
        worldZ: foot.z,
      };
      useAlignmentStore.getState().addPlacedLabel(lbl);
      needsRenderRef.current = true;
      return;
    }

    if (annotStore.offsetToolActive) {
      // Get 3D click point from IFC geometry; fall back to Y=0 horizontal plane.
        let clickPt: THREE.Vector3;
        if (hit) {
          clickPt = hit.point;
        } else {
          const camera   = cameraRef.current;
          const renderer = rendererRef.current;
          if (!camera || !renderer) return;
          const rect = domRectRef.current ?? renderer.domElement.getBoundingClientRect();
          _ndc.set(
            ((e.clientX - rect.left) / rect.width)  * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          _ray.setFromCamera(_ndc, camera);
          const target = new THREE.Vector3();
          if (!_ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), target)) return;
          clickPt = target;
        }

        // Find the perpendicular foot on the nearest visible alignment by projecting
        // clickPt horizontally (XZ) onto each polyline segment.
        const { visibleIds } = useAlignmentStore.getState();
        let bestDist2 = Infinity, bestAlignId2 = -1, bestT2 = 0, bestSegIdx = 0;
        let bestCacheRef: { pts: Array<{ x: number; y: number; z: number | null; sta: number; ox: number; oy: number; oz: number }>; name: string } | null = null;

        for (const [aId, aCache] of alignPolylineRef.current.entries()) {
          if (!visibleIds.has(aId)) continue;
          const { pts } = aCache;
          for (let i = 0; i < pts.length - 1; i++) {
            const A = pts[i], B = pts[i + 1];
            const { ox, oy } = A;
            const ax = A.x - ox, az = -(A.y - oy);
            const bx = B.x - ox, bz = -(B.y - oy);
            const dx = bx - ax, dz = bz - az;
            const len2 = dx*dx + dz*dz;
            if (len2 < 1e-12) continue;
            const t = Math.max(0, Math.min(1, ((clickPt.x - ax)*dx + (clickPt.z - az)*dz) / len2));
            const ex = ax + t*dx - clickPt.x, ez = az + t*dz - clickPt.z;
            const d2 = ex*ex + ez*ez;
            if (d2 < bestDist2) { bestDist2 = d2; bestAlignId2 = aId; bestT2 = t; bestSegIdx = i; bestCacheRef = aCache; }
          }
        }

        if (bestAlignId2 < 0 || !bestCacheRef) return;

        const SA = bestCacheRef.pts[bestSegIdx], SB = bestCacheRef.pts[bestSegIdx + 1];
        const { ox, oy, oz } = SA;
        const foot = new THREE.Vector3(
          SA.x + bestT2 * (SB.x - SA.x) - ox,
          (SA.z ?? oz) + bestT2 * ((SB.z ?? oz) - (SA.z ?? oz)) - oz,
          -((SA.y + bestT2 * (SB.y - SA.y)) - oy),
        );
        const perpStation = SA.sta + bestT2 * (SB.sta - SA.sta);

        // Tangent at foot (scene XZ), then right-hand normal
        let ttx = SB.x - SA.x, ttz = -(SB.y - SA.y);
        const tlen = Math.hypot(ttx, ttz);
        if (tlen > 1e-9) { ttx /= tlen; ttz /= tlen; }
        const right = new THREE.Vector3(-ttz, 0, ttx);

        // True perpendicular (normal-to-tangent) distance: project diff onto right normal
        const diff = new THREE.Vector3().subVectors(clickPt, foot);
        const offset = diff.dot(right);  // signed: + = right of axis, - = left

        const m: OffsetMeasurement = {
          id: crypto.randomUUID(),
          alignmentId: bestAlignId2,
          alignmentName: bestCacheRef.name,
          station: perpStation,
          offset,
          clickWorldX: clickPt.x, clickWorldY: clickPt.y, clickWorldZ: clickPt.z,
          footWorldX:  foot.x,    footWorldY:  foot.y,    footWorldZ:  foot.z,
        };
      useAlignmentStore.getState().addOffsetMeasurement(m);
      needsRenderRef.current = true;
      return;
    }

    if (activeTool === "measure") {
      // Measure needs a 3D point even on empty space — use a large plane
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      if (!renderer || !camera || !scene) return;

      let point: THREE.Vector3;
      if (hit) {
        point = hit.point;
      } else {
        // Project onto Y=0 plane
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, target)) return;
        point = target;
      }

      if (!pendingPointRef.current) {
        // First click: store point A
        pendingPointRef.current = point.clone();
        addSphere(point);
        setMeasurePending(true);
      } else {
        // Second click: complete measurement
        const a = pendingPointRef.current;
        const b = point.clone();
        addSphere(b);

        // Draw line
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const mat = new THREE.LineDashedMaterial({
          color: 0x7aa2f7, dashSize: 0.3, gapSize: 0.15, linewidth: 2,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.renderOrder = 998;
        scene.add(line);
        measureLinesRef.current.push(line);
        needsRenderRef.current = true;

        measureMidpointsRef.current.push({ a, b });
        pendingPointRef.current = null;
        setMeasurePending(false);

        const dist = a.distanceTo(b);
        addMeasurement({ id: uuidv4(), a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z }, distance: dist });
        updateMeasureLabels();
      }
      return;
    }

    // Section tool: click face → create new plane at that position
    if (activeTool === "section") {
      if (clickSuppressedRef.current) return;
      if (hit?.faceNormal) {
        const N = hit.faceNormal.clone().negate().normalize();
        const P = hit.point;
        const planes = useModelStore.getState().sectionPlanes;
        const colors = ["#7aa2f7","#f7768e","#9ece6a","#e0af68","#bb9af7","#2ac3de"];
        useModelStore.getState().addSectionPlane({
          id: uuidv4(),
          name: `Schnitt ${planes.length + 1}`,
          normal: [N.x, N.y, N.z],
          point:  [P.x, P.y, P.z],
          enabled: true,
          color: colors[planes.length % colors.length],
        });
        useModelStore.getState().setActiveTool("select");
      }
      return;
    }

    if (!hit) return;

    // Select tool: store update triggers the highlight useEffect
    onElementClick(hit.modelId, hit.expressId);
  }, [activeTool, raycastPoint, addSphere, addMeasurement, updateMeasureLabels, findClosestAlignPoint, onElementClick]);

  // ── Mouse position tracking for click-suppression ────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current    = { x: e.clientX, y: e.clientY };
    clickSuppressedRef.current = false;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!clickSuppressedRef.current && mouseDownPosRef.current) {
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      if (dx * dx + dy * dy > 25) clickSuppressedRef.current = true;
    }
    // Inspection hover
    if (pickerRef.current && cameraRef.current && rendererRef.current) {
      const rect = domRectRef.current ?? rendererRef.current.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      if (pickerRef.current.onMouseMove(_ndc, cameraRef.current)) needsRenderRef.current = true;
    }
  }, []);

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLDivElement>) => {
    // SectionModule handles its own drag via pointerdown capture + setPointerCapture.
    // No section drag state remains here.
  }, []);

  // ── Context menu action helpers ───────────────────────────────────────────

  const ctxZoomTo = useCallback((modelId: string, expressIds: number[]) => {
    const scene    = sceneRef.current;
    const camera   = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    const box = new THREE.Box3();
    for (const expressId of expressIds) {
      const meshes = meshIndexRef.current.get(`${modelId}:${expressId}`);
      if (meshes) for (const obj of meshes) box.expandByObject(obj);
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov    = (camera.fov * Math.PI) / 180;
    const dist   = (maxDim / (2 * Math.tan(fov / 2))) * 1.6;

    // Keep current look direction — only translate camera along that axis
    const dir = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();

    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center);
    camera.near = Math.max(0.01, dist * 0.0001);
    camera.far  = dist * 250;
    camera.updateProjectionMatrix();

    const ortho = orthoCameraRef.current;
    if (ortho) {
      const aspect = (rendererRef.current?.domElement.clientWidth  ?? 1) /
                     (rendererRef.current?.domElement.clientHeight ?? 1);
      const s = maxDim * 0.8;
      ortho.left = -s * aspect; ortho.right = s * aspect;
      ortho.top = s; ortho.bottom = -s;
      ortho.position.copy(camera.position);
      ortho.updateProjectionMatrix();
    }

    controls.update();
    needsRenderRef.current = true;
  }, []);

  // ── Double-click: zoom to element or apply staged SmartView ─────────────
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // In edge-pick mode: flood-select all connected edges from the clicked one
    if (pickerRef.current && inspPickModeRef.current === "edge" && rendererRef.current && cameraRef.current) {
      const rect = domRectRef.current ?? rendererRef.current.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      if (pickerRef.current.onDblClick(_ndc, cameraRef.current)) {
        needsRenderRef.current = true;
        return;
      }
    }
    if (stagedSmartViewId) { applySmartView(stagedSmartViewId); return; }
    const hit = raycastPoint(e);
    if (hit) ctxZoomTo(hit.modelId, [hit.expressId]);
  }, [stagedSmartViewId, applySmartView, raycastPoint, ctxZoomTo]);

  const ctxSelectClass = useCallback((modelId: string, expressId: number) => {
    const state = useModelStore.getState();
    const model = state.models.get(modelId);
    if (!model) return;
    let typeName: string | null = null;
    for (const [t, els] of Object.entries(model.elementsByType)) {
      if (els.some((el) => el.expressId === expressId)) { typeName = t; break; }
    }
    if (!typeName) return;
    const entries = new Set<string>();
    state.models.forEach((m) => {
      const els = m.elementsByType[typeName!] ?? [];
      els.forEach((el) => entries.add(`${m.id}:${el.expressId}`));
    });
    setBasket(entries);
  }, [setBasket]);

  const ctxSelectStorey = useCallback((modelId: string, expressId: number) => {
    const state = useModelStore.getState();
    const model = state.models.get(modelId);
    if (!model?.spatialTree) return;

    function collectNodeElements(node: SpatialNode): number[] {
      const ids = (node.elements ?? []).map((el) => el.expressId);
      for (const child of node.children) ids.push(...collectNodeElements(child));
      return ids;
    }

    function findStorey(node: SpatialNode): number[] | null {
      const allIds = collectNodeElements(node);
      if (!allIds.includes(expressId)) return null;
      if (node.type === "IfcBuildingStorey") return allIds;
      for (const child of node.children) {
        const result = findStorey(child);
        if (result !== null) return result;
      }
      return null;
    }

    const ids = findStorey(model.spatialTree);
    if (!ids) return;
    const entries = new Set(ids.map((id) => `${modelId}:${id}`));
    setBasket(entries);
  }, [setBasket]);

  // ── Right-click context menu ──────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = raycastPoint(e);
    if (!hit) { setContextMenu(null); return; }
    const containerRect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    // Look up element name/type from loaded models
    let elementName = `#${hit.expressId}`;
    let ifcType = "";
    const model = useModelStore.getState().models.get(hit.modelId);
    if (model) {
      outer: for (const [type, els] of Object.entries(model.elementsByType)) {
        for (const el of els as Array<{ expressId: number; name: string }>) {
          if (el.expressId === hit.expressId) {
            elementName = el.name || elementName;
            ifcType = type;
            break outer;
          }
        }
      }
    }
    setContextMenu({
      x: e.clientX - containerRect.left,
      y: e.clientY - containerRect.top,
      modelId: hit.modelId,
      expressId: hit.expressId,
      elementName,
      ifcType,
      faceNormal: hit.faceNormal ? [hit.faceNormal.x, hit.faceNormal.y, hit.faceNormal.z] : undefined,
      hitPoint: [hit.point.x, hit.point.y, hit.point.z],
    });
  }, [raycastPoint]);

  // ── Export helpers ────────────────────────────────────────────────────────
  const exportGLTF = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const exporter = new GLTFExporter();
    const meshes: THREE.Object3D[] = pickableMeshesRef.current.slice();
    if (meshes.length === 0) return;

    const group = new THREE.Group();
    meshes.forEach((m) => group.add(m.clone()));

    exporter.parse(group, (result) => {
      const blob = new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "modell.glb";
      a.click();
      URL.revokeObjectURL(a.href);
    }, (err) => console.error("[GLTFExporter]", err), { binary: true });
  }, []);

  const takeScreenshot = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `infracore-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }, []);

  // Cursor style per tool
  const labelToolActive  = useAlignmentStore(s => s.labelToolActive);
  const offsetToolActive = useAlignmentStore(s => s.offsetToolActive);
  const cursor = activeTool === "measure" ? "crosshair"
               : activeTool === "section" ? "crosshair"
               : labelToolActive || offsetToolActive ? "crosshair"
               : "default";

  return (
    <div className={cn("w-full h-full relative", basketMode && "ring-2 ring-amber-400/70 ring-inset")}>
      <div
        ref={mountRef}
        className="w-full h-full"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor }}
        data-viewport="main"
      />

      {/* Measure hint */}
      {activeTool === "measure" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-card/90 backdrop-blur border border-border rounded-full px-4 py-1.5 text-xs text-foreground">
            {measurePending ? "Zweiten Punkt klicken · Esc = Abbrechen" : "Ersten Punkt klicken"}
          </div>
        </div>
      )}

      {/* Measure labels */}
      {measureLabels.map((lbl, i) => (
        <div
          key={i}
          className="absolute pointer-events-none bg-primary text-primary-foreground text-[11px] font-mono px-2 py-0.5 rounded shadow-lg"
          style={{ left: lbl.x, top: lbl.y, transform: "translate(-50%, -100%)" }}
        >
          {lbl.text}
        </div>
      ))}

      {/* Annotation labels: station ticks, placed labels, offset measurements */}
      {annotLabels.map(lbl => {
        if (lbl.type === "station") {
          return (
            <div
              key={lbl.id}
              className="absolute pointer-events-none select-none"
              style={{ left: lbl.x, top: lbl.y, transform: "translate(-50%, -130%)" }}
            >
              <div
                className="text-[9px] font-mono font-semibold px-1 py-0.5 rounded whitespace-nowrap shadow-sm"
                style={{ color: lbl.color, backgroundColor: "rgba(0,0,0,0.55)", border: `1px solid ${lbl.color}55` }}
              >
                {lbl.lines[0]}
              </div>
              {/* Tick line */}
              <div className="absolute left-1/2 -translate-x-px w-px h-2.5 top-full" style={{ backgroundColor: lbl.color, opacity: 0.7 }} />
            </div>
          );
        }

        if (lbl.type === "placed") {
          return (
            <div
              key={lbl.id}
              className="absolute select-none"
              style={{ left: lbl.x, top: lbl.y, transform: "translate(6px, -50%)", pointerEvents: "none" }}
            >
              {/* Pin dot */}
              <div className="absolute -left-5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2"
                style={{ backgroundColor: lbl.color, borderColor: lbl.color, boxShadow: `0 0 4px ${lbl.color}` }} />
              <div
                className="relative text-[9px] font-mono px-1.5 py-1 rounded whitespace-nowrap shadow-lg leading-snug"
                style={{ backgroundColor: "rgba(0,0,0,0.75)", border: `1px solid ${lbl.color}66`, color: "#e4e4e7" }}
              >
                <div className="font-semibold mb-0.5" style={{ color: lbl.color }}>{lbl.lines[0]}</div>
                {lbl.lines.slice(1).map((l, i) => <div key={i}>{l}</div>)}
                {/* Delete button */}
                <button
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none hover:opacity-100 opacity-70 transition-opacity"
                  style={{ backgroundColor: "rgba(0,0,0,0.8)", border: `1px solid ${lbl.color}88`, color: lbl.color, pointerEvents: "auto" }}
                  onClick={() => lbl.storeId && useAlignmentStore.getState().removePlacedLabel(lbl.storeId)}
                >×</button>
              </div>
            </div>
          );
        }

        if (lbl.type === "offset") {
          const fx = lbl.footX ?? lbl.x, fy = lbl.footY ?? lbl.y;
          const cx = lbl.clickSX ?? lbl.x, cy = lbl.clickSY ?? lbl.y;
          const dx = cx - fx, dy = cy - fy;
          const len = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          return (
            <div key={lbl.id} className="absolute select-none" style={{ left: 0, top: 0, pointerEvents: "none" }}>
              {/* Offset line SVG */}
              {len > 2 && (
                <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
                  <line x1={fx} y1={fy} x2={cx} y2={cy}
                    stroke={lbl.color} strokeWidth={1.5} strokeDasharray="4 2" opacity={0.8} />
                  <circle cx={fx} cy={fy} r={3} fill={lbl.color} opacity={0.9} />
                  <circle cx={cx} cy={cy} r={3} fill={lbl.color} opacity={0.9} />
                </svg>
              )}
              {/* Label at midpoint */}
              <div
                className="absolute text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap shadow-lg leading-snug"
                style={{
                  left: lbl.x, top: lbl.y,
                  transform: `translate(-50%, -50%) rotate(${angle > 90 || angle < -90 ? angle + 180 : angle}deg)`,
                  backgroundColor: "rgba(0,0,0,0.75)",
                  border: `1px solid ${lbl.color}66`,
                  color: "#e4e4e7",
                }}
              >
                <div className="font-semibold" style={{ color: lbl.color }}>{lbl.lines[0]}</div>
                {lbl.lines.slice(1).map((l, i) => <div key={i}>{l}</div>)}
                {/* Delete button — counter-rotated so it stays upright */}
                <button
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none hover:opacity-100 opacity-70 transition-opacity"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.8)",
                    border: `1px solid ${lbl.color}88`,
                    color: lbl.color,
                    pointerEvents: "auto",
                    transform: `rotate(${-(angle > 90 || angle < -90 ? angle + 180 : angle)}deg)`,
                  }}
                  onClick={() => lbl.storeId && useAlignmentStore.getState().removeOffsetMeasurement(lbl.storeId)}
                >×</button>
              </div>
            </div>
          );
        }

        return null;
      })}

      {/* Inspector labels — face (F1…) and edge (K1…) labels in 3D viewport */}
      {inspSession && inspShowLabels && inspLabels.map((lbl) => (
        <div
          key={`${lbl.type}-${lbl.id}`}
          className={cn(
            "absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono whitespace-nowrap border select-none shadow",
            lbl.type === "face"
              ? lbl.selected
                ? "bg-[#00ff66] text-black border-[#00ff66] font-semibold"
                : "bg-[#22aa55]/85 text-white border-[#22aa55]/60"
              : lbl.selected
                ? "bg-[#ff8800] text-black border-[#ff8800] font-semibold"
                : "bg-[#cc2222]/85 text-white border-[#cc2222]/60"
          )}
          style={{ left: lbl.x, top: lbl.y }}
        >
          {lbl.text}
        </div>
      ))}

      {/* Section panel — top center, lazy: only mounts when active */}
      <SectionPanel />

      {/* Geometry inspector panel */}
      {inspSession && (
        <GeometryInspectorPanel
          elementName={inspSession.elementName}
          billingKey={inspSession.billingKey}
          expressId={inspSession.expressId}
          modelId={inspSession.modelId}
          ifcType={inspSession.ifcType}
          faces={inspFaces}
          boundaries={inspBoundaries}
          edges={inspEdges}
          selectedFaceIds={inspSelFaces}
          selectedBoundaryIds={inspSelBoundaries}
          selectedEdgeIds={inspSelEdges}
          pickMode={inspPickMode}
          onPickModeChange={handlePickModeChange}
          showMesh={inspShowMesh}
          onToggleShowMesh={() => setInspShowMesh(v => !v)}
          showLabels={inspShowLabels}
          onToggleShowLabels={() => setInspShowLabels(v => !v)}
          maxBend={inspMaxBend}
          onMaxBendChange={v => {
            setInspMaxBend(v);
            inspMaxBendRef.current = v;
            if (pickerRef.current) pickerRef.current.connectedEdgeMaxBend = v;
          }}
          onClose={() => {
            pickerRef.current?.dispose();
            pickerRef.current = null;
            // Restore IFC mesh visibility before clearing state
            for (const m of inspMeshesRef.current) m.visible = true;
            inspMeshesRef.current = [];
            setInspSession(null);
            setInspLabels([]);
            setInspShowLabels(false);
            useModelStore.getState().showAll();
            needsRenderRef.current = true;
          }}
          onClearSelection={() => {
            setInspSelFaces(new Set());
            setInspSelBoundaries(new Set());
            setInspSelEdges(new Set());
          }}
          onOpen5D={inspSession?.billingKey ? () => {
            const key = inspSession.billingKey!;
            pendingSelectKeyRef.current = key;
            openBillingWindow();
            try {
              const bc2 = new BroadcastChannel(BILLING_CHANNEL);
              bc2.postMessage({ t: "selectEntry", key } satisfies BillingMsg);
              bc2.close();
            } catch { /* ignore */ }
          } : undefined}
        />
      )}

      {/* SmartView: apply hint */}
      {stagedSmartViewId && stagedSmartViewId !== activeSmartViewId && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-card/90 backdrop-blur border border-primary/40 rounded-lg px-4 py-2 text-[11px] text-primary shadow-xl">
            Doppelklick zum Anwenden der SmartView
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          modelId={contextMenu.modelId}
          expressId={contextMenu.expressId}
          inBasket={selectionBasket.has(`${contextMenu.modelId}:${contextMenu.expressId}`)}
          onClose={() => setContextMenu(null)}
          onHide={() => { hideElement(contextMenu.modelId, contextMenu.expressId); setContextMenu(null); }}
          onIsolate={() => { isolateElement(contextMenu.modelId, contextMenu.expressId); setContextMenu(null); }}
          onShowAll={() => { showAll(); setContextMenu(null); }}
          onFit={() => { ctxZoomTo(contextMenu.modelId, [contextMenu.expressId]); setContextMenu(null); }}
          onBasketToggle={() => {
            const key = `${contextMenu.modelId}:${contextMenu.expressId}`;
            if (selectionBasket.has(key)) removeFromBasket(contextMenu.modelId, contextMenu.expressId);
            else addToBasket(contextMenu.modelId, contextMenu.expressId);
            setContextMenu(null);
          }}
          onSelectClass={() => { ctxSelectClass(contextMenu.modelId, contextMenu.expressId); setContextMenu(null); }}
          onSelectStorey={() => { ctxSelectStorey(contextMenu.modelId, contextMenu.expressId); setContextMenu(null); }}
          inBilling={(() => {
            const guid = Object.values(useModelStore.getState().models.get(contextMenu.modelId)?.elementsByType ?? {}).flat()
              .find((e: { expressId: number; guid?: string }) => e.expressId === contextMenu.expressId)?.guid ?? "";
            return !!guid && !!useBillingStore.getState().entries[guid];
          })()}
          currentDegree={(() => {
            const guid = Object.values(useModelStore.getState().models.get(contextMenu.modelId)?.elementsByType ?? {}).flat()
              .find((e: { expressId: number; guid?: string }) => e.expressId === contextMenu.expressId)?.guid ?? "";
            if (!guid) return null;
            const entry = useBillingStore.getState().entries[guid];
            return entry?.stages.length ? entry.stages[entry.stages.length - 1].degree : null;
          })()}
          menuX={contextMenu.x}
          onAdd5D={() => {
            const model = useModelStore.getState().models.get(contextMenu.modelId);
            const guid = Object.values(model?.elementsByType ?? {}).flat()
              .find((e: { expressId: number; guid?: string }) => e.expressId === contextMenu.expressId)?.guid ?? "";
            if (!guid) { setContextMenu(null); return; }
            useBillingStore.getState().addEntry({
              key: guid, guid, expressId: contextMenu.expressId, modelId: contextMenu.modelId,
              elementName: contextMenu.elementName, ifcType: contextMenu.ifcType,
            });
            pendingSelectKeyRef.current = guid;
            openBillingWindow();
            try {
              const bc2 = new BroadcastChannel(BILLING_CHANNEL);
              bc2.postMessage({ t: "selectEntry", key: guid } satisfies BillingMsg);
              bc2.close();
            } catch { /* ignore */ }
            setContextMenu(null);
          }}
          onOpen5D={() => {
            const guid = Object.values(useModelStore.getState().models.get(contextMenu.modelId)?.elementsByType ?? {}).flat()
              .find((e: { expressId: number; guid?: string }) => e.expressId === contextMenu.expressId)?.guid ?? "";
            if (!guid) { setContextMenu(null); return; }
            pendingSelectKeyRef.current = guid;
            openBillingWindow();
            try {
              const bc2 = new BroadcastChannel(BILLING_CHANNEL);
              bc2.postMessage({ t: "selectEntry", key: guid } satisfies BillingMsg);
              bc2.close();
            } catch { /* ignore */ }
            setContextMenu(null);
          }}
          onSet5DDegree={(degree) => {
            const model = useModelStore.getState().models.get(contextMenu.modelId);
            const guid = Object.values(model?.elementsByType ?? {}).flat()
              .find((e: { expressId: number; guid?: string }) => e.expressId === contextMenu.expressId)?.guid ?? "";
            if (!guid) { setContextMenu(null); return; }
            const store = useBillingStore.getState();
            if (!store.entries[guid]) {
              store.addEntry({
                key: guid, guid, expressId: contextMenu.expressId, modelId: contextMenu.modelId,
                elementName: contextMenu.elementName, ifcType: contextMenu.ifcType,
              });
            }
            useBillingStore.getState().addStage(guid, {
              label: `Stand ${new Date().toLocaleDateString("de-DE")}`,
              date: new Date().toISOString().slice(0, 10),
              degree,
              note: "",
            });
            setContextMenu(null);
          }}
          faceNormal={contextMenu.faceNormal}
          hitPoint={contextMenu.hitPoint}
          onStartInspection={() => {
            const guid = Object.values(useModelStore.getState().models.get(contextMenu.modelId)?.elementsByType ?? {}).flat()
              .find((e: { expressId: number; guid?: string }) => e.expressId === contextMenu.expressId)?.guid ?? "";
            startInspectionForElement(
              contextMenu.modelId, contextMenu.expressId,
              contextMenu.elementName,
              guid || null,
              contextMenu.ifcType,
            );
            setContextMenu(null);
          }}
          onSectionFromFace={contextMenu.faceNormal ? () => {
            const N = new THREE.Vector3(...contextMenu.faceNormal!).negate().normalize();
            const planes = useModelStore.getState().sectionPlanes;
            const colors = ["#7aa2f7","#f7768e","#9ece6a","#e0af68","#bb9af7","#2ac3de"];
            useModelStore.getState().addSectionPlane({
              id: uuidv4(),
              name: `Schnitt ${planes.length + 1}`,
              normal: [N.x, N.y, N.z],
              point: contextMenu.hitPoint!,
              enabled: true,
              color: colors[planes.length % colors.length],
            });
            setContextMenu(null);
          } : undefined}
        />
      )}
    </div>
  );
}

// Walk up the parent chain to check if an object is truly rendered
function isWorldVisible(obj: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = obj;
  while (node !== null) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

// ── Context menu component ────────────────────────────────────────────────────

function degreeColor(d: number): string {
  if (d === 0) return "#94a3b8";
  if (d >= 100) return "#22c55e";
  const t = d / 100;
  return `rgb(${Math.round((1 - t * 0.65) * 255)},${Math.round((0.38 + t * 0.58) * 255)},20)`;
}

function ContextMenu({
  x, y, expressId, inBasket, inBilling, currentDegree, menuX, faceNormal,
  onClose, onHide, onIsolate, onShowAll,
  onFit, onBasketToggle, onSelectClass, onSelectStorey, onSectionFromFace,
  onAdd5D, onOpen5D, onSet5DDegree, onStartInspection,
}: {
  x: number; y: number; modelId: string; expressId: number; inBasket: boolean; inBilling: boolean;
  currentDegree: number | null; menuX: number;
  faceNormal?: [number, number, number]; hitPoint?: [number, number, number];
  onClose: () => void; onHide: () => void; onIsolate: () => void;
  onShowAll: () => void; onFit: () => void;
  onBasketToggle: () => void; onSelectClass: () => void; onSelectStorey: () => void;
  onSectionFromFace?: () => void; onAdd5D: () => void; onOpen5D: () => void; onSet5DDegree: (d: number) => void;
  onStartInspection: () => void;
}) {
  const [subOpen, setSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [subStyle, setSubStyle] = useState<React.CSSProperties>({});

  // Clamp main menu within container after first paint
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const parent = el.parentElement;
    const cw = parent?.offsetWidth ?? window.innerWidth;
    const ch = parent?.offsetHeight ?? window.innerHeight;
    setPos({
      left: x + el.offsetWidth  > cw ? Math.max(0, cw - el.offsetWidth)  : x,
      top:  y + el.offsetHeight > ch ? Math.max(0, ch - el.offsetHeight) : y,
    });
  }, [x, y]);

  // Clamp submenu position (horizontal flip + vertical clamp) after it renders
  useLayoutEffect(() => {
    if (!subOpen) { setSubStyle({}); return; }
    const sub = subRef.current;
    const menu = menuRef.current;
    if (!sub || !menu) return;
    const container = menu.parentElement;
    const cw = container?.offsetWidth ?? window.innerWidth;
    const ch = container?.offsetHeight ?? window.innerHeight;

    // Horizontal: prefer right side, flip left if not enough space
    const goLeft = pos.left + menu.offsetWidth + sub.offsetWidth > cw && pos.left >= sub.offsetWidth;

    // Vertical: find submenu's top relative to container using getBoundingClientRect
    const subRect = sub.getBoundingClientRect();
    const containerRect = container
      ? container.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };
    const subTopInContainer = subRect.top - containerRect.top;
    const overflow = subTopInContainer + sub.offsetHeight - ch;
    const vertShift = overflow > 0 ? -Math.min(overflow, subTopInContainer) : 0;

    setSubStyle({
      top: vertShift,
      ...(goLeft
        ? { right: "100%", left: "auto", marginRight: 2, marginLeft: 0 }
        : { left: "100%", right: "auto", marginLeft: 2, marginRight: 0 }),
    });
  }, [subOpen, pos]);

  const openSub  = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setSubOpen(true);
  }, []);
  const closeSub = useCallback(() => {
    closeTimer.current = setTimeout(() => setSubOpen(false), 120);
  }, []);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("click", handler, { once: true });
    return () => window.removeEventListener("click", handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-popover border border-border rounded-md shadow-xl text-xs min-w-[190px] py-1"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-muted-foreground/60 text-[10px] border-b border-border font-mono mb-1">
        #{expressId}
      </div>
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onFit}>
        Zoom to
      </button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onIsolate}>
        Isolieren
      </button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onHide}>
        Ausblenden
      </button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onShowAll}>
        Alles einblenden
      </button>
      <div className="border-t border-border my-1" />
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onBasketToggle}>
        {inBasket ? "Aus Auswahlkorb entfernen" : "Zum Auswahlkorb hinzufügen"}
      </button>

      <div className="border-t border-border my-1" />
      <button
        className={cn("w-full text-left px-3 py-1.5 hover:bg-muted/60", inBilling ? "text-primary font-medium" : "text-foreground")}
        onClick={inBilling ? onOpen5D : onAdd5D}
      >
        {inBilling ? "5D-Eintrag öffnen" : "In 5D aufnehmen"}
      </button>
      {inBilling && (
        <div className="relative" onMouseEnter={openSub} onMouseLeave={closeSub}>
          <button
            className={cn(
              "w-full text-left px-3 py-1.5 hover:bg-muted/60 flex items-center gap-1 text-foreground",
              subOpen && "bg-muted/60"
            )}
          >
            <span className="flex-1">Fertigstellungsgrad</span>
            {currentDegree !== null && (
              <span className="text-[10px] font-mono px-1 rounded" style={{ color: degreeColor(currentDegree) }}>
                {currentDegree}%
              </span>
            )}
            <svg width="8" height="8" viewBox="0 0 8 8" className="text-muted-foreground shrink-0">
              <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {subOpen && (
            <div ref={subRef} className="absolute bg-popover border border-border rounded-md shadow-xl py-1 z-[60] w-36" style={subStyle} onMouseEnter={openSub} onMouseLeave={closeSub}>
              <div className="px-2.5 py-1 text-[10px] text-muted-foreground/70 border-b border-border mb-0.5 font-medium">Fertigstellungsgrad</div>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((d) => (
                <button key={d} className={cn("w-full text-left px-2.5 py-1 flex items-center gap-2 hover:bg-muted/60 transition-colors", currentDegree === d ? "bg-muted/80 font-semibold" : "text-foreground")}
                  onClick={(e) => { e.stopPropagation(); onSet5DDegree(d); }}>
                  <span className="w-3 h-3 rounded-full shrink-0 border border-white/10" style={{ backgroundColor: degreeColor(d) }} />
                  <span className="font-mono text-xs flex-1">{d}%</span>
                  {d === 100 && <span className="text-green-500 text-[10px]">✓</span>}
                  {currentDegree === d && d !== 100 && <span className="text-primary text-[10px]">●</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onSelectClass}>
        Alle Elemente dieser Klasse wählen
      </button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onSelectStorey}>
        Gleiches Geschoss wählen
      </button>
      {onSectionFromFace && faceNormal && (
        <>
          <div className="border-t border-border my-1" />
          <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onSectionFromFace}>
            Schnitt auf dieser Fläche
          </button>
        </>
      )}
      <div className="border-t border-border my-1" />
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onStartInspection}>
        Geometrie-Inspektor starten
      </button>
    </div>
  );
}
