import { useRef, useState, useEffect, useMemo } from "react";
import { X, ZoomIn, Loader2 } from "lucide-react";
import { useAlignmentStore } from "./alignmentStore";
import { cn } from "../lib/utils";

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

const M = { top: 10, right: 16, bottom: 36, left: 56 };
const DEFAULT_W = 460;
const DEFAULT_H = 340;

export function CrossSectionViewer() {
  const open             = useAlignmentStore(s => s.crossSectionOpen);
  const station          = useAlignmentStore(s => s.crossSectionStation);
  const alignmentId      = useAlignmentStore(s => s.crossSectionAlignmentId);
  const mode             = useAlignmentStore(s => s.crossSectionMode);
  const lines            = useAlignmentStore(s => s.crossSectionLines);
  const computing        = useAlignmentStore(s => s.crossSectionComputing);
  const files            = useAlignmentStore(s => s.files);
  const closeCrossSection   = useAlignmentStore(s => s.closeCrossSection);
  const setCrossSectionMode = useAlignmentStore(s => s.setCrossSectionMode);

  // Dialog position (draggable)
  const [pos, setPos] = useState({ x: window.innerWidth - DEFAULT_W - 20, y: window.innerHeight - DEFAULT_H - 80 });
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.px + e.clientX - dragRef.current.ox,
        y: dragRef.current.py + e.clientY - dragRef.current.oy,
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Find alignment info
  const alignment = useMemo(
    () => files.flatMap(f => f.alignments).find(a => a.id === alignmentId) ?? null,
    [files, alignmentId]
  );

  // SVG size
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H - 32 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(80, width), h: Math.max(60, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Data domain from lines
  const domain = useMemo(() => {
    if (lines.length === 0) {
      return { xMin: -20, xMax: 20, yMin: -5, yMax: 10 };
    }
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const l of lines) {
      xMin = Math.min(xMin, l.x1, l.x2);
      xMax = Math.max(xMax, l.x1, l.x2);
      yMin = Math.min(yMin, l.y1, l.y2);
      yMax = Math.max(yMax, l.y1, l.y2);
    }
    // Ensure axis origin is always visible
    xMin = Math.min(xMin, -1);
    xMax = Math.max(xMax, 1);
    const xp = (xMax - xMin) * 0.08;
    const yp = (yMax - yMin) * 0.12;
    return { xMin: xMin - xp, xMax: xMax + xp, yMin: yMin - yp, yMax: yMax + yp };
  }, [lines]);

  // Zoom/pan
  const [viewX, setViewX] = useState<[number, number] | null>(null);
  const [viewY, setViewY] = useState<[number, number] | null>(null);
  useEffect(() => { setViewX(null); setViewY(null); }, [domain.xMin, domain.xMax, domain.yMin, domain.yMax]);

  const vxMin = viewX ? viewX[0] : domain.xMin;
  const vxMax = viewX ? viewX[1] : domain.xMax;
  const vyMin = viewY ? viewY[0] : domain.yMin;
  const vyMax = viewY ? viewY[1] : domain.yMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  const xs = (x: number) => M.left + ((x - vxMin) / (vxMax - vxMin || 1)) * chartW;
  const ys = (y: number) => M.top + chartH * (1 - (y - vyMin) / (vyMax - vyMin || 1));

  // Wheel zoom (non-passive)
  const viewXRef = useRef<[number, number] | null>(null);
  const viewYRef = useRef<[number, number] | null>(null);
  const domainRef = useRef(domain);
  useEffect(() => { viewXRef.current = viewX; viewYRef.current = viewY; }, [viewX, viewY]);
  useEffect(() => { domainRef.current = domain; }, [domain]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dom = domainRef.current;
      const cx = viewXRef.current ? viewXRef.current : [dom.xMin, dom.xMax] as [number, number];
      const cy = viewYRef.current ? viewYRef.current : [dom.yMin, dom.yMax] as [number, number];
      const cw = rect.width  - M.left - M.right;
      const ch = rect.height - M.top  - M.bottom;
      const pivotX = cx[0] + Math.max(0, Math.min(1, (mx - M.left)  / cw)) * (cx[1] - cx[0]);
      const pivotY = cy[0] + Math.max(0, Math.min(1, 1 - (my - M.top) / ch)) * (cy[1] - cy[0]);
      const f = e.deltaY > 0 ? 1.25 : 1 / 1.25;
      const nx0 = Math.max(dom.xMin, pivotX - (pivotX - cx[0]) * f);
      const nx1 = Math.min(dom.xMax, pivotX + (cx[1] - pivotX) * f);
      const ny0 = Math.max(dom.yMin, pivotY - (pivotY - cy[0]) * f);
      const ny1 = Math.min(dom.yMax, pivotY + (cy[1] - pivotY) * f);
      setViewX([nx0, nx1]);
      setViewY([ny0, ny1]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan drag
  const panRef = useRef<{ mx: number; my: number; vx: [number, number]; vy: [number, number] } | null>(null);
  const [panning, setPanning] = useState(false);

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      panRef.current = { mx: e.clientX, my: e.clientY, vx: [vxMin, vxMax], vy: [vyMin, vyMax] };
      setPanning(true);
    }
  };
  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.mx;
    const dy = e.clientY - panRef.current.my;
    const rx = (panRef.current.vx[1] - panRef.current.vx[0]) / chartW;
    const ry = (panRef.current.vy[1] - panRef.current.vy[0]) / chartH;
    const nx0 = Math.max(domain.xMin, Math.min(domain.xMax - (panRef.current.vx[1] - panRef.current.vx[0]), panRef.current.vx[0] - dx * rx));
    const ny0 = Math.max(domain.yMin, Math.min(domain.yMax - (panRef.current.vy[1] - panRef.current.vy[0]), panRef.current.vy[0] + dy * ry));
    setViewX([nx0, nx0 + panRef.current.vx[1] - panRef.current.vx[0]]);
    setViewY([ny0, ny0 + panRef.current.vy[1] - panRef.current.vy[0]]);
  };
  const handleSvgMouseUp = () => { panRef.current = null; setPanning(false); };

  const xTicks = useMemo(() => computeTicks(vxMin, vxMax, Math.max(3, Math.floor(chartW / 60))), [vxMin, vxMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vyMin, vyMax, Math.max(3, Math.floor(chartH / 40))), [vyMin, vyMax, chartH]);

  const isZoomed = viewX !== null || viewY !== null;

  if (!open) return null;

  return (
    <div
      className="fixed z-50 bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: DEFAULT_W, height: DEFAULT_H, minWidth: 260, minHeight: 180 }}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-border cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleHeaderMouseDown}
      >
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Querschnitt
        </span>
        {station !== null && (
          <span className="text-[10px] font-mono text-foreground shrink-0">{fmtSta(station)}</span>
        )}
        {alignment && (
          <span className="text-[9px] text-muted-foreground truncate flex-1">{alignment.displayName}</span>
        )}

        {/* Mode selector */}
        <div className="shrink-0 flex bg-muted rounded overflow-hidden text-[9px] font-medium">
          {(["vertical", "normal"] as const).map(m => (
            <button
              key={m}
              onClick={e => { e.stopPropagation(); setCrossSectionMode(m); }}
              className={cn(
                "px-1.5 py-0.5 transition-colors",
                mode === m ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "vertical" ? "Vertikal" : "Normal"}
            </button>
          ))}
        </div>

        {isZoomed && (
          <button
            onClick={() => { setViewX(null); setViewY(null); }}
            className="shrink-0 flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground"
          >
            <ZoomIn size={10} />
          </button>
        )}
        <button onClick={closeCrossSection} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 relative">
        {computing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        )}
        {!computing && lines.length === 0 && station !== null && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Kein IFC-Modell geschnitten
          </div>
        )}
        {station === null && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Im Längenschnitt auf eine Station klicken
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%" height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          style={{ cursor: panning ? "grabbing" : "crosshair", display: "block" }}
        >
          <defs>
            <clipPath id="xs-clip">
              <rect x={M.left} y={M.top} width={chartW} height={chartH} />
            </clipPath>
          </defs>

          {/* Grid */}
          {yTicks.map(y => (
            <line key={y} x1={M.left} y1={ys(y)} x2={M.left + chartW} y2={ys(y)}
              stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,4" />
          ))}
          {xTicks.map(x => (
            <line key={x} x1={xs(x)} y1={M.top} x2={xs(x)} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,4" />
          ))}

          <g clipPath="url(#xs-clip)">
            {/* Alignment axis vertical line at x=0 */}
            {xs(0) >= M.left && xs(0) <= M.left + chartW && (
              <line x1={xs(0)} y1={M.top} x2={xs(0)} y2={M.top + chartH}
                stroke="var(--color-muted-foreground)" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
            )}

            {/* Section lines */}
            {lines.map((l, i) => (
              <line key={i} x1={xs(l.x1)} y1={ys(l.y1)} x2={xs(l.x2)} y2={ys(l.y2)}
                stroke={l.color} strokeWidth={1.2} />
            ))}

            {/* Alignment origin marker */}
            {xs(0) >= M.left - 8 && xs(0) <= M.left + chartW + 8 && (
              <>
                <circle cx={xs(0)} cy={ys(0)} r={4} fill="none"
                  stroke="var(--color-foreground)" strokeWidth={1.5} />
                <line x1={xs(0) - 7} y1={ys(0)} x2={xs(0) + 7} y2={ys(0)}
                  stroke="var(--color-foreground)" strokeWidth={1.5} />
                <line x1={xs(0)} y1={ys(0) - 7} x2={xs(0)} y2={ys(0) + 7}
                  stroke="var(--color-foreground)" strokeWidth={1.5} />
              </>
            )}
          </g>

          {/* X axis */}
          <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
            stroke="var(--color-border)" strokeWidth={1} />
          {xTicks.map(x => (
            <g key={x}>
              <line x1={xs(x)} y1={M.top + chartH} x2={xs(x)} y2={M.top + chartH + 4}
                stroke="var(--color-muted-foreground)" strokeWidth={1} />
              <text x={xs(x)} y={M.top + chartH + 14}
                textAnchor="middle" fontSize={9}
                fill="var(--color-muted-foreground)" fontFamily="monospace"
              >
                {x === 0 ? "0" : `${x > 0 ? "R" : "L"} ${Math.abs(x).toFixed(x % 1 ? 1 : 0)}`}
              </text>
            </g>
          ))}
          {/* R / L labels at chart edges */}
          <text x={M.left + chartW - 2} y={M.top + chartH + 14} textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)" fontFamily="monospace">R →</text>
          <text x={M.left + 2}           y={M.top + chartH + 14} textAnchor="start" fontSize={9} fill="var(--color-muted-foreground)" fontFamily="monospace">← L</text>

          {/* Y axis */}
          <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
            stroke="var(--color-border)" strokeWidth={1} />
          {yTicks.map(y => (
            <g key={y}>
              <line x1={M.left - 4} y1={ys(y)} x2={M.left} y2={ys(y)}
                stroke="var(--color-muted-foreground)" strokeWidth={1} />
              <text x={M.left - 7} y={ys(y) + 3}
                textAnchor="end" fontSize={9}
                fill="var(--color-muted-foreground)" fontFamily="monospace"
              >
                {y.toFixed(1)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
