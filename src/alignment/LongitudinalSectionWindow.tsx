import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { X, ZoomIn, Download } from "lucide-react";
import { LS_CHANNEL, openLongitudinalSectionWindow } from "../utils/windowSync";
import type { LSMsg, LSSyncState } from "../utils/windowSync";

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

const M = { top: 16, right: 20, bottom: 44, left: 72 };

const EMPTY_STATE: LSSyncState = {
  alignmentId: null,
  alignmentName: "",
  staStart: 0,
  staEnd: 1000,
  lines: [],
  profile: [],
  computing: false,
  theme: "dark",
};

export function LongitudinalSectionWindow() {
  const [state, setState]       = useState<LSSyncState>(EMPTY_STATE);
  const stateRef                = useRef<LSSyncState>(EMPTY_STATE);
  const channelRef              = useRef<BroadcastChannel | null>(null);
  const svgRef                  = useRef<SVGSVGElement>(null);
  const containerRef            = useRef<HTMLDivElement>(null);
  const [size, setSize]         = useState({ w: 1160, h: 540 });
  const [viewSta, setViewSta]   = useState<[number, number] | null>(null);
  const [hoverSta, setHoverSta] = useState<number | null>(null);

  const viewStaRef  = useRef<[number, number] | null>(null);

  // Request state from main window on mount
  useEffect(() => {
    const ch = new BroadcastChannel(LS_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev: MessageEvent<LSMsg>) => {
      const msg = ev.data;
      if (msg.t === "state") {
        stateRef.current = msg.s;
        setState(msg.s);
      }
    };
    ch.postMessage({ t: "req" } satisfies LSMsg);
    return () => { ch.close(); };
  }, []);

  useEffect(() => { stateRef.current = state; }, [state]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(200, width), h: Math.max(80, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close: notify main window
  const handleClose = () => {
    channelRef.current?.postMessage({ t: "close" } satisfies LSMsg);
    window.close();
  };

  // Domain
  const domain = useMemo(() => {
    const { lines, profile, staStart, staEnd } = state;
    let eMin = Infinity, eMax = -Infinity;
    for (const l of lines) {
      if (l.elev1 < eMin) eMin = l.elev1;
      if (l.elev1 > eMax) eMax = l.elev1;
      if (l.elev2 < eMin) eMin = l.elev2;
      if (l.elev2 > eMax) eMax = l.elev2;
    }
    for (const p of profile) {
      if (p.elev < eMin) eMin = p.elev;
      if (p.elev > eMax) eMax = p.elev;
    }
    if (!isFinite(eMin)) { eMin = 0; eMax = 100; }
    const ep = Math.max(2, (eMax - eMin) * 0.15);
    return { sMin: staStart, sMax: staEnd, eMin: eMin - ep, eMax: eMax + ep };
  }, [state]);

  // Reset view when alignment changes
  useEffect(() => { setViewSta(null); }, [state.alignmentId, state.staStart, state.staEnd]);

  const vMin = viewSta ? viewSta[0] : domain.sMin;
  const vMax = viewSta ? viewSta[1] : domain.sMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  const xs = (sta: number)  => M.left + ((sta - vMin) / (vMax - vMin || 1)) * chartW;
  const ys = (elev: number) => M.top  + chartH * (1 - (elev - domain.eMin) / (domain.eMax - domain.eMin || 1));

  useEffect(() => { viewStaRef.current = viewSta; }, [viewSta]);
  const domainRef = useRef(domain);
  useEffect(() => { domainRef.current = domain; }, [domain]);

  // Wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const curMin = viewStaRef.current ? viewStaRef.current[0] : domainRef.current.sMin;
      const curMax = viewStaRef.current ? viewStaRef.current[1] : domainRef.current.sMax;
      const cw     = rect.width - M.left - M.right;
      const centerSta = curMin + Math.max(0, Math.min(1, (mx - M.left) / cw)) * (curMax - curMin);
      const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
      const half   = (curMax - curMin) * factor / 2;
      const dom    = domainRef.current;
      const newMin = Math.max(dom.sMin, Math.min(dom.sMax - half * 2,
        centerSta - half * ((centerSta - curMin) / (curMax - curMin || 1)) * 2));
      setViewSta([newMin, newMin + half * 2]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Pan
  const dragRef = useRef<{ x: number; min: number; max: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, min: vMin, max: vMax };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      const dx    = e.clientX - dragRef.current.x;
      const range = dragRef.current.max - dragRef.current.min;
      const staDx = -(dx / chartW) * range;
      const dom   = domainRef.current;
      const newMin = Math.max(dom.sMin, Math.min(dom.sMax - range, dragRef.current.min + staDx));
      setViewSta([newMin, newMin + range]);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    if (mx < M.left || mx > M.left + chartW) { setHoverSta(null); return; }
    setHoverSta(vMin + ((mx - M.left) / chartW) * (vMax - vMin));
  };

  const handleMouseUp = () => { dragRef.current = null; setIsDragging(false); };
  const handleMouseLeave = () => { dragRef.current = null; setIsDragging(false); setHoverSta(null); };

  const xTicks = useMemo(
    () => computeTicks(vMin, vMax, Math.max(4, Math.floor(chartW / 110))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vMin, vMax, chartW]
  );
  const yTicks = useMemo(
    () => computeTicks(domain.eMin, domain.eMax, 6),
    [domain.eMin, domain.eMax]
  );

  // Export SVG
  const handleExport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `laengenschnitt_${state.alignmentName || "export"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.alignmentName]);

  // Range input
  const [rangeInput, setRangeInput] = useState({ start: "", end: "" });
  useEffect(() => {
    setRangeInput({
      start: state.staStart.toFixed(0),
      end:   state.staEnd.toFixed(0),
    });
  }, [state.staStart, state.staEnd]);

  const applyRange = () => {
    const s = parseFloat(rangeInput.start);
    const e = parseFloat(rangeInput.end);
    if (isFinite(s) && isFinite(e) && s < e) {
      channelRef.current?.postMessage({ t: "setRange", staStart: s, staEnd: e } satisfies LSMsg);
    }
  };

  const isZoomed = viewSta !== null;

  // Visible IFC lines in view
  const visibleLines = useMemo(
    () => state.lines.filter(l =>
      Math.max(l.sta1, l.sta2) >= vMin && Math.min(l.sta1, l.sta2) <= vMax
    ),
    [state.lines, vMin, vMax]
  );

  // Profile polyline path
  const profilePath = useMemo(() => {
    const pts = state.profile.filter(p => p.sta >= vMin && p.sta <= vMax);
    if (pts.length < 2) return "";
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${xs(p.sta).toFixed(1)},${ys(p.elev).toFixed(1)}`).join(" ");
  }, [state.profile, vMin, vMax, xs, ys]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDark = state.theme !== "light";

  return (
    <div
      ref={containerRef}
      className="w-screen h-screen flex flex-col overflow-hidden"
      style={{
        background: isDark ? "#0f0f0f" : "#ffffff",
        color: isDark ? "#e8e8e8" : "#1a1a1a",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* ── Header ── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-1 border-b"
        style={{ borderColor: isDark ? "#333" : "#ccc", fontSize: 11 }}
      >
        <span style={{ fontWeight: 600, letterSpacing: "0.06em", fontSize: 10, opacity: 0.7 }}>
          LÄNGENSCHNITT
        </span>
        {state.alignmentName && (
          <span style={{ fontWeight: 600 }}>{state.alignmentName}</span>
        )}
        <span style={{ opacity: 0.5, fontSize: 9 }}>
          {fmtSta(state.staStart)} – {fmtSta(state.staEnd)}
        </span>

        <div style={{ flex: 1 }} />

        {/* Range inputs */}
        <label style={{ fontSize: 9, opacity: 0.6 }}>Von</label>
        <input
          value={rangeInput.start}
          onChange={e => setRangeInput(r => ({ ...r, start: e.target.value }))}
          onBlur={applyRange}
          onKeyDown={e => { if (e.key === "Enter") applyRange(); }}
          style={{
            width: 72, fontSize: 9, padding: "1px 4px", borderRadius: 3,
            background: isDark ? "#1e1e1e" : "#f0f0f0",
            border: `1px solid ${isDark ? "#444" : "#ccc"}`,
            color: "inherit",
          }}
        />
        <label style={{ fontSize: 9, opacity: 0.6 }}>Bis</label>
        <input
          value={rangeInput.end}
          onChange={e => setRangeInput(r => ({ ...r, end: e.target.value }))}
          onBlur={applyRange}
          onKeyDown={e => { if (e.key === "Enter") applyRange(); }}
          style={{
            width: 72, fontSize: 9, padding: "1px 4px", borderRadius: 3,
            background: isDark ? "#1e1e1e" : "#f0f0f0",
            border: `1px solid ${isDark ? "#444" : "#ccc"}`,
            color: "inherit",
          }}
        />

        {state.computing && (
          <span style={{ fontSize: 9, opacity: 0.55, fontStyle: "italic" }}>Berechnung…</span>
        )}

        {isZoomed && (
          <button
            onClick={() => setViewSta(null)}
            style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, opacity: 0.7, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
            title="Zoom zurücksetzen"
          >
            <ZoomIn size={11} /> Reset
          </button>
        )}

        <button
          onClick={handleExport}
          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, opacity: 0.7, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          title="SVG exportieren"
        >
          <Download size={11} />
        </button>

        <button
          onClick={handleClose}
          style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}
          title="Schließen"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Chart area ── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {state.lines.length === 0 && !state.computing && state.alignmentId === null ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, opacity: 0.45 }}>
            Kein Längenschnitt aktiv — Bereich im Profilviewer auswählen (P) und Längenschnitt öffnen
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
                stroke={isDark ? "#ffffff18" : "#00000018"} strokeWidth={0.5}
              />
            ))}

            <defs>
              <clipPath id="ls-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
            </defs>

            <g clipPath="url(#ls-clip)">
              {/* Computing overlay */}
              {state.computing && (
                <rect x={M.left} y={M.top} width={chartW} height={chartH}
                  fill={isDark ? "#ffffff08" : "#00000008"} />
              )}

              {/* IFC section lines */}
              {visibleLines.map((l, i) => (
                <line key={i}
                  x1={xs(l.sta1)} y1={ys(l.elev1)}
                  x2={xs(l.sta2)} y2={ys(l.elev2)}
                  stroke={l.color} strokeWidth={1} opacity={0.75}
                />
              ))}

              {/* Designed profile grade line */}
              {profilePath && (
                <path
                  d={profilePath}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth={1.5}
                  strokeDasharray="6,3"
                  opacity={0.85}
                />
              )}

              {/* Hover station line */}
              {hoverSta !== null && (
                <line
                  x1={xs(hoverSta)} y1={M.top}
                  x2={xs(hoverSta)} y2={M.top + chartH}
                  stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)"}
                  strokeWidth={1} strokeDasharray="3,2"
                />
              )}
            </g>

            {/* X axis */}
            <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
              stroke={isDark ? "#444" : "#bbb"} strokeWidth={1} />
            {xTicks.map(sta => (
              <g key={sta}>
                <line x1={xs(sta)} y1={M.top + chartH} x2={xs(sta)} y2={M.top + chartH + 5}
                  stroke={isDark ? "#555" : "#aaa"} strokeWidth={1} />
                <text x={xs(sta)} y={M.top + chartH + 15}
                  textAnchor="middle" fontSize={9}
                  fill={isDark ? "#888" : "#666"} fontFamily="monospace"
                >
                  {fmtSta(sta)}
                </text>
              </g>
            ))}

            {/* Y axis */}
            <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
              stroke={isDark ? "#444" : "#bbb"} strokeWidth={1} />
            {yTicks.map(e => (
              <g key={e}>
                <line x1={M.left - 5} y1={ys(e)} x2={M.left} y2={ys(e)}
                  stroke={isDark ? "#555" : "#aaa"} strokeWidth={1} />
                <text x={M.left - 8} y={ys(e) + 3}
                  textAnchor="end" fontSize={9}
                  fill={isDark ? "#888" : "#666"} fontFamily="monospace"
                >
                  {e.toFixed(1)}
                </text>
              </g>
            ))}

            {/* Hover station label */}
            {hoverSta !== null && (
              <text
                x={Math.min(xs(hoverSta) + 4, M.left + chartW - 60)}
                y={M.top + 12}
                fontSize={9} fontFamily="monospace"
                fill={isDark ? "#aaa" : "#555"}
              >
                {fmtSta(hoverSta)}
              </text>
            )}

            {/* Legend */}
            <g>
              <line x1={M.left + chartW - 80} y1={M.top + 8}
                    x2={M.left + chartW - 60} y2={M.top + 8}
                    stroke="#4ade80" strokeWidth={1.5} strokeDasharray="6,3" />
              <text x={M.left + chartW - 56} y={M.top + 11}
                fontSize={8} fill={isDark ? "#888" : "#666"} fontFamily="monospace">
                Gradiente
              </text>
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
