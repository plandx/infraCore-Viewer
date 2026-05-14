import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FlipHorizontal2, X } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import type { SpatialNode } from "../types/ifc";
import { v4 as uuidv4 } from "uuid";

interface Props {
  onElementClick: (modelId: string, expressId: number) => void;
}

interface MeasureLabel {
  x: number;
  y: number;
  text: string;
}

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

  // Section plane 3D visuals
  const sectionGroupRef = useRef<THREE.Group | null>(null);
  const sectionHandleRef = useRef<THREE.Mesh | null>(null);
  const sectionPlaneMeshRef = useRef<THREE.Mesh | null>(null);
  const sectionArrowRef = useRef<THREE.ArrowHelper | null>(null);

  // Handle drag state
  const isDraggingHandleRef = useRef(false);
  const dragViewPlaneRef = useRef<THREE.Plane | null>(null);
  const dragStartIntersectRef = useRef<THREE.Vector3 | null>(null);
  const dragStartClipPointRef = useRef<THREE.Vector3 | null>(null);
  const wasDraggingRef = useRef(false);

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

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; modelId: string; expressId: number;
  } | null>(null);

  const models = useModelStore((s) => s.models);
  const settings = useModelStore((s) => s.settings);
  const activeTool = useModelStore((s) => s.activeTool);
  const hiddenElements = useModelStore((s) => s.hiddenElements);
  const isolatedElements = useModelStore((s) => s.isolatedElements);
  const selectedElement = useModelStore((s) => s.selectedElement);
  const addMeasurement = useModelStore((s) => s.addMeasurement);
  const clearMeasurements = useModelStore((s) => s.clearMeasurements);
  const hideElement = useModelStore((s) => s.hideElement);
  const isolateElement = useModelStore((s) => s.isolateElement);
  const showAll = useModelStore((s) => s.showAll);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const stagedSmartViewId = useModelStore((s) => s.stagedSmartViewId);
  const activeSmartViewId = useModelStore((s) => s.activeSmartViewId);
  const applySmartView = useModelStore((s) => s.applySmartView);
  const selectionBasket = useModelStore((s) => s.selectionBasket);
  const basketMode = useModelStore((s) => s.basketMode);
  const addToBasket = useModelStore((s) => s.addToBasket);
  const removeFromBasket = useModelStore((s) => s.removeFromBasket);
  const setBasket = useModelStore((s) => s.setBasket);

  // Track color-override materials for disposal
  const colorMaterialsRef = useRef<THREE.Material[]>([]);

  // Basket material overrides: stores original material per mesh for restore
  const basketMatsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b26");
    sceneRef.current = scene;

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
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(200, 400, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -5000;
    sun.shadow.camera.right = sun.shadow.camera.top = 5000;
    sun.shadow.camera.far = 500_000;
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

    // Render loop
    let running = true;
    const animate = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(animate);
      controls.update();
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

      renderer.render(scene, isOrtho ? ortho : camera);
    };
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const a = w / h;
      const s = orthoSize;
      ortho.left = -s * a; ortho.right = s * a;
      ortho.top = s; ortho.bottom = -s;
      ortho.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clip plane renderer update ────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.localClippingEnabled = true;
    if (!settings.clipPlanes) {
      renderer.clippingPlanes = [];
      return;
    }
    const N = new THREE.Vector3(...settings.clipNormal).normalize();
    const P = new THREE.Vector3(...settings.clipPoint);
    const plane = new THREE.Plane(N, -N.dot(P));
    renderer.clippingPlanes = [plane];
  }, [settings.clipPlanes, settings.clipNormal, settings.clipPoint]);

  // ── Section plane 3D visuals ──────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old group
    if (sectionGroupRef.current) {
      scene.remove(sectionGroupRef.current);
      sectionGroupRef.current = null;
      sectionHandleRef.current = null;
      sectionPlaneMeshRef.current = null;
      sectionArrowRef.current = null;
    }
    if (!settings.clipPlanes) return;

    // Compute scene scale for sizing visuals
    let sceneMaxDim = 50;
    useModelStore.getState().models.forEach((m) => {
      if (!m.boundingBox.isEmpty()) {
        const sz = new THREE.Vector3();
        m.boundingBox.getSize(sz);
        sceneMaxDim = Math.max(sceneMaxDim, sz.x, sz.y, sz.z);
      }
    });

    const N = new THREE.Vector3(...settings.clipNormal).normalize();
    const P = new THREE.Vector3(...settings.clipPoint);

    const group = new THREE.Group();
    group.name = "__sectionGroup";

    // Large translucent disc
    const planeSize = sceneMaxDim * 4;
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x7aa2f7, opacity: 0.10, transparent: true,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize, 1, 1), planeMat);
    planeMesh.renderOrder = 1;
    planeMesh.userData.isSectionVisual = true;
    // Orient plane geometry so its +Z axis points along N
    const defaultN = new THREE.Vector3(0, 0, 1);
    if (Math.abs(N.dot(defaultN)) < 0.9999) {
      planeMesh.quaternion.setFromUnitVectors(defaultN, N);
    } else if (N.z < 0) {
      planeMesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }
    planeMesh.position.copy(P);
    group.add(planeMesh);
    sectionPlaneMeshRef.current = planeMesh;

    // Grid lines on the plane
    const gridMat = new THREE.LineBasicMaterial({ color: 0x7aa2f7, opacity: 0.20, transparent: true });
    const gridGeo = new THREE.BufferGeometry();
    const step = planeSize / 8;
    const pts: number[] = [];
    for (let i = -4; i <= 4; i++) {
      pts.push(-planeSize / 2, i * step, 0,  planeSize / 2, i * step, 0);
      pts.push(i * step, -planeSize / 2, 0,  i * step, planeSize / 2, 0);
    }
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const gridLines = new THREE.LineSegments(gridGeo, gridMat);
    gridLines.quaternion.copy(planeMesh.quaternion);
    gridLines.position.copy(P);
    gridLines.userData.isSectionVisual = true;
    group.add(gridLines);

    // Perimeter border
    const borderPts = [
      new THREE.Vector3(-planeSize / 2, -planeSize / 2, 0),
      new THREE.Vector3( planeSize / 2, -planeSize / 2, 0),
      new THREE.Vector3( planeSize / 2,  planeSize / 2, 0),
      new THREE.Vector3(-planeSize / 2,  planeSize / 2, 0),
      new THREE.Vector3(-planeSize / 2, -planeSize / 2, 0),
    ];
    const border = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(borderPts),
      new THREE.LineBasicMaterial({ color: 0x7aa2f7, opacity: 0.50, transparent: true })
    );
    border.quaternion.copy(planeMesh.quaternion);
    border.position.copy(P);
    border.userData.isSectionVisual = true;
    group.add(border);

    // Direction arrow
    const arrowLen = Math.max(2, sceneMaxDim * 0.10);
    const headLen  = arrowLen * 0.28;
    const headW    = arrowLen * 0.14;
    const arrow = new THREE.ArrowHelper(N, P.clone().addScaledVector(N, 0.05), arrowLen, 0xffffff, headLen, headW);
    (arrow.line.material as THREE.LineBasicMaterial).color.set(0x7aa2f7);
    (arrow.cone.material as THREE.MeshBasicMaterial).color.set(0x7aa2f7);
    arrow.userData.isSectionVisual = true;
    group.add(arrow);
    sectionArrowRef.current = arrow;

    // Drag handle sphere — sits exactly on the clip plane, never clipped
    const handleR = Math.max(0.2, sceneMaxDim * 0.009);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x7aa2f7, roughness: 0.2, metalness: 0.6, emissive: 0x3050a0, emissiveIntensity: 0.3,
    });
    const handle = new THREE.Mesh(new THREE.SphereGeometry(handleR, 24, 24), handleMat);
    handle.position.copy(P);
    // Disable global clipping planes for this mesh so it is always fully visible
    handle.onBeforeRender = (rend) => { rend.clippingPlanes = []; };
    handle.onAfterRender  = (rend) => {
      const s = useModelStore.getState().settings;
      if (!s.clipPlanes) return;
      const n = new THREE.Vector3(...s.clipNormal).normalize();
      const p = new THREE.Vector3(...s.clipPoint);
      rend.clippingPlanes = [new THREE.Plane(n, -n.dot(p))];
    };
    handle.userData.isSectionHandle = true;
    handle.userData.isSectionVisual = true;
    handle.renderOrder = 10;
    group.add(handle);
    sectionHandleRef.current = handle;

    scene.add(group);
    sectionGroupRef.current = group;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.clipPlanes, settings.clipNormal]);

  // ── Section visuals position sync ────────────────────────────────────────
  const updateSectionPositions = useCallback((
    N: THREE.Vector3, P: THREE.Vector3
  ) => {
    const planeMesh = sectionPlaneMeshRef.current;
    const handle    = sectionHandleRef.current;
    const arrow     = sectionArrowRef.current;
    const group     = sectionGroupRef.current;
    if (!group) return;

    // Reorient plane + grid + border
    const defaultN = new THREE.Vector3(0, 0, 1);
    let q = new THREE.Quaternion();
    if (Math.abs(N.dot(defaultN)) < 0.9999) {
      q.setFromUnitVectors(defaultN, N);
    } else if (N.z < 0) {
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }

    group.children.forEach((child) => {
      if (child === handle || child === arrow) return;
      if (child.userData.isSectionVisual) {
        (child as THREE.Object3D).quaternion.copy(q);
        (child as THREE.Object3D).position.copy(P);
      }
    });

    if (planeMesh) planeMesh.position.copy(P);

    if (arrow) {
      arrow.position.copy(P).addScaledVector(N, 0.05);
      arrow.setDirection(N);
    }

    if (handle) {
      handle.position.copy(P);
    }

    // Update screen position for overlay
    updateHandleScreenPos();
  }, []);

  const updateHandleScreenPos = useCallback(() => {}, []);

  useEffect(() => {
    if (!settings.clipPlanes) return;
    const N = new THREE.Vector3(...settings.clipNormal).normalize();
    const P = new THREE.Vector3(...settings.clipPoint);
    updateSectionPositions(N, P);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.clipPoint, settings.clipNormal, settings.clipPlanes]);

  // ── Grid / axes visibility ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const grid = scene.getObjectByName("__grid");
    if (grid) grid.visible = settings.grid ?? true;
    const axes = scene.getObjectByName("__axes");
    if (axes) axes.visible = settings.axes ?? true;
  }, [settings.grid, settings.axes]);

  // ── Scene background follows theme ────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.background = new THREE.Color(
      settings.theme === "light" ? "#e8edf2" : (settings.background ?? "#1a1b26")
    );
  }, [settings.theme, settings.background]);

  // ── Sync models into scene ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const storeIds = new Set(models.keys());
    for (const id of Array.from(sceneModelIds.current)) {
      if (!storeIds.has(id)) {
        const obj = scene.getObjectByName(`model:${id}`);
        if (obj) scene.remove(obj);
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
        // Add edge overlays to every mesh in this model
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x000000, transparent: true, opacity: 0.18,
        });
        const edgesVisible = useModelStore.getState().settings.edges;
        model.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isHighlight && !child.userData.isEdge) {
            const edgesGeo = new THREE.EdgesGeometry(child.geometry, 15);
            const lines = new THREE.LineSegments(edgesGeo, edgeMat.clone());
            lines.userData.isEdge = true;
            lines.visible = edgesVisible;
            child.add(lines);
          }
        });
        requestAnimationFrame(() => fitAllLoaded());
      }

      // Model-level visibility
      const sceneObj = scene.getObjectByName(`model:${model.id}`);
      if (sceneObj) sceneObj.visible = model.visible;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // ── Edge visibility toggle ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.traverse((obj) => {
      if (obj.userData.isEdge) obj.visible = settings.edges;
    });
  }, [settings.edges]);

  // ── Element-level visibility (hide/isolate) ───────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const state = useModelStore.getState();

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData.expressId == null) return;
      if (!obj.userData.expressId) return; // skip non-element meshes (highlight clones etc.)

      let modelId = "";
      let node: THREE.Object3D | null = obj;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }
      if (!modelId) return;

      const model = state.models.get(modelId);
      if (!model || !model.visible) return;

      const key = `${modelId}:${obj.userData.expressId}`;
      if (state.basketMode === "isolate" && state.selectionBasket.size > 0) {
        obj.visible = state.selectionBasket.has(key);
      } else if (state.isolatedElements !== null) {
        obj.visible = state.isolatedElements.has(key);
      } else {
        obj.visible = !state.hiddenElements.has(key);
      }
    });
  }, [hiddenElements, isolatedElements, models, selectionBasket, basketMode]);

  // ── Color group override ──────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Restore original materials and dispose overrides
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.originalMaterial !== undefined) {
        obj.material = obj.userData.originalMaterial as THREE.Material;
        obj.userData.originalMaterial = undefined;
      }
    });
    colorMaterialsRef.current.forEach((m) => m.dispose());
    colorMaterialsRef.current = [];

    if (!colorGroups || colorGroups.length === 0) return;

    const colorMap = new Map<string, string>();
    colorGroups.forEach((group) => {
      if (!group.visible) return;
      group.entries.forEach(({ modelId, expressId }) => {
        colorMap.set(`${modelId}:${expressId}`, group.color);
      });
    });

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData.expressId == null) return;
      if (obj.userData.isHighlight || obj.userData.isSectionVisual) return;

      let modelId = "";
      let node: THREE.Object3D | null = obj;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }
      if (!modelId) return;

      const key = `${modelId}:${obj.userData.expressId}`;
      const color = colorMap.get(key);
      if (color === undefined) return;

      const newMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
      obj.userData.originalMaterial = obj.material;
      obj.material = newMat;
      colorMaterialsRef.current.push(newMat);
    });
  }, [colorGroups]);

  // ── Basket visual override (highlight / ghost) ──────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Restore all previously overridden materials
    basketMatsRef.current.forEach((orig, mesh) => { mesh.material = orig as THREE.Material; });
    basketMatsRef.current.clear();

    if (!basketMode || basketMode === "isolate" || selectionBasket.size === 0) return;

    const createdMats: THREE.Material[] = [];

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData.isHighlight || obj.userData.isSectionVisual) return;
      if (obj.userData.expressId == null) return;

      let modelId = "";
      let node: THREE.Object3D | null = obj;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }
      if (!modelId) return;

      const key = `${modelId}:${obj.userData.expressId}`;
      const inBasket = selectionBasket.has(key);
      const orig = obj.material as THREE.Material;

      if (basketMode === "highlight" && inBasket) {
        // Bright amber material — fully replaces original so it's clearly visible
        const hlMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: new THREE.Color(0xf59e0b),
          emissiveIntensity: 0.5,
          roughness: 0.35,
          metalness: 0.1,
        });
        basketMatsRef.current.set(obj, orig);
        obj.material = hlMat;
        createdMats.push(hlMat);
      } else if (basketMode === "ghost" && !inBasket) {
        const ghost = orig.clone() as THREE.MeshLambertMaterial;
        ghost.transparent = true;
        ghost.opacity = 0.10;
        ghost.needsUpdate = true;
        basketMatsRef.current.set(obj, orig);
        obj.material = ghost;
        createdMats.push(ghost);
      }
    });

    return () => {
      basketMatsRef.current.forEach((orig, mesh) => { mesh.material = orig as THREE.Material; });
      basketMatsRef.current.clear();
      createdMats.forEach((m) => m.dispose());
    };
  }, [selectionBasket, basketMode, models]);

  // ── Highlight selected element ────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous highlight meshes
    for (const h of highlightRef.current) {
      scene.remove(h);
      if (Array.isArray(h.material)) h.material.forEach((m) => m.dispose());
      else h.material.dispose();
    }
    highlightRef.current = [];

    if (!selectedElement) return;

    const key = `${selectedElement.modelId}:${selectedElement.expressId}`;
    const isHidden = hiddenElements.has(key);
    const isExcludedByIsolation = isolatedElements !== null && !isolatedElements.has(key);
    if (isHidden || isExcludedByIsolation) return;

    const hlMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xf59e0b),
      emissive: new THREE.Color(0xf59e0b),
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData.isHighlight) return;
      if (obj.userData.expressId !== selectedElement.expressId) return;

      // Verify it belongs to the correct model
      let node: THREE.Object3D | null = obj;
      let belongs = false;
      while (node) {
        if (node.userData.modelId === selectedElement.modelId) { belongs = true; break; }
        node = node.parent;
      }
      if (!belongs) return;

      // Build highlight mesh with correct world-space transform
      const hl = new THREE.Mesh(obj.geometry, hlMat);
      obj.updateWorldMatrix(true, false);
      hl.matrixAutoUpdate = false;
      hl.matrix.copy(obj.matrixWorld);
      hl.renderOrder = 999;
      hl.userData = { isHighlight: true };
      scene.add(hl);
      highlightRef.current.push(hl);
    });
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
  }, [fitAllLoaded, fitCameraToBox, ctxZoomTo, setPresetView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Measure label update (on controls change) ─────────────────────────────
  const updateMeasureLabels = useCallback(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer || measureMidpointsRef.current.length === 0) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const labels: MeasureLabel[] = measureMidpointsRef.current.map(({ a, b }) => {
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const proj = mid.clone().project(camera);
      const x = ((proj.x + 1) / 2) * rect.width;
      const y = (-(proj.y - 1) / 2) * rect.height;
      const dist = a.distanceTo(b);
      const text = dist >= 1 ? `${dist.toFixed(3)} m` : `${(dist * 100).toFixed(1)} cm`;
      return { x, y, text };
    });
    setMeasureLabels(labels);
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onChange = () => { updateMeasureLabels(); updateHandleScreenPos(); };
    controls.addEventListener("change", onChange);
    return () => controls.removeEventListener("change", onChange);
  }, [updateMeasureLabels, updateHandleScreenPos]);

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

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      const activeCamera = useModelStore.getState().settings.orthographic
        ? orthoCameraRef.current ?? camera
        : camera;
      raycaster.setFromCamera(mouse, activeCamera);

      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh &&
          obj.userData.expressId != null &&
          !obj.userData.isHighlight &&
          !obj.userData.isSectionVisual &&
          isWorldVisible(obj)
        ) {
          meshes.push(obj);
        }
      });

      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;

      const hit = hits[0];
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

    const hit = raycastPoint(e);

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

        measureMidpointsRef.current.push({ a, b });
        pendingPointRef.current = null;
        setMeasurePending(false);

        const dist = a.distanceTo(b);
        addMeasurement({ id: uuidv4(), a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z }, distance: dist });
        updateMeasureLabels();
      }
      return;
    }

    // Section tool: click face → position clip plane there, normal = face normal
    if (activeTool === "section") {
      if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
      if (hit?.faceNormal) {
        const N = hit.faceNormal.clone().negate().normalize();
        const P = hit.point;
        useModelStore.getState().updateSettings({
          clipNormal: [N.x, N.y, N.z],
          clipPoint:  [P.x, P.y, P.z],
          clipPlanes: true,
        });
      }
      return;
    }

    if (!hit) return;

    // Select tool: store update triggers the highlight useEffect
    onElementClick(hit.modelId, hit.expressId);
  }, [activeTool, raycastPoint, addSphere, addMeasurement, updateMeasureLabels, onElementClick]);

  // ── Section handle drag ───────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current  = { x: e.clientX, y: e.clientY };
    clickSuppressedRef.current = false;

    const handle   = sectionHandleRef.current;
    const renderer = rendererRef.current;
    const camera   = cameraRef.current;
    if (!handle || !renderer || !camera || !settings.clipPlanes) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      -((e.clientY - rect.top)  / rect.height) *  2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    const activeCamera = useModelStore.getState().settings.orthographic
      ? orthoCameraRef.current ?? camera : camera;
    raycaster.setFromCamera(mouse, activeCamera);

    const hits = raycaster.intersectObject(handle, false);
    if (!hits.length) return;

    // Build a "view plane" at the handle position for dragging
    const camDir = new THREE.Vector3();
    activeCamera.getWorldDirection(camDir);
    const viewPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, handle.position);
    const startIntersect = new THREE.Vector3();
    raycaster.ray.intersectPlane(viewPlane, startIntersect);

    isDraggingHandleRef.current  = true;
    wasDraggingRef.current       = false;
    dragViewPlaneRef.current     = viewPlane;
    dragStartIntersectRef.current = startIntersect.clone();
    dragStartClipPointRef.current = new THREE.Vector3(...useModelStore.getState().settings.clipPoint);

    if (controlsRef.current) controlsRef.current.enabled = false;
    e.stopPropagation();
  }, [settings.clipPlanes]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Detect significant drag movement to suppress the subsequent click
    if (!clickSuppressedRef.current && mouseDownPosRef.current) {
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      if (dx * dx + dy * dy > 25) clickSuppressedRef.current = true; // 5 px threshold
    }
    if (!isDraggingHandleRef.current) return;
    const renderer = rendererRef.current;
    const camera   = cameraRef.current;
    if (!renderer || !camera) return;

    wasDraggingRef.current = true;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      -((e.clientY - rect.top)  / rect.height) *  2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    const activeCamera = useModelStore.getState().settings.orthographic
      ? orthoCameraRef.current ?? camera : camera;
    raycaster.setFromCamera(mouse, activeCamera);

    const curIntersect = new THREE.Vector3();
    if (!dragViewPlaneRef.current) return;
    raycaster.ray.intersectPlane(dragViewPlaneRef.current, curIntersect);

    const st = useModelStore.getState().settings;
    const N = new THREE.Vector3(...st.clipNormal).normalize();
    const delta = curIntersect.clone().sub(dragStartIntersectRef.current!);
    const travel = delta.dot(N);  // project onto clip normal

    const newP = dragStartClipPointRef.current!.clone().addScaledVector(N, travel);

    // Directly update 3D visuals for smooth dragging (skip React state)
    updateSectionPositions(N, newP);

    // Update renderer clipping plane directly
    const rend = rendererRef.current;
    if (rend && rend.clippingPlanes.length > 0) {
      rend.clippingPlanes[0].set(N, -N.dot(newP));
    }
  }, [updateSectionPositions]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingHandleRef.current) return;
    isDraggingHandleRef.current = false;
    if (controlsRef.current) controlsRef.current.enabled = true;

    // Persist final position to store
    const handle = sectionHandleRef.current;
    if (handle && wasDraggingRef.current) {
      const P = handle.position;
      useModelStore.getState().updateSettings({
        clipPoint: [P.x, P.y, P.z],
      });
    }
    e.stopPropagation();
  }, []);

  // ── Context menu action helpers ───────────────────────────────────────────

  const ctxZoomTo = useCallback((modelId: string, expressIds: number[]) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const idSet = new Set(expressIds);
    const box = new THREE.Box3();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !idSet.has(obj.userData.expressId)) return;
      if (obj.userData.isHighlight || obj.userData.isEdge) return;
      let node: THREE.Object3D | null = obj;
      while (node) { if (node.userData.modelId === modelId) { box.expandByObject(obj); break; } node = node.parent; }
    });
    if (!box.isEmpty()) fitCameraToBox(box);
  }, [fitCameraToBox]);

  // ── Double-click: zoom to element or apply staged SmartView ─────────────
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
    setContextMenu({
      x: e.clientX - containerRect.left,
      y: e.clientY - containerRect.top,
      modelId: hit.modelId,
      expressId: hit.expressId,
    });
  }, [raycastPoint]);

  // ── Export helpers ────────────────────────────────────────────────────────
  const exportGLTF = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const exporter = new GLTFExporter();
    const meshes: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.expressId != null && !obj.userData.isHighlight) {
        meshes.push(obj);
      }
    });
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
  const cursor = activeTool === "measure" ? "crosshair"
               : activeTool === "section" ? "cell"
               : "default";

  return (
    <div className="w-full h-full relative">
      <div
        ref={mountRef}
        className="w-full h-full"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor: isDraggingHandleRef.current ? "grabbing" : cursor }}
        data-viewport="main"
      />

      {/* Tool hints */}
      {(activeTool === "measure" || activeTool === "section") && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-card/90 backdrop-blur border border-border rounded-full px-4 py-1.5 text-xs text-foreground">
            {activeTool === "measure"
              ? (measurePending ? "Zweiten Punkt klicken · Esc = Abbrechen" : "Ersten Punkt klicken")
              : "Fläche anklicken → Schnittebene positionieren"}
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

      {/* Section plane overlay — top center */}
      {settings.clipPlanes && (
        <SectionOverlay
          onFlip={() => {
            const st = useModelStore.getState().settings;
            const N = new THREE.Vector3(...st.clipNormal).negate();
            useModelStore.getState().updateSettings({ clipNormal: [N.x, N.y, N.z] });
          }}
          onClose={() => {
            useModelStore.getState().updateSettings({ clipPlanes: false });
            useModelStore.getState().setActiveTool("select");
          }}
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

// ── Section overlay ───────────────────────────────────────────────────────────

function SectionOverlay({ onFlip, onClose }: { onFlip: () => void; onClose: () => void }) {
  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 bg-card/95 backdrop-blur border border-border rounded-lg shadow-xl px-2 py-1.5">
        <span className="text-[10px] text-muted-foreground font-medium pr-1.5 border-r border-border mr-0.5">
          Schnitt
        </span>
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] hover:bg-muted/60 text-foreground transition-colors"
          title="Schnittrichtung umkehren"
          onClick={onFlip}
        >
          <FlipHorizontal2 size={12} />
          <span>Spiegeln</span>
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          className="p-1 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-colors"
          title="Schnitt deaktivieren"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Context menu component ────────────────────────────────────────────────────

function ContextMenu({
  x, y, modelId, expressId, inBasket, onClose, onHide, onIsolate, onShowAll,
  onFit, onBasketToggle, onSelectClass, onSelectStorey,
}: {
  x: number; y: number; modelId: string; expressId: number; inBasket: boolean;
  onClose: () => void; onHide: () => void; onIsolate: () => void;
  onShowAll: () => void; onFit: () => void;
  onBasketToggle: () => void; onSelectClass: () => void; onSelectStorey: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("click", handler, { once: true });
    return () => window.removeEventListener("click", handler);
  }, [onClose]);

  return (
    <div
      className="absolute z-50 bg-popover border border-border rounded-md shadow-xl text-xs min-w-[190px] py-1"
      style={{ left: x, top: y }}
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
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onSelectClass}>
        Alle Elemente dieser Klasse wählen
      </button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-muted/60 text-foreground" onClick={onSelectStorey}>
        Gleiches Geschoss wählen
      </button>
    </div>
  );
}
