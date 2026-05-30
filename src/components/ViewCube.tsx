import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const S = 76;
const H = S / 2;
const DOT = 9;

interface Props {
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  visible: boolean;
  onPreset: (preset: string) => void;
}

const FACES = [
  { t: `rotateY(0deg) translateZ(${H}px)`,    p: "front",  l: "Vorne"  },
  { t: `rotateY(180deg) translateZ(${H}px)`,  p: "back",   l: "Hinten" },
  { t: `rotateY(90deg) translateZ(${H}px)`,   p: "right",  l: "Rechts" },
  { t: `rotateY(-90deg) translateZ(${H}px)`,  p: "left",   l: "Links"  },
  { t: `rotateX(-90deg) translateZ(${H}px)`,  p: "top",    l: "Oben"   },
  { t: `rotateX(90deg) translateZ(${H}px)`,   p: "bottom", l: "Unten"  },
];

// 8 corners: (cx, cy, cz) in cube-local space, each ±H
const CORNERS = [
  { cx: +H, cy: -H, cz: +H, p: "iso-ftr" },
  { cx: -H, cy: -H, cz: +H, p: "iso-ftl" },
  { cx: +H, cy: +H, cz: +H, p: "iso-fbr" },
  { cx: -H, cy: +H, cz: +H, p: "iso-fbl" },
  { cx: +H, cy: -H, cz: -H, p: "iso-btr" },
  { cx: -H, cy: -H, cz: -H, p: "iso-btl" },
  { cx: +H, cy: +H, cz: -H, p: "iso-bbr" },
  { cx: -H, cy: +H, cz: -H, p: "iso-bbl" },
];

// Module-level preallocated — never reallocated during renders or event callbacks.
const _mat = new THREE.Matrix4();
const _qInv = new THREE.Quaternion();

export function ViewCube({ cameraRef, controlsRef, visible, onPreset }: Props) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Subscribe to controls.change and directly mutate the cube DOM element —
  // zero React state updates on camera move, no re-renders at 60fps.
  //
  // Problem: ViewCube mounts before ViewportContainer's init useEffect runs,
  // so controlsRef.current is null on first render. We poll with RAF until
  // controls become available, then subscribe once and stay subscribed.
  useEffect(() => {
    if (!visible) return;

    const updateTransform = () => {
      const cube = cubeRef.current;
      const camera = cameraRef.current;
      if (!cube || !camera) return;
      _qInv.copy(camera.quaternion).invert();
      _mat.makeRotationFromQuaternion(_qInv);
      const e = _mat.elements;
      cube.style.transform =
        `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
    };

    let rafId = 0;
    let subscribedControls: typeof controlsRef.current = null;

    const trySubscribe = () => {
      const controls = controlsRef.current;
      if (controls) {
        subscribedControls = controls;
        controls.addEventListener("change", updateTransform);
        updateTransform(); // initial sync once controls exist
      } else {
        // Controls not ready yet — retry next frame (typically resolves in 1–2 frames)
        rafId = requestAnimationFrame(trySubscribe);
      }
    };

    trySubscribe();

    return () => {
      cancelAnimationFrame(rafId);
      subscribedControls?.removeEventListener("change", updateTransform);
    };
  }, [visible, cameraRef, controlsRef]);

  if (!visible) return null;

  return (
    <div
      className="absolute select-none z-40"
      style={{ top: 12, right: 12, width: S + 24, height: S + 24, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ perspective: "260px", width: S, height: S }}>
        <div
          ref={cubeRef}
          style={{ width: S, height: S, position: "relative", transformStyle: "preserve-3d", transformOrigin: "50% 50% 0" }}
        >
          {FACES.map(f => (
            <div
              key={f.p}
              onClick={() => onPreset(f.p)}
              onMouseEnter={() => setHovered(f.p)}
              onMouseLeave={() => setHovered(null)}
              style={{
                position: "absolute",
                inset: 0,
                transform: f.t,
                backfaceVisibility: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 2,
                background: hovered === f.p
                  ? f.p === "top" ? "rgba(0,120,212,0.97)" : "rgba(90,120,170,0.97)"
                  : f.p === "top" ? "rgba(0,120,212,0.82)" : "rgba(28,45,72,0.82)",
                fontSize: 8.5,
                fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif",
                fontWeight: 700,
                color: hovered === f.p ? "#fff" : "rgba(210,225,255,0.92)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                userSelect: "none",
                transition: "background 0.08s, color 0.08s",
              }}
            >
              {f.l}
            </div>
          ))}

          {CORNERS.map(c => (
            <div
              key={c.p}
              onClick={() => onPreset(c.p)}
              onMouseEnter={() => setHovered(c.p)}
              onMouseLeave={() => setHovered(null)}
              style={{
                position: "absolute",
                left: 0, top: 0,
                width: DOT, height: DOT,
                transform: `translate3d(${H + c.cx - DOT / 2}px,${H + c.cy - DOT / 2}px,${c.cz}px)`,
                backfaceVisibility: "hidden",
                background: hovered === c.p ? "#ffffff" : "rgba(180,210,255,0.75)",
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.45)",
                cursor: "pointer",
                transition: "background 0.08s",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
