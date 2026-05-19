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
  type: string;
  bearing: number;
}

interface LaserBeam {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTime: number;
}

interface HitFlash {
  id: number;
  startTime: number;
}

interface DroneHudState {
  altitude: number;
  altGround: number;
  speed: number;
  heading: number;
  pitch: number;
  roll: number;
  targets: Target[];
  lockedTarget: Target | null;
  lockProgress: number; // 0..1
  destroyedKeys: Set<string>;
  kills: number;
  lat: number;
  lon: number;
  missionTime: number;
  laserBeams: LaserBeam[];
  hitFlashes: HitFlash[];
  isLocked: boolean;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DronePlay() {
  const setActiveTool = useModelStore(s => s.setActiveTool);
  const models        = useModelStore(s => s.models);

  const [hud, setHud] = useState<DroneHudState>({
    altitude: 0,
    altGround: 0,
    speed: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    targets: [],
    lockedTarget: null,
    lockProgress: 0,
    destroyedKeys: new Set(),
    kills: 0,
    lat: 47.8095,
    lon: 13.0550,
    missionTime: 0,
    laserBeams: [],
    hitFlashes: [],
    isLocked: false,
  });

  const keysRef        = useRef({ w: false, a: false, s: false, d: false, q: false, e: false, shift: false });
  const eulerRef       = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const activeRef      = useRef(false);
  const destroyedRef   = useRef(new Set<string>());
  const killsRef       = useRef(0);
  const frameRef       = useRef(0);
  const lastTimeRef    = useRef(performance.now());
  const missionStartRef= useRef(Date.now());
  const lockStartRef   = useRef<number | null>(null);
  const lockTargetRef  = useRef<string | null>(null);
  const beamIdRef      = useRef(0);
  const flashIdRef     = useRef(0);

  const LOCK_TIME_MS = 1800;
  const LASER_DURATION_MS = 600;

  const getCameraAndScene = useCallback((): { camera: THREE.PerspectiveCamera; scene: THREE.Scene } | null => {
    const canvas = document.querySelector<HTMLElement>('[data-viewport="main"]');
    if (!canvas) return null;
    const ev = new CustomEvent("drone:getState", { detail: {}, bubbles: false });
    canvas.dispatchEvent(ev);
    const d = (ev as any).detail as { camera?: THREE.PerspectiveCamera; scene?: THREE.Scene };
    return d.camera && d.scene ? { camera: d.camera, scene: d.scene } : null;
  }, []);

  const fireWeapon = useCallback((target: Target) => {
    const key = `${target.modelId}:${target.expressId}`;
    if (destroyedRef.current.has(key)) return;
    destroyedRef.current.add(key);
    killsRef.current++;

    // CSS laser beam from screen center to target
    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    const cw = canvas?.clientWidth ?? window.innerWidth;
    const ch = canvas?.clientHeight ?? window.innerHeight;
    const beamId = beamIdRef.current++;
    const flashId = flashIdRef.current++;

    setHud(prev => ({
      ...prev,
      laserBeams: [...prev.laserBeams, {
        id: beamId,
        fromX: cw / 2,
        fromY: ch / 2,
        toX: target.screenX,
        toY: target.screenY,
        startTime: performance.now(),
      }],
      hitFlashes: [...prev.hitFlashes, { id: flashId, startTime: performance.now() }],
    }));

    // Hide in model
    useModelStore.getState().hideElement(target.modelId, target.expressId);

    setTimeout(() => {
      setHud(prev => ({
        ...prev,
        destroyedKeys: new Set(destroyedRef.current),
        kills: killsRef.current,
        lockedTarget: null,
        lockProgress: 0,
        laserBeams: prev.laserBeams.filter(b => b.id !== beamId),
        hitFlashes: prev.hitFlashes.filter(f => f.id !== flashId),
      }));
      lockStartRef.current = null;
      lockTargetRef.current = null;
    }, LASER_DURATION_MS);
  }, []);

  useEffect(() => {
    const mount = document.querySelector<HTMLElement>('[data-viewport="main"]');
    if (!mount) return;

    mount.dispatchEvent(new CustomEvent("drone:enter"));
    activeRef.current = true;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.code === "KeyW") { k.w = true; e.preventDefault(); }
      if (e.code === "KeyA") { k.a = true; e.preventDefault(); }
      if (e.code === "KeyS") { k.s = true; e.preventDefault(); }
      if (e.code === "KeyD") { k.d = true; e.preventDefault(); }
      if (e.code === "KeyQ") { k.q = true; e.preventDefault(); }
      if (e.code === "KeyE") { k.e = true; e.preventDefault(); }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") k.shift = true;
      if (e.key === "Escape") {
        activeRef.current = false;
        useModelStore.getState().setActiveTool("select");
      }
      if (e.code === "Space") {
        e.preventDefault();
        setHud(prev => {
          if (prev.lockedTarget && prev.lockProgress >= 1) {
            fireWeapon(prev.lockedTarget);
          }
          return prev;
        });
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
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") k.shift = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!activeRef.current || document.pointerLockElement !== mount) return;
      const euler = eulerRef.current;
      const cs = getCameraAndScene();
      if (!cs) return;
      euler.setFromQuaternion(cs.camera.quaternion);
      euler.y -= e.movementX * 0.0018;
      euler.x -= e.movementY * 0.0018;
      euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x));
      cs.camera.quaternion.setFromEuler(euler);
    };
    const onClick = () => {
      if (document.pointerLockElement !== mount) {
        mount.requestPointerLock();
        return;
      }
      setHud(prev => {
        if (prev.lockedTarget && prev.lockProgress >= 1) {
          fireWeapon(prev.lockedTarget);
        }
        return prev;
      });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup",   onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("click", onClick);

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
      const spd = (k.shift ? 80 : 25) * dt;
      let speedMag = 0;
      if (k.w) { camera.translateZ(-spd); speedMag = k.shift ? 80 : 25; }
      if (k.s) { camera.translateZ( spd); speedMag = k.shift ? 80 : 25; }
      if (k.a) { camera.translateX(-spd); speedMag = k.shift ? 80 : 25; }
      if (k.d) { camera.translateX( spd); speedMag = k.shift ? 80 : 25; }
      if (k.q) { camera.translateY(-spd); speedMag = k.shift ? 80 : 25; }
      if (k.e) { camera.translateY( spd); speedMag = k.shift ? 80 : 25; }
      if (k.w || k.a || k.s || k.d || k.q || k.e) {
        mount.dispatchEvent(new CustomEvent("drone:moved"));
      }

      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      const altitude = camera.position.y;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const heading = Math.round(Math.atan2(forward.x, -forward.z) * 180 / Math.PI + 360) % 360;
      const pitchDeg = Math.round(euler.x * 180 / Math.PI);
      const rollDeg  = Math.round(euler.z * 180 / Math.PI);

      // Ground clearance via downward raycast
      const downRay = new THREE.Raycaster(camera.position.clone(), new THREE.Vector3(0, -1, 0));
      const allMeshes: THREE.Mesh[] = [];
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.visible && !obj.userData.isHelper && !obj.userData.isEdge && !obj.userData.isXSSurface) {
          allMeshes.push(obj);
        }
      });
      const groundHits = downRay.intersectObjects(allMeshes, false);
      const groundClear = groundHits.length > 0 ? groundHits[0].distance : 999;

      // Targets via raycasting
      const targets: Target[] = [];
      const renderer = document.querySelector<HTMLCanvasElement>("canvas");
      if (renderer) {
        const w = renderer.clientWidth, h = renderer.clientHeight;
        const raycaster = new THREE.Raycaster();
        const angles = [
          [0, 0], [0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08],
          [0.15, 0.08], [-0.15, 0.08], [0.15, -0.08], [-0.15, -0.08],
          [0.25, 0], [-0.25, 0], [0, 0.2], [0, -0.2],
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
            const pos = hit.point.clone().project(camera);
            const sx = (pos.x + 1) / 2 * w;
            const sy = (-pos.y + 1) / 2 * h;
            const toTarget = new THREE.Vector3().subVectors(hit.point, camera.position).normalize();
            const bearing = Math.round(Math.atan2(toTarget.x, -toTarget.z) * 180 / Math.PI + 360) % 360;
            let name = mesh.userData?.name ?? `Element ${expressId}`;
            let type = "UNKNOWN";
            for (const [mid, model] of models) {
              if (mid !== modelId) continue;
              for (const [t, els] of Object.entries(model.elementsByType)) {
                const found = (els as any[]).find((e: any) => e.expressId === expressId);
                if (found) { name = found.name || name; type = t.replace("Ifc", ""); break; }
              }
            }
            targets.push({ modelId, expressId, screenX: sx, screenY: sy, dist: hit.distance, name, type, bearing });
          }
        }
      }
      targets.sort((a, b) => a.dist - b.dist);
      const centerTarget = targets.length > 0 ? targets[0] : null;

      // Lock-on logic
      const nowMs = performance.now();
      let lockProgress = 0;
      if (centerTarget) {
        const key = `${centerTarget.modelId}:${centerTarget.expressId}`;
        if (lockTargetRef.current !== key) {
          lockTargetRef.current = key;
          lockStartRef.current = nowMs;
        }
        const elapsed = lockStartRef.current ? nowMs - lockStartRef.current : 0;
        lockProgress = Math.min(1, elapsed / LOCK_TIME_MS);
      } else {
        lockTargetRef.current = null;
        lockStartRef.current = null;
      }

      const missionSecs = Math.floor((Date.now() - missionStartRef.current) / 1000);

      setHud(prev => ({
        ...prev,
        altitude: Math.round(altitude * 10) / 10,
        altGround: Math.round(groundClear * 10) / 10,
        speed: Math.round(speedMag * 3.6),
        heading,
        pitch: pitchDeg,
        roll: rollDeg,
        targets: targets.slice(0, 8),
        lockedTarget: centerTarget,
        lockProgress,
        missionTime: missionSecs,
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
      if (document.pointerLockElement === mount) document.exitPointerLock();
      mount.dispatchEvent(new CustomEvent("drone:exit"));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointerLocked = document.pointerLockElement === document.querySelector('[data-viewport="main"]');
  const missionMM = String(Math.floor(hud.missionTime / 60)).padStart(2, "0");
  const missionSS = String(hud.missionTime % 60).padStart(2, "0");
  const lat = hud.lat.toFixed(4);
  const lon = hud.lon.toFixed(4);

  return (
    <div className="fixed inset-0 pointer-events-none z-40 select-none" style={{ fontFamily: "monospace" }}>

      {/* CRT scan lines */}
      <div className="absolute inset-0" style={{
        backgroundImage: "repeating-linear-gradient(0deg,rgba(0,0,0,0.06) 0,rgba(0,0,0,0.06) 1px,transparent 1px,transparent 4px)",
        mixBlendMode: "multiply",
        pointerEvents: "none",
      }} />

      {/* Vignette */}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,15,5,0.55) 100%)",
        pointerEvents: "none",
      }} />

      {/* Hit flash overlays */}
      {hud.hitFlashes.map(f => (
        <div key={f.id} className="absolute inset-0 pointer-events-none" style={{
          background: "rgba(255,80,0,0.35)",
          animation: "drone-flash 0.5s ease-out forwards",
        }} />
      ))}

      {/* === TOP BAR === */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-start px-4 pt-2">
        {/* Left: System + ID */}
        <div className="flex flex-col gap-0.5">
          <div className="text-green-300 text-[10px] tracking-[0.2em] font-bold">DRONE-CAM · UAV-7734</div>
          <div className="text-green-400/60 text-[9px] tracking-widest">INFRACORE TACTICAL v2.1</div>
          <SystemStatusRow />
        </div>

        {/* Center: Heading tape */}
        <div className="flex flex-col items-center">
          <HeadingTape heading={hud.heading} />
          <div className="text-green-300 text-[11px] font-bold mt-0.5">{String(hud.heading).padStart(3, "0")}°</div>
        </div>

        {/* Right: Mission time + kills */}
        <div className="flex flex-col items-end gap-0.5">
          <div className="text-green-400/60 text-[9px] tracking-widest">MISSION TIME</div>
          <div className="text-green-300 text-sm font-bold tabular-nums">{missionMM}:{missionSS}</div>
          <div className="text-red-400 text-[10px] font-bold">{hud.kills} KILLS</div>
        </div>
      </div>

      {/* === LEFT SIDE: Altitude tape === */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
        <div className="text-green-400/60 text-[9px] tracking-widest mb-1">ALT</div>
        <AltitudeTape value={hud.altitude} />
        <div className="text-green-300 text-xs font-bold tabular-nums mt-1">{hud.altitude.toFixed(1)} m</div>
        <div className="text-green-400/50 text-[9px] mt-2">GND CLR</div>
        <div className={cn(
          "text-xs font-bold tabular-nums",
          hud.altGround < 5 ? "text-red-400 animate-pulse" : "text-green-300"
        )}>{hud.altGround.toFixed(1)} m</div>
      </div>

      {/* === RIGHT SIDE: Speed tape === */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
        <div className="text-green-400/60 text-[9px] tracking-widest mb-1">SPD</div>
        <SpeedTape value={hud.speed} />
        <div className="text-green-300 text-xs font-bold tabular-nums mt-1">{hud.speed} km/h</div>
        <div className="text-green-400/50 text-[9px] mt-3">SHIFT=BOOST</div>
      </div>

      {/* === CENTER: Artificial horizon + crosshair === */}
      <div className="absolute inset-0 flex items-center justify-center">
        <ArtificialHorizon pitch={hud.pitch} roll={hud.roll} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <LockCrosshair
          locked={!!hud.lockedTarget}
          lockProgress={hud.lockProgress}
        />
      </div>

      {/* === LASER BEAMS === */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {hud.laserBeams.map(b => {
          const dx = b.toX - b.fromX;
          const dy = b.toY - b.fromY;
          const len = Math.sqrt(dx * dx + dy * dy);
          return (
            <g key={b.id}>
              <line
                x1={b.fromX} y1={b.fromY} x2={b.toX} y2={b.toY}
                stroke="#ff4400" strokeWidth="3" strokeOpacity="0.9"
                style={{ filter: "drop-shadow(0 0 4px #ff6600)" }}
              />
              <line
                x1={b.fromX} y1={b.fromY} x2={b.toX} y2={b.toY}
                stroke="#ffffff" strokeWidth="1" strokeOpacity="0.7"
              />
              {len > 0 && (
                <circle cx={b.toX} cy={b.toY} r="8" fill="none"
                  stroke="#ff4400" strokeWidth="2" strokeOpacity="0.8"
                  style={{ filter: "drop-shadow(0 0 6px #ff6600)" }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* === TARGET BOXES === */}
      {hud.targets.map(t => (
        <TargetMarker
          key={`${t.modelId}:${t.expressId}`}
          target={t}
          isCenter={hud.lockedTarget?.expressId === t.expressId && hud.lockedTarget?.modelId === t.modelId}
          lockProgress={hud.lockedTarget?.expressId === t.expressId ? hud.lockProgress : 0}
        />
      ))}

      {/* === BOTTOM BAR === */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-end px-4 pb-3">
        {/* Left: GPS coordinates */}
        <div className="flex flex-col gap-0.5">
          <div className="text-green-400/50 text-[9px] tracking-widest">POSITION</div>
          <div className="text-green-300 text-[10px] font-bold tabular-nums">{lat}°N {lon}°E</div>
          <div className="text-green-400/50 text-[9px]">PITCH {hud.pitch > 0 ? "+" : ""}{hud.pitch}° · ROLL {hud.roll > 0 ? "+" : ""}{hud.roll}°</div>
        </div>

        {/* Center: Lock status */}
        <div className="flex flex-col items-center gap-1">
          {hud.lockedTarget && hud.lockProgress >= 1 && (
            <div className="text-red-300 text-[11px] font-bold tracking-widest animate-pulse border border-red-400/60 px-3 py-0.5">
              ◆ TARGET LOCKED ◆
            </div>
          )}
          {hud.lockedTarget && hud.lockProgress < 1 && (
            <div className="text-amber-400 text-[10px] tracking-widest border border-amber-400/40 px-3 py-0.5">
              ACQUIRING {Math.round(hud.lockProgress * 100)}%
            </div>
          )}
          {!pointerLocked ? (
            <div className="text-green-400/70 text-[10px] border border-green-400/25 px-3 py-0.5">
              CLICK TO ACTIVATE POINTER LOCK
            </div>
          ) : (
            <div className="text-green-400/40 text-[9px]">
              WASD MOVE · Q/E ALT · SHIFT BOOST · SPACE / CLICK FIRE
            </div>
          )}
        </div>

        {/* Right: Weapon status */}
        <div className="flex flex-col items-end gap-0.5">
          <div className="text-green-400/50 text-[9px] tracking-widest">WEAPON STATUS</div>
          <div className={cn("text-[10px] font-bold", hud.lockedTarget && hud.lockProgress >= 1 ? "text-red-400" : "text-green-400/70")}>
            {hud.lockedTarget && hud.lockProgress >= 1 ? "READY TO FIRE" : "SEARCHING"}
          </div>
          <div className="text-green-400/40 text-[9px]">∞ AMMO</div>
        </div>
      </div>

      {/* === Threat list (top-right) === */}
      {hud.targets.length > 1 && (
        <ThreatList targets={hud.targets} lockedKey={hud.lockedTarget ? `${hud.lockedTarget.modelId}:${hud.lockedTarget.expressId}` : null} />
      )}

      {/* === Corner brackets === */}
      <CornerDecor />

      {/* === Exit button === */}
      <button
        className="pointer-events-auto absolute top-12 right-4 text-[9px] text-green-400/60 hover:text-red-400 border border-current/30 px-2 py-0.5 tracking-widest transition-colors"
        onClick={() => setActiveTool("select")}
      >
        [ESC] EXIT DRONE
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeadingTape({ heading }: { heading: number }) {
  const ticks: number[] = [];
  for (let d = -30; d <= 30; d += 5) {
    ticks.push((heading + d + 360) % 360);
  }
  return (
    <div className="relative overflow-hidden" style={{ width: 160, height: 24, borderBottom: "1px solid rgba(74,222,128,0.3)" }}>
      <div className="flex items-end h-full" style={{ transform: `translateX(${-((heading % 5) / 5) * 20}px)` }}>
        {Array.from({ length: 13 }, (_, i) => {
          const deg = ((heading - 30 + i * 5) + 360) % 360;
          const major = deg % 10 === 0;
          return (
            <div key={i} className="flex-none flex flex-col items-center" style={{ width: 20 }}>
              {major && <span className="text-green-400/60 text-[8px] leading-none mb-0.5">{String(deg).padStart(3, "0")}</span>}
              <div style={{ height: major ? 6 : 3, width: 1, background: major ? "rgba(74,222,128,0.6)" : "rgba(74,222,128,0.3)" }} />
            </div>
          );
        })}
      </div>
      {/* Center marker */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: 1, height: 10, background: "#4ade80" }} />
    </div>
  );
}

function AltitudeTape({ value }: { value: number }) {
  const rounded = Math.round(value / 5) * 5;
  const ticks: number[] = [];
  for (let v = rounded + 20; v >= rounded - 20; v -= 5) ticks.push(v);
  return (
    <div className="relative overflow-hidden border border-green-400/20" style={{ width: 50, height: 100 }}>
      <div className="flex flex-col items-end">
        {ticks.map((v, i) => (
          <div key={i} className="flex items-center justify-end" style={{ height: 20 }}>
            {v % 10 === 0 && <span className="text-green-400/60 text-[8px] mr-1">{v}</span>}
            <div style={{ width: v % 10 === 0 ? 6 : 3, height: 1, background: v % 10 === 0 ? "rgba(74,222,128,0.5)" : "rgba(74,222,128,0.25)" }} />
          </div>
        ))}
      </div>
      {/* Center pointer */}
      <div className="absolute top-1/2 right-0 -translate-y-1/2" style={{
        width: 0, height: 0,
        borderTop: "5px solid transparent",
        borderBottom: "5px solid transparent",
        borderRight: "8px solid #4ade80",
      }} />
    </div>
  );
}

function SpeedTape({ value }: { value: number }) {
  const rounded = Math.round(value / 5) * 5;
  const ticks: number[] = [];
  for (let v = rounded + 20; v >= rounded - 20; v -= 5) ticks.push(v < 0 ? 0 : v);
  return (
    <div className="relative overflow-hidden border border-green-400/20" style={{ width: 50, height: 100 }}>
      <div className="flex flex-col items-start">
        {ticks.map((v, i) => (
          <div key={i} className="flex items-center" style={{ height: 20 }}>
            <div style={{ width: v % 10 === 0 ? 6 : 3, height: 1, background: v % 10 === 0 ? "rgba(74,222,128,0.5)" : "rgba(74,222,128,0.25)" }} />
            {v % 10 === 0 && <span className="text-green-400/60 text-[8px] ml-1">{v}</span>}
          </div>
        ))}
      </div>
      {/* Center pointer */}
      <div className="absolute top-1/2 left-0 -translate-y-1/2" style={{
        width: 0, height: 0,
        borderTop: "5px solid transparent",
        borderBottom: "5px solid transparent",
        borderLeft: "8px solid #4ade80",
      }} />
    </div>
  );
}

function ArtificialHorizon({ pitch, roll }: { pitch: number; roll: number }) {
  const r = 48;
  return (
    <svg width={r * 2 + 4} height={r * 2 + 4} style={{ opacity: 0.45 }}>
      <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="rgba(74,222,128,0.3)" strokeWidth="1" />
      {/* Roll arc */}
      {[-30, -20, -10, 0, 10, 20, 30].map(deg => {
        const rad = ((deg - roll) * Math.PI) / 180;
        const x = r + 2 + Math.sin(rad) * r;
        const y = r + 2 - Math.cos(rad) * r;
        return (
          <line key={deg}
            x1={r + 2} y1={r + 2} x2={x} y2={y}
            stroke={deg === 0 ? "rgba(74,222,128,0.8)" : "rgba(74,222,128,0.3)"}
            strokeWidth={deg === 0 ? 1.5 : 1}
          />
        );
      })}
      {/* Pitch indicator lines */}
      <line x1={r - 14} y1={r + 2 - (pitch / 45) * r} x2={r + 16} y2={r + 2 - (pitch / 45) * r}
        stroke="rgba(74,222,128,0.5)" strokeWidth="1" />
      {/* Fixed aircraft symbol */}
      <line x1={r - 16} y1={r + 2} x2={r + 18} y2={r + 2} stroke="#4ade80" strokeWidth="1.5" />
      <circle cx={r + 2} cy={r + 2} r={2} fill="#4ade80" />
    </svg>
  );
}

function LockCrosshair({ locked, lockProgress }: { locked: boolean; lockProgress: number }) {
  const sz = 36;
  const color = locked && lockProgress >= 1 ? "#f87171" : locked ? "#fbbf24" : "#4ade80";
  const rotAnim = locked && lockProgress < 1 ? "drone-spin 1.2s linear infinite" : "none";
  return (
    <div className="relative" style={{ width: sz * 2, height: sz * 2, color }}>
      {/* Rotating acquisition ring */}
      {locked && lockProgress < 1 && (
        <svg className="absolute inset-0" style={{ animation: rotAnim }} width={sz * 2} height={sz * 2}>
          <circle cx={sz} cy={sz} r={sz - 2} fill="none" stroke={color} strokeWidth="1"
            strokeDasharray={`${2 * Math.PI * (sz - 2) * lockProgress} 9999`} strokeOpacity="0.8" />
        </svg>
      )}
      {/* Full lock ring */}
      {locked && lockProgress >= 1 && (
        <svg className="absolute inset-0" width={sz * 2} height={sz * 2}>
          <circle cx={sz} cy={sz} r={sz - 2} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.7" />
        </svg>
      )}
      {/* Center dot */}
      <div className="absolute" style={{ top: sz - 2, left: sz - 2, width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
      {/* H + V lines */}
      <div className="absolute" style={{ top: sz - 0.5, left: sz - 18, width: 12, height: 1, background: "currentColor" }} />
      <div className="absolute" style={{ top: sz - 0.5, right: sz - 18, width: 12, height: 1, background: "currentColor" }} />
      <div className="absolute" style={{ left: sz - 0.5, top: sz - 18, height: 12, width: 1, background: "currentColor" }} />
      <div className="absolute" style={{ left: sz - 0.5, bottom: sz - 18, height: 12, width: 1, background: "currentColor" }} />
      {/* Corner brackets */}
      {[
        { top: 0, left: 0, borderTopWidth: "1.5px", borderLeftWidth: "1.5px" },
        { top: 0, right: 0, borderTopWidth: "1.5px", borderRightWidth: "1.5px" },
        { bottom: 0, left: 0, borderBottomWidth: "1.5px", borderLeftWidth: "1.5px" },
        { bottom: 0, right: 0, borderBottomWidth: "1.5px", borderRightWidth: "1.5px" },
      ].map((s, i) => (
        <div key={i} className="absolute" style={{
          ...s, width: 10, height: 10,
          borderStyle: "solid", borderColor: "currentColor",
          borderTopWidth: s.borderTopWidth ?? 0, borderBottomWidth: s.borderBottomWidth ?? 0,
          borderLeftWidth: s.borderLeftWidth ?? 0, borderRightWidth: s.borderRightWidth ?? 0,
        }} />
      ))}
    </div>
  );
}

function TargetMarker({ target, isCenter, lockProgress }: {
  target: Target; isCenter: boolean; lockProgress: number;
}) {
  const color = isCenter && lockProgress >= 1 ? "#f87171" : isCenter ? "#fbbf24" : "#4ade80";
  const sz = isCenter ? 28 : 20;
  return (
    <div className="absolute pointer-events-none" style={{
      left: target.screenX,
      top: target.screenY,
      transform: "translate(-50%,-50%)",
      zIndex: 1,
    }}>
      {/* Corner brackets box */}
      <div className="relative" style={{ width: sz, height: sz }}>
        {[
          { top: 0, left: 0, borderTopWidth: "1.5px", borderLeftWidth: "1.5px" },
          { top: 0, right: 0, borderTopWidth: "1.5px", borderRightWidth: "1.5px" },
          { bottom: 0, left: 0, borderBottomWidth: "1.5px", borderLeftWidth: "1.5px" },
          { bottom: 0, right: 0, borderBottomWidth: "1.5px", borderRightWidth: "1.5px" },
        ].map((s, i) => (
          <div key={i} className="absolute" style={{
            ...s, width: 7, height: 7,
            borderStyle: "solid", borderColor: color,
            borderTopWidth: s.borderTopWidth ?? 0, borderBottomWidth: s.borderBottomWidth ?? 0,
            borderLeftWidth: s.borderLeftWidth ?? 0, borderRightWidth: s.borderRightWidth ?? 0,
          }} />
        ))}
      </div>
      {/* Info below */}
      <div className="absolute text-center" style={{ top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 3, whiteSpace: "nowrap" }}>
        <div style={{ color, fontSize: 8, lineHeight: 1.4, textTransform: "uppercase" }}>
          {target.type.slice(0, 10)}
        </div>
        <div style={{ color, fontSize: 9, fontWeight: "bold" }}>
          {target.dist.toFixed(0)}m
        </div>
        {isCenter && (
          <div style={{ color: "#fbbf24", fontSize: 8 }}>
            {Math.round(lockProgress * 100)}%
          </div>
        )}
      </div>
    </div>
  );
}

function ThreatList({ targets, lockedKey }: { targets: Target[]; lockedKey: string | null }) {
  return (
    <div className="absolute top-16 right-4 flex flex-col gap-0.5" style={{ minWidth: 140 }}>
      <div className="text-green-400/50 text-[9px] tracking-widest mb-1">CONTACTS ({targets.length})</div>
      {targets.slice(0, 6).map(t => {
        const key = `${t.modelId}:${t.expressId}`;
        const isLocked = key === lockedKey;
        return (
          <div key={key} className="flex items-center gap-2" style={{ color: isLocked ? "#f87171" : "rgba(74,222,128,0.7)" }}>
            <span style={{ fontSize: 9 }}>{isLocked ? "◆" : "·"}</span>
            <span style={{ fontSize: 9, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.name.slice(0, 14)}
            </span>
            <span style={{ fontSize: 9, fontVariantNumeric: "tabular-nums" }}>{t.dist.toFixed(0)}m</span>
            <span style={{ fontSize: 9 }}>{String(t.bearing).padStart(3, "0")}°</span>
          </div>
        );
      })}
    </div>
  );
}

function SystemStatusRow() {
  return (
    <div className="flex gap-2 mt-0.5">
      {[
        { label: "ENG", ok: true },
        { label: "NAV", ok: true },
        { label: "WPN", ok: true },
        { label: "COM", ok: true },
        { label: "SEN", ok: true },
      ].map(s => (
        <div key={s.label} className="flex flex-col items-center">
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: s.ok ? "#4ade80" : "#ef4444", marginBottom: 2 }} />
          <span style={{ fontSize: 8, color: "rgba(74,222,128,0.5)", letterSpacing: 1 }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function CornerDecor() {
  const c = "rgba(74,222,128,0.2)";
  const sz = 28;
  return (
    <>
      {[
        { top: 8, left: 8, borderTopWidth: 1, borderLeftWidth: 1 },
        { top: 8, right: 8, borderTopWidth: 1, borderRightWidth: 1 },
        { bottom: 8, left: 8, borderBottomWidth: 1, borderLeftWidth: 1 },
        { bottom: 8, right: 8, borderBottomWidth: 1, borderRightWidth: 1 },
      ].map((s, i) => (
        <div key={i} className="absolute" style={{
          ...s, width: sz, height: sz,
          borderStyle: "solid", borderColor: c,
          borderTopWidth: s.borderTopWidth ?? 0, borderBottomWidth: s.borderBottomWidth ?? 0,
          borderLeftWidth: s.borderLeftWidth ?? 0, borderRightWidth: s.borderRightWidth ?? 0,
        }} />
      ))}
    </>
  );
}
