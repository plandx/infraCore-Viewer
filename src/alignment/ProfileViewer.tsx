import { useRef, useState, useEffect, useMemo } from "react";
import { X, ZoomIn, ChevronDown, Slice } from "lucide-react";
import { useAlignmentStore } from "./alignmentStore";
import { useModelStore } from "../store/modelStore";
import { evaluateProfile } from "./landXmlParser";
import { openCrossSectionWindow, openLongitudinalSectionWindow } from "../utils/windowSync";

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

function sampleProfilePoints(staStart: number, staEnd: number, profileGeom: { tangents: unknown[]; curves: unknown[] }, steps = 400): Array<{ sta: number; elev: number }> {
  if (!profileGeom.tangents.length && !profileGeom.curves.length) return [];
  const out: Array<{ sta: number; elev: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const sta = staStart + (i / steps) * (staEnd - staStart);
    const elev = evaluateProfile(profileGeom, sta);
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
  const selectedId      = useAlignmentStore(s => s.selectedId);
  const setProfileHover  = useAlignmentStore(s => s.setProfileHover);
  const openCrossSection = useAlignmentStore(s => s.openCrossSection);
  const crossSectionSta  = useAlignmentStore(s => s.crossSectionStation);
  const crossSectionOpen = useAlignmentStore(s => s.crossSectionOpen);
  const setOpen          = useModelStore(s => s.setProfilePanelOpen);
  const openLongSection  = useAlignmentStore(s => s.openLongSection);
  const lsStaStart       = useAlignmentStore(s => s.lsStaStart);
  const lsStaEnd         = useAlignmentStore(s => s.lsStaEnd);
  const lsOpen           = useAlignmentStore(s => s.lsOpen);

  // Range selection for Längenschnitt: shift+drag or LS-mode drag
  const [lsMode, setLsMode]             = useState(false);
  const [lsRange, setLsRange]           = useState<[number, number] | null>(null);
  const lsRangeRef = useRef<{ start: number; end: number } | null>(null);

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

  // All alignments that have a profile
  const alignments = useMemo(
    () => files.flatMap(f => f.alignments).filter(
      a => a.profileGeom.tangents.length > 0 || a.profileGeom.curves.length > 0
    ),
    [files]
  );

  // Active alignment: follow selectedId from panel when possible, otherwise first available
  const [activeAlignId, setActiveAlignId] = useState<number | null>(null);

  useEffect(() => {
    if (alignments.length === 0) { setActiveAlignId(null); return; }
    let newId: number | null = null;
    if (selectedId !== null && alignments.some(a => a.id === selectedId)) {
      newId = selectedId;
    } else if (activeAlignId === null || !alignments.some(a => a.id === activeAlignId)) {
      newId = alignments[0].id;
    }
    if (newId !== null && newId !== activeAlignId) {
      setActiveAlignId(newId);
      setLsRange(null);
      lsRangeRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, alignments]);

  const activeAlignment = useMemo(
    () => alignments.find(a => a.id === activeAlignId) ?? null,
    [alignments, activeAlignId]
  );

  const pts = useMemo(
    () => activeAlignment
      ? sampleProfilePoints(activeAlignment.staStart, activeAlignment.staEnd, activeAlignment.profileGeom)
      : [],
    [activeAlignment]
  );

  const color = activeAlignment ? (colors[activeAlignment.id] ?? "#888") : "#888";

  // Domain
  const domain = useMemo(() => {
    if (!pts.length) return { sMin: 0, sMax: 1000, eMin: 0, eMax: 100 };
    let sMin = Infinity, sMax = -Infinity, eMin = Infinity, eMax = -Infinity;
    for (const p of pts) {
      if (p.sta < sMin) sMin = p.sta;
      if (p.sta > sMax) sMax = p.sta;
      if (p.elev < eMin) eMin = p.elev;
      if (p.elev > eMax) eMax = p.elev;
    }
    const ep = Math.max(2, (eMax - eMin) * 0.15);
    return { sMin, sMax, eMin: eMin - ep, eMax: eMax + ep };
  }, [pts]);

  const [viewSta, setViewSta] = useState<[number, number] | null>(null);
  useEffect(() => { setViewSta(null); }, [domain.sMin, domain.sMax]);

  const vMin = viewSta ? viewSta[0] : domain.sMin;
  const vMax = viewSta ? viewSta[1] : domain.sMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  const xs = (sta: number) => M.left + ((sta - vMin) / (vMax - vMin || 1)) * chartW;
  const ys = (elev: number) => M.top + chartH * (1 - (elev - domain.eMin) / (domain.eMax - domain.eMin || 1));

  const viewStaRef = useRef<[number, number] | null>(null);
  const domainRef  = useRef(domain);
  useEffect(() => { viewStaRef.current = viewSta; }, [viewSta]);
  useEffect(() => { domainRef.current = domain; }, [domain]);

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
      const newMin = Math.max(dom.sMin, Math.min(dom.sMax - half * 2, centerSta - half * ((centerSta - curMin) / (curMax - curMin || 1)) * 2));
      setViewSta([newMin, newMin + half * 2]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragRef = useRef<{ x: number; min: number; max: number } | null>(null);
  const lsDragRef = useRef<{ startSta: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverSta, setHoverSta] = useState<number | null>(null);
  const lsModeRef = useRef(false);
  useEffect(() => { lsModeRef.current = lsMode; }, [lsMode]);

  const staFromEvent = (e: React.MouseEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < M.left || mx > M.left + chartW) return null;
    const sta = vMin + ((mx - M.left) / chartW) * (vMax - vMin);
    return Math.max(domain.sMin, Math.min(domain.sMax, sta));
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (lsModeRef.current || e.shiftKey) {
      const sta = staFromEvent(e);
      if (sta !== null) {
        lsDragRef.current = { startSta: sta };
        setLsRange([sta, sta]);
        lsRangeRef.current = { start: sta, end: sta };
      }
    } else {
      dragRef.current = { x: e.clientX, min: vMin, max: vMax };
      setIsDragging(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (lsDragRef.current) {
      const sta = staFromEvent(e);
      if (sta !== null) {
        const s = lsDragRef.current.startSta;
        const a = Math.min(s, sta), b = Math.max(s, sta);
        setLsRange([a, b]);
        lsRangeRef.current = { start: a, end: b };
      }
      return;
    }
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const range = dragRef.current.max - dragRef.current.min;
      const staDx = -(dx / chartW) * range;
      const dom = domainRef.current;
      const newMin = Math.max(dom.sMin, Math.min(dom.sMax - range, dragRef.current.min + staDx));
      setViewSta([newMin, newMin + range]);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < M.left || mx > M.left + chartW) {
      setHoverSta(null);
      setProfileHover(null, null);
      return;
    }
    const sta = vMin + ((mx - M.left) / chartW) * (vMax - vMin);
    setHoverSta(sta);
    setProfileHover(activeAlignId, sta);
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (lsDragRef.current) {
      lsDragRef.current = null;
      // range already set; user can now open the LS window
      return;
    }
    if (dragRef.current && Math.abs(e.clientX - dragRef.current.x) < 5) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (mx >= M.left && mx <= M.left + chartW && activeAlignment) {
        const sta = vMin + ((mx - M.left) / chartW) * (vMax - vMin);
        if (sta >= domain.sMin && sta <= domain.sMax) {
          openCrossSection(activeAlignment.id, sta);
          openCrossSectionWindow();
        }
      }
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    dragRef.current = null;
    lsDragRef.current = null;
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
      <div className="shrink-0 flex items-center gap-2 px-2 py-0.5 border-b border-border min-w-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
          Längenschnitt
        </span>

        {/* Alignment selector */}
        {alignments.length > 0 && (
          <div className="relative flex items-center min-w-0">
            <span className="inline-block w-2.5 h-0.5 rounded-full shrink-0 mr-1" style={{ background: color }} />
            <select
              value={activeAlignId ?? ""}
              onChange={e => setActiveAlignId(Number(e.target.value))}
              className="text-[10px] bg-transparent border-none outline-none text-foreground pr-3 max-w-40 truncate cursor-pointer appearance-none"
              title="Achse auswählen"
            >
              {alignments.map(a => (
                <option key={a.id} value={a.id}>{a.displayName}</option>
              ))}
            </select>
            <ChevronDown size={9} className="absolute right-0 pointer-events-none text-muted-foreground" />
          </div>
        )}

        <div className="flex-1" />

        {lsRange && activeAlignment && (
          <button
            onClick={() => {
              openLongSection(activeAlignment.id, lsRange[0], lsRange[1]);
              openLongitudinalSectionWindow();
            }}
            className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            title="Längenschnitt öffnen"
          >
            <Slice size={9} />
            Längenschnitt
          </button>
        )}

        <button
          onClick={() => { setLsMode(a => !a); if (lsMode) setLsRange(null); }}
          className={`shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] transition-colors ${lsMode ? "bg-blue-700 text-white" : "text-muted-foreground hover:text-foreground"}`}
          title={lsMode ? "LS-Modus deaktivieren" : "LS-Bereich auswählen (oder Shift+Drag)"}
        >
          <Slice size={9} />
          LS
        </button>

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
            style={{ cursor: isDragging ? "grabbing" : lsMode ? "col-resize" : "crosshair", display: "block" }}
          >
            {/* Horizontal grid */}
            {yTicks.map(e => (
              <line key={e}
                x1={M.left} y1={ys(e)} x2={M.left + chartW} y2={ys(e)}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,4"
              />
            ))}

            <defs>
              <clipPath id="profile-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
            </defs>

            <g clipPath="url(#profile-clip)">
              {/* LS range rectangle */}
              {lsRange && (
                <rect
                  x={xs(lsRange[0])} y={M.top}
                  width={Math.max(0, xs(lsRange[1]) - xs(lsRange[0]))}
                  height={chartH}
                  fill="#3b82f6" fillOpacity={0.12}
                  stroke="#3b82f6" strokeWidth={1} strokeDasharray="4,2"
                />
              )}

              {/* Active cross-section station marker */}
              {crossSectionOpen && crossSectionSta !== null &&
               xs(crossSectionSta) >= M.left && xs(crossSectionSta) <= M.left + chartW && (
                <line
                  x1={xs(crossSectionSta)} y1={M.top}
                  x2={xs(crossSectionSta)} y2={M.top + chartH}
                  stroke="#4488ff" strokeWidth={1.5} opacity={0.8}
                />
              )}

              {/* Profile polyline */}
              {pts.length >= 2 && (
                <polyline
                  points={pts.map(p => `${xs(p.sta)},${ys(p.elev)}`).join(" ")}
                  fill="none" stroke={color} strokeWidth={1.5}
                />
              )}

              {/* VPI markers */}
              {activeAlignment?.profileGeom.vertices.map((v, i) => (
                <circle key={i}
                  cx={xs(v.sta)} cy={ys(v.elev)} r={2.5}
                  fill={color}
                />
              ))}

              {/* Hover line + elevation readout */}
              {hoverSta !== null && activeAlignment && (
                <>
                  <line
                    x1={xs(hoverSta)} y1={M.top} x2={xs(hoverSta)} y2={M.top + chartH}
                    stroke="white" strokeWidth={1} strokeDasharray="3,2" opacity={0.5}
                  />
                  {(() => {
                    const elev = evaluateProfile(activeAlignment.profileGeom, hoverSta);
                    if (elev === null) return null;
                    const flip = xs(hoverSta) > M.left + chartW * 0.75;
                    return (
                      <g>
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
                  })()}
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
