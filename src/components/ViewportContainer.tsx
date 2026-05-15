import { useEffect, useRef, useCallback, useState } from "react";
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

  const billingEntries = useBillingStore((s) => s.entries);
  const billingModuleActive = useBillingStore((s) => s.moduleActive);
  const billingVizRef = useRef<BillingVisualizer | null>(null);

  // Track color-override materials for disposal
  const colorMaterialsRef = useRef<THREE.Material[]>([]);

  const basketOutlinesRef = useRef<THREE.LineSegments[]>([]);

  // Basket material overrides: stores original material per mesh for restore
  const basketMatsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());

  // Render-on-demand: only draw when something changed
  const needsRenderRef = useRef(true);

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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b26");
    sceneRef.current = scene;

    billingVizRef.current = new BillingVisualizer(scene);

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

    // Trigger a render whenever the camera moves
    controls.addEventListener("change", () => { needsRenderRef.current = true; });

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

  // ── Section module: sync planes from store ───────────────────────────────
  useEffect(() => {
    sectionModuleRef.current?.syncPlanes(sectionPlanes);
  }, [sectionPlanes]);

  // ── Billing visualizer ────────────────────────────────────────────────────
  useEffect(() => {
    const viz = billingVizRef.current;
    const scene = sceneRef.current;
    if (!viz || !scene) return;
    if (!billingModuleActive) { viz.clear(); needsRenderRef.current = true; return; }

    scene.updateMatrixWorld(true);
    const meshMap = new Map<string, THREE.Mesh[]>();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData.expressId == null) return;
      if (obj.userData.isHighlight || obj.userData.isSectionVisual || obj.userData.isSectionCap || obj.userData.isEdge || obj.userData.isBillingOverlay) return;
      let modelId = "";
      let node: THREE.Object3D | null = obj;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }
      if (!modelId) return;
      const key = `${modelId}:${obj.userData.expressId}`;
      const list = meshMap.get(key) ?? [];
      list.push(obj);
      meshMap.set(key, list);
    });

    viz.update(billingEntries, meshMap);
    needsRenderRef.current = true;
  }, [billingEntries, billingModuleActive]);

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
        // Rebuild section caps so newly loaded geometry gets cut properly
        sectionModuleRef.current?.syncPlanes(useModelStore.getState().sectionPlanes);
      }

      // Model-level visibility
      const sceneObj = scene.getObjectByName(`model:${model.id}`);
      if (sceneObj) sceneObj.visible = model.visible;
    });
    needsRenderRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // ── Edge visibility toggle ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.traverse((obj) => {
      if (obj.userData.isEdge) obj.visible = settings.edges;
    });
    needsRenderRef.current = true;
  }, [settings.edges]);

  // ── Element-level visibility (hide/isolate) ───────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const state = useModelStore.getState();

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData.expressId == null) return;
      if (!obj.userData.expressId) return;

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
        obj.visible = state.selectionBasket.has(key) && !state.hiddenElements.has(key);
      } else if (state.isolatedElements !== null) {
        obj.visible = state.isolatedElements.has(key) && !state.hiddenElements.has(key);
      } else {
        obj.visible = !state.hiddenElements.has(key);
      }
    });
    needsRenderRef.current = true;
    // Rebuild section caps to match new visibility
    sectionModuleRef.current?.invalidateCaps();
  // selectionBasket only matters when basketMode === "isolate"; basketMode covers both
  }, [hiddenElements, isolatedElements, models, basketMode,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      basketMode === "isolate" ? selectionBasket : null]);

  // ── Color group override ──────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const colorMap = new Map<string, { color: string; opacity: number }>();
    if (colorGroups && colorGroups.length > 0) {
      colorGroups.forEach((group) => {
        if (!group.visible) return;
        const opacity = group.opacity ?? 1;
        group.entries.forEach(({ modelId, expressId }) => {
          colorMap.set(`${modelId}:${expressId}`, { color: group.color, opacity });
        });
      });
    }

    const newMats: THREE.Material[] = [];

    // Single traversal: restore previous overrides and apply new colors
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;

      if (obj.userData.originalMaterial !== undefined) {
        obj.material = obj.userData.originalMaterial as THREE.Material;
        obj.userData.originalMaterial = undefined;
      }

      if (colorMap.size === 0 || obj.userData.expressId == null) return;
      if (obj.userData.isHighlight || obj.userData.isSectionVisual || obj.userData.isSectionCap) return;

      let modelId = "";
      let node: THREE.Object3D | null = obj;
      while (node) {
        if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
        node = node.parent;
      }
      if (!modelId) return;

      const entry = colorMap.get(`${modelId}:${obj.userData.expressId}`);
      if (!entry) return;

      const newMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(entry.color),
        transparent: entry.opacity < 1,
        opacity: entry.opacity,
      });
      obj.userData.originalMaterial = obj.material;
      obj.material = newMat;
      newMats.push(newMat);
    });

    colorMaterialsRef.current.forEach((m) => m.dispose());
    colorMaterialsRef.current = newMats;
    needsRenderRef.current = true;
  }, [colorGroups]);

  // ── Basket visuals: outlines + material override (highlight / ghost) ────────
  // Single traversal handles both to avoid two O(n) scene walks per basket change.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Cleanup
    basketOutlinesRef.current.forEach((line) => {
      line.parent?.remove(line);
      (line.material as THREE.Material).dispose();
    });
    basketOutlinesRef.current = [];
    basketMatsRef.current.forEach((orig, mesh) => { mesh.material = orig as THREE.Material; });
    basketMatsRef.current.clear();

    if (selectionBasket.size === 0) return;

    const doMaterials = basketMode && basketMode !== "isolate";
    const createdMats: THREE.Material[] = [];

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData.isHighlight || obj.userData.isSectionVisual || obj.userData.isSectionCap || obj.userData.isEdge || obj.userData.isBasketOutline) return;
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

      // Yellow outline only when highlight mode is active
      if (inBasket && basketMode === "highlight") {
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
      }

      // Material override (highlight / ghost modes only)
      if (doMaterials) {
        const orig = obj.material as THREE.Material;
        if (basketMode === "highlight" && inBasket) {
          const hlMat = new THREE.MeshStandardMaterial({
            color: 0xf59e0b, emissive: new THREE.Color(0xf59e0b),
            emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.1,
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
      }
    });

    return () => {
      basketOutlinesRef.current.forEach((line) => {
        line.parent?.remove(line);
        (line.material as THREE.Material).dispose();
      });
      basketOutlinesRef.current = [];
      basketMatsRef.current.forEach((orig, mesh) => { mesh.material = orig as THREE.Material; });
      basketMatsRef.current.clear();
      createdMats.forEach((m) => m.dispose());
    };
    needsRenderRef.current = true;
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
    controls.addEventListener("change", updateMeasureLabels);
    return () => controls.removeEventListener("change", updateMeasureLabels);
  }, [updateMeasureLabels]);

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
          !obj.userData.isSectionCap &&
          isWorldVisible(obj)
        ) {
          meshes.push(obj);
        }
      });

      const hits = raycaster.intersectObjects(meshes, false);
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
  }, [activeTool, raycastPoint, addSphere, addMeasurement, updateMeasureLabels, onElementClick]);

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

    const idSet = new Set(expressIds);
    const box = new THREE.Box3();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !idSet.has(obj.userData.expressId)) return;
      if (obj.userData.isHighlight || obj.userData.isEdge) return;
      let node: THREE.Object3D | null = obj;
      while (node) { if (node.userData.modelId === modelId) { box.expandByObject(obj); break; } node = node.parent; }
    });
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
               : activeTool === "section" ? "crosshair"
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

      {/* Section panel — top center, lazy: only mounts when active */}
      <SectionPanel />

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
          inBilling={!!useBillingStore.getState().entries[`${contextMenu.modelId}:${contextMenu.expressId}`]}
          onAdd5D={() => {
            const key = `${contextMenu.modelId}:${contextMenu.expressId}`;
            useBillingStore.getState().addEntry({
              key, guid: "", expressId: contextMenu.expressId, modelId: contextMenu.modelId,
              elementName: contextMenu.elementName, ifcType: contextMenu.ifcType,
            });
            openBillingWindow();
            // Tell billing window to select this entry (slight delay for window to open)
            setTimeout(() => {
              try {
                const bc = new BroadcastChannel(BILLING_CHANNEL);
                bc.postMessage({ t: "selectEntry", key } satisfies BillingMsg);
                bc.close();
              } catch { /* ignore */ }
            }, 600);
            setContextMenu(null);
          }}
          faceNormal={contextMenu.faceNormal}
          hitPoint={contextMenu.hitPoint}
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

function ContextMenu({
  x, y, expressId, inBasket, inBilling, faceNormal,
  onClose, onHide, onIsolate, onShowAll,
  onFit, onBasketToggle, onSelectClass, onSelectStorey, onSectionFromFace, onAdd5D,
}: {
  x: number; y: number; modelId: string; expressId: number; inBasket: boolean; inBilling: boolean;
  faceNormal?: [number, number, number]; hitPoint?: [number, number, number];
  onClose: () => void; onHide: () => void; onIsolate: () => void;
  onShowAll: () => void; onFit: () => void;
  onBasketToggle: () => void; onSelectClass: () => void; onSelectStorey: () => void;
  onSectionFromFace?: () => void; onAdd5D: () => void;
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
      <button
        className={`w-full text-left px-3 py-1.5 hover:bg-muted/60 ${inBilling ? "text-primary font-medium" : "text-foreground"}`}
        onClick={onAdd5D}
      >
        {inBilling ? "5D-Eintrag öffnen" : "In 5D aufnehmen"}
      </button>
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
    </div>
  );
}
