import { useRef, useState, useEffect, useMemo } from "react";
import { X, ZoomIn } from "lucide-react";
import { useAlignmentStore } from "./alignmentStore";
import { useModelStore } from "../store/modelStore";
import { evaluateProfile } from "./landXmlParser";
import { openCrossSectionWindow } from "../utils/windowSync";
import type { Alignment } from "./types";

function fmtSta(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m = sta - km * 1000;
  return `${km}+${m.toFixed(3).padStart(7, "0")}`;
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
  const svgRef        = useRef<SVGSVGElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 200 });

  const files           = useAlignmentStore(s => s.files);
  const colors          = useAlignmentStore(s => s.colors);
  const visibleIds      = useAlignmentStore(s => s.visibleIds);
  const setProfileHover  = useAlignmentStore(s => s.setProfileHover);
  const openCrossSection = useAlignmentStore(s => s.openCrossSection);
  const crossSectionSta  = useAlignmentStore(s => s.crossSectionStation);
  const crossSectionOpen = useAlignmentStore(s => s.crossSectionOpen);
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

  // Full data domain (elevation only)
  const domain = useMemo(() => {
    let sMin = Infinity, sMax = -Infinity, eMin = Infinity, eMax = -Infinity;
    for (const { pts } of profiles) {
      for (const p of pts) {
        if (p.sta < sMin) sMin = p.sta;
        if (p.sta > sMax) sMax = p.sta;
        if (p.elev < eMin) eMin = p.elev;
        if (p.elev > eMax) eMax = p.elev;
      }
    }
    if (!isFinite(sMin)) return { sMin: 0, sMax: 1000, eMin: 0, eMax: 100 };
    const ep = Math.max(2, (eMax - eMin) * 0.15);
    return { sMin, sMax, eMin: eMin - ep, eMax: eMax + ep };
  }, [profiles]);

  // Zoom/pan: [viewMin, viewMax] in station units; null = full view
  const [viewSta, setViewSta] = useState<[number, number] | null>(null);
  useEffect(() => { setViewSta(null); }, [domain.sMin, domain.sMax]);

  const vMin = viewSta ? viewSta[0] : domain.sMin;
  const vMax = viewSta ? viewSta[1] : domain.sMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  const xs = (sta: number) => M.left + ((sta - vMin) / (vMax - vMin || 1)) * chartW;
  const ys = (elev: number) => M.top + chartH * (1 - (elev - domain.eMin) / (domain.eMax - domain.eMin || 1));

  // Wheel zoom (non-passive listener to allow preventDefault)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const curMin = viewStaRef.current ? viewStaRef.current[0] : domainRef.current.sMin;
      const curMax = viewStaRef.current ? viewStaRef.current[1] : domainRef.current.sMax;
      const cw = rect.width - M.left - M.right;
      const centerSta = curMin + Math.max(0, Math.min(1, (mx - M.left) / cw)) * (curMax - curMin);
      const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
      const half = (curMax - curMin) * factor / 2;
      const dom = domainRef.current;
      const newMin = Math.max(dom.sMin, centerSta - half * ((centerSta - curMin) / (curMax - curMin || 1)) * 2);
      const newMax = Math.min(dom.sMax, newMin + half * 2);
      setViewSta([newMin, newMax]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // Re-attach when svg mounts; refs handle current values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs so wheel handler always sees current values without needing to re-attach
  const viewStaRef = useRef<[number, number] | null>(null);
  const domainRef  = useRef(domain);
  useEffect(() => { viewStaRef.current = viewSta; }, [viewSta]);
  useEffect(() => { domainRef.current = domain; }, [domain]);

  // Drag pan state
  const dragRef = useRef<{ x: number; min: number; max: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [hoverSta, setHoverSta] = useState<number | null>(null);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 0) {
      dragRef.current = { x: e.clientX, min: vMin, max: vMax };
      setIsDragging(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // Pan while dragging
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const range = dragRef.current.max - dragRef.current.min;
      const staDx = -(dx / chartW) * range;
      const dom = domainRef.current;
      const newMin = Math.max(dom.sMin, Math.min(dom.sMax - range, dragRef.current.min + staDx));
      setViewSta([newMin, newMin + range]);
      return;
    }

    // Hover
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < M.left || mx > M.left + chartW) {
      setHoverSta(null);
      setProfileHover(null, null);
      return;
    }
    const sta = vMin + ((mx - M.left) / chartW) * (vMax - vMin);
    setHoverSta(sta);
    const first = profiles.find(p => p.visible);
    setProfileHover(first?.a.id ?? null, sta);
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    // Click (not drag) → set cross-section station
    if (dragRef.current && Math.abs(e.clientX - dragRef.current.x) < 5) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (mx >= M.left && mx <= M.left + chartW) {
        const sta = vMin + ((mx - M.left) / chartW) * (vMax - vMin);
        const first = profiles.find(p => p.visible);
        if (first && sta >= domain.sMin && sta <= domain.sMax) {
          openCrossSection(first.a.id, sta);
          openCrossSectionWindow();
        }
      }
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    dragRef.current = null;
    setIsDragging(false);
    setHoverSta(null);
    setProfileHover(null, null);
  };

  const xTicks = useMemo(
    () => computeTicks(vMin, vMax, Math.max(3, Math.floor(chartW / 90))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vMin, vMax, chartW]
  );
  const yTicks = useMemo(
    () => computeTicks(domain.eMin, domain.eMax, 5),
    [domain.eMin, domain.eMax]
  );

  const isZoomed = viewSta !== null;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-0.5 border-b border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Längenschnitt
        </span>
        <div className="flex items-center gap-1.5 ml-1 flex-1 overflow-hidden">
          {profiles.map(({ a, color, visible }) => (
            <span key={a.id} className="flex items-center gap-1 text-[9px] shrink-0" style={{ opacity: visible ? 1 : 0.4 }}>
              <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: color }} />
              <span className="text-muted-foreground truncate max-w-24">{a.displayName}</span>
            </span>
          ))}
        </div>
        {hoverSta !== null && (
          <span className="text-[9px] font-mono text-muted-foreground shrink-0">
            {fmtSta(hoverSta)}
          </span>
        )}
        {isZoomed && (
          <button
            onClick={() => setViewSta(null)}
            className="shrink-0 flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
            title="Zoom zurücksetzen"
          >
            <ZoomIn size={10} />
            Reset
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {alignments.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            Kein Profil geladen — LandXML-Achse mit Gradiente öffnen
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{ cursor: isDragging ? "grabbing" : "crosshair", display: "block" }}
          >
            {/* Horizontal grid */}
            {yTicks.map(e => (
              <line key={e}
                x1={M.left} y1={ys(e)} x2={M.left + chartW} y2={ys(e)}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,4"
              />
            ))}

            {/* Clip to chart area via inline clip-path */}
            <defs>
              <clipPath id="profile-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
            </defs>

            <g clipPath="url(#profile-clip)">
              {/* Active cross-section station marker */}
              {crossSectionOpen && crossSectionSta !== null && xs(crossSectionSta) >= M.left && xs(crossSectionSta) <= M.left + chartW && (
                <line
                  x1={xs(crossSectionSta)} y1={M.top}
                  x2={xs(crossSectionSta)} y2={M.top + chartH}
                  stroke="#4488ff" strokeWidth={1.5} opacity={0.8}
                />
              )}

              {/* Profile polylines */}
              {profiles.map(({ a, color, visible, pts }) => pts.length < 2 ? null : (
                <polyline key={a.id}
                  points={pts.map(p => `${xs(p.sta)},${ys(p.elev)}`).join(" ")}
                  fill="none" stroke={color} strokeWidth={1.5}
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

              {/* Hover line + dots */}
              {hoverSta !== null && (
                <>
                  <line
                    x1={xs(hoverSta)} y1={M.top} x2={xs(hoverSta)} y2={M.top + chartH}
                    stroke="white" strokeWidth={1} strokeDasharray="3,2" opacity={0.5}
                  />
                  {profiles.filter(p => p.visible).map(({ a, color }) => {
                    const elev = evaluateProfile(a.profileGeom, hoverSta);
                    if (elev === null) return null;
                    const flip = xs(hoverSta) > M.left + chartW * 0.75;
                    return (
                      <g key={a.id}>
                        <circle cx={xs(hoverSta)} cy={ys(elev)} r={3.5}
                          fill={color} stroke="white" strokeWidth={1.5} />
                        <text
                          x={flip ? xs(hoverSta) - 5 : xs(hoverSta) + 5}
                          y={ys(elev) - 4}
                          textAnchor={flip ? "end" : "start"}
                          fontSize={9} fill={color} fontFamily="monospace"
                        >
                          {elev.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}
                </>
              )}
            </g>

            {/* X axis */}
            <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {xTicks.map(sta => (
              <g key={sta}>
                <line x1={xs(sta)} y1={M.top + chartH} x2={xs(sta)} y2={M.top + chartH + 4}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={xs(sta)} y={M.top + chartH + 14}
                  textAnchor="middle" fontSize={9}
                  fill="var(--color-muted-foreground)" fontFamily="monospace"
                >
                  {fmtSta(sta)}
                </text>
              </g>
            ))}

            {/* Y axis */}
            <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {yTicks.map(e => (
              <g key={e}>
                <line x1={M.left - 4} y1={ys(e)} x2={M.left} y2={ys(e)}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={M.left - 7} y={ys(e) + 3}
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
