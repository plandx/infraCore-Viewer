import { useRef, useState, useEffect, useMemo } from "react";
import { Ruler, Trash2, ZoomIn, Loader2, ChevronLeft, ChevronRight, Layers, Magnet, MapPin, Tag } from "lucide-react";
import { cn } from "../lib/utils";
import { CROSS_SECTION_CHANNEL } from "../utils/windowSync";
import type { XSMsg, XSSyncState, XSSyncObjectLabel } from "../utils/windowSync";

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

type Meas     = { p1: [number, number]; p2: [number, number] };
type PtLabel  = { id: string; x: number; y: number };
type SnapInfo = { pt: [number, number]; type: "vertex" | "edge" };

function computeSnap(
  wx: number, wy: number,
  segs: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  scale: number,
): SnapInfo | null {
  const T = 14 / scale;
  let best: SnapInfo | null = null;
  let bestD = Infinity;

  for (const l of segs) {
    for (const [px, py] of [[l.x1, l.y1], [l.x2, l.y2]] as [number, number][]) {
      const d = Math.hypot(wx - px, wy - py);
      if (d < T && d < bestD) { bestD = d; best = { pt: [px, py], type: "vertex" }; }
    }
  }
  if (best) return best;

  for (const l of segs) {
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const t  = Math.max(0, Math.min(1, ((wx - l.x1) * dx + (wy - l.y1) * dy) / len2));
    const px = l.x1 + t * dx, py = l.y1 + t * dy;
    const d  = Math.hypot(wx - px, wy - py);
    if (d < T && d < bestD) { bestD = d; best = { pt: [px, py], type: "edge" }; }
  }
  return best;
}

// ── Object label layout ───────────────────────────────────────────────────────

type ObjLabelPos = {
  key: string; text: string; color: string;
  cx: number; cy: number;
  lx: number; ly: number;
  bw: number; bh: number;
};

