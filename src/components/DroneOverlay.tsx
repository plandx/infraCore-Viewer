import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { useModelStore } from "../store/modelStore";
import { cn } from "../lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Target {
  modelId: string;
  expressId: number;
  screenX: number;
  screenY: number;
  dist: number;
  name: string;
}

interface DroneState {
  altitude: number;
  speed: number;
  heading: number;
  targets: Target[];
  lockedTarget: Target | null;
  destroyedKeys: Set<string>;
  kills: number;
}

// ── Drone Camera HUD ──────────────────────────────────────────────────────────

export function DroneOverlay() {
  const setActiveTool = useModelStore(s => s.setActiveTool);
  const models        = useModelStore(s => s.models);

  const [state, setState] = useState<DroneState>({
    altitude: 0,
    speed: 0,
    heading: 0,
    targets: [],
    lockedTarget: null,
    destroyedKeys: new Set(),
    kills: 0,
  });

  const keysRef     = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });
  const eulerRef    = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const activeRef   = useRef(false);
  const destroyedRef = useRef(new Set<string>());
  const killsRef    = useRef(0);
  const frameRef    = useRef(0);
  const lastTimeRef = useRef(performance.now());

  // Get camera + scene from viewport
  const getCameraAndScene = useCallback((): { camera: THREE.PerspectiveCamera; scene: THREE.Scene } | null => {
    const canvas = document.querySelector<HTMLElement>('[data-viewport="main"]');
    if (!canvas) return null;
    // Access camera via a custom event
    const ev = new CustomEvent("drone:getState", { detail: {}, bubbles: false });
    canvas.dispatchEvent(ev);
    const d = (ev as any).detail as { camera?: THREE.PerspectiveCamera; scene?: THREE.Scene };
    return d.camera && d.scene ? { camera: d.camera, scene: d.scene } : null;
  }, []);

  const shootTarget = useCallback((target: Target) => {
    const key = `${target.modelId}:${target.expressId}`;
    if (destroyedRef.current.has(key)) return;
    destroyedRef.current.add(key);
    killsRef.current++;

    // Hide the element in the scene
    useModelStore.getState().hideElement(target.modelId, target.expressId);

    setState(prev => ({
      ...prev,
      destroyedKeys: new Set(destroyedRef.current),
      kills: killsRef.current,
      lockedTarget: null,
    }));
  }, []);

  useEffect(() => {
    const mount = document.querySelector<HTMLElement>('[data-viewport="main"]');
    if (!mount) return;

    // Disable OrbitControls via custom event
    mount.dispatchEvent(new CustomEvent("drone:enter"));
    activeRef.current = true;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.code === "KeyW") k.w = true;
      if (e.code === "KeyA") k.a = true;
      if (e.code === "KeyS") k.s = true;
      if (e.code === "KeyD") k.d = true;
      if (e.code === "KeyQ") k.q = true;
      if (e.code === "KeyE") k.e = true;
      if (e.key === "Escape") {
        activeRef.current = false;
        useModelStore.getState().setActiveTool("select");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.code === "KeyW") k.w = false;
      if (e.code === "KeyA") k.a = false;
      if (e.code === "KeyS") k.s = false;
      if (e.code === "KeyD") k.d = false;
      if (e.code === "KeyQ") k.q = false;
      if (e.code === "KeyE") k.e = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!activeRef.current || document.pointerLockElement !== mount) return;
      const euler = eulerRef.current;
      const cs = getCameraAndScene();
      if (!cs) return;
      euler.setFromQuaternion(cs.camera.quaternion);
      euler.y -= e.movementX * 0.002;
      euler.x -= e.movementY * 0.002;
      euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x));
      cs.camera.quaternion.setFromEuler(euler);
    };

    const onClick = () => {
      if (document.pointerLockElement !== mount) {
        mount.requestPointerLock();
        return;
      }
      // Shoot locked target
      setState(prev => {
        if (prev.lockedTarget) shootTarget(prev.lockedTarget);
        return prev;
      });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup",   onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("click", onClick);

    const onLockChange = () => {
      if (document.pointerLockElement !== mount && activeRef.current) {
        // keep drone active but show click-to-lock hint
      }
    };
    document.addEventListener("pointerlockchange", onLockChange);

    // Update loop
    const tick = () => {
      if (!activeRef.current) return;
      frameRef.current = requestAnimationFrame(tick);

      const now = performance.now();
      const dt  = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      const cs = getCameraAndScene();
      if (!cs) return;
      const { camera, scene } = cs;

      const k = keysRef.current;
      const anyKey = k.w || k.a || k.s || k.d || k.q || k.e;
      let speedMag = 0;
      if (anyKey) {
        const spd = 25 * dt;
        if (k.w) { camera.translateZ(-spd); speedMag = 25; }
        if (k.s) { camera.translateZ( spd); speedMag = 25; }
        if (k.a) { camera.translateX(-spd); speedMag = 25; }
        if (k.d) { camera.translateX( spd); speedMag = 25; }
        if (k.q) { camera.translateY(-spd); speedMag = 25; }
        if (k.e) { camera.translateY( spd); speedMag = 25; }
        // Notify viewport to re-render
        const event = new CustomEvent("drone:moved");
        document.querySelector('[data-viewport="main"]')?.dispatchEvent(event);
      }

      // Compute altitude and heading
      const altitude = camera.position.y;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const heading = Math.round(Math.atan2(forward.x, -forward.z) * 180 / Math.PI + 360) % 360;

      // Find visible targets via raycasting from center of screen
      const targets: Target[] = [];
      const raycaster = new THREE.Raycaster();
      const renderer = document.querySelector<HTMLCanvasElement>("canvas");
      if (renderer) {
        const w = renderer.clientWidth, h = renderer.clientHeight;
        const allMeshes: THREE.Mesh[] = [];
        scene.traverse(obj => {
          if (obj instanceof THREE.Mesh && obj.visible && !obj.userData.isHelper && !obj.userData.isEdge && !obj.userData.isXSSurface) {
            allMeshes.push(obj);
          }
        });

        // Sample a grid of rays to find targets
        const angles = [
          [0, 0],
          [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1],
          [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2],
        ];
        const seen = new Set<string>();
        for (const [nx, ny] of angles) {
          raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
          const hits = raycaster.intersectObjects(allMeshes, false);
          for (const hit of hits.slice(0, 1)) {
            const mesh = hit.object as THREE.Mesh;
            const expressId = mesh.userData?.expressId ?? 0;
            const modelId   = mesh.userData?.modelId ?? "";
            const key = `${modelId}:${expressId}`;
            if (seen.has(key) || destroyedRef.current.has(key)) continue;
            seen.add(key);

            // Project to screen
            const pos = hit.point.clone().project(camera);
            const sx = (pos.x + 1) / 2 * w;
            const sy = (-pos.y + 1) / 2 * h;
            const dist = hit.distance;

            let name = mesh.userData?.name ?? `Element ${expressId}`;
            // Look up in models
            for (const [mid, model] of models) {
              if (mid !== modelId) continue;
              for (const els of Object.values(model.elementsByType)) {
                const found = (els as any[]).find((e: any) => e.expressId === expressId);
                if (found) { name = found.name || name; break; }
              }
            }
            targets.push({ modelId, expressId, screenX: sx, screenY: sy, dist, name });
          }
        }
      }

      // Sort by distance, lock closest
      targets.sort((a, b) => a.dist - b.dist);
      const lockedTarget = targets.length > 0 ? targets[0] : null;

      setState(prev => ({
        ...prev,
        altitude: Math.round(altitude * 10) / 10,
        speed: Math.round(speedMag),
        heading,
        targets: targets.slice(0, 5),
        lockedTarget,
      }));
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(frameRef.current);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === mount) document.exitPointerLock();
      mount.dispatchEvent(new CustomEvent("drone:exit"));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locked = document.pointerLockElement === document.querySelector('[data-viewport="main"]');

  return (
    <div className="fixed inset-0 pointer-events-none z-40 font-mono">
      {/* CRT scan-line overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px)",
          mixBlendMode: "multiply",
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,30,10,0.45) 100%)",
        }}
      />

      {/* Corner brackets */}
      <CornerBrackets />

      {/* Top bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-8 text-green-400">
        <HudValue label="ALT" value={`${state.altitude.toFixed(1)} m`} />
        <HudValue label="SPD" value={`${state.speed} km/h`} />
        <HudValue label="HDG" value={`${String(state.heading).padStart(3, "0")}°`} />
        <HudValue label="KILLS" value={String(state.kills)} color="text-red-400" />
      </div>

      {/* Center crosshair */}
      <div className="absolute inset-0 flex items-center justify-center">
        <DroneCrosshair locked={!!state.lockedTarget} />
      </div>

      {/* Target indicators */}
      {state.targets.map(t => (
        <TargetBox
          key={`${t.modelId}:${t.expressId}`}
          target={t}
          isLocked={state.lockedTarget?.expressId === t.expressId && state.lockedTarget?.modelId === t.modelId}
        />
      ))}

      {/* Bottom status bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        {state.lockedTarget && (
          <div className="text-red-400 text-xs animate-pulse border border-red-400/50 px-3 py-1 rounded">
            TARGET LOCKED · {state.lockedTarget.name.toUpperCase()} · {state.lockedTarget.dist.toFixed(0)}m
            <span className="ml-2 opacity-70">[CLICK TO DESTROY]</span>
          </div>
        )}
        {!locked && (
          <div className="text-green-400/80 text-xs border border-green-400/30 px-3 py-1 rounded">
            KLICKEN ZUM AKTIVIEREN · ESC = BEENDEN
          </div>
        )}
        <div className="text-green-400/50 text-[10px]">
          WASD MOVE · Q/E UP/DOWN · MOUSE LOOK
        </div>
      </div>

      {/* Mode label */}
      <div className="absolute top-4 left-4 text-green-400/80 text-[10px] flex flex-col gap-0.5">
        <span className="text-green-300 font-bold tracking-widest">DRONE CAM</span>
        <span className="opacity-60">infraCore v2</span>
      </div>

      {/* Exit button */}
      <button
        className="pointer-events-auto absolute top-4 right-4 text-green-400/70 hover:text-red-400 text-[10px] border border-current/30 px-2 py-1 rounded transition-colors"
        onClick={() => setActiveTool("select")}
      >
        [ESC] EXIT
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HudValue({ label, value, color = "text-green-400" }: {
  label: string; value: string; color?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] opacity-60 tracking-widest">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", color)}>{value}</span>
    </div>
  );
}

