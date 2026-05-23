import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { ZoomIn, Loader2, Download, Ruler, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import { ABWICKLUNG_CHANNEL } from "../utils/windowSync";
import type { AbwicklungMsg, AbwicklungSyncState } from "../utils/windowSync";

function fmtSta(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m  = sta - km * 1000;
  return `${km}+${m.toFixed(3).padStart(7, "0")}`;
}

function computeTicks(min: number, max: number, target: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / target;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const n     = rough / mag;
  const step  = n < 1.5 ? mag : n < 3.5 ? 2 * mag : n < 7.5 ? 5 * mag : 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 1e-9; t += step)
    ticks.push(parseFloat(t.toFixed(10)));
  return ticks;
}

// Margin: top, right, bottom, left
const M = { top: 12, right: 20, bottom: 44, left: 62 };

type AbwGroup = { label: string; children: React.ReactNode };
function AbwGroup({ label, children }: AbwGroup) {
  return (
    <div className="flex flex-col shrink-0 border-r border-border">
      <div className="flex items-center gap-1 px-2 flex-1 min-w-0">{children}</div>
      <div className="text-[9px] text-muted-foreground/60 font-medium tracking-wide text-center px-2 pb-0.5 shrink-0">{label}</div>
    </div>
  );
}

type Meas = { p1: [number, number]; p2: [number, number] };

// Elevation → hue: blue (low) → red (high)
function elevColor(elev: number, elevMin: number, elevMax: number): string {
  const t = elevMax > elevMin ? Math.max(0, Math.min(1, (elev - elevMin) / (elevMax - elevMin))) : 0.5;
  const hue = (1 - t) * 240;
  return `hsl(${hue.toFixed(0)},80%,55%)`;
}

