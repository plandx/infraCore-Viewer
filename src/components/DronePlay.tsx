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
  elevation: number; // degrees above/below horizon
}

interface LaserBeam {
  id: number;
  fromX: number; fromY: number;
  toX: number;   toY: number;
  startTime: number;
}

interface HitFlash {
  id: number;
  x: number; y: number;
  startTime: number;
}

interface HudState {
  altitude: number;
  altGround: number;
  speed: number;
  vspeed: number;     // vertical speed m/s
  heading: number;
  pitch: number;
  roll: number;
  targets: Target[];
  lockedTarget: Target | null;
  lockProgress: number;
  destroyedKeys: Set<string>;
  kills: number;
  missionTime: number;
  laserBeams: LaserBeam[];
  hitFlashes: HitFlash[];
  fpvX: number; fpvY: number; // flight path vector screen position
  zoomLevel: number;
  cameraMode: "EO" | "IR" | "WIDE";
  datalink: number; // 0..4
}

const LOCK_TIME_MS   = 600;
const LASER_DURATION = 550;

// ── Main Component ────────────────────────────────────────────────────────────

export function DronePlay() {
  const setActiveTool = useModelStore(s => s.setActiveTool);
  const models        = useModelStore(s => s.models);

  const [hud, setHud] = useState<HudState>({
    altitude: 0, altGround: 0, speed: 0, vspeed: 0,
    heading: 0, pitch: 0, roll: 0,
    targets: [], lockedTarget: null, lockProgress: 0,
    destroyedKeys: new Set(), kills: 0, missionTime: 0,
    laserBeams: [], hitFlashes: [], fpvX: 0.5, fpvY: 0.5,
    zoomLevel: 1, cameraMode: "EO", datalink: 4,
  });

  const keysRef       = useRef({ w:false, a:false, s:false, d:false, q:false, e:false, shift:false });
  const eulerRef      = useRef(new THREE.Euler(0,0,0,"YXZ"));
  const activeRef     = useRef(false);
  const destroyedRef  = useRef(new Set<string>());
  const killsRef      = useRef(0);
  const frameRef      = useRef(0);
  const lastTimeRef   = useRef(performance.now());
  const missionStart  = useRef(Date.now());
  const lockStartRef  = useRef<number|null>(null);
  const lockKeyRef    = useRef<string|null>(null);
  const beamIdRef     = useRef(0);
  const flashIdRef    = useRef(0);
  const prevAltRef    = useRef(0);
  const prevTimeRef   = useRef(performance.now());

  const getCamScene = useCallback((): { camera: THREE.PerspectiveCamera; scene: THREE.Scene } | null => {
    const el = document.querySelector<HTMLElement>('[data-viewport="main"]');
    if (!el) return null;
    const ev = new CustomEvent("drone:getState", { detail:{}, bubbles:false });
    el.dispatchEvent(ev);
    const d = (ev as any).detail as { camera?: THREE.PerspectiveCamera; scene?: THREE.Scene };
    return d.camera && d.scene ? { camera: d.camera, scene: d.scene } : null;
  }, []);

  const fireWeapon = useCallback((target: Target) => {
    const key = `${target.modelId}:${target.expressId}`;
    if (destroyedRef.current.has(key)) return;
    destroyedRef.current.add(key);
    killsRef.current++;

    const beamId  = beamIdRef.current++;
    const flashId = flashIdRef.current++;
    const canvas  = document.querySelector<HTMLCanvasElement>("canvas");
    const cw = canvas?.clientWidth  ?? window.innerWidth;
    const ch = canvas?.clientHeight ?? window.innerHeight;

    setHud(prev => ({
      ...prev,
      laserBeams: [...prev.laserBeams, {
        id: beamId,
        fromX: cw/2, fromY: ch/2,
        toX: target.screenX, toY: target.screenY,
        startTime: performance.now(),
      }],
      hitFlashes: [...prev.hitFlashes, { id: flashId, x: target.screenX, y: target.screenY, startTime: performance.now() }],
    }));

    // Immediately hide in scene so it vanishes before the store round-trip
    const cs = getCamScene();
    if (cs) {
      cs.scene.traverse(obj => {
        if (obj instanceof THREE.Mesh &&
            obj.userData?.modelId === target.modelId &&
            obj.userData?.expressId === target.expressId) {
          obj.visible = false;
        }
      });
      cs.scene.dispatchEvent({ type: "change" } as any);
    }
    useModelStore.getState().hideElement(target.modelId, target.expressId);

    setTimeout(() => {
      setHud(prev => ({
        ...prev,
        destroyedKeys: new Set(destroyedRef.current),
        kills: killsRef.current,
        lockedTarget: null, lockProgress: 0,
        laserBeams:  prev.laserBeams.filter(b => b.id !== beamId),
        hitFlashes:  prev.hitFlashes.filter(f => f.id !== flashId),
      }));
      lockStartRef.current = null;
      lockKeyRef.current   = null;
    }, LASER_DURATION);
  }, []);

  useEffect(() => {
    const mount = document.querySelector<HTMLElement>('[data-viewport="main"]');
    if (!mount) return;
    mount.dispatchEvent(new CustomEvent("drone:enter"));
    activeRef.current = true;

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code==="KeyW") { keysRef.current.w = down; e.preventDefault(); }
      if (e.code==="KeyA") { keysRef.current.a = down; e.preventDefault(); }
      if (e.code==="KeyS") { keysRef.current.s = down; e.preventDefault(); }
      if (e.code==="KeyD") { keysRef.current.d = down; e.preventDefault(); }
      if (e.code==="KeyQ") { keysRef.current.q = down; e.preventDefault(); }
      if (e.code==="KeyE") { keysRef.current.e = down; e.preventDefault(); }
      if (e.code==="ShiftLeft"||e.code==="ShiftRight") keysRef.current.shift = down;
      if (down && e.key==="Escape") { activeRef.current=false; useModelStore.getState().setActiveTool("select"); }
      if (down && e.code==="Space") {
        e.preventDefault();
        setHud(prev => { if (prev.lockedTarget && prev.lockProgress>=1) fireWeapon(prev.lockedTarget); return prev; });
      }
      if (down && e.code==="KeyZ") setHud(prev => ({ ...prev, zoomLevel: prev.zoomLevel<4 ? prev.zoomLevel*2 : 1 }));
      if (down && e.code==="KeyV") setHud(prev => ({
        ...prev,
        cameraMode: prev.cameraMode==="EO" ? "IR" : prev.cameraMode==="IR" ? "WIDE" : "EO",
      }));
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!activeRef.current || document.pointerLockElement !== mount) return;
      const euler = eulerRef.current;
      const cs = getCamScene();
      if (!cs) return;
      euler.setFromQuaternion(cs.camera.quaternion);
      euler.y -= e.movementX * 0.0018;
      euler.x -= e.movementY * 0.0018;
      euler.x = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, euler.x));
      cs.camera.quaternion.setFromEuler(euler);
    };

    const onClick = () => {
      if (document.pointerLockElement !== mount) { mount.requestPointerLock(); return; }
      setHud(prev => { if (prev.lockedTarget && prev.lockProgress>=1) fireWeapon(prev.lockedTarget); return prev; });
    };

    document.addEventListener("keydown", onKey(true));
    document.addEventListener("keyup",   onKey(false));
    document.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("click", onClick);

    const tick = () => {
      if (!activeRef.current) return;
      frameRef.current = requestAnimationFrame(tick);

      const now  = performance.now();
      const dt   = Math.min((now - lastTimeRef.current)/1000, 0.1);
      lastTimeRef.current = now;

      const cs = getCamScene();
      if (!cs) return;
      const { camera, scene } = cs;

      const k = keysRef.current;
      const spd = (k.shift ? 80 : 25) * dt;
      let speedMag = 0;
      if (k.w) { camera.translateZ(-spd); speedMag = k.shift?80:25; }
      if (k.s) { camera.translateZ( spd); speedMag = k.shift?80:25; }
      if (k.a) { camera.translateX(-spd); speedMag = k.shift?80:25; }
      if (k.d) { camera.translateX( spd); speedMag = k.shift?80:25; }
      if (k.q) { camera.translateY(-spd); speedMag = k.shift?80:25; }
      if (k.e) { camera.translateY( spd); speedMag = k.shift?80:25; }
      if (k.w||k.a||k.s||k.d||k.q||k.e) mount.dispatchEvent(new CustomEvent("drone:moved"));

      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");
      const alt   = camera.position.y;
      const fwd   = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
      const hdg   = Math.round(Math.atan2(fwd.x,-fwd.z)*180/Math.PI+360)%360;
      const pitch = Math.round(euler.x*180/Math.PI);
      const roll  = Math.round(euler.z*180/Math.PI);

      // Vertical speed
      const dtVsp = (now - prevTimeRef.current)/1000;
      const vspd  = dtVsp>0 ? (alt - prevAltRef.current)/dtVsp : 0;
      prevAltRef.current = alt;
      prevTimeRef.current = now;

      // Ground clearance
      const allMesh: THREE.Mesh[] = [];
      scene.traverse(o => {
        if (o instanceof THREE.Mesh && o.visible && !o.userData.isHelper && !o.userData.isEdge && !o.userData.isXSSurface)
          allMesh.push(o);
      });
      const down = new THREE.Raycaster(camera.position.clone(), new THREE.Vector3(0,-1,0));
      const gHits = down.intersectObjects(allMesh, false);
      const groundClr = gHits[0]?.distance ?? 999;

      // Flight path vector (where camera is actually moving in screen space)
      const velVec = new THREE.Vector3(k.d?1:k.a?-1:0, k.e?1:k.q?-1:0, k.s?1:k.w?-1:0);
      let fpvX = 0.5, fpvY = 0.5;
      if (velVec.lengthSq() > 0) {
        velVec.applyQuaternion(camera.quaternion).normalize();
        const fpv = velVec.clone().project(camera);
        fpvX = (fpv.x+1)/2;
        fpvY = (-fpv.y+1)/2;
      }

      // Targets
      const targets: Target[] = [];
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      if (canvas) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const ray = new THREE.Raycaster();
        const angles = [
          [0,0],[0.07,0],[-0.07,0],[0,0.07],[0,-0.07],
          [0.14,0.07],[-0.14,0.07],[0.14,-0.07],[-0.14,-0.07],
          [0.22,0],[-0.22,0],[0,0.18],[0,-0.18],
          [0.3,0.12],[-0.3,0.12],
        ];
        const seen = new Set<string>();
        for (const [nx,ny] of angles) {
          ray.setFromCamera(new THREE.Vector2(nx,ny), camera);
          const hits = ray.intersectObjects(allMesh, false);
          for (const hit of hits.slice(0,1)) {
            const mesh = hit.object as THREE.Mesh;
            const eid  = mesh.userData?.expressId ?? 0;
            const mid  = mesh.userData?.modelId ?? "";
            const key  = `${mid}:${eid}`;
            if (seen.has(key) || destroyedRef.current.has(key)) continue;
            seen.add(key);
            const proj = hit.point.clone().project(camera);
            const sx = (proj.x+1)/2*w;
            const sy = (-proj.y+1)/2*h;
            const toT  = new THREE.Vector3().subVectors(hit.point, camera.position).normalize();
            const bear  = Math.round(Math.atan2(toT.x,-toT.z)*180/Math.PI+360)%360;
            const elev  = Math.round(Math.asin(toT.y)*180/Math.PI);
            let name = `Element ${eid}`, type = "UNKNOWN";
            for (const [m, model] of models) {
              if (m !== mid) continue;
              for (const [t, els] of Object.entries(model.elementsByType)) {
                const f = (els as any[]).find((e: any)=>e.expressId===eid);
                if (f) { name=f.name||name; type=t.replace("Ifc",""); break; }
              }
            }
            targets.push({ modelId:mid, expressId:eid, screenX:sx, screenY:sy, dist:hit.distance, name, type, bearing:bear, elevation:elev });
          }
        }
      }
      targets.sort((a,b)=>a.dist-b.dist);

      const center = targets[0] ?? null;
      let lockProgress = 0;
      if (center) {
        const key = `${center.modelId}:${center.expressId}`;
        if (lockKeyRef.current !== key) { lockKeyRef.current=key; lockStartRef.current=now; }
        lockProgress = Math.min(1, (now - (lockStartRef.current??now)) / LOCK_TIME_MS);
      } else {
        lockKeyRef.current=null; lockStartRef.current=null;
      }

      const missSec = Math.floor((Date.now()-missionStart.current)/1000);

      setHud(prev => ({
        ...prev,
        altitude: Math.round(alt*10)/10, altGround: Math.round(groundClr*10)/10,
        speed: Math.round(speedMag*3.6), vspeed: Math.round(vspd*10)/10,
        heading: hdg, pitch, roll,
        targets: targets.slice(0,10), lockedTarget: center, lockProgress,
        missionTime: missSec, fpvX, fpvY,
        datalink: 3 + (missSec%4 < 3 ? 1 : 0), // flicker simulation
      }));
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(frameRef.current);
      document.removeEventListener("keydown", onKey(true));
      document.removeEventListener("keyup",   onKey(false));
      document.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("click", onClick);
      if (document.pointerLockElement===mount) document.exitPointerLock();
      mount.dispatchEvent(new CustomEvent("drone:exit"));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locked      = document.pointerLockElement === document.querySelector('[data-viewport="main"]');
  const mm = String(Math.floor(hud.missionTime/60)).padStart(2,"0");
  const ss = String(hud.missionTime%60).padStart(2,"0");
  const irFilter = hud.cameraMode==="IR"
    ? "sepia(1) hue-rotate(60deg) saturate(3) brightness(0.85)"
    : hud.cameraMode==="WIDE" ? "brightness(0.92) contrast(1.1)" : undefined;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none select-none overflow-hidden" style={{ fontFamily:"'Courier New',monospace" }}>

      {/* Camera mode color grade overlay */}
      {irFilter && (
        <div className="absolute inset-0 pointer-events-none" style={{ background:"transparent", mixBlendMode:"color", filter:irFilter, opacity:0.15 }} />
      )}

      {/* CRT scan lines */}
      <div className="absolute inset-0" style={{
        backgroundImage:"repeating-linear-gradient(0deg,rgba(0,0,0,0.055) 0,rgba(0,0,0,0.055) 1px,transparent 1px,transparent 4px)",
        pointerEvents:"none",
      }}/>

      {/* Vignette */}
      <div className="absolute inset-0" style={{
        background:"radial-gradient(ellipse at center, transparent 48%, rgba(0,12,4,0.6) 100%)",
        pointerEvents:"none",
      }}/>

      {/* Hit flashes */}
      {hud.hitFlashes.map(f => (
        <div key={f.id} className="absolute pointer-events-none" style={{
          left: f.x-60, top: f.y-60, width:120, height:120,
          background:"radial-gradient(circle, rgba(255,100,0,0.7) 0%, transparent 70%)",
          animation:"drone-flash 0.5s ease-out forwards",
        }}/>
      ))}

      {/* === LASER BEAMS === */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow:"visible" }}>
        <defs>
          <filter id="laser-glow">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {hud.laserBeams.map(b => (
          <g key={b.id} filter="url(#laser-glow)">
            <line x1={b.fromX} y1={b.fromY} x2={b.toX} y2={b.toY} stroke="#ff2200" strokeWidth="4" strokeOpacity="0.85"/>
            <line x1={b.fromX} y1={b.fromY} x2={b.toX} y2={b.toY} stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.6"/>
            <circle cx={b.toX} cy={b.toY} r="12" fill="none" stroke="#ff4400" strokeWidth="2.5" strokeOpacity="0.9"/>
            <circle cx={b.toX} cy={b.toY} r="6"  fill="rgba(255,60,0,0.6)"/>
          </g>
        ))}
      </svg>

      {/* === TOP BAR === */}
      <TopBar kills={hud.kills} missionTime={`${mm}:${ss}`} datalink={hud.datalink} cameraMode={hud.cameraMode} zoomLevel={hud.zoomLevel} onExit={() => setActiveTool("select")} />

      {/* === HEADING TAPE === */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top:38 }}>
        <HeadingTape heading={hud.heading}/>
        <div className="text-center text-green-300 font-bold tabular-nums" style={{ fontSize:12, marginTop:2 }}>
          {String(hud.heading).padStart(3,"0")}° · {bearingLabel(hud.heading)}
        </div>
      </div>

      {/* === LEFT: Altitude === */}
      <div className="absolute" style={{ left:8, top:"50%", transform:"translateY(-50%)" }}>
        <AltTape value={hud.altitude}/>
        <div style={{ fontSize:10, color:"#86efac", textAlign:"center", marginTop:2 }}>
          {hud.altitude.toFixed(1)} m
        </div>
        <div style={{ fontSize:9, color: hud.vspeed>0?"#4ade80":hud.vspeed<0?"#f87171":"#86efac60", textAlign:"center" }}>
          {hud.vspeed>0?"+":""}{hud.vspeed.toFixed(1)} m/s
        </div>
        <div style={{ fontSize:9, color:"#86efac60", textAlign:"center", marginTop:4 }}>GND</div>
        <div style={{ fontSize:10, color: hud.altGround<5?"#f87171":hud.altGround<15?"#fbbf24":"#86efac", textAlign:"center", fontWeight:"bold" }}>
          {hud.altGround.toFixed(1)} m
        </div>
        {hud.altGround < 5 && (
          <div style={{ fontSize:9, color:"#f87171", textAlign:"center" }} className="animate-pulse">GROUND!</div>
        )}
      </div>

      {/* === RIGHT: Speed === */}
      <div className="absolute" style={{ right:8, top:"50%", transform:"translateY(-50%)" }}>
        <SpeedTape value={hud.speed}/>
        <div style={{ fontSize:10, color:"#86efac", textAlign:"center", marginTop:2 }}>
          {hud.speed} km/h
        </div>
        <div style={{ fontSize:9, color:"#86efac60", textAlign:"center", marginTop:4 }}>SHFT+</div>
        <div style={{ fontSize:9, color:"#86efac60", textAlign:"center" }}>BOOST</div>
      </div>

      {/* === CENTER AREA === */}
      {/* Artificial horizon + pitch ladder */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <PitchLadder pitch={hud.pitch} roll={hud.roll}/>
      </div>

      {/* Flight path vector */}
      <FlightPathVector fpvX={hud.fpvX} fpvY={hud.fpvY}/>

      {/* Main crosshair + lock ring */}
      <div className="absolute inset-0 flex items-center justify-center">
        <LockReticle locked={!!hud.lockedTarget} progress={hud.lockProgress}/>
      </div>

      {/* Target boxes */}
      {hud.targets.map(t => (
        <TargetBox
          key={`${t.modelId}:${t.expressId}`}
          target={t}
          isCenter={hud.lockedTarget?.expressId===t.expressId && hud.lockedTarget?.modelId===t.modelId}
          progress={hud.lockedTarget?.expressId===t.expressId ? hud.lockProgress : 0}
        />
      ))}

      {/* === THREAT LIST (right side) === */}
      {hud.targets.length > 0 && (
        <ThreatList targets={hud.targets} lockedKey={hud.lockedTarget ? `${hud.lockedTarget.modelId}:${hud.lockedTarget.expressId}` : null}/>
      )}

      {/* === BOTTOM BAR === */}
      <BottomBar hud={hud} locked={locked}/>

      {/* === CORNER DECOR === */}
      <CornerDecor/>
    </div>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────

function TopBar({ kills, missionTime, datalink, cameraMode, zoomLevel, onExit }: {
  kills: number; missionTime: string; datalink: number; cameraMode: string; zoomLevel: number; onExit():void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-1.5" style={{ borderBottom:"1px solid rgba(74,222,128,0.12)", background:"rgba(0,0,0,0.25)" }}>
      {/* Left cluster */}
      <div className="flex items-center gap-4">
        <div>
          <div style={{ fontSize:8, color:"rgba(74,222,128,0.5)", letterSpacing:"0.15em" }}>SYSTEM</div>
          <div className="flex gap-1.5 mt-0.5">
            {["ENG","NAV","WPN","COM","SEN","GPS"].map(s => (
              <div key={s} className="flex flex-col items-center gap-0.5">
                <div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 4px #4ade80" }}/>
                <span style={{ fontSize:7, color:"rgba(74,222,128,0.4)", letterSpacing:"0.1em" }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize:8, color:"rgba(74,222,128,0.5)", letterSpacing:"0.15em" }}>DATALINK</div>
          <div className="flex gap-0.5 mt-1 items-end">
            {[1,2,3,4].map(i => (
              <div key={i} style={{ width:4, height:4+i*2, background: i<=datalink?"#4ade80":"rgba(74,222,128,0.2)", borderRadius:1 }}/>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize:8, color:"rgba(74,222,128,0.5)", letterSpacing:"0.15em" }}>CAM MODE</div>
          <div className="flex gap-1 mt-0.5">
            {(["EO","IR","WIDE"] as const).map(m => (
              <span key={m} style={{ fontSize:8, color: m===cameraMode?"#4ade80":"rgba(74,222,128,0.3)", fontWeight: m===cameraMode?"bold":"normal" }}>
                {m===cameraMode?"["+m+"]":m}
              </span>
            ))}
            <span style={{ fontSize:8, color:"rgba(74,222,128,0.6)", marginLeft:4 }}>{zoomLevel}×</span>
          </div>
        </div>
      </div>

      {/* Center ID */}
      <div className="flex flex-col items-center">
        <div style={{ fontSize:10, color:"#86efac", letterSpacing:"0.25em", fontWeight:"bold" }}>UAV-7734 · INFRACORE</div>
        <div style={{ fontSize:8, color:"rgba(74,222,128,0.4)", letterSpacing:"0.12em" }}>MISSION TIME {missionTime}</div>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-4">
        <div>
          <div style={{ fontSize:8, color:"rgba(74,222,128,0.5)", letterSpacing:"0.15em" }}>KILLS</div>
          <div style={{ fontSize:16, color:"#f87171", fontWeight:"bold", textAlign:"center" }}>{kills}</div>
        </div>
        <button
          className="pointer-events-auto"
          onClick={onExit}
          style={{ fontSize:8, color:"rgba(74,222,128,0.5)", border:"1px solid rgba(74,222,128,0.2)", padding:"2px 6px", letterSpacing:"0.1em" }}
        >
          [ESC] EXIT
        </button>
      </div>
    </div>
  );
}

// ── HeadingTape ───────────────────────────────────────────────────────────────

function HeadingTape({ heading }: { heading: number }) {
  const W = 200, H = 20;
  const pxPerDeg = W / 40;
  const start = heading - 20;
  const ticks = [];
  for (let d = Math.floor(start/5)*5; d <= start+40; d+=5) {
    const x = (d - start) * pxPerDeg;
    const deg = ((d%360)+360)%360;
    const major = deg%10===0;
    ticks.push({ x, deg, major });
  }
  return (
    <svg width={W} height={H} style={{ display:"block" }}>
      <line x1={0} y1={H-1} x2={W} y2={H-1} stroke="rgba(74,222,128,0.25)" strokeWidth="1"/>
      {ticks.map((t,i) => (
        <g key={i}>
          <line x1={t.x} y1={H-1} x2={t.x} y2={t.major?H-8:H-4} stroke={t.major?"rgba(74,222,128,0.7)":"rgba(74,222,128,0.3)"} strokeWidth="1"/>
          {t.major && <text x={t.x} y={H-10} fill="rgba(74,222,128,0.55)" fontSize="7" textAnchor="middle">{String(t.deg).padStart(3,"0")}</text>}
        </g>
      ))}
      {/* Center pointer */}
      <polygon points={`${W/2-4},${H} ${W/2+4},${H} ${W/2},${H-6}`} fill="#4ade80"/>
    </svg>
  );
}

// ── PitchLadder ───────────────────────────────────────────────────────────────

function PitchLadder({ pitch, roll }: { pitch: number; roll: number }) {
  const W=280, H=220, cx=W/2, cy=H/2;
  const pxPerDeg = 5;
  const lines = [-30,-20,-15,-10,-5,0,5,10,15,20,30];
  return (
    <svg width={W} height={H} style={{ opacity:0.55 }}>
      <defs>
        <clipPath id="ladder-clip">
          <ellipse cx={cx} cy={cy} rx={cx-10} ry={cy-10}/>
        </clipPath>
      </defs>
      <g clipPath="url(#ladder-clip)" transform={`rotate(${roll}, ${cx}, ${cy})`}>
        {/* Sky / ground split */}
        <rect x={0} y={0} width={W} height={cy + pitch*pxPerDeg} fill="rgba(30,80,180,0.08)"/>
        <rect x={0} y={cy + pitch*pxPerDeg} width={W} height={H} fill="rgba(100,60,20,0.08)"/>
        {/* Horizon line */}
        <line x1={0} y1={cy + pitch*pxPerDeg} x2={W} y2={cy + pitch*pxPerDeg} stroke="rgba(74,222,128,0.7)" strokeWidth="1.5"/>
        {/* Degree lines */}
        {lines.filter(d=>d!==0).map(d => {
          const y = cy + (pitch+d)*pxPerDeg;
          const lw = Math.abs(d)%10===0 ? 60 : 36;
          const lbl = Math.abs(d);
          return (
            <g key={d}>
              <line x1={cx-lw/2} y1={y} x2={cx+lw/2} y2={y} stroke="rgba(74,222,128,0.45)" strokeWidth="0.8"/>
              <text x={cx-lw/2-10} y={y+3} fill="rgba(74,222,128,0.4)" fontSize="8" textAnchor="end">{lbl}</text>
              <text x={cx+lw/2+10} y={y+3} fill="rgba(74,222,128,0.4)" fontSize="8" textAnchor="start">{lbl}</text>
            </g>
          );
        })}
      </g>
      {/* Fixed aircraft wings */}
      <line x1={cx-50} y1={cy} x2={cx-10} y2={cy} stroke="#4ade80" strokeWidth="2"/>
      <line x1={cx+10} y1={cy} x2={cx+50} y2={cy} stroke="#4ade80" strokeWidth="2"/>
      <circle cx={cx} cy={cy} r="3" fill="#4ade80"/>
      {/* Bank indicator arc */}
      <BankArc cx={cx} cy={cy} roll={roll} r={cy-8}/>
      {/* Outer ellipse frame */}
      <ellipse cx={cx} cy={cy} rx={cx-10} ry={cy-10} fill="none" stroke="rgba(74,222,128,0.2)" strokeWidth="1"/>
    </svg>
  );
}

function BankArc({ cx, cy, roll, r }: { cx:number; cy:number; roll:number; r:number }) {
  const ticks = [-60,-45,-30,-20,-10,0,10,20,30,45,60];
  return (
    <g>
      {ticks.map(d => {
        const rad = (d-90)*Math.PI/180;
        const x1 = cx + r*Math.cos(rad);
        const y1 = cy + r*Math.sin(rad);
        const r2 = d%30===0 ? r-9 : d%10===0 ? r-5 : r-3;
        const x2 = cx + r2*Math.cos(rad);
        const y2 = cy + r2*Math.sin(rad);
        return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(74,222,128,0.35)" strokeWidth="1"/>;
      })}
      {/* Roll pointer */}
      {(() => {
        const rad = (roll-90)*Math.PI/180;
        const x1 = cx + (r-2)*Math.cos(rad);
        const y1 = cy + (r-2)*Math.sin(rad);
        const x2 = cx + (r-10)*Math.cos(rad);
        const y2 = cy + (r-10)*Math.sin(rad);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4ade80" strokeWidth="1.5"/>;
      })()}
    </g>
  );
}

// ── FlightPathVector ──────────────────────────────────────────────────────────

function FlightPathVector({ fpvX, fpvY }: { fpvX: number; fpvY: number }) {
  const x = fpvX * window.innerWidth;
  const y = fpvY * window.innerHeight;
  const r = 8;
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none">
      <circle cx={x} cy={y} r={r} fill="none" stroke="rgba(74,222,128,0.6)" strokeWidth="1.5"/>
      <line x1={x-r-4} y1={y} x2={x-r} y2={y} stroke="rgba(74,222,128,0.6)" strokeWidth="1.5"/>
      <line x1={x+r}   y1={y} x2={x+r+4} y2={y} stroke="rgba(74,222,128,0.6)" strokeWidth="1.5"/>
      <line x1={x} y1={y-r-4} x2={x} y2={y-r} stroke="rgba(74,222,128,0.6)" strokeWidth="1.5"/>
    </svg>
  );
}

// ── Altitude & Speed Tapes ────────────────────────────────────────────────────

function AltTape({ value }: { value: number }) {
  const H=110, W=52, pxPerUnit=4, center=H/2;
  const range=H/(2*pxPerUnit);
  const ticks = [];
  const step=5;
  for (let v=Math.floor((value-range)/step)*step; v<=value+range; v+=step) {
    const y=center-(v-value)*pxPerUnit;
    if (y<0||y>H) continue;
    ticks.push({ v, y, major:v%10===0 });
  }
  return (
    <svg width={W} height={H} style={{ display:"block" }}>
      <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.35)" rx="2"/>
      {ticks.map((t,i) => (
        <g key={i}>
          <line x1={W-1} y1={t.y} x2={W-(t.major?14:7)} y2={t.y} stroke={t.major?"rgba(74,222,128,0.65)":"rgba(74,222,128,0.3)"} strokeWidth="1"/>
          {t.major && <text x={W-16} y={t.y+3} fill="rgba(74,222,128,0.55)" fontSize="8" textAnchor="end">{t.v}</text>}
        </g>
      ))}
      {/* Current value box */}
      <rect x={0} y={center-8} width={W} height={16} fill="rgba(74,222,128,0.12)" rx="2"/>
      <line x1={W} y1={center} x2={W-8} y2={center-4} stroke="#4ade80" strokeWidth="1.5"/>
      <line x1={W} y1={center} x2={W-8} y2={center+4} stroke="#4ade80" strokeWidth="1.5"/>
    </svg>
  );
}

function SpeedTape({ value }: { value: number }) {
  const H=110, W=52, pxPerUnit=0.8, center=H/2;
  const range=H/(2*pxPerUnit);
  const step=10;
  const ticks = [];
  for (let v=Math.floor((value-range)/step)*step; v<=value+range; v+=step) {
    if (v<0) continue;
    const y=center-(v-value)*pxPerUnit;
    if (y<0||y>H) continue;
    ticks.push({ v, y, major:v%20===0 });
  }
  return (
    <svg width={W} height={H} style={{ display:"block" }}>
      <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.35)" rx="2"/>
      {ticks.map((t,i) => (
        <g key={i}>
          <line x1={0} y1={t.y} x2={t.major?14:7} y2={t.y} stroke={t.major?"rgba(74,222,128,0.65)":"rgba(74,222,128,0.3)"} strokeWidth="1"/>
          {t.major && <text x={16} y={t.y+3} fill="rgba(74,222,128,0.55)" fontSize="8" textAnchor="start">{t.v}</text>}
        </g>
      ))}
      <rect x={0} y={center-8} width={W} height={16} fill="rgba(74,222,128,0.12)" rx="2"/>
      <line x1={0} y1={center} x2={8} y2={center-4} stroke="#4ade80" strokeWidth="1.5"/>
      <line x1={0} y1={center} x2={8} y2={center+4} stroke="#4ade80" strokeWidth="1.5"/>
    </svg>
  );
}

// ── Lock Reticle ──────────────────────────────────────────────────────────────

function LockReticle({ locked, progress }: { locked: boolean; progress: number }) {
  const r = 40, sz = r*2+4;
  const color = locked&&progress>=1 ? "#f87171" : locked ? "#fbbf24" : "#4ade80";
  const circ  = 2*Math.PI*r;
  return (
    <div style={{ position:"relative", width:sz, height:sz, color }}>
      {/* Acquisition progress arc */}
      {locked && progress < 1 && (
        <svg className="absolute inset-0" style={{ animation:"drone-spin 1.4s linear infinite" }} width={sz} height={sz}>
          <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={color}
            strokeWidth="1.5" strokeOpacity="0.7"
            strokeDasharray={`${circ*progress} ${circ}`}
          />
        </svg>
      )}
      {/* Full lock ring (double) */}
      {locked && progress>=1 && (
        <svg className="absolute inset-0" width={sz} height={sz}>
          <circle cx={sz/2} cy={sz/2} r={r}   fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.8"/>
          <circle cx={sz/2} cy={sz/2} r={r-5}  fill="none" stroke={color} strokeWidth="0.7" strokeOpacity="0.5"/>
        </svg>
      )}
      {/* H + V gaps */}
      <div style={{ position:"absolute", top:sz/2-0.5, left:0,     width:sz/2-14, height:1, background:"currentColor" }}/>
      <div style={{ position:"absolute", top:sz/2-0.5, right:0,    width:sz/2-14, height:1, background:"currentColor" }}/>
      <div style={{ position:"absolute", left:sz/2-0.5, top:0,     height:sz/2-14, width:1, background:"currentColor" }}/>
      <div style={{ position:"absolute", left:sz/2-0.5, bottom:0,  height:sz/2-14, width:1, background:"currentColor" }}/>
      {/* Center dot */}
      <div style={{ position:"absolute", top:sz/2-2, left:sz/2-2, width:4, height:4, borderRadius:"50%", background:"currentColor" }}/>
      {/* Corner brackets */}
      {[
        { top:0,left:0,    borderTop:"1.5px solid",borderLeft:"1.5px solid"  },
        { top:0,right:0,   borderTop:"1.5px solid",borderRight:"1.5px solid" },
        { bottom:0,left:0,  borderBottom:"1.5px solid",borderLeft:"1.5px solid"  },
        { bottom:0,right:0, borderBottom:"1.5px solid",borderRight:"1.5px solid" },
      ].map((s,i) => (
        <div key={i} style={{ position:"absolute", ...s, width:10, height:10, borderColor:"currentColor" }}/>
      ))}
      {/* % readout during acquisition */}
      {locked && progress<1 && (
        <div style={{ position:"absolute", top:sz+2, left:"50%", transform:"translateX(-50%)", fontSize:9, color, whiteSpace:"nowrap" }}>
          ACQ {Math.round(progress*100)}%
        </div>
      )}
    </div>
  );
}

// ── Target Box ────────────────────────────────────────────────────────────────

function TargetBox({ target, isCenter, progress }: { target: Target; isCenter: boolean; progress: number }) {
  const color = isCenter&&progress>=1 ? "#f87171" : isCenter ? "#fbbf24" : "#4ade8066";
  const sz = isCenter ? 30 : 20;
  return (
    <div style={{ position:"absolute", left:target.screenX, top:target.screenY, transform:"translate(-50%,-50%)", pointerEvents:"none" }}>
      {/* Box */}
      <svg width={sz} height={sz}>
        {[
          [0,0,8,0],[sz-8,0,sz,0],[sz,0,sz,8],
          [0,sz-8,0,sz],[0,sz,8,sz],
          [sz-8,sz,sz,sz],[sz,sz-8,sz,sz],
        ].map(([x1,y1,x2,y2],i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5"/>
        ))}
      </svg>
      {/* Labels */}
      <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", marginTop:2, whiteSpace:"nowrap", textAlign:"center" }}>
        <div style={{ fontSize:8, color, textTransform:"uppercase" }}>{target.type.slice(0,10)}</div>
        <div style={{ fontSize:9, color, fontWeight:"bold" }}>{target.dist.toFixed(0)}m</div>
        <div style={{ fontSize:7, color:"rgba(74,222,128,0.5)" }}>EL {target.elevation>0?"+":""}{target.elevation}°</div>
        {isCenter && progress<1 && (
          <div style={{ fontSize:8, color:"#fbbf24" }}>ACQ {Math.round(progress*100)}%</div>
        )}
        {isCenter && progress>=1 && (
          <div style={{ fontSize:8, color:"#f87171", animation:"none" }}>◆ LOCKED ◆</div>
        )}
      </div>
    </div>
  );
}

// ── Threat List ───────────────────────────────────────────────────────────────

function ThreatList({ targets, lockedKey }: { targets: Target[]; lockedKey: string|null }) {
  return (
    <div style={{ position:"absolute", top:72, right:72, minWidth:160 }}>
      <div style={{ fontSize:8, color:"rgba(74,222,128,0.45)", letterSpacing:"0.18em", marginBottom:4 }}>
        CONTACTS ({targets.length})
      </div>
      {targets.slice(0,7).map(t => {
        const key = `${t.modelId}:${t.expressId}`;
        const lk  = key===lockedKey;
        return (
          <div key={key} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
            <span style={{ fontSize:8, color:lk?"#f87171":"rgba(74,222,128,0.4)", width:8 }}>{lk?"◆":"·"}</span>
            <span style={{ fontSize:8, color:lk?"#f87171":"rgba(74,222,128,0.65)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {t.name.slice(0,15)}
            </span>
            <span style={{ fontSize:8, color:"rgba(74,222,128,0.5)", fontVariantNumeric:"tabular-nums" }}>{t.dist.toFixed(0)}m</span>
            <span style={{ fontSize:8, color:"rgba(74,222,128,0.4)" }}>{String(t.bearing).padStart(3,"0")}°</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Bottom Bar ────────────────────────────────────────────────────────────────

function BottomBar({ hud, locked }: { hud: HudState; locked: boolean }) {
  const kbHint = locked ? "WASD MOVE · Q/E ALT · SHIFT BOOST · SPACE/CLICK FIRE · Z ZOOM · V CAM" : "CLICK TO ACTIVATE POINTER LOCK";
  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-3 pb-2"
      style={{ borderTop:"1px solid rgba(74,222,128,0.1)", background:"rgba(0,0,0,0.2)" }}>
      {/* Left: Position */}
      <div style={{ minWidth:160 }}>
        <div style={{ fontSize:8, color:"rgba(74,222,128,0.45)", letterSpacing:"0.15em" }}>POSITION</div>
        <div style={{ fontSize:9, color:"#86efac", fontWeight:"bold" }}>
          {hud.altitude.toFixed(0).padStart(4,"0")}m ASL · HDG {String(hud.heading).padStart(3,"0")}°
        </div>
        <div style={{ fontSize:8, color:"rgba(74,222,128,0.4)" }}>
          PITCH {hud.pitch>0?"+":""}{hud.pitch}° · ROLL {hud.roll>0?"+":""}{hud.roll}°
        </div>
      </div>

      {/* Center: Weapon / lock status */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
        {hud.lockedTarget && hud.lockProgress>=1 && (
          <div style={{ fontSize:10, color:"#f87171", fontWeight:"bold", letterSpacing:"0.2em", border:"1px solid rgba(248,113,113,0.5)", padding:"1px 10px", animation:"drone-flash-border 0.8s step-end infinite" }}>
            ◆ TARGET LOCKED · FIRE READY ◆
          </div>
        )}
        {hud.lockedTarget && hud.lockProgress<1 && (
          <div style={{ fontSize:9, color:"#fbbf24", letterSpacing:"0.15em", border:"1px solid rgba(251,191,36,0.35)", padding:"1px 8px" }}>
            ACQUIRING TARGET {Math.round(hud.lockProgress*100)}%
          </div>
        )}
        <div style={{ fontSize:8, color:"rgba(74,222,128,0.45)" }}>{kbHint}</div>
      </div>

      {/* Right: Weapon status */}
      <div style={{ minWidth:120, textAlign:"right" }}>
        <div style={{ fontSize:8, color:"rgba(74,222,128,0.45)", letterSpacing:"0.15em" }}>WEAPON STATUS</div>
        <div style={{ fontSize:9, color: hud.lockedTarget&&hud.lockProgress>=1 ? "#f87171":"#86efac", fontWeight:"bold" }}>
          {hud.lockedTarget&&hud.lockProgress>=1 ? "ARM · READY" : "SAFE · SEARCHING"}
        </div>
        <div style={{ fontSize:8, color:"rgba(74,222,128,0.4)" }}>KILLS: {hud.kills} · AMMO: ∞</div>
      </div>
    </div>
  );
}

// ── Corner Decor ──────────────────────────────────────────────────────────────

function CornerDecor() {
  const s: React.CSSProperties = { position:"absolute", width:32, height:32, borderColor:"rgba(74,222,128,0.18)" };
  return (
    <>
      <div style={{ ...s, top:8, left:8,   borderTop:"1px solid", borderLeft:"1px solid"  }}/>
      <div style={{ ...s, top:8, right:8,  borderTop:"1px solid", borderRight:"1px solid" }}/>
      <div style={{ ...s, bottom:8, left:8,  borderBottom:"1px solid", borderLeft:"1px solid"  }}/>
      <div style={{ ...s, bottom:8, right:8, borderBottom:"1px solid", borderRight:"1px solid" }}/>
    </>
  );
}

// ── Bearing label helper ──────────────────────────────────────────────────────

function bearingLabel(h: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(h/22.5)%16];
}
