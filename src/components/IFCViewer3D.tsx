import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useModelStore } from "../store/modelStore";

interface Props {
  onElementClick: (modelId: string, expressId: number) => void;
}

export default function IFCViewer3D({ onElementClick }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const frameRef = useRef<number>(0);
  const highlightRef = useRef<THREE.Mesh | null>(null);

  const models = useModelStore((s) => s.models);
  const settings = useModelStore((s) => s.settings);

  // ── Bootstrap Three.js scene ──────────────────────────────────────────────
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true, // critical for 20km-range scenes
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(settings.background);
    sceneRef.current = scene;

    // Camera with far plane large enough for 50 km diagonal
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.01,
      500_000
    );
    camera.position.set(50, 50, 100);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI;
    controls.zoomSpeed = 1.5;
    controls.panSpeed = 1.5;
    controlsRef.current = controls;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(100, 200, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 500_000;
    sun.shadow.camera.left = -5000;
    sun.shadow.camera.right = 5000;
    sun.shadow.camera.top = 5000;
    sun.shadow.camera.bottom = -5000;
    scene.add(sun);
    const fill = new THREE.HemisphereLight(0x8888ff, 0x444400, 0.4);
    scene.add(fill);

    // Grid
    const grid = new THREE.GridHelper(10_000, 100, 0x333355, 0x222233);
    grid.name = "grid";
    scene.add(grid);

    // Axes
    const axes = new THREE.AxesHelper(500);
    axes.name = "axes";
    scene.add(axes);

    // Render loop
    function animate() {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frameRef.current);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync scene settings ───────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.background = new THREE.Color(settings.background);
    const grid = scene.getObjectByName("grid");
    if (grid) grid.visible = settings.grid;
    const axes = scene.getObjectByName("axes");
    if (axes) axes.visible = settings.axes;
  }, [settings.background, settings.grid, settings.axes]);

  // ── Sync models into scene ────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove models that no longer exist in the store
    const keepIds = new Set(models.keys());
    scene.children
      .filter((c) => c.userData.modelId && !keepIds.has(c.userData.modelId))
      .forEach((c) => scene.remove(c));

    // Add / update visibility of current models
    models.forEach((model) => {
      let obj = scene.getObjectByProperty(
        "userData",
        model.id
      ) as THREE.Object3D | undefined;

      // Look by name since getObjectByProperty doesn't work on nested userData
      obj = scene.children.find(
        (c) => c.userData.modelId === model.id
      ) as THREE.Object3D | undefined;

      if (!obj) {
        model.mesh.userData.modelId = model.id;
        scene.add(model.mesh);
        obj = model.mesh;

        // Fit camera on first model load
        if (models.size === 1) {
          fitCameraToBox(model.boundingBox);
        }
      }

      if (obj) obj.visible = model.visible;
    });
  }, [models]);

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
    let distance = maxDim / (2 * Math.tan(fov / 2));
    distance *= 1.5;

    const direction = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.target.copy(center);
    camera.far = distance * 200;
    camera.near = distance * 0.0001;
    camera.updateProjectionMatrix();
    controls.update();
  }, []);

  // ── Fit-all button handler (exposed via custom event) ────────────────────
  useEffect(() => {
    const handler = () => {
      const allBox = new THREE.Box3();
      models.forEach((m) => {
        if (m.visible) allBox.union(m.boundingBox);
      });
      if (!allBox.isEmpty()) fitCameraToBox(allBox);
    };
    window.addEventListener("viewer:fitAll", handler);
    return () => window.removeEventListener("viewer:fitAll", handler);
  }, [models, fitCameraToBox]);

  // ── Raycasting for element selection ─────────────────────────────────────
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      if (!renderer || !camera || !scene) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(mouse, camera);

      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.userData.expressId)
          meshes.push(obj);
      });

      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) return;

      const hit = hits[0].object as THREE.Mesh;
      const expressId = hit.userData.expressId as number;

      // Find which model this mesh belongs to
      let modelId = "";
      scene.children.forEach((child) => {
        if (child.userData.modelId && child.getObjectById(hit.id)) {
          modelId = child.userData.modelId as string;
        }
      });

      if (modelId && expressId) {
        onElementClick(modelId, expressId);

        // Highlight
        if (highlightRef.current) {
          scene.remove(highlightRef.current);
        }
        const highlight = hit.clone();
        (highlight.material as THREE.MeshLambertMaterial) =
          new THREE.MeshLambertMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.6,
            depthTest: false,
          });
        highlight.renderOrder = 999;
        scene.add(highlight);
        highlightRef.current = highlight;
      }
    },
    [onElementClick]
  );

  return (
    <div
      ref={canvasRef}
      className="viewer-canvas"
      onClick={handleClick}
      style={{ width: "100%", height: "100%", cursor: "crosshair" }}
    />
  );
}