function deOverlapLabels(labels: ObjLabelPos[]): void {
  const PAD = 4;
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        const acx = a.lx + a.bw / 2, acy = a.ly + a.bh / 2;
        const bcx = b.lx + b.bw / 2, bcy = b.ly + b.bh / 2;
        const overX = (a.bw / 2 + b.bw / 2 + PAD) - Math.abs(bcx - acx);
        const overY = (a.bh / 2 + b.bh / 2 + PAD) - Math.abs(bcy - acy);
        if (overX > 0 && overY > 0) {
          // Push along the axis with less overlap (minimum separation effort)
          if (overX <= overY) {
            const push = overX / 2 + 0.5;
            if (bcx >= acx) { a.lx -= push; b.lx += push; }
            else            { a.lx += push; b.lx -= push; }
          } else {
            const push = overY / 2 + 0.5;
            if (bcy >= acy) { a.ly -= push; b.ly += push; }
            else            { a.ly += push; b.ly -= push; }
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function buildLabelPositions(
  objectLabels: XSSyncObjectLabel[],
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; objectKey?: string }>,
  propKey: string,
  vxMin: number, vyMin: number, visW: number, visH: number, chartW: number, chartH: number,
): ObjLabelPos[] {
  const _xs = (x: number) => M.left + (x - vxMin) / visW * chartW;
  const _ys = (y: number) => M.top  + (1 - (y - vyMin) / visH) * chartH;

  // Use bounding box center for centroid — midpoint average skews toward long/dense segments
  const groups = new Map<string, { xMin: number; xMax: number; yMin: number; yMax: number; color: string }>();
  for (const l of lines) {
    if (!l.objectKey) continue;
    const g = groups.get(l.objectKey);
    if (g) {
      g.xMin = Math.min(g.xMin, l.x1, l.x2);
      g.xMax = Math.max(g.xMax, l.x1, l.x2);
      g.yMin = Math.min(g.yMin, l.y1, l.y2);
      g.yMax = Math.max(g.yMax, l.y1, l.y2);
    } else {
      groups.set(l.objectKey, {
        xMin: Math.min(l.x1, l.x2), xMax: Math.max(l.x1, l.x2),
        yMin: Math.min(l.y1, l.y2), yMax: Math.max(l.y1, l.y2),
        color: l.color,
      });
    }
  }

  const BH = 15;
  const positions: ObjLabelPos[] = [];

  for (const lbl of objectLabels) {
    const g = groups.get(lbl.key);
    if (!g) continue;
    const text = propKey === "name" ? lbl.name
      : propKey === "type" ? lbl.type
      : (lbl.props[propKey] ?? lbl.name);
    if (!text) continue;
    // Anchor to bounding box center; initial label above top edge of bounding box
    const cx = _xs((g.xMin + g.xMax) / 2);
    const cy = _ys((g.yMin + g.yMax) / 2);
    const topSvg = _ys(g.yMax);
    const bw = Math.max(40, text.length * 6.5 + 12);
    positions.push({ key: lbl.key, text, color: g.color, cx, cy, lx: cx - bw / 2, ly: topSvg - BH - 8, bw, bh: BH });
  }

  deOverlapLabels(positions);
  return positions;
}

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

    // Notify the main window when this popup closes so it can clear the section
    const sendClose = () => { try { ch.postMessage({ t: "close" } satisfies XSMsg); } catch { /* ignore */ } };
    window.addEventListener("beforeunload", sendClose);

    return () => {
      window.removeEventListener("beforeunload", sendClose);
      sendClose(); // also fire on React unmount (e.g. HMR)
      ch.close();
      chRef.current = null;
    };
  }, []);

  const send = (msg: XSMsg) => chRef.current?.postMessage(msg);

  // ── Station navigation ────────────────────────────────────────────────────
  const [step, setStep] = useState(10);
  const [staInput, setStaInput] = useState("");

  useEffect(() => {
    if (state?.station != null) setStaInput(fmtSta(state.station));
  }, [state?.station]);

  // ── Face cross-section offset ─────────────────────────────────────────────
  const [faceOffsetInput, setFaceOffsetInput] = useState("0.00");
  const [faceStep, setFaceStep] = useState(0.5);

  useEffect(() => {
    setFaceOffsetInput((state?.faceOffset ?? 0).toFixed(2));
  }, [state?.faceOffset]);

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
  // Cached SVG bounding rect — invalidated on resize so we don't call getBCR on every mousemove
  const svgRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(120, width), h: Math.max(80, height) });
      svgRectRef.current = null; // invalidate on resize
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines    = state?.lines    ?? [];
  const polygons = state?.polygons ?? [];

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
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const [viewCenter, setViewCenter] = useState<[number, number] | null>(null);

  useEffect(() => { setZoomFactor(1.0); setViewCenter(null); },
    [domain.xMin, domain.xMax, domain.yMin, domain.yMax]);

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

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

  // Coordinate transforms (used in render only — hot-path uses refs below)
  const xs = (x: number) => M.left  + (x - vxMin) / visW * chartW;
  const ys = (y: number) => M.top   + (1 - (y - vyMin) / visH) * chartH;

  // ── Viewport refs (for event handlers / rAF callbacks — no stale closures) ─
  const vpRef = useRef({ vxMin, vyMin, vyMax, visW, visH, chartW, chartH, scale });
  vpRef.current = { vxMin, vyMin, vyMax, visW, visH, chartW, chartH, scale };
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const zoomRef   = useRef(1.0);
  const centerRef = useRef<[number, number] | null>(null);
  const domainRef = useRef(domain);
  useEffect(() => { zoomRef.current   = zoomFactor; }, [zoomFactor]);
  useEffect(() => { centerRef.current = viewCenter; }, [viewCenter]);
  useEffect(() => { domainRef.current = domain; },     [domain]);

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
      const curVW = cw / sc, curVH = ch / sc;
      const mx    = Math.max(0, Math.min(cw, e.clientX - rect.left - M.left));
      const my    = Math.max(0, Math.min(ch, e.clientY - rect.top  - M.top));
      const mxD   = curCx - curVW / 2 + mx / sc;
      const myD   = curCy + curVH / 2 - my / sc;
      const f     = e.deltaY > 0 ? 1 / 1.25 : 1.25;
      const newZ  = Math.max(0.1, Math.min(200, curZ * f));
      const newSc = bs * newZ;
      const newVW = cw / newSc, newVH = ch / newSc;
      svgRectRef.current = null; // viewport changed
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

  // ── Point-label tool ─────────────────────────────────────────────────────
  const [ptLabelMode, setPtLabelMode] = useState(false);
  const [pointLabels, setPointLabels] = useState<PtLabel[]>([]);

  // ── Object label overlay ─────────────────────────────────────────────────
  const [objLabelsVisible, setObjLabelsVisible] = useState(false);
  const [objLabelProp, setObjLabelProp] = useState("name");

  // ── Snap mode ────────────────────────────────────────────────────────────
  const [snapActive, setSnapActive] = useState(false);
  const [snapDisplay, setSnapDisplay] = useState<SnapInfo | null>(null);
  const snapRef       = useRef<SnapInfo | null>(null);
  const snapActiveRef = useRef(false);
  useEffect(() => { snapActiveRef.current = snapActive; }, [snapActive]);

  // ── rAF throttle for mousemove ────────────────────────────────────────────
  // Mousemove fires at 200+ Hz; we cap state updates to ~60 Hz via rAF.
  // This alone cuts renders by ~3-4x. Combined with path pre-computation it's huge.
  const rafIdRef        = useRef<number | null>(null);
  const pendingPosRef   = useRef<{ svgX: number; svgY: number } | null>(null);

  // ── Ticks ─────────────────────────────────────────────────────────────────
  const xTicks = useMemo(() => computeTicks(vxMin, vxMax, Math.max(3, Math.floor(chartW / 70))), [vxMin, vxMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vyMin, vyMax, Math.max(3, Math.floor(chartH / 45))), [vyMin, vyMax, chartH]);

  // ── Pre-computed SVG paths (key perf optimisation) ─────────────────────────
  // Groups all line segments by color into a single <path> per color group.
  // Replaces potentially thousands of individual <line> SVG elements with ~10 <path> elements.
  const svgPaths = useMemo(() => {
    const byColor = new Map<string, string>();
    for (const l of lines) {
      const x1s = (M.left + (l.x1 - vxMin) / visW * chartW).toFixed(1);
      const y1s = (M.top  + (1 - (l.y1 - vyMin) / visH) * chartH).toFixed(1);
      const x2s = (M.left + (l.x2 - vxMin) / visW * chartW).toFixed(1);
      const y2s = (M.top  + (1 - (l.y2 - vyMin) / visH) * chartH).toFixed(1);
      byColor.set(l.color, (byColor.get(l.color) ?? "") + `M${x1s},${y1s}L${x2s},${y2s}`);
    }
    return [...byColor.entries()];
  }, [lines, vxMin, vyMin, visW, visH, chartW, chartH]);

  const svgPolyPaths = useMemo(() => polygons.map(poly => ({
    color: poly.color,
    d: poly.points.map(([x, y], j) =>
      `${j === 0 ? "M" : "L"}${(M.left + (x - vxMin) / visW * chartW).toFixed(1)},${(M.top + (1 - (y - vyMin) / visH) * chartH).toFixed(1)}`
    ).join("") + "Z",
  })), [polygons, vxMin, vyMin, visW, visH, chartW, chartH]);

  const isZoomed = zoomFactor !== 1.0 || viewCenter !== null;
  const effW = (snapActive && snapDisplay) ? snapDisplay.pt : mouseWorld;

  // ── Object labels ─────────────────────────────────────────────────────────
  const objectLabels = state?.objectLabels ?? [];

  const availablePropKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const lbl of objectLabels) for (const k of Object.keys(lbl.props)) keys.add(k);
    return ["name", "type", ...Array.from(keys).sort()];
  }, [objectLabels]);

  // Deps use numbers, not function references — memo actually works correctly
  const objLabelPositions = useMemo(() => {
    if (!objLabelsVisible || objectLabels.length === 0) return [];
    return buildLabelPositions(objectLabels, lines, objLabelProp, vxMin, vyMin, visW, visH, chartW, chartH);
  }, [objLabelsVisible, objectLabels, lines, objLabelProp, vxMin, vyMin, visW, visH, chartW, chartH]);

  // ── Event handlers ────────────────────────────────────────────────────────
  const svgToWorldFromVp = (svgX: number, svgY: number, vp: typeof vpRef.current): [number, number] => [
    vp.vxMin + (svgX - M.left) / vp.chartW * vp.visW,
    vp.vyMax - (svgY - M.top)  / vp.chartH * vp.visH,
  ];

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (measActive || ptLabelMode || e.button !== 0) return;
    dragRef.current = { mx: e.clientX, my: e.clientY, cx, cy, sc: scale };
    setPanning(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // Cache bounding rect — one layout query until next resize/zoom
    if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
    const rect = svgRectRef.current;
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    // Drag panning: update immediately for smooth feel
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.mx;
      const dy = e.clientY - dragRef.current.my;
      svgRectRef.current = null; // viewport shifts on pan
      setViewCenter([
        dragRef.current.cx - dx / dragRef.current.sc,
        dragRef.current.cy + dy / dragRef.current.sc,
      ]);
      return;
    }

    // All other updates (readout, snap) throttled to rAF (~60 Hz)
    pendingPosRef.current = { svgX, svgY };
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const p = pendingPosRef.current;
        if (!p) return;
        const vp = vpRef.current;
        const raw = svgToWorldFromVp(p.svgX, p.svgY, vp);

        setMouseWorld(raw);

        if (snapActiveRef.current) {
          const s = computeSnap(raw[0], raw[1], linesRef.current, vp.scale);
          // Only trigger state update if snap result changed
          const prev = snapRef.current;
          if (s?.pt[0] !== prev?.pt[0] || s?.pt[1] !== prev?.pt[1] || s?.type !== prev?.type) {
            snapRef.current = s;
            setSnapDisplay(s);
          }
        } else if (snapRef.current) {
          snapRef.current = null;
          setSnapDisplay(null);
        }
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 0) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const raw = svgToWorldFromVp(e.clientX - svgRectRef.current.left, e.clientY - svgRectRef.current.top, vpRef.current);
      const w: [number, number] = snapActiveRef.current && snapRef.current ? snapRef.current.pt : raw;

      if (measActive) {
        if (pending == null) setPending(w);
        else { setMeasurements(ms => [...ms, { p1: pending, p2: w }]); setPending(null); }
      } else if (ptLabelMode) {
        setPointLabels(ls => [...ls, { id: crypto.randomUUID(), x: w[0], y: w[1] }]);
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
    snapRef.current = null;
    setSnapDisplay(null);
  };

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
        {state?.isFaceSection && (
          <span className="text-xs font-mono text-amber-400 ml-1">Versatz: {(state.faceOffset ?? 0).toFixed(2)} m</span>
        )}
        {!state?.isFaceSection && state?.station != null && (
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

        {state?.isFaceSection ? (
          /* Face cross-section: offset slider instead of station */
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Versatz</span>
            <button
              onClick={() => send({ t: "setFaceOffset", offset: (state.faceOffset ?? 0) - faceStep })}
              className="flex items-center px-1.5 py-0.5 rounded text-xs bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            ><ChevronLeft size={13} /></button>
            <input
              type="number"
              step={faceStep}
              value={faceOffsetInput}
              onChange={e => setFaceOffsetInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const v = parseFloat(faceOffsetInput.replace(",", "."));
                  if (!isNaN(v)) send({ t: "setFaceOffset", offset: v });
                }
              }}
              onBlur={() => {
                const v = parseFloat(faceOffsetInput.replace(",", "."));
                if (!isNaN(v)) send({ t: "setFaceOffset", offset: v });
              }}
              className="w-20 text-center text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">m</span>
            <button
              onClick={() => send({ t: "setFaceOffset", offset: (state.faceOffset ?? 0) + faceStep })}
              className="flex items-center px-1.5 py-0.5 rounded text-xs bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            ><ChevronRight size={13} /></button>
            <select value={faceStep} onChange={e => setFaceStep(Number(e.target.value))}
              className="text-xs bg-muted border border-border rounded px-1 py-0.5 text-foreground">
              {[0.01, 0.05, 0.1, 0.25, 0.5, 1.0].map(s => <option key={s} value={s}>{s} m</option>)}
            </select>
          </div>
        ) : (
          <>
            {/* Station navigation (alignment mode) */}
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
          </>
        )}

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Mode (only for alignment-based cross-section) */}
        {!state?.isFaceSection && (
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
        )}

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* 3D section surface toggle */}
        <button
          onClick={() => send({ t: "toggleSectionSurface" })}
          className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            state?.showSectionSurface
              ? "bg-sky-600 text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Schnittfläche im 3D-Viewer anzeigen"
        >
          <Layers size={13} /> 3D-Fläche
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Measure */}
        <button
          onClick={() => { setMeasActive(a => !a); setPending(null); setPtLabelMode(false); }}
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

        {/* Point-label tool */}
        <button
          onClick={() => { setPtLabelMode(a => !a); setMeasActive(false); setPending(null); }}
          className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            ptLabelMode ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Punkt X/Y beschriften (gemessen vom Achspunkt)"
        >
          <MapPin size={13} /> Punkt
        </button>
        {pointLabels.length > 0 && (
          <button onClick={() => setPointLabels([])}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground hover:text-red-400 transition-colors"
            title="Alle Punktbeschriftungen löschen">
            <Trash2 size={12} />
          </button>
        )}

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Snap toggle */}
        <button
          onClick={() => setSnapActive(a => !a)}
          className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            snapActive ? "bg-sky-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Fangmodus: Punkt- und Linienfang"
        >
          <Magnet size={13} /> Fang
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Object labels toggle + property selector */}
        <button
          onClick={() => setObjLabelsVisible(a => !a)}
          className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            objLabelsVisible ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Objekte beschriften"
        >
          <Tag size={13} /> Objekte
        </button>
        {objLabelsVisible && availablePropKeys.length > 0 && (
          <select
            value={objLabelProp}
            onChange={e => setObjLabelProp(e.target.value)}
            className="text-xs bg-muted border border-border rounded px-1 py-0.5 text-foreground max-w-[120px]"
            title="Beschriftungsattribut"
          >
            {availablePropKeys.map(k => (
              <option key={k} value={k}>{k === "name" ? "Name" : k === "type" ? "Typ" : k}</option>
            ))}
          </select>
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

        {effW != null && (
          <span className={cn("ml-auto text-[10px] font-mono",
            snapActive && snapDisplay ? "text-amber-400" : "text-muted-foreground")}>
            {effW[0] >= 0 ? "R" : "L"}&nbsp;{Math.abs(effW[0]).toFixed(3)} m&nbsp;&nbsp;
            Δh&nbsp;{effW[1] >= 0 ? "+" : ""}{effW[1].toFixed(3)} m
            {snapActive && snapDisplay && (
              <span className="ml-1 text-[9px] opacity-70">
                {snapDisplay.type === "vertex" ? "●" : "—"}
              </span>
            )}
          </span>
        )}
      </div>

      {/* ── Chart + measurements sidebar ─────────────────────────────────── */}
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
            style={{ cursor: (measActive || ptLabelMode) ? "crosshair" : panning ? "grabbing" : "grab", display: "block" }}
          >
            <defs>
              <clipPath id="xs-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
              <pattern id="xs-hatch" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="8">
                <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="0.9" opacity="0.4" />
              </pattern>
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
              {/* Alignment axis */}
              <line x1={xs(0)} y1={M.top} x2={xs(0)} y2={M.top + chartH}
                stroke="var(--color-muted-foreground)" strokeWidth={1} strokeDasharray="6,4" opacity={0.5} />

              {/* Hatched polygon fills — pre-computed path strings */}
              {svgPolyPaths.map((p, i) => (
                <g key={i} style={{ color: p.color }}>
                  <path d={p.d} fill={p.color} fillOpacity={0.18} stroke="none" />
                  <path d={p.d} fill="url(#xs-hatch)" stroke="none" opacity={0.6} />
                </g>
              ))}

              {/* Section lines — one <path> per color instead of one <line> per segment */}
              {svgPaths.map(([color, d]) => (
                <path key={color} d={d} stroke={color} strokeWidth={1.5} fill="none" />
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
                      fill="#fbbf24" fontFamily="monospace" fontWeight="bold">{d.toFixed(3)} m</text>
                  </g>
                );
              })}

              {/* Pending measurement */}
              {pending != null && (
                <>
                  <circle cx={xs(pending[0])} cy={ys(pending[1])} r={4} fill="#fbbf24" />
                  {effW != null && (() => {
                    const d  = Math.sqrt((effW[0]-pending[0])**2 + (effW[1]-pending[1])**2);
                    const mx = (xs(pending[0]) + xs(effW[0])) / 2;
                    const my = (ys(pending[1]) + ys(effW[1])) / 2;
                    return (
                      <>
                        <line x1={xs(pending[0])} y1={ys(pending[1])} x2={xs(effW[0])} y2={ys(effW[1])}
                          stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
                        <text x={mx} y={my - 5} textAnchor="middle" fontSize={10}
                          fill="#fbbf24" fontFamily="monospace">{d.toFixed(3)} m</text>
                      </>
                    );
                  })()}
                </>
              )}

              {/* Point labels (X/Y from axis origin) */}
              {pointLabels.map(lbl => {
                const sx  = xs(lbl.x), sy  = ys(lbl.y);
                const s0x = xs(0),     s0y = ys(0);
                const xLbl = lbl.x === 0 ? "0.00 m"
                  : `${lbl.x > 0 ? "R" : "L"} ${Math.abs(lbl.x).toFixed(2)} m`;
                const yLbl = `${lbl.y >= 0 ? "+" : ""}${lbl.y.toFixed(2)} m`;
                const mhx = (s0x + sx) / 2, mvy = (s0y + sy) / 2;
                const xTxtDy = sy < s0y ? -5 : 12;
                const yTxtDx = sx > s0x ? 5 : -5;
                const yAnchor = sx > s0x ? "start" : "end";
                return (
                  <g key={lbl.id}>
                    {lbl.x !== 0 && (
                      <line x1={s0x} y1={sy} x2={sx} y2={sy}
                        stroke="#a78bfa" strokeWidth={0.9} strokeDasharray="4,2" opacity={0.75} />
                    )}
                    {lbl.y !== 0 && (
                      <line x1={sx} y1={s0y} x2={sx} y2={sy}
                        stroke="#a78bfa" strokeWidth={0.9} strokeDasharray="4,2" opacity={0.75} />
                    )}
                    {lbl.x !== 0 && <line x1={s0x - 3} y1={sy} x2={s0x + 3} y2={sy} stroke="#a78bfa" strokeWidth={1.2} />}
                    {lbl.y !== 0 && <line x1={sx} y1={s0y - 3} x2={sx} y2={s0y + 3} stroke="#a78bfa" strokeWidth={1.2} />}
                    {lbl.x !== 0 && (
                      <>
                        <rect x={mhx - 26} y={sy + xTxtDy - 9} width={52} height={11} rx={2}
                          fill="var(--color-popover)" opacity={0.88} />
                        <text x={mhx} y={sy + xTxtDy} textAnchor="middle" fontSize={9}
                          fill="#a78bfa" fontFamily="monospace" fontWeight="bold">{xLbl}</text>
                      </>
                    )}
                    {lbl.y !== 0 && (
                      <>
                        <rect x={sx + yTxtDx - (yAnchor === "start" ? 0 : 52)} y={mvy - 9} width={52} height={11} rx={2}
                          fill="var(--color-popover)" opacity={0.88} />
                        <text x={sx + yTxtDx} y={mvy} textAnchor={yAnchor} fontSize={9}
                          fill="#a78bfa" fontFamily="monospace" fontWeight="bold">{yLbl}</text>
                      </>
                    )}
                    <circle cx={sx} cy={sy} r={3} fill="#a78bfa" />
                  </g>
                );
              })}

              {/* Live preview dot when ptLabelMode active */}
              {ptLabelMode && effW != null && (
                <circle cx={xs(effW[0])} cy={ys(effW[1])} r={3}
                  fill="none" stroke="#a78bfa" strokeWidth={1.2} opacity={0.7} strokeDasharray="2,1" />
              )}
            </g>

            {/* Snap indicator — above clip group */}
            {snapActive && snapDisplay && (() => {
              const sx = xs(snapDisplay.pt[0]), sy = ys(snapDisplay.pt[1]);
              return snapDisplay.type === "vertex" ? (
                <g>
                  <rect x={sx - 5} y={sy - 5} width={10} height={10}
                    fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.9}
                    transform={`rotate(45,${sx},${sy})`} />
                  <circle cx={sx} cy={sy} r={1.5} fill="#f59e0b" opacity={0.9} />
                </g>
              ) : (
                <g>
                  <circle cx={sx} cy={sy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.9} />
                  <circle cx={sx} cy={sy} r={1.5} fill="#f59e0b" opacity={0.9} />
                </g>
              );
            })()}

            {/* Object labels with leader lines */}
            {objLabelPositions.map(lbl => {
              const clampedCx = Math.max(M.left, Math.min(M.left + chartW, lbl.cx));
              const clampedCy = Math.max(M.top,  Math.min(M.top + chartH,  lbl.cy));
              const boxCx = lbl.lx + lbl.bw / 2;
              const boxCy = lbl.ly + lbl.bh / 2;
              const edgeX = boxCx + (clampedCx < boxCx ? -lbl.bw / 2 : lbl.bw / 2);
              return (
                <g key={lbl.key}>
                  <line x1={clampedCx} y1={clampedCy} x2={edgeX} y2={boxCy}
                    stroke={lbl.color} strokeWidth={0.8} strokeDasharray="3,2" opacity={0.65} />
                  <circle cx={clampedCx} cy={clampedCy} r={2.5} fill={lbl.color} opacity={0.8} />
                  <rect x={lbl.lx} y={lbl.ly} width={lbl.bw} height={lbl.bh} rx={3}
                    fill="var(--color-popover)" stroke={lbl.color} strokeWidth={1} opacity={0.95} />
                  <text x={lbl.lx + lbl.bw / 2} y={lbl.ly + lbl.bh - 4}
                    textAnchor="middle" fontSize={9}
                    fill={lbl.color} fontFamily="sans-serif" fontWeight="600">{lbl.text}</text>
                </g>
              );
            })}

            {/* X axis */}
            <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {xTicks.map(x => (
              <g key={x}>
                <line x1={xs(x)} y1={M.top + chartH} x2={xs(x)} y2={M.top + chartH + 5}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={xs(x)} y={M.top + chartH + 16} textAnchor="middle" fontSize={10}
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {x === 0 ? "0" : `${x > 0 ? "R" : "L"} ${Math.abs(x).toFixed(2)}`}
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
                  {y >= 0 ? "+" : ""}{y.toFixed(2)}
                </text>
              </g>
            ))}
            <text x={M.left + 4} y={M.top + 8} textAnchor="start" fontSize={10}
              fill="var(--color-muted-foreground)">↑ Δh [m]</text>
          </svg>

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