function DroneCrosshair({ locked }: { locked: boolean }) {
  return (
    <div className={cn("relative", locked ? "text-red-400" : "text-green-400")}>
      {/* Center dot */}
      <div className="absolute top-1/2 left-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
      {/* Lines */}
      <div className="absolute top-1/2 left-0 right-0 h-px bg-current -translate-y-1/2" style={{ width: 40, left: -20 }} />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-current -translate-x-1/2" style={{ height: 40, top: -20 }} />
      {/* Corner brackets */}
      {locked && (
        <>
          <div className="absolute" style={{ top: -16, left: -16, width: 8, height: 8, borderTop: "1.5px solid currentColor", borderLeft: "1.5px solid currentColor" }} />
          <div className="absolute" style={{ top: -16, right: -16, width: 8, height: 8, borderTop: "1.5px solid currentColor", borderRight: "1.5px solid currentColor" }} />
          <div className="absolute" style={{ bottom: -16, left: -16, width: 8, height: 8, borderBottom: "1.5px solid currentColor", borderLeft: "1.5px solid currentColor" }} />
          <div className="absolute" style={{ bottom: -16, right: -16, width: 8, height: 8, borderBottom: "1.5px solid currentColor", borderRight: "1.5px solid currentColor" }} />
        </>
      )}
    </div>
  );
}