export function AbwicklungWindow() {
  const [state, setState]   = useState<AbwicklungSyncState | null>(null);
  const chRef               = useRef<BroadcastChannel | null>(null);
  const svgRef              = useRef<SVGSVGElement>(null);
  const containerRef        = useRef<HTMLDivElement>(null);
  const svgRectRef          = useRef<DOMRect | null>(null);
  const [size, setSize]     = useState({ w: 1200, h: 520 });

  // ── Zoom state ────────────────────────────────────────────────────────────
  const [viewSta,   setViewSta]   = useState<[number, number] | null>(null);
  const [viewLat,   setViewLat]   = useState<[number, number] | null>(null);

  // ── BroadcastChannel ─────────────────────────────────────────────────────
  useEffect(() => {
    document.title = "Abwicklung — infraCore";
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(ABWICKLUNG_CHANNEL); } catch { return; }
    chRef.current = ch;
    ch.onmessage = (ev: MessageEvent<AbwicklungMsg>) => {
      if (ev.data.t === "state") setState(ev.data.s);
    };
    ch.postMessage({ t: "req" } satisfies AbwicklungMsg);

    const sendClose = () => { try { ch.postMessage({ t: "close" } satisfies AbwicklungMsg); } catch { /* ignore */ } };
    window.addEventListener("beforeunload", sendClose);
    return () => {
      window.removeEventListener("beforeunload", sendClose);
      ch.close();
      chRef.current = null;
    };
  }, []);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle("dark", state?.theme !== "light");
  }, [state?.theme]);

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(200, width), h: Math.max(80, height) });
      svgRectRef.current = null;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines            = state?.lines            ?? [];
  const elevationOrigin  = state?.elevationOrigin  ?? 0;

  // ── Domain ────────────────────────────────────────────────────────────────
  const domain = useMemo(() => {
    const staStart = state?.staStart ?? 0;
    const staEnd   = state?.staEnd   ?? 1000;
    const left  = state?.leftOffset  ?? 10;
    const right = state?.rightOffset ?? 10;
    return {
      sMin: staStart,
      sMax: staEnd,
      tMin: -left,
      tMax: right,
    };
  }, [state?.staStart, state?.staEnd, state?.leftOffset, state?.rightOffset]);

  // Reset view when alignment or range changes
  useEffect(() => { setViewSta(null); setViewLat(null); }, [state?.alignmentId, state?.staStart, state?.staEnd]);

  const vMin  = viewSta ? viewSta[0] : domain.sMin;
  const vMax  = viewSta ? viewSta[1] : domain.sMax;
  const vtMin = viewLat ? viewLat[0] : domain.tMin;
  const vtMax = viewLat ? viewLat[1] : domain.tMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  const vRange  = vMax  - vMin  || 1;
  const vtRange = vtMax - vtMin || 1;

  // X = station, Y = lateral (positive = right = top of chart)
  const xs = useCallback((sta: number) => M.left + (sta  - vMin)  / vRange  * chartW, [vMin,  vRange,  chartW]);
  const ys = useCallback((lat: number) => M.top  + chartH * (1 - (lat - vtMin) / vtRange), [vtMin, vtRange, chartH]);

  // ── vpRef for stable callbacks ────────────────────────────────────────────
  const vpRef = useRef({ vMin, vMax, vtMin, vtMax, vRange, vtRange, chartW, chartH });
  vpRef.current = { vMin, vMax, vtMin, vtMax, vRange, vtRange, chartW, chartH };

  const viewStaRef = useRef<[number, number] | null>(null);
  const viewLatRef = useRef<[number, number] | null>(null);
  const domainRef  = useRef(domain);
  useEffect(() => { viewStaRef.current = viewSta;  }, [viewSta]);
  useEffect(() => { viewLatRef.current = viewLat;  }, [viewLat]);
  useEffect(() => { domainRef.current  = domain;   }, [domain]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cw   = rect.width  - M.left - M.right;
      const ch   = rect.height - M.top  - M.bottom;
      const f    = e.deltaY > 0 ? 1.25 : 1 / 1.25;

      const curSta = viewStaRef.current ?? [domainRef.current.sMin, domainRef.current.sMax] as [number, number];
      const fracX  = Math.max(0, Math.min(1, (e.clientX - rect.left - M.left) / cw));
      const pivotX = curSta[0] + fracX * (curSta[1] - curSta[0]);
      setViewSta([pivotX - (pivotX - curSta[0]) * f, pivotX + (curSta[1] - pivotX) * f]);

      const curLat = viewLatRef.current ?? [domainRef.current.tMin, domainRef.current.tMax] as [number, number];
      const fracY  = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top - M.top) / ch));
      const pivotY = curLat[0] + fracY * (curLat[1] - curLat[0]);
      setViewLat([pivotY - (pivotY - curLat[0]) * f, pivotY + (curLat[1] - pivotY) * f]);

      svgRectRef.current = null;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pan ───────────────────────────────────────────────────────────────────
  const dragRef = useRef<{ mx: number; my: number; sMin: number; sMax: number; tMin: number; tMax: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // ── Measurement tool ─────────────────────────────────────────────────────
  const [measActive, setMeasActive]     = useState(false);
  const [measurements, setMeasurements] = useState<Meas[]>([]);
  const [pending, setPending]           = useState<[number, number] | null>(null);
  const [mouseWorld, setMouseWorld]     = useState<[number, number] | null>(null);

  const rafIdRef      = useRef<number | null>(null);
  const pendingPosRef = useRef<{ svgX: number; svgY: number } | null>(null);

  // ── Color mode ────────────────────────────────────────────────────────────
  const [colorMode, setColorMode] = useState<"ifc" | "elevation">("ifc");

  // Elevation range for coloring
  const [elevMin, elevMax] = useMemo(() => {
    if (lines.length === 0) return [0, 100];
    let lo = Infinity, hi = -Infinity;
    for (const l of lines) {
      const abs = l.elevMid + elevationOrigin;
      if (abs < lo) lo = abs;
      if (abs > hi) hi = abs;
    }
    return [lo, hi];
  }, [lines, elevationOrigin]);

  // ── Offset inputs ─────────────────────────────────────────────────────────
  const [offsetInput, setOffsetInput] = useState({ left: "10", right: "10" });
  useEffect(() => {
    setOffsetInput({
      left:  (state?.leftOffset  ?? 10).toFixed(0),
      right: (state?.rightOffset ?? 10).toFixed(0),
    });
  }, [state?.leftOffset, state?.rightOffset]);

  const applyOffsets = () => {
    const l = parseFloat(offsetInput.left);
    const r = parseFloat(offsetInput.right);
    if (isFinite(l) && isFinite(r) && l >= 0 && r >= 0)
      chRef.current?.postMessage({ t: "setOffsets", left: l, right: r } satisfies AbwicklungMsg);
  };

  // ── Station range inputs ──────────────────────────────────────────────────
  const [rangeInput, setRangeInput] = useState({ start: "", end: "" });
  useEffect(() => {
    setRangeInput({
      start: (state?.staStart ?? 0).toFixed(0),
      end:   (state?.staEnd   ?? 0).toFixed(0),
    });
  }, [state?.staStart, state?.staEnd]);

  const applyRange = () => {
    const s = parseFloat(rangeInput.start);
    const e = parseFloat(rangeInput.end);
    if (isFinite(s) && isFinite(e) && s < e)
      chRef.current?.postMessage({ t: "setRange", staStart: s, staEnd: e } satisfies AbwicklungMsg);
  };

  // ── SVG paths batched by color ─────────────────────────────────────────────
  const svgPaths = useMemo(() => {
    if (colorMode === "elevation") {
      // Per-line color based on elevation
      return lines.map(l => {
        const absElev = l.elevMid + elevationOrigin;
        const col = elevColor(absElev, elevMin, elevMax);
        return { color: col, d: `M${xs(l.s1).toFixed(1)},${ys(l.t1).toFixed(1)}L${xs(l.s2).toFixed(1)},${ys(l.t2).toFixed(1)}` };
      });
    }
    // IFC color mode: batch by color
    const byColor = new Map<string, string>();
    for (const l of lines) {
      const seg = `M${xs(l.s1).toFixed(1)},${ys(l.t1).toFixed(1)}L${xs(l.s2).toFixed(1)},${ys(l.t2).toFixed(1)}`;
      byColor.set(l.color, (byColor.get(l.color) ?? "") + seg);
    }
    return [...byColor.entries()].map(([color, d]) => ({ color, d }));
  }, [lines, xs, ys, colorMode, elevMin, elevMax, elevationOrigin]);

  // ── Ticks ─────────────────────────────────────────────────────────────────
  const xTicks = useMemo(() => computeTicks(vMin, vMax, Math.max(4, Math.floor(chartW / 110))), [vMin, vMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vtMin, vtMax, Math.max(3, Math.floor(chartH / 40))), [vtMin, vtMax, chartH]);

  // ── SVG Export ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const style = getComputedStyle(document.documentElement);
    const resolve = (v: string) => {
      const m = v.match(/var\(([^)]+)\)/);
      if (!m) return v;
      return style.getPropertyValue(m[1].trim()).trim() || "#888";
    };
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(size.w));
    clone.setAttribute("height", String(size.h));
    clone.querySelectorAll<SVGElement>("*").forEach(el => {
      for (const a of ["stroke", "fill", "color"]) {
        const v = el.getAttribute(a);
        if (v && v.includes("var(")) el.setAttribute(a, resolve(v));
      }
    });
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", String(size.w));
    bg.setAttribute("height", String(size.h));
    bg.setAttribute("fill", state?.theme === "light" ? "#ffffff" : "#1a1b26");
    clone.insertBefore(bg, clone.firstChild);
    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `abwicklung_${state?.alignmentName || "export"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [size, state?.theme, state?.alignmentName]);

  // ── World-space coordinate helpers ────────────────────────────────────────
  const svgToWorld = (svgX: number, svgY: number, vp: typeof vpRef.current): [number, number] => [
    vp.vMin + (svgX - M.left) / vp.chartW * vp.vRange,
    vp.vtMin + (1 - (svgY - M.top) / vp.chartH) * vp.vtRange,
  ];

  const activeToolRef = useRef({ measActive });
  activeToolRef.current = { measActive };

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeToolRef.current.measActive || e.button !== 0) return;
    dragRef.current = { mx: e.clientX, my: e.clientY, sMin: vMin, sMax: vMax, tMin: vtMin, tMax: vtMax };
    setPanning(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
    const rect = svgRectRef.current;
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    if (dragRef.current) {
      const dxPx = e.clientX - dragRef.current.mx;
      const dyPx = e.clientY - dragRef.current.my;
      const vp   = vpRef.current;
      svgRectRef.current = null;
      const dSta = -(dxPx / vp.chartW) * (dragRef.current.sMax - dragRef.current.sMin);
      const dLat =  (dyPx / vp.chartH) * (dragRef.current.tMax - dragRef.current.tMin);
      setViewSta([dragRef.current.sMin + dSta, dragRef.current.sMax + dSta]);
      setViewLat([dragRef.current.tMin + dLat, dragRef.current.tMax + dLat]);
      return;
    }

    pendingPosRef.current = { svgX, svgY };
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const p = pendingPosRef.current;
        if (!p) return;
        setMouseWorld(svgToWorld(p.svgX, p.svgY, vpRef.current));
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 0 && !dragRef.current) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const w = svgToWorld(e.clientX - svgRectRef.current.left, e.clientY - svgRectRef.current.top, vpRef.current);
      if (measActive) {
        if (pending == null) setPending(w);
        else { setMeasurements(ms => [...ms, { p1: pending, p2: w }]); setPending(null); }
      }
    }
    dragRef.current = null;
    setPanning(false);
  };

  const handleMouseLeave = () => {
    if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
    dragRef.current = null;
    setPanning(false);
    setMouseWorld(null);
  };

  const isZoomed = viewSta !== null || viewLat !== null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden select-none">

      {/* ── Row 1: Identity bar ───────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3.5 border-b border-border/60"
        style={{ height: "36px", fontSize: "14px", background: "var(--toolbar-bg)", borderTop: "3px solid #10b981", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" className="shrink-0 rounded-[3px]">
          <rect width="32" height="32" rx="5" fill="#E8312A"/>
          <text x="16" y="23" fontFamily="Arial" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle">iC</text>
        </svg>
        <span className="font-bold text-[11px] tracking-tight">Abwicklung</span>
        {state?.alignmentName && (
          <span className="text-[10px] text-muted-foreground">— {state.alignmentName}</span>
        )}
        {state?.staStart != null && state?.staEnd != null && (
          <span className="text-[10px] font-mono text-emerald-400">{fmtSta(state.staStart)} – {fmtSta(state.staEnd)}</span>
        )}
        <div className="flex-1" />
        {state?.computing && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        {mouseWorld != null && (
          <span className="text-[10px] font-mono text-muted-foreground">
            Sta:&nbsp;{fmtSta(mouseWorld[0])}&nbsp;&nbsp;
            Lat:&nbsp;{mouseWorld[1] >= 0 ? "+" : ""}{mouseWorld[1].toFixed(2)}&nbsp;m
          </span>
        )}
        <div className={`w-1.5 h-1.5 rounded-full ${state != null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
      </div>

      {/* ── Row 2: Ribbon ─────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-stretch border-b border-border overflow-x-auto"
        style={{ height: "60px", fontSize: "14px", background: "var(--toolbar-bg)" }}
      >
        <AbwGroup label="Station">
          <span className="text-[9px] text-muted-foreground">Von</span>
          <input
            value={rangeInput.start}
            onChange={e => setRangeInput(r => ({ ...r, start: e.target.value }))}
            onBlur={applyRange}
            onKeyDown={e => { if (e.key === "Enter") applyRange(); }}
            className="w-16 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
            placeholder="0"
          />
          <span className="text-[9px] text-muted-foreground">Bis</span>
          <input
            value={rangeInput.end}
            onChange={e => setRangeInput(r => ({ ...r, end: e.target.value }))}
            onBlur={applyRange}
            onKeyDown={e => { if (e.key === "Enter") applyRange(); }}
            className="w-16 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
            placeholder="1000"
          />
        </AbwGroup>

        <AbwGroup label="Korridor (m)">
          <span className="text-[9px] text-muted-foreground">Li</span>
          <input
            value={offsetInput.left}
            onChange={e => setOffsetInput(o => ({ ...o, left: e.target.value }))}
            onBlur={applyOffsets}
            onKeyDown={e => { if (e.key === "Enter") applyOffsets(); }}
            className="w-12 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
            placeholder="10"
          />
          <span className="text-[9px] text-muted-foreground">Re</span>
          <input
            value={offsetInput.right}
            onChange={e => setOffsetInput(o => ({ ...o, right: e.target.value }))}
            onBlur={applyOffsets}
            onKeyDown={e => { if (e.key === "Enter") applyOffsets(); }}
            className="w-12 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
            placeholder="10"
          />
        </AbwGroup>

        <AbwGroup label="Farbe">
          <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
            <button
              onClick={() => setColorMode("ifc")}
              className={cn("px-2 py-0.5 transition-colors",
                colorMode === "ifc" ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"
              )}
              title="IFC-Elementfarben"
            >IFC</button>
            <button
              onClick={() => setColorMode("elevation")}
              className={cn("px-2 py-0.5 transition-colors",
                colorMode === "elevation" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"
              )}
              title="Höhen-Farbrampe (blau = tief, rot = hoch)"
            >Höhe</button>
          </div>
        </AbwGroup>

        <AbwGroup label="Werkzeuge">
          <button
            onClick={() => { setMeasActive(a => !a); setPending(null); }}
            className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors whitespace-nowrap",
              measActive ? "bg-amber-500 text-white" : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="Messen"
          >
            <Ruler size={12} />
            <span>Messen</span>
          </button>
          {measurements.length > 0 && (
            <button onClick={() => { setMeasurements([]); setPending(null); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-red-400 transition-colors"
              title="Alle Messungen löschen">
              <Trash2 size={12} />
            </button>
          )}
        </AbwGroup>

        <AbwGroup label="Ansicht">
          {isZoomed && (
            <button onClick={() => { setViewSta(null); setViewLat(null); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground"
              title="Zoom zurücksetzen">
              <ZoomIn size={11} />
              <span>Reset</span>
            </button>
          )}
        </AbwGroup>

        <AbwGroup label="Export">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Als SVG exportieren"
          >
            <Download size={12} /><span>SVG</span>
          </button>
        </AbwGroup>

      </div>

      {/* ── Chart ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        <div ref={containerRef} className="flex-1 min-w-0 min-h-0 relative">
          <svg ref={svgRef}
            width="100%" height="100%"
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{ cursor: measActive ? "crosshair" : panning ? "grabbing" : "grab", display: "block" }}
          >
            <defs>
              <clipPath id="abw-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
            </defs>

            {/* Grid lines */}
            {yTicks.map(t => (
              <line key={t}
                x1={M.left} y1={ys(t)} x2={M.left + chartW} y2={ys(t)}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />
            ))}
            {xTicks.map(s => (
              <line key={s}
                x1={xs(s)} y1={M.top} x2={xs(s)} y2={M.top + chartH}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />
            ))}

            <g clipPath="url(#abw-clip)">

              {/* IFC edge lines */}
              {colorMode === "ifc"
                ? svgPaths.map(({ color, d }) => (
                    <path key={color} d={d} stroke={color} strokeWidth={1.2} fill="none" />
                  ))
                : svgPaths.map(({ color, d }, i) => (
                    <path key={i} d={d} stroke={color} strokeWidth={1.2} fill="none" />
                  ))
              }

              {/* Alignment centerline (lat = 0) */}
              {vtMin < 0 && vtMax > 0 && (
                <line
                  x1={M.left} y1={ys(0)} x2={M.left + chartW} y2={ys(0)}
                  stroke="#6366f1" strokeWidth={1.5} strokeDasharray="8,4" opacity={0.7}
                />
              )}

              {/* Left offset boundary */}
              {state?.leftOffset != null && vtMin < -state.leftOffset && vtMax > -state.leftOffset && (
                <line
                  x1={M.left} y1={ys(-state.leftOffset)} x2={M.left + chartW} y2={ys(-state.leftOffset)}
                  stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,4" opacity={0.5}
                />
              )}

              {/* Right offset boundary */}
              {state?.rightOffset != null && vtMin < state.rightOffset && vtMax > state.rightOffset && (
                <line
                  x1={M.left} y1={ys(state.rightOffset)} x2={M.left + chartW} y2={ys(state.rightOffset)}
                  stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,4" opacity={0.5}
                />
              )}

              {/* Committed measurements */}
              {measurements.map((meas, i) => {
                const dSta = meas.p2[0] - meas.p1[0];
                const dLat = meas.p2[1] - meas.p1[1];
                const dist = Math.hypot(dSta, dLat);
                const mx   = (xs(meas.p1[0]) + xs(meas.p2[0])) / 2;
                const my   = (ys(meas.p1[1]) + ys(meas.p2[1])) / 2;
                return (
                  <g key={i}>
                    <line x1={xs(meas.p1[0])} y1={ys(meas.p1[1])} x2={xs(meas.p2[0])} y2={ys(meas.p2[1])}
                      stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4,2" />
                    <circle cx={xs(meas.p1[0])} cy={ys(meas.p1[1])} r={3.5} fill="#fbbf24" />
                    <circle cx={xs(meas.p2[0])} cy={ys(meas.p2[1])} r={3.5} fill="#fbbf24" />
                    <rect x={mx - 32} y={my - 9} width={64} height={15} rx={3}
                      fill="var(--color-popover)" stroke="var(--color-border)" strokeWidth={1} opacity={0.95} />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize={10}
                      fill="#fbbf24" fontFamily="monospace" fontWeight="bold">{dist.toFixed(3)} m</text>
                  </g>
                );
              })}

              {/* Pending measurement preview */}
              {pending != null && (
                <>
                  <circle cx={xs(pending[0])} cy={ys(pending[1])} r={4} fill="#fbbf24" />
                  {mouseWorld != null && (() => {
                    const dSta = mouseWorld[0] - pending[0];
                    const dLat = mouseWorld[1] - pending[1];
                    const dist = Math.hypot(dSta, dLat);
                    const mx   = (xs(pending[0]) + xs(mouseWorld[0])) / 2;
                    const my   = (ys(pending[1]) + ys(mouseWorld[1])) / 2;
                    return (
                      <>
                        <line x1={xs(pending[0])} y1={ys(pending[1])} x2={xs(mouseWorld[0])} y2={ys(mouseWorld[1])}
                          stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
                        <text x={mx} y={my - 5} textAnchor="middle" fontSize={10}
                          fill="#fbbf24" fontFamily="monospace">{dist.toFixed(3)} m</text>
                      </>
                    );
                  })()}
                </>
              )}
            </g>

            {/* ── X axis (station) ── */}
            <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {xTicks.map(sta => (
              <g key={sta}>
                <line x1={xs(sta)} y1={M.top + chartH} x2={xs(sta)} y2={M.top + chartH + 5}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={xs(sta)} y={M.top + chartH + 15}
                  textAnchor="middle" fontSize={9}
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {fmtSta(sta)}
                </text>
              </g>
            ))}
            <text x={M.left + chartW} y={M.top + chartH + 30}
              textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)">Station [m]</text>

            {/* ── Y axis (lateral offset) ── */}
            <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {yTicks.map(t => (
              <g key={t}>
                <line x1={M.left - 5} y1={ys(t)} x2={M.left} y2={ys(t)}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={M.left - 8} y={ys(t) + 3}
                  textAnchor="end" fontSize={9}
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {t >= 0 ? "+" : ""}{t.toFixed(0)}
                </text>
              </g>
            ))}
            <text x={M.left + 4} y={M.top + 8}
              textAnchor="start" fontSize={9} fill="var(--color-muted-foreground)">
              ↑ Quer [m] +re
            </text>

            {/* Legend */}
            <g>
              <line x1={M.left + chartW - 100} y1={M.top + 8}
                    x2={M.left + chartW - 80}  y2={M.top + 8}
                    stroke="#6366f1" strokeWidth={1.5} strokeDasharray="8,4" opacity={0.7} />
              <text x={M.left + chartW - 76} y={M.top + 11}
                fontSize={8} fill="var(--color-muted-foreground)" fontFamily="monospace">
                Achse
              </text>
              <line x1={M.left + chartW - 45} y1={M.top + 8}
                    x2={M.left + chartW - 25}  y2={M.top + 8}
                    stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,4" opacity={0.6} />
              <text x={M.left + chartW - 21} y={M.top + 11}
                fontSize={8} fill="var(--color-muted-foreground)" fontFamily="monospace">
                Korridor
              </text>
            </g>
          </svg>

          {state?.computing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-card/90 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground shadow-lg">
                <Loader2 size={16} className="animate-spin" /> Berechne Abwicklung…
              </div>
            </div>
          )}
          {state?.alignmentId == null && !state?.computing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-card/90 rounded-lg px-6 py-4 text-center text-sm text-muted-foreground shadow-lg">
                {state == null
                  ? "Verbindung zum Hauptfenster wird hergestellt…"
                  : "Bereich im Profilviewer auswählen und Abwicklung öffnen"}
              </div>
            </div>
          )}
        </div>

        {/* ── Measurements sidebar ─────────────────────────────────────────── */}
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
              const dSta = meas.p2[0] - meas.p1[0];
              const dLat = meas.p2[1] - meas.p1[1];
              const dist = Math.hypot(dSta, dLat);
              return (
                <div key={i} className="bg-muted/40 rounded px-2 py-1.5 text-[10px] border border-border/50">
                  <div className="font-mono font-semibold text-amber-400 mb-0.5">{dist.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">ΔSta {dSta >= 0 ? "+" : ""}{dSta.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">ΔQuer {dLat >= 0 ? "+" : ""}{dLat.toFixed(3)} m</div>
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
