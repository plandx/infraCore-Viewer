import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const S = 76;
const H = S / 2;
const DOT = 9;

interface Props {
  cameraQuat: THREE.Quaternion;
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

// 8 corners in cube-local space (cx,cy,cz) = ±H
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

// Preallocated — never recreated during render
const _mat = new THREE.Matrix4();
const _qInv = new THREE.Quaternion();

export function ViewCube({ cameraQuat, visible, onPreset }: Props) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const cube = cubeRef.current;
    if (!cube || !visible) return;
    _qInv.copy(cameraQuat).invert();
    _mat.makeRotationFromQuaternion(_qInv);
    const e = _mat.elements;
    // Three.js is Y-up; CSS 3D is Y-down. Flip Y row + Y column of 3×3 rotation block.
    // CSS matrix3d is column-major: each group of 4 = one column (x, y, z, w).
    cube.style.transform = `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
  }, [cameraQuat, visible]);

  if (!visible) return null;

  return (
    <div
      className="absolute select-none z-40"
      style={{ top: 12, right: 12, width: S + 24, height: S + 24, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {/* Perspective wrapper */}
      <div style={{ perspective: "260px", width: S, height: S }}>
        {/* Rotating cube */}
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

          {/* Corner dots — 3D positioned at each of the 8 cube corners */}
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
                background: hovered === c.p ? "#ffffff" : "rgba(180,210,255,0.75)",
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.45)",
                cursor: "pointer",
                transition: "background 0.08s",
                zIndex: 10,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
