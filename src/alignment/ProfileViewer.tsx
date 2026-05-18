import { useRef, useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { useAlignmentStore } from "./alignmentStore";
import { useModelStore } from "../store/modelStore";
import { evaluateProfile } from "./landXmlParser";
import type { Alignment } from "./types";

function fmtSta(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m = sta - km * 1000;
  return `${km}+${m.toFixed(0).padStart(3, "0")}`;
}

function computeTicks(min: number, max: number, target: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / mag;
  const step = n < 1.5 ? mag : n < 3.5 ? 2 * mag : n < 7.5 ? 5 * mag : 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 1e-9; t += step)
    ticks.push(parseFloat(t.toFixed(10)));
  return ticks;
}

function sampleProfilePoints(a: Alignment, steps = 400): Array<{ sta: number; elev: number }> {
  const { tangents, curves } = a.profileGeom;
  if (!tangents.length && !curves.length) return [];
  const out: Array<{ sta: number; elev: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const sta = a.staStart + (i / steps) * (a.staEnd - a.staStart);
    const elev = evaluateProfile(a.profileGeom, sta);
    if (elev !== null) out.push({ sta, elev });
  }
  return out;
}

const M = { top: 10, right: 16, bottom: 36, left: 62 };

export function ProfileViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 200 });

  const files            = useAlignmentStore(s => s.files);
  const colors           = useAlignmentStore(s => s.colors);
  const visibleIds       = useAlignmentStore(s => s.visibleIds);
  const setProfileHover  = useAlignmentStore(s => s.setProfileHover);
  const setOpen          = useModelStore(s => s.setProfilePanelOpen);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(120, width), h: Math.max(60, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const alignments = useMemo(
    () => files.flatMap(f => f.alignments).filter(
      a => a.profileGeom.tangents.length > 0 || a.profileGeom.curves.length > 0
    ),
    [files]
  );

  const profiles = useMemo(
    () => alignments.map(a => ({
      a,
      color: colors[a.id] ?? "#888",
      visible: visibleIds.has(a.id),
      pts: sampleProfilePoints(a),
    })),
    [alignments, colors, visibleIds]
  );

  const domain = useMemo(() => {
    let sMin = Infinity, sMax = -Infinity, eMin = Infinity, eMax = -Infinity;
    for (const { pts, visible } of profiles) {
      if (!visible) continue;
      for (const p of pts) {
        if (p.sta < sMin) sMin = p.sta;
        if (p.sta > sMax) sMax = p.sta;
        if (p.elev < eMin) eMin = p.elev;
        if (p.elev > eMax) eMax = p.elev;
      }
    }
    if (!isFinite(sMin)) {
      for (const { pts } of profiles) {
        for (const p of pts) {
          if (p.sta < sMin) sMin = p.sta;
          if (p.sta > sMax) sMax = p.sta;
          if (p.elev < eMin) eMin = p.elev;
          if (p.elev > eMax) eMax = p.elev;
        }
      }
    }
    if (!isFinite(sMin)) return { sMin: 0, sMax: 1000, eMin: 0, eMax: 100 };
    const ep = Math.max(2, (eMax - eMin) * 0.15);
    return { sMin, sMax, eMin: eMin - ep, eMax: eMax + ep };
  }, [profiles]);

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  const xs = (sta: number) => M.left + ((sta - domain.sMin) / (domain.sMax - domain.sMin || 1)) * chartW;
  const ys = (elev: number) => M.top + chartH * (1 - (elev - domain.eMin) / (domain.eMax - domain.eMin || 1));

  const [hoverSta, setHoverSta] = useState<number | null>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < M.left || mx > M.left + chartW) {
      setHoverSta(null);
      setProfileHover(null, null);
      return;
    }
    const sta = domain.sMin + ((mx - M.left) / chartW) * (domain.sMax - domain.sMin);
    setHoverSta(sta);
    const first = profiles.find(p => p.visible);
    setProfileHover(first?.a.id ?? null, sta);
  };

  const handleMouseLeave = () => {
    setHoverSta(null);
    setProfileHover(null, null);
  };

  const xTicks = useMemo(
    () => computeTicks(domain.sMin, domain.sMax, Math.max(3, Math.floor(chartW / 90))),
    [domain.sMin, domain.sMax, chartW]
  );
  const yTicks = useMemo(
    () => computeTicks(domain.eMin, domain.eMax, 5),
    [domain.eMin, domain.eMax]
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-background flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-0.5 border-b border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Längenschnitt
        </span>
        <div className="flex items-center gap-1.5 ml-1 flex-1 overflow-hidden">
          {profiles.map(({ a, color, visible }) => (
            <span key={a.id} className="flex items-center gap-1 text-[9px] shrink-0" style={{ opacity: visible ? 1 : 0.4 }}>
              <span className="w-2.5 h-0.5 rounded-full inline-block" style={{ background: color }} />
              <span className="text-muted-foreground truncate max-w-24">{a.displayName}</span>
            </span>
          ))}
        </div>
        {hoverSta !== null && (
          <span className="text-[9px] font-mono text-muted-foreground shrink-0">
            {fmtSta(hoverSta)}
          </span>
        )}
        <button
          onClick={() => setOpen(false)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0">
        {alignments.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            Kein Profil geladen — LandXML-Achse mit Gradiente öffnen
          </div>
        ) : (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ cursor: "crosshair", display: "block" }}
          >
            {/* Horizontal grid */}
            {yTicks.map(e => (
              <line key={e}
                x1={M.left} y1={ys(e)} x2={M.left + chartW} y2={ys(e)}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,4"
              />
            ))}

            {/* Profile polylines */}
            {profiles.map(({ a, color, visible, pts }) => pts.length < 2 ? null : (
              <polyline key={a.id}
                points={pts.map(p => `${xs(p.sta)},${ys(p.elev)}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                opacity={visible ? 1 : 0.2}
              />
            ))}

            {/* VPI markers */}
            {profiles.map(({ a, color, visible }) =>
              a.profileGeom.vertices.map((v, i) => (
                <circle key={`${a.id}-${i}`}
                  cx={xs(v.sta)} cy={ys(v.elev)} r={2.5}
                  fill={color} opacity={visible ? 1 : 0.15}
                />
              ))
            )}

            {/* Hover vertical line + dots */}
            {hoverSta !== null && (
              <>
                <line
                  x1={xs(hoverSta)} y1={M.top} x2={xs(hoverSta)} y2={M.top + chartH}
                  stroke="white" strokeWidth={1} strokeDasharray="3,2" opacity={0.5}
                />
                {profiles.map(({ a, color, visible }) => {
                  if (!visible) return null;
                  const elev = evaluateProfile(a.profileGeom, hoverSta);
                  if (elev === null) return null;
                  return (
                    <circle key={a.id}
                      cx={xs(hoverSta)} cy={ys(elev)} r={3.5}
                      fill={color} stroke="white" strokeWidth={1.5}
                    />
                  );
                })}
                {/* Elevation labels next to dots */}
                {profiles.filter(p => p.visible).map(({ a, color }) => {
                  const elev = evaluateProfile(a.profileGeom, hoverSta);
                  if (elev === null) return null;
                  const cx = xs(hoverSta);
                  const cy = ys(elev);
                  const flip = cx > M.left + chartW * 0.75;
                  return (
                    <text key={a.id}
                      x={flip ? cx - 5 : cx + 5}
                      y={cy - 4}
                      textAnchor={flip ? "end" : "start"}
                      fontSize={9}
                      fill={color}
                      fontFamily="monospace"
                    >
                      {elev.toFixed(2)}
                    </text>
                  );
                })}
              </>
            )}

            {/* X axis line */}
            <line
              x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1}
            />
            {xTicks.map(sta => (
              <g key={sta}>
                <line
                  x1={xs(sta)} y1={M.top + chartH} x2={xs(sta)} y2={M.top + chartH + 4}
                  stroke="var(--color-muted-foreground)" strokeWidth={1}
                />
                <text
                  x={xs(sta)} y={M.top + chartH + 14}
                  textAnchor="middle" fontSize={9}
                  fill="var(--color-muted-foreground)" fontFamily="monospace"
                >
                  {fmtSta(sta)}
                </text>
              </g>
            ))}

            {/* Y axis line */}
            <line
              x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1}
            />
            {yTicks.map(e => (
              <g key={e}>
                <line
                  x1={M.left - 4} y1={ys(e)} x2={M.left} y2={ys(e)}
                  stroke="var(--color-muted-foreground)" strokeWidth={1}
                />
                <text
                  x={M.left - 7} y={ys(e) + 3}
                  textAnchor="end" fontSize={9}
                  fill="var(--color-muted-foreground)" fontFamily="monospace"
                >
                  {e.toFixed(1)}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
