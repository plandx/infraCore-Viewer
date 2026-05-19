import { useRef, useState, useEffect, useMemo } from "react";
import { Ruler, Trash2, ZoomIn, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { CROSS_SECTION_CHANNEL } from "../utils/windowSync";
import type { XSMsg, XSSyncState } from "../utils/windowSync";

function fmtSta(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m  = sta - km * 1000;
  return `${km}+${m.toFixed(3).padStart(7, "0")}`;
}

function parseSta(input: string): number | null {
  const s = input.trim().replace(",", ".");
  const km = s.match(/^(\d+)[+:](\d+(?:\.\d+)?)$/);
  if (km) return parseInt(km[1]) * 1000 + parseFloat(km[2]);
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
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

const M = { top: 12, right: 20, bottom: 40, left: 64 };

type Meas = { p1: [number, number]; p2: [number, number] };

export function CrossSectionWindow() {
  const [state, setState] = useState<XSSyncState | null>(null);
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Querschnitt — infraCore";
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(CROSS_SECTION_CHANNEL); } catch { return; }
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent<XSMsg>) => {
      if (e.data.t === "state") setState(e.data.s);
    };
    ch.postMessage({ t: "req" } satisfies XSMsg);
    return () => { ch.close(); chRef.current = null; };
  }, []);

  const send = (msg: XSMsg) => chRef.current?.postMessage(msg);

  // ── Station navigation ────────────────────────────────────────────────────
  const [step, setStep] = useState(10);
  const [staInput, setStaInput] = useState("");

  useEffect(() => {
    if (state?.station != null) setStaInput(fmtSta(state.station));
  }, [state?.station]);

  const submitSta = () => {
    const parsed = parseSta(staInput);
    if (parsed != null && state?.alignmentId != null)
      send({ t: "setStation", alignmentId: state.alignmentId, station: parsed });
  };
  const navigate = (delta: number) => send({ t: "nextStation", delta });

  // ── SVG sizing ────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 580 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(120, width), h: Math.max(80, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = state?.lines ?? [];

  // ── Domain ────────────────────────────────────────────────────────────────
  const domain = useMemo(() => {
    if (!lines.length) return { xMin: -20, xMax: 20, yMin: -5, yMax: 10 };
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const l of lines) {
      xMin = Math.min(xMin, l.x1, l.x2); xMax = Math.max(xMax, l.x1, l.x2);
      yMin = Math.min(yMin, l.y1, l.y2); yMax = Math.max(yMax, l.y1, l.y2);
    }
    xMin = Math.min(xMin, -2); xMax = Math.max(xMax, 2);
    const xp = (xMax - xMin) * 0.08, yp = Math.max(1, (yMax - yMin) * 0.12);
    return { xMin: xMin - xp, xMax: xMax + xp, yMin: yMin - yp, yMax: yMax + yp };
  }, [lines]);

  // ── Equal-scale zoom / pan ────────────────────────────────────────────────
  // A single zoom factor + pan center keeps X and Y at the same px/m scale.
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const [viewCenter, setViewCenter] = useState<[number, number] | null>(null); // data-space center

  useEffect(() => { setZoomFactor(1.0); setViewCenter(null); },
    [domain.xMin, domain.xMax, domain.yMin, domain.yMax]);

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  // Base scale (px/m) that fits the full domain
  const baseScale = Math.min(
    chartW / ((domain.xMax - domain.xMin) || 1),
    chartH / ((domain.yMax - domain.yMin) || 1),
  );
  const scale = baseScale * zoomFactor;

  const cx = viewCenter ? viewCenter[0] : (domain.xMin + domain.xMax) / 2;
  const cy = viewCenter ? viewCenter[1] : (domain.yMin + domain.yMax) / 2;

  const visW = chartW / scale;
  const visH = chartH / scale;
  const vxMin = cx - visW / 2;
  const vxMax = cx + visW / 2;
  const vyMin = cy - visH / 2;
  const vyMax = cy + visH / 2;

  // Equal-scale coordinate transforms
  const xs = (x: number) => M.left  + (x - vxMin) / visW * chartW;
  const ys = (y: number) => M.top   + (1 - (y - vyMin) / visH) * chartH;

  // Refs for non-passive wheel handler
  const zoomRef      = useRef(1.0);
  const centerRef    = useRef<[number, number] | null>(null);
  const domainRef    = useRef(domain);
  useEffect(() => { zoomRef.current = zoomFactor; }, [zoomFactor]);
  useEffect(() => { centerRef.current = viewCenter; }, [viewCenter]);
  useEffect(() => { domainRef.current = domain; }, [domain]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect  = svg.getBoundingClientRect();
      const dom   = domainRef.current;
      const cw    = rect.width  - M.left - M.right;
      const ch    = rect.height - M.top  - M.bottom;
      const bs    = Math.min(cw / ((dom.xMax - dom.xMin) || 1), ch / ((dom.yMax - dom.yMin) || 1));
      const curZ  = zoomRef.current;
      const sc    = bs * curZ;
      const curCx = centerRef.current ? centerRef.current[0] : (dom.xMin + dom.xMax) / 2;
      const curCy = centerRef.current ? centerRef.current[1] : (dom.yMin + dom.yMax) / 2;
      const curVW = cw / sc;
      const curVH = ch / sc;

      // Mouse position in data space
      const mx    = Math.max(0, Math.min(cw, e.clientX - rect.left - M.left));
      const my    = Math.max(0, Math.min(ch, e.clientY - rect.top  - M.top));
      const mxD   = curCx - curVW / 2 + mx / sc;
      const myD   = curCy + curVH / 2 - my / sc;

      const f     = e.deltaY > 0 ? 1 / 1.25 : 1.25;
      const newZ  = Math.max(0.1, Math.min(200, curZ * f));
      const newSc = bs * newZ;
      const newVW = cw / newSc;
      const newVH = ch / newSc;

      // Keep mouse data-position fixed
      setZoomFactor(newZ);
      setViewCenter([mxD - mx / newSc + newVW / 2, myD + my / newSc - newVH / 2]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragRef  = useRef<{ mx: number; my: number; cx: number; cy: number; sc: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // ── Measurement tool ─────────────────────────────────────────────────────
  const [measActive, setMeasActive] = useState(false);
  const [measurements, setMeasurements] = useState<Meas[]>([]);
  const [pending, setPending] = useState<[number, number] | null>(null);
  const [mouseWorld, setMouseWorld] = useState<[number, number] | null>(null);

  const svgToWorld = (svgX: number, svgY: number): [number, number] => [
    vxMin + (svgX - M.left) / chartW * visW,
    vyMax - (svgY - M.top)  / chartH * visH,
  ];

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (measActive || e.button !== 0) return;
    dragRef.current = { mx: e.clientX, my: e.clientY, cx, cy, sc: scale };
    setPanning(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouseWorld(svgToWorld(e.clientX - rect.left, e.clientY - rect.top));

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.mx;
      const dy = e.clientY - dragRef.current.my;
      setViewCenter([
        dragRef.current.cx - dx / dragRef.current.sc,
        dragRef.current.cy + dy / dragRef.current.sc,
      ]);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (measActive && e.button === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const w = svgToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (pending == null) {
        setPending(w);
      } else {
        setMeasurements(ms => [...ms, { p1: pending, p2: w }]);
        setPending(null);
      }
    }
    dragRef.current = null;
    setPanning(false);
  };

  const xTicks = useMemo(() => computeTicks(vxMin, vxMax, Math.max(3, Math.floor(chartW / 70))), [vxMin, vxMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vyMin, vyMax, Math.max(3, Math.floor(chartH / 45))), [vyMin, vyMax, chartH]);

  const isZoomed = zoomFactor !== 1.0 || viewCenter !== null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden select-none">

      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 h-10 px-3 border-b border-border bg-card">
        <svg width="16" height="16" viewBox="0 0 32 32" className="shrink-0 rounded-[3px]">
          <rect width="32" height="32" rx="5" fill="#E8312A"/>
          <text x="16" y="23" fontFamily="Arial" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle">iC</text>
        </svg>
        <span className="font-bold text-sm">Querschnitt</span>
        {state?.alignmentName && (
          <span className="text-xs text-muted-foreground">— {state.alignmentName}</span>
        )}
        {state?.station != null && (
          <span className="text-xs font-mono text-sky-400 ml-1">{fmtSta(state.station)}</span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-[10px]">
          <div className={`w-1.5 h-1.5 rounded-full ${state != null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
          <span className="text-muted-foreground">{state != null ? "Verbunden" : "Warte auf Hauptfenster…"}</span>
        </div>
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/40 flex-wrap">

        {/* Station navigation */}
        <div className="flex items-center gap-0.5">
          <button onClick={() => navigate(-step * 10)}
            className="px-1.5 py-0.5 rounded text-xs bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors font-mono"
            title={`−${step * 10} m`}>◄◄</button>
          <button onClick={() => navigate(-step)}
            className="flex items-center px-1.5 py-0.5 rounded text-xs bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title={`−${step} m`}><ChevronLeft size={13} /></button>
          <input
            type="text" value={staInput}
            onChange={e => setStaInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitSta()}
            onBlur={submitSta}
            className="w-28 text-center text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 text-foreground"
            placeholder="0+000.000"
          />
          <button onClick={() => navigate(step)}
            className="flex items-center px-1.5 py-0.5 rounded text-xs bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title={`+${step} m`}><ChevronRight size={13} /></button>
          <button onClick={() => navigate(step * 10)}
            className="px-1.5 py-0.5 rounded text-xs bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors font-mono"
            title={`+${step * 10} m`}>►►</button>
        </div>

        {/* Step selector */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Δ</span>
          <select value={step} onChange={e => setStep(Number(e.target.value))}
            className="text-xs bg-muted border border-border rounded px-1 py-0.5 text-foreground">
            {[1, 5, 10, 25, 50, 100].map(s => <option key={s} value={s}>{s} m</option>)}
          </select>
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Mode */}
        <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
          {(["vertical", "normal"] as const).map(m => (
            <button key={m}
              onClick={() => send({ t: "setMode", mode: m })}
              className={cn("px-2 py-0.5 transition-colors",
                state?.mode === m ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "vertical" ? "Vertikal" : "Normal"}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Measure */}
        <button
          onClick={() => { setMeasActive(a => !a); setPending(null); }}
          className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            measActive ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
          )}
        >
          <Ruler size={13} /> Messen
        </button>
        {pending != null && (
          <span className="text-[10px] text-amber-400 italic">2. Punkt klicken…</span>
        )}
        {measurements.length > 0 && (
          <button onClick={() => { setMeasurements([]); setPending(null); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground hover:text-red-400 transition-colors"
            title="Alle Messungen löschen">
            <Trash2 size={12} />
          </button>
        )}

        <div className="w-px h-5 bg-border mx-0.5" />

        {isZoomed && (
          <button onClick={() => { setZoomFactor(1.0); setViewCenter(null); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground hover:text-foreground"
            title="Zoom zurücksetzen">
            <ZoomIn size={12} /> Reset
          </button>
        )}

        {state?.computing && <Loader2 size={13} className="animate-spin text-muted-foreground" />}

        {/* Mouse position readout */}
        {mouseWorld != null && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground">
            {mouseWorld[0] >= 0 ? "R" : "L"}&nbsp;{Math.abs(mouseWorld[0]).toFixed(3)} m&nbsp;&nbsp;
            Δh&nbsp;{mouseWorld[1] >= 0 ? "+" : ""}{mouseWorld[1].toFixed(3)} m
          </span>
        )}
      </div>

      {/* ── Chart + measurements sidebar ─────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* SVG chart */}
        <div ref={containerRef} className="flex-1 min-w-0 min-h-0 relative">
          <svg ref={svgRef}
            width="100%" height="100%"
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { panRef.current = null; setPanning(false); setMouseWorld(null); }}
            style={{ cursor: measActive ? "crosshair" : panning ? "grabbing" : "grab", display: "block" }}
          >
            <defs>
              <clipPath id="xs-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
            </defs>

            {/* Grid */}
            {yTicks.map(y => (
              <line key={y} x1={M.left} y1={ys(y)} x2={M.left + chartW} y2={ys(y)}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />
            ))}
            {xTicks.map(x => (
              <line key={x} x1={xs(x)} y1={M.top} x2={xs(x)} y2={M.top + chartH}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />
            ))}

            <g clipPath="url(#xs-clip)">
              {/* Alignment axis (dashed vertical) */}
              <line x1={xs(0)} y1={M.top} x2={xs(0)} y2={M.top + chartH}
                stroke="var(--color-muted-foreground)" strokeWidth={1} strokeDasharray="6,4" opacity={0.5} />

              {/* Section lines */}
              {lines.map((l, i) => (
                <line key={i} x1={xs(l.x1)} y1={ys(l.y1)} x2={xs(l.x2)} y2={ys(l.y2)}
                  stroke={l.color} strokeWidth={1.5} />
              ))}

              {/* Alignment origin crosshair */}
              <circle cx={xs(0)} cy={ys(0)} r={5}
                fill="none" stroke="var(--color-foreground)" strokeWidth={1.5} />
              <line x1={xs(0) - 9} y1={ys(0)} x2={xs(0) + 9} y2={ys(0)}
                stroke="var(--color-foreground)" strokeWidth={1.5} />
              <line x1={xs(0)} y1={ys(0) - 9} x2={xs(0)} y2={ys(0) + 9}
                stroke="var(--color-foreground)" strokeWidth={1.5} />

              {/* Committed measurements */}
              {measurements.map((meas, i) => {
                const d  = Math.sqrt((meas.p2[0]-meas.p1[0])**2 + (meas.p2[1]-meas.p1[1])**2);
                const mx = (xs(meas.p1[0]) + xs(meas.p2[0])) / 2;
                const my = (ys(meas.p1[1]) + ys(meas.p2[1])) / 2;
                return (
                  <g key={i}>
                    <line x1={xs(meas.p1[0])} y1={ys(meas.p1[1])} x2={xs(meas.p2[0])} y2={ys(meas.p2[1])}
                      stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4,2" />
                    <circle cx={xs(meas.p1[0])} cy={ys(meas.p1[1])} r={3.5} fill="#fbbf24" />
                    <circle cx={xs(meas.p2[0])} cy={ys(meas.p2[1])} r={3.5} fill="#fbbf24" />
                    <rect x={mx - 30} y={my - 9} width={60} height={15} rx={3}
                      fill="var(--color-popover)" stroke="var(--color-border)" strokeWidth={1} opacity={0.95} />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize={10}
                      fill="#fbbf24" fontFamily="monospace" fontWeight="bold">
                      {d.toFixed(3)} m
                    </text>
                  </g>
                );
              })}

              {/* Pending measurement */}
              {pending != null && (
                <>
                  <circle cx={xs(pending[0])} cy={ys(pending[1])} r={4} fill="#fbbf24" />
                  {mouseWorld != null && (() => {
                    const d  = Math.sqrt((mouseWorld[0]-pending[0])**2 + (mouseWorld[1]-pending[1])**2);
                    const mx = (xs(pending[0]) + xs(mouseWorld[0])) / 2;
                    const my = (ys(pending[1]) + ys(mouseWorld[1])) / 2;
                    return (
                      <>
                        <line x1={xs(pending[0])} y1={ys(pending[1])} x2={xs(mouseWorld[0])} y2={ys(mouseWorld[1])}
                          stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
                        <text x={mx} y={my - 5} textAnchor="middle" fontSize={10}
                          fill="#fbbf24" fontFamily="monospace">{d.toFixed(3)} m</text>
                      </>
                    );
                  })()}
                </>
              )}
            </g>

            {/* X axis */}
            <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {xTicks.map(x => (
              <g key={x}>
                <line x1={xs(x)} y1={M.top + chartH} x2={xs(x)} y2={M.top + chartH + 5}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={xs(x)} y={M.top + chartH + 16} textAnchor="middle" fontSize={10}
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {x === 0 ? "0" : `${x > 0 ? "R" : "L"} ${Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0)}`}
                </text>
              </g>
            ))}
            <text x={M.left} y={M.top + chartH + 30} textAnchor="start" fontSize={10} fill="var(--color-muted-foreground)">← L</text>
            <text x={M.left + chartW} y={M.top + chartH + 30} textAnchor="end"   fontSize={10} fill="var(--color-muted-foreground)">R → [m]</text>

            {/* Y axis */}
            <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {yTicks.map(y => (
              <g key={y}>
                <line x1={M.left - 5} y1={ys(y)} x2={M.left} y2={ys(y)}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={M.left - 8} y={ys(y) + 3} textAnchor="end" fontSize={10}
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {y >= 0 ? "+" : ""}{y.toFixed(y % 1 !== 0 ? 1 : 0)}
                </text>
              </g>
            ))}
            <text x={M.left + 4} y={M.top + 8} textAnchor="start" fontSize={10}
              fill="var(--color-muted-foreground)">↑ Δh [m]</text>
          </svg>

          {/* Overlay messages */}
          {state?.computing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-card/90 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground shadow-lg">
                <Loader2 size={16} className="animate-spin" /> Berechne Schnitt…
              </div>
            </div>
          )}
          {!state?.computing && !lines.length && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-card/90 rounded-lg px-6 py-4 text-center text-sm text-muted-foreground shadow-lg">
                {state == null
                  ? "Verbindung zum Hauptfenster wird hergestellt…"
                  : state.station == null
                  ? "Im Längenschnitt auf eine Station klicken, um den Schnitt zu berechnen"
                  : "Kein IFC-Modell bei dieser Station vorhanden"}
              </div>
            </div>
          )}
        </div>

        {/* ── Measurements sidebar ────────────────────────────────────────── */}
        {measurements.length > 0 && (
          <div className="w-52 shrink-0 border-l border-border overflow-y-auto p-2 flex flex-col gap-1.5 bg-card/20">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Messungen</span>
              <button onClick={() => { setMeasurements([]); setPending(null); }}
                className="text-muted-foreground hover:text-red-400 transition-colors">
                <Trash2 size={11} />
              </button>
            </div>
            {measurements.map((meas, i) => {
              const d  = Math.sqrt((meas.p2[0]-meas.p1[0])**2 + (meas.p2[1]-meas.p1[1])**2);
              const dH = Math.abs(meas.p2[0] - meas.p1[0]);
              const dV = meas.p2[1] - meas.p1[1];
              return (
                <div key={i} className="bg-muted/40 rounded px-2 py-1.5 text-[10px] border border-border/50">
                  <div className="font-mono font-semibold text-amber-400 mb-0.5">{d.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">H {dH.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">V {dV >= 0 ? "+" : ""}{dV.toFixed(3)} m</div>
                  <button onClick={() => setMeasurements(ms => ms.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-400 mt-1 text-[9px] transition-colors">
                    löschen
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