function TargetBox({ target, isLocked }: { target: Target; isLocked: boolean }) {
  const color = isLocked ? "#f87171" : "#4ade80";
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: target.screenX,
        top: target.screenY,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className={cn("relative", isLocked && "animate-pulse")}
        style={{ width: 32, height: 32 }}
      >
        {/* Corner brackets */}
        {[
          { top: 0, left: 0, borderTop: `1.5px solid ${color}`, borderLeft: `1.5px solid ${color}` },
          { top: 0, right: 0, borderTop: `1.5px solid ${color}`, borderRight: `1.5px solid ${color}` },
          { bottom: 0, left: 0, borderBottom: `1.5px solid ${color}`, borderLeft: `1.5px solid ${color}` },
          { bottom: 0, right: 0, borderBottom: `1.5px solid ${color}`, borderRight: `1.5px solid ${color}` },
        ].map((style, i) => (
          <div key={i} className="absolute" style={{ ...style, width: 8, height: 8 }} />
        ))}
      </div>
      <div
        className="absolute text-[9px] font-mono whitespace-nowrap"
        style={{ top: "100%", left: "50%", transform: "translateX(-50%)", color, marginTop: 2 }}
      >
        {target.dist.toFixed(0)}m
      </div>
    </div>
  );
}

function CornerBrackets() {
  const style = "absolute border-green-400/30";
  const sz = 24;
  const bw = 1;
  return (
    <>
      <div className={cn(style, "top-2 left-2")} style={{ width: sz, height: sz, borderTop: `${bw}px solid`, borderLeft: `${bw}px solid` }} />
      <div className={cn(style, "top-2 right-2")} style={{ width: sz, height: sz, borderTop: `${bw}px solid`, borderRight: `${bw}px solid` }} />
      <div className={cn(style, "bottom-2 left-2")} style={{ width: sz, height: sz, borderBottom: `${bw}px solid`, borderLeft: `${bw}px solid` }} />
      <div className={cn(style, "bottom-2 right-2")} style={{ width: sz, height: sz, borderBottom: `${bw}px solid`, borderRight: `${bw}px solid` }} />
    </>
  );
}
