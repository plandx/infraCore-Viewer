import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useModelStore } from "../store/modelStore";

interface Props {
  onElementClick: (modelId: string, expressId: number) => void;
}

export function ViewportContainer({ onElementClick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef<number>(0);
  const highlightRef = useRef<THREE.Mesh | null>(null);
  // Track which model IDs are already in the scene to avoid double-add
  const sceneModelIds = useRef<Set<string>>(new Set());

  const models = useModelStore((s) => s.models);
  const settings = useModelStore((s) => s.settings);

  // ── Init scene ───────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true, // essential for 20 km scenes
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b26"); // tokyo-storm
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.01, 500_000);
    camera.position.set(50, 50, 100);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
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
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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

  // ── Sync scene background ─────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const grid = scene.getObjectByName("__grid");
    if (grid) grid.visible = settings.grid ?? true;
    const axes = scene.getObjectByName("__axes");
    if (axes) axes.visible = settings.axes ?? true;
  }, [settings.grid, settings.axes]);

  // ── Sync models into scene (FIXED multi-model logic) ─────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove groups that are no longer in the store
    const storeIds = new Set(models.keys());
    for (const id of Array.from(sceneModelIds.current)) {
      if (!storeIds.has(id)) {
        const obj = scene.getObjectByName(`model:${id}`);
        if (obj) scene.remove(obj);
        sceneModelIds.current.delete(id);
      }
    }

    // Add / replace / update models
    models.forEach((model) => {
      const existing = scene.getObjectByName(`model:${model.id}`);

      if (!existing) {
        // ID not yet in scene — add (works for placeholder AND real mesh)
        model.mesh.name = `model:${model.id}`;
        model.mesh.userData.modelId = model.id;
        scene.add(model.mesh);
        sceneModelIds.current.add(model.id);
      } else if (existing !== model.mesh) {
        // ID already in scene but mesh object changed (placeholder → real geometry)
        scene.remove(existing);
        model.mesh.name = `model:${model.id}`;
        model.mesh.userData.modelId = model.id;
        scene.add(model.mesh);
      }

      // Fit camera whenever a model finishes loading
      if (model.status === "loaded" && existing !== model.mesh) {
        requestAnimationFrame(() => fitAllLoaded());
      }

      // Always sync visibility
      const sceneObj = scene.getObjectByName(`model:${model.id}`);
      if (sceneObj) sceneObj.visible = model.visible;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

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
      new THREE.Vector3(1, 0.7, 1).normalize(),
      distance
    );
    controls.target.copy(center);
    camera.near = Math.max(0.01, distance * 0.0001);
    camera.far = distance * 250;
    camera.updateProjectionMatrix();
    controls.update();
  }, []);

  const fitAllLoaded = useCallback(() => {
    const allBox = new THREE.Box3();
    useModelStore.getState().models.forEach((m) => {
      if (m.visible && !m.boundingBox.isEmpty()) allBox.union(m.boundingBox);
    });
    if (!allBox.isEmpty()) fitCameraToBox(allBox);
  }, [fitCameraToBox]);

  // Global events
  useEffect(() => {
    const onFitAll = () => fitAllLoaded();
    const onFitTo = (e: Event) => {
      const box = (e as CustomEvent<THREE.Box3>).detail;
      if (box) fitCameraToBox(box);
    };
    window.addEventListener("viewer:fitAll", onFitAll);
    window.addEventListener("viewer:fitTo", onFitTo);
    return () => {
      window.removeEventListener("viewer:fitAll", onFitAll);
      window.removeEventListener("viewer:fitTo", onFitTo);
    };
  }, [fitAllLoaded, fitCameraToBox]);

  // ── Raycasting ───────────────────────────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Collect all selectable meshes
    const meshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.expressId != null) meshes.push(obj);
    });

    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return;

    const hitMesh = hits[0].object as THREE.Mesh;
    const expressId = hitMesh.userData.expressId as number;

    // Find owning model by walking up the parent chain
    let modelId = "";
    let node: THREE.Object3D | null = hitMesh;
    while (node) {
      if (node.userData.modelId) { modelId = node.userData.modelId as string; break; }
      node = node.parent;
    }

    if (!modelId) return;

    onElementClick(modelId, expressId);

    // Highlight
    if (highlightRef.current) scene.remove(highlightRef.current);
    const hl = hitMesh.clone();
    (hl.material as THREE.MeshLambertMaterial) = new THREE.MeshLambertMaterial({
      color: 0x7aa2f7,
      transparent: true, opacity: 0.55, depthTest: false,
    });
    hl.renderOrder = 999;
    hl.userData = {};
    scene.add(hl);
    highlightRef.current = hl;
  }, [onElementClick]);

  return (
    <div
      ref={mountRef}
      className="w-full h-full"
      onClick={handleClick}
      style={{ cursor: "crosshair" }}
      data-viewport="main"
    />
  );
}
