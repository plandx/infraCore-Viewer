import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { Ruler, Trash2, ZoomIn, Loader2, ChevronLeft, ChevronRight, Layers, Magnet, MapPin, Tag, Download, Columns2, Eye } from "lucide-react";
import { cn } from "../lib/utils";
import { CROSS_SECTION_CHANNEL } from "../utils/windowSync";
import type { XSMsg, XSSyncState, XSSyncObjectLabel, XSSyncDepthLine } from "../utils/windowSync";

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

// Left margin for Y-axis labels, right margin for absolute-elevation axis
const M = { top: 12, right: 72, bottom: 40, left: 64 };

type Meas     = { p1: [number, number]; p2: [number, number] };
type PtLabel  = { id: string; x: number; y: number };
type SnapInfo = { pt: [number, number]; type: "vertex" | "edge" };
type DimAnnotation = { id: string; p1: [number, number]; p2: [number, number]; offset: number };

// ── ISO hatch definitions ─────────────────────────────────────────────────────

const ISO_HATCHES = [
  { id: "none",       label: "Keine" },
  { id: "concrete",   label: "Beton" },
  { id: "steel",      label: "Stahl" },
  { id: "wood",       label: "Holz" },
  { id: "insulation", label: "Dämmung" },
  { id: "earth",      label: "Erdreich" },
  { id: "sand",       label: "Sand" },
  { id: "brick",      label: "Mauerwerk" },
] as const;
type HatchId = (typeof ISO_HATCHES)[number]["id"];

const DEFAULT_TYPE_HATCH: Record<string, HatchId> = {
  IfcWall:               "brick",
  IfcWallStandardCase:   "brick",
  IfcSlab:               "concrete",
  IfcFooting:            "concrete",
  IfcFoundation:         "concrete",
  IfcPile:               "concrete",
  IfcBeam:               "steel",
  IfcBeamStandardCase:   "steel",
  IfcColumn:             "steel",
  IfcColumnStandardCase: "steel",
  IfcMember:             "steel",
  IfcPlate:              "steel",
  IfcRoof:               "concrete",
  IfcCurtainWall:        "concrete",
  IfcStair:              "concrete",
  IfcRamp:               "concrete",
  IfcCovering:           "insulation",
};

// ── Snap ─────────────────────────────────────────────────────────────────────

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
  mode: "leader" | "direct",
): ObjLabelPos[] {
  const _xs = (x: number) => M.left + (x - vxMin) / visW * chartW;
  const _ys = (y: number) => M.top  + (1 - (y - vyMin) / visH) * chartH;

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
    const cx = _xs((g.xMin + g.xMax) / 2);
    const cy = _ys((g.yMin + g.yMax) / 2);
    const bw = Math.max(40, text.length * 6.5 + 12);
    const initLy = mode === "direct" ? cy - BH / 2 : _ys(g.yMax) - BH - 8;
    positions.push({ key: lbl.key, text, color: g.color, cx, cy, lx: cx - bw / 2, ly: initLy, bw, bh: BH });
  }

  deOverlapLabels(positions);
  return positions;
}

// ── CrossSectionWindow ribbon helpers ─────────────────────────────────────────

type XsIconProps = { size?: number; className?: string; strokeWidth?: number };

function XsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col shrink-0 border-r border-border">
      <div className="flex items-center gap-1 px-2 flex-1 min-w-0">{children}</div>
      <div className="text-[9px] text-muted-foreground/60 font-medium tracking-wide text-center px-2 pb-0.5 shrink-0">
        {label}
      </div>
    </div>
  );
}

function XsToolBtn({
  icon: Icon, label, onClick, active, title, disabled,
  color = "bg-sky-600 text-white",
}: {
  icon: (props: XsIconProps) => ReactNode;
  label?: string; onClick: () => void;
  active?: boolean; title?: string; disabled?: boolean; color?: string;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors whitespace-nowrap",
        active ? color : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted",
        disabled ? "opacity-50 cursor-not-allowed" : ""
      )}
    >
      <Icon size={12} />
      {label && <span>{label}</span>}
    </button>
  );
}

// ── SVG arrow helper ──────────────────────────────────────────────────────────

function arrowHeadPath(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return "";
  const ux = dx / len, uy = dy / len;
  const px = -uy * size * 0.4, py = ux * size * 0.4;
  // Arrow pointing from (x2,y2) back toward (x1,y1), tip at (x2,y2)
  return `M${(x2 - ux * size + px).toFixed(1)},${(y2 - uy * size + py).toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} L${(x2 - ux * size - px).toFixed(1)},${(y2 - uy * size - py).toFixed(1)}`;
}

export function CrossSectionWindow() {
  const [state, setState] = useState<XSSyncState | null>(null);
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    document.title = "Querschnitt — infraCore";
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(CROSS_SECTION_CHANNEL); } catch { return; }
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent<XSMsg>) => {
      if (e.data.t === "state") setState(e.data.s);
    };
    ch.postMessage({ t: "req" } satisfies XSMsg);

    const sendClose = () => { try { ch.postMessage({ t: "close" } satisfies XSMsg); } catch { /* ignore */ } };
    window.addEventListener("beforeunload", sendClose);

    return () => {
      window.removeEventListener("beforeunload", sendClose);
      ch.close();
      chRef.current = null;
    };
  }, []);

  const send = (msg: XSMsg) => chRef.current?.postMessage(msg);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle("dark", state?.theme !== "light");
  }, [state?.theme]);

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
  const svgRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(120, width), h: Math.max(80, height) });
      svgRectRef.current = null;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines      = state?.lines      ?? [];
  const polygons   = state?.polygons   ?? [];
  const depthLines = (state?.depthLines ?? []) as XSSyncDepthLine[];

  // ── Domain ────────────────────────────────────────────────────────────────
  const domain = useMemo(() => {
    const allSegs = [...lines, ...depthLines];
    if (!allSegs.length) return { xMin: -20, xMax: 20, yMin: -5, yMax: 10 };
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const l of allSegs) {
      xMin = Math.min(xMin, l.x1, l.x2); xMax = Math.max(xMax, l.x1, l.x2);
      yMin = Math.min(yMin, l.y1, l.y2); yMax = Math.max(yMax, l.y1, l.y2);
    }
    xMin = Math.min(xMin, -2); xMax = Math.max(xMax, 2);
    const xp = (xMax - xMin) * 0.08, yp = Math.max(1, (yMax - yMin) * 0.12);
    return { xMin: xMin - xp, xMax: xMax + xp, yMin: yMin - yp, yMax: yMax + yp };
  }, [lines, depthLines]);

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

  const xs = (x: number) => M.left  + (x - vxMin) / visW * chartW;
  const ys = (y: number) => M.top   + (1 - (y - vyMin) / visH) * chartH;

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
      svgRectRef.current = null;
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

  // ── Dimensioning tool (Kote) ──────────────────────────────────────────────
  const [dimActive, setDimActive] = useState(false);
  const [dimStep, setDimStep] = useState<"p1" | "p2" | "offset">("p1");
  const [dimP1, setDimP1] = useState<[number, number] | null>(null);
  const [dimP2, setDimP2] = useState<[number, number] | null>(null);
  const [dimensions, setDimensions] = useState<DimAnnotation[]>([]);

  // ── Point-label tool ─────────────────────────────────────────────────────
  const [ptLabelMode, setPtLabelMode] = useState(false);
  const [pointLabels, setPointLabels] = useState<PtLabel[]>([]);

  // ── Object label overlay ─────────────────────────────────────────────────
  const [objLabelsVisible, setObjLabelsVisible] = useState(false);
  const [objLabelProp, setObjLabelProp] = useState("name");
  const [labelStyle, setLabelStyle] = useState<"leader" | "direct">("leader");

  // ── ISO hatches ───────────────────────────────────────────────────────────
  const [hatchMode, setHatchMode] = useState<"none" | "auto" | "custom">("none");
  // custom: user can override per-type hatch
  const [customHatchMap, setCustomHatchMap] = useState<Record<string, HatchId>>({});

  // ── Depth view ────────────────────────────────────────────────────────────
  const [showCutLines,    setShowCutLines]    = useState(true);
  const [showViewLines,   setShowViewLines]   = useState(false);
  const [showHiddenLines, setShowHiddenLines] = useState(false);
  const [depthDistInput, setDepthDistInput] = useState("3.00");
  useEffect(() => {
    setDepthDistInput((state?.depthDistance ?? 3).toFixed(2));
  }, [state?.depthDistance]);

  // ── Snap mode ────────────────────────────────────────────────────────────
  const [snapActive, setSnapActive] = useState(false);
  const [snapDisplay, setSnapDisplay] = useState<SnapInfo | null>(null);
  const snapRef       = useRef<SnapInfo | null>(null);
  const snapActiveRef = useRef(false);
  useEffect(() => { snapActiveRef.current = snapActive; }, [snapActive]);

  // ── rAF throttle for mousemove ─────────────────────────────────────────
  const rafIdRef        = useRef<number | null>(null);
  const pendingPosRef   = useRef<{ svgX: number; svgY: number } | null>(null);

  // ── Ticks ─────────────────────────────────────────────────────────────────
  const xTicks = useMemo(() => computeTicks(vxMin, vxMax, Math.max(3, Math.floor(chartW / 70))), [vxMin, vxMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vyMin, vyMax, Math.max(3, Math.floor(chartH / 45))), [vyMin, vyMax, chartH]);

  // ── Pre-computed SVG paths ─────────────────────────────────────────────────
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

  // Depth lines split into visible/hidden buckets per color
  const svgDepthPaths = useMemo(() => {
    const vis = new Map<string, string>();
    const hid = new Map<string, string>();
    for (const l of depthLines) {
      const x1s = (M.left + (l.x1 - vxMin) / visW * chartW).toFixed(1);
      const y1s = (M.top  + (1 - (l.y1 - vyMin) / visH) * chartH).toFixed(1);
      const x2s = (M.left + (l.x2 - vxMin) / visW * chartW).toFixed(1);
      const y2s = (M.top  + (1 - (l.y2 - vyMin) / visH) * chartH).toFixed(1);
      const seg = `M${x1s},${y1s}L${x2s},${y2s}`;
      if (l.hidden) { hid.set(l.color, (hid.get(l.color) ?? "") + seg); }
      else          { vis.set(l.color, (vis.get(l.color) ?? "") + seg); }
    }
    return { vis: [...vis.entries()], hid: [...hid.entries()] };
  }, [depthLines, vxMin, vyMin, visW, visH, chartW, chartH]);

  const svgPolyPaths = useMemo(() => polygons.map(poly => ({
    color: poly.color,
    objectKey: poly.objectKey,
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

  const objLabelPositions = useMemo(() => {
    if (!objLabelsVisible || objectLabels.length === 0) return [];
    return buildLabelPositions(objectLabels, lines, objLabelProp, vxMin, vyMin, visW, visH, chartW, chartH, labelStyle);
  }, [objLabelsVisible, objectLabels, lines, objLabelProp, vxMin, vyMin, visW, visH, chartW, chartH, labelStyle]);

  // ── Hatch resolution ──────────────────────────────────────────────────────
  // Build objectKey → hatch pattern id
  const objectKeyToType = useMemo(() => {
    const m = new Map<string, string>();
    for (const lbl of objectLabels) m.set(lbl.key, lbl.type);
    return m;
  }, [objectLabels]);

  const resolveHatch = useCallback((objectKey: string | undefined): string => {
    if (hatchMode === "none" || !objectKey) return "url(#xs-hatch-concrete)";
    const type = objectKeyToType.get(objectKey) ?? "";
    if (hatchMode === "custom") {
      const h = customHatchMap[type] ?? DEFAULT_TYPE_HATCH[type] ?? "concrete";
      return h === "none" ? "none" : `url(#xs-hatch-${h})`;
    }
    // auto
    const h = DEFAULT_TYPE_HATCH[type] ?? "concrete";
    return `url(#xs-hatch-${h})`;
  }, [hatchMode, objectKeyToType, customHatchMap]);

  // All unique types visible in current polygons (for hatch UI)
  const visibleTypes = useMemo(() => {
    if (hatchMode !== "custom") return [];
    const types = new Set<string>();
    for (const p of polygons) {
      if (p.objectKey) {
        const t = objectKeyToType.get(p.objectKey);
        if (t) types.add(t);
      }
    }
    return Array.from(types).sort();
  }, [hatchMode, polygons, objectKeyToType]);

  // ── Elevation origin ──────────────────────────────────────────────────────
  const elevationOrigin = state?.elevationOrigin;

  // ── SVG Export ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Compute resolved CSS-variable colors from the live document
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

    // Walk all elements and resolve var() in stroke/fill/color attributes and inline styles
    clone.querySelectorAll<SVGElement>("*").forEach(el => {
      const attrs = ["stroke", "fill", "color"];
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v && v.includes("var(")) el.setAttribute(a, resolve(v));
      }
      if (el.style.color?.includes("var(")) el.style.color = resolve(el.style.color);
    });

    // Add white background for standalone viewing
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", String(size.w));
    bg.setAttribute("height", String(size.h));
    bg.setAttribute("fill", state?.theme === "light" ? "#ffffff" : "#1a1b26");
    clone.insertBefore(bg, clone.firstChild);

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const sta = state?.station != null ? `_${fmtSta(state.station).replace("+", "-")}` : "";
    a.download = `querschnitt${sta}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [size, state?.theme, state?.station]);

  // ── Event handlers ────────────────────────────────────────────────────────
  const svgToWorldFromVp = (svgX: number, svgY: number, vp: typeof vpRef.current): [number, number] => [
    vp.vxMin + (svgX - M.left) / vp.chartW * vp.visW,
    vp.vyMax - (svgY - M.top)  / vp.chartH * vp.visH,
  ];

  const activeToolRef = useRef({ measActive, ptLabelMode, dimActive });
  activeToolRef.current = { measActive, ptLabelMode, dimActive };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const { measActive: ma, ptLabelMode: pt, dimActive: da } = activeToolRef.current;
    if (ma || pt || da || e.button !== 0) return;
    dragRef.current = { mx: e.clientX, my: e.clientY, cx, cy, sc: scale };
    setPanning(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
    const rect = svgRectRef.current;
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.mx;
      const dy = e.clientY - dragRef.current.my;
      svgRectRef.current = null;
      setViewCenter([
        dragRef.current.cx - dx / dragRef.current.sc,
        dragRef.current.cy + dy / dragRef.current.sc,
      ]);
      return;
    }

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
      } else if (dimActive) {
        if (dimStep === "p1") {
          setDimP1(w); setDimP2(null); setDimStep("p2");
        } else if (dimStep === "p2") {
          setDimP2(w); setDimStep("offset");
        } else if (dimStep === "offset" && dimP1 && dimP2) {
          // Compute perpendicular offset distance from dimension line
          const dx = dimP2[0] - dimP1[0], dy = dimP2[1] - dimP1[1];
          const len = Math.hypot(dx, dy);
          if (len > 1e-6) {
            const nx = -dy / len, ny = dx / len; // perpendicular (left-hand normal)
            const offset = (w[0] - dimP1[0]) * nx + (w[1] - dimP1[1]) * ny;
            setDimensions(ds => [...ds, { id: crypto.randomUUID(), p1: dimP1, p2: dimP2, offset }]);
          }
          setDimP1(null); setDimP2(null); setDimStep("p1");
        }
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

  // ── Derived cursor ────────────────────────────────────────────────────────
  const isToolActive = measActive || ptLabelMode || dimActive;
  const cursorStyle = isToolActive ? "crosshair" : panning ? "grabbing" : "grab";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden select-none">

      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-3 border-b border-border/60 bg-card" style={{ height: '28px', fontSize: '14px' }}>
        <svg width="16" height="16" viewBox="0 0 32 32" className="shrink-0 rounded-[3px]">
          <rect width="32" height="32" rx="5" fill="#E8312A"/>
          <text x="16" y="23" fontFamily="Arial" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle">iC</text>
        </svg>
        <span className="font-bold text-[11px] tracking-tight">Querschnitt</span>
        {state?.alignmentName && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">— {state.alignmentName}</span>
        )}
        {!state?.isFaceSection && state?.station != null && (
          <span className="text-[10px] font-mono text-primary ml-1">{fmtSta(state.station)}</span>
        )}
        {state?.isFaceSection && (
          <span className="text-[10px] font-mono text-amber-400 ml-1">Versatz: {(state.faceOffset ?? 0).toFixed(2)} m</span>
        )}
        {state?.computing && <Loader2 size={11} className="animate-spin text-muted-foreground ml-1" />}
        <div className="flex-1" />
        {effW != null && (
          <span className={cn("text-[10px] font-mono",
            snapActive && snapDisplay ? "text-amber-400" : "text-muted-foreground")}>
            {effW[0] >= 0 ? "R" : "L"}&nbsp;{Math.abs(effW[0]).toFixed(3)} m&nbsp;&nbsp;
            Δh&nbsp;{effW[1] >= 0 ? "+" : ""}{effW[1].toFixed(3)} m
            {elevationOrigin != null && (
              <span className="ml-2 text-sky-400/80">
                {(elevationOrigin + effW[1]).toFixed(3)} m ü.NHN
              </span>
            )}
            {snapActive && snapDisplay && (
              <span className="ml-1 text-[9px] opacity-70">
                {snapDisplay.type === "vertex" ? "●" : "—"}
              </span>
            )}
          </span>
        )}
        {isZoomed && (
          <button
            onClick={() => { setZoomFactor(1.0); setViewCenter(null); }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Zoom zurücksetzen"
          >
            <ZoomIn size={11} /> Reset
          </button>
        )}
        <div className="flex items-center gap-1 text-[10px]">
          <div className={`w-1.5 h-1.5 rounded-full ${state != null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
          <span className="text-muted-foreground">{state != null ? "Verbunden" : "Warte…"}</span>
        </div>
      </div>

      {/* ── Ribbon bar ───────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-stretch border-b border-border bg-card/40 overflow-x-auto" style={{ height: '52px', fontSize: '14px' }}>

        {/* Station */}
        <XsGroup label="Station">
          {state?.isFaceSection ? (
            <>
              <button onClick={() => send({ t: "setFaceOffset", offset: (state.faceOffset ?? 0) - faceStep })}
                className="xs-btn" title={`−${faceStep} m`}><ChevronLeft size={12} /></button>
              <input
                type="number" step={faceStep} value={faceOffsetInput}
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
                className="w-20 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
              />
              <button onClick={() => send({ t: "setFaceOffset", offset: (state.faceOffset ?? 0) + faceStep })}
                className="xs-btn" title={`+${faceStep} m`}><ChevronRight size={12} /></button>
              <select value={faceStep} onChange={e => setFaceStep(Number(e.target.value))}
                className="text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-foreground">
                {[0.01, 0.05, 0.1, 0.25, 0.5, 1.0].map(s => <option key={s} value={s}>{s} m</option>)}
              </select>
            </>
          ) : (
            <>
              <button onClick={() => navigate(-step * 10)}
                className="xs-btn text-[10px] font-mono" title={`−${step * 10} m`}>◄◄</button>
              <button onClick={() => navigate(-step)}
                className="xs-btn" title={`−${step} m`}><ChevronLeft size={12} /></button>
              <input
                type="text" value={staInput}
                onChange={e => setStaInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitSta()}
                onBlur={submitSta}
                className="w-24 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
                placeholder="0+000.000"
              />
              <button onClick={() => navigate(step)}
                className="xs-btn" title={`+${step} m`}><ChevronRight size={12} /></button>
              <button onClick={() => navigate(step * 10)}
                className="xs-btn text-[10px] font-mono" title={`+${step * 10} m`}>►►</button>
              <span className="text-[9px] text-muted-foreground ml-1">Δ</span>
              <select value={step} onChange={e => setStep(Number(e.target.value))}
                className="text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-foreground">
                {[1, 5, 10, 25, 50, 100].map(s => <option key={s} value={s}>{s} m</option>)}
              </select>
            </>
          )}
        </XsGroup>

        {/* Modus (non-face only) */}
        {!state?.isFaceSection && (
          <XsGroup label="Modus">
            <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
              {(["vertical", "normal"] as const).map(m => (
                <button key={m}
                  onClick={() => send({ t: "setMode", mode: m })}
                  className={cn("px-2 py-0.5 transition-colors",
                    state?.mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "vertical" ? "Vertikal" : "Normal"}
                </button>
              ))}
            </div>
          </XsGroup>
        )}

        {/* Linien */}
        <XsGroup label="Linien">
          <XsToolBtn icon={Eye} label="Schnitt" active={showCutLines}
            onClick={() => setShowCutLines(v => !v)}
            title="Schnittlinien (direkte Verschneidung)" color="bg-sky-600 text-white" />
          <XsToolBtn icon={Eye} label="Ansicht" active={showViewLines}
            onClick={() => {
              const next = !showViewLines;
              setShowViewLines(next);
              const depthOn = state?.depthView ?? false;
              if (next && !depthOn) send({ t: "setDepthView", enabled: true });
              else if (!next && !showHiddenLines && depthOn) send({ t: "setDepthView", enabled: false });
            }}
            title="Ansichtslinien (sichtbare Tiefenkanten)" color="bg-emerald-600 text-white" />
          <XsToolBtn icon={Layers} label="Verdeckt" active={showHiddenLines}
            onClick={() => {
              const next = !showHiddenLines;
              setShowHiddenLines(next);
              const depthOn = state?.depthView ?? false;
              if (next && !depthOn) send({ t: "setDepthView", enabled: true });
              else if (!next && !showViewLines && depthOn) send({ t: "setDepthView", enabled: false });
            }}
            title="Verdeckte Linien (gestrichelt)" color="bg-violet-600 text-white" />
          {state?.depthView && (
            <div className="flex items-center gap-0.5">
              <input
                type="number" min={0.1} max={100} step={0.5}
                value={depthDistInput}
                onChange={e => setDepthDistInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const v = parseFloat(depthDistInput.replace(",", "."));
                    if (!isNaN(v) && v > 0) send({ t: "setDepthView", enabled: true, distance: v });
                  }
                }}
                onBlur={() => {
                  const v = parseFloat(depthDistInput.replace(",", "."));
                  if (!isNaN(v) && v > 0) send({ t: "setDepthView", enabled: true, distance: v });
                }}
                className="w-12 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
              />
              <span className="text-[9px] text-muted-foreground">m</span>
            </div>
          )}
        </XsGroup>

        {/* Werkzeuge */}
        <XsGroup label="Werkzeuge">
          <div className="flex flex-col gap-0.5 justify-center">
            <div className="flex items-center gap-1">
              <XsToolBtn icon={Ruler} label="Messen" active={measActive}
                onClick={() => { setMeasActive(a => !a); setPending(null); setPtLabelMode(false); setDimActive(false); setDimStep("p1"); setDimP1(null); setDimP2(null); }}
                color="bg-amber-500 text-white" />
              {measurements.length > 0 && (
                <button onClick={() => { setMeasurements([]); setPending(null); }}
                  className="xs-btn text-muted-foreground hover:text-red-400" title="Messungen löschen">
                  <Trash2 size={10} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <XsToolBtn icon={Columns2} label="Kote" active={dimActive}
                onClick={() => { setDimActive(a => !a); setMeasActive(false); setPending(null); setPtLabelMode(false); setDimStep("p1"); setDimP1(null); setDimP2(null); }}
                title="Bemaßung / Kote absetzen" color="bg-orange-500 text-white" />
              {dimensions.length > 0 && (
                <button onClick={() => setDimensions([])}
                  className="xs-btn text-muted-foreground hover:text-red-400" title="Koten löschen">
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-0.5 justify-center ml-1">
            <div className="flex items-center gap-1">
              <XsToolBtn icon={MapPin} label="Punkt" active={ptLabelMode}
                onClick={() => { setPtLabelMode(a => !a); setMeasActive(false); setPending(null); setDimActive(false); setDimStep("p1"); setDimP1(null); setDimP2(null); }}
                title="Punkt X/Y beschriften" color="bg-violet-600 text-white" />
              {pointLabels.length > 0 && (
                <button onClick={() => setPointLabels([])}
                  className="xs-btn text-muted-foreground hover:text-red-400" title="Punkte löschen">
                  <Trash2 size={10} />
                </button>
              )}
            </div>
            {measActive && pending != null && (
              <span className="text-[9px] text-amber-400 italic">2. Punkt…</span>
            )}
            {dimActive && (
              <span className="text-[9px] text-orange-400 italic">
                {dimStep === "p1" ? "1. Punkt…" : dimStep === "p2" ? "2. Punkt…" : "Kote…"}
              </span>
            )}
          </div>
        </XsGroup>

        {/* Fang */}
        <XsGroup label="Fang">
          <XsToolBtn icon={Magnet} label="Fang" active={snapActive}
            onClick={() => setSnapActive(a => !a)}
            title="Fangmodus" color="bg-sky-600 text-white" />
        </XsGroup>

        {/* Beschriftung */}
        <XsGroup label="Beschriftung">
          <XsToolBtn icon={Tag} active={objLabelsVisible}
            onClick={() => setObjLabelsVisible(a => !a)}
            title="Objekte beschriften" color="bg-emerald-600 text-white" />
          {objLabelsVisible && availablePropKeys.length > 0 && (
            <select
              value={objLabelProp}
              onChange={e => setObjLabelProp(e.target.value)}
              className="text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-foreground max-w-[90px]"
              title="Beschriftungsattribut"
            >
              {availablePropKeys.map(k => (
                <option key={k} value={k}>{k === "name" ? "Name" : k === "type" ? "Typ" : k}</option>
              ))}
            </select>
          )}
          {objLabelsVisible && (
            <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
              <button
                onClick={() => setLabelStyle("leader")}
                className={cn("px-1.5 py-0.5 transition-colors",
                  labelStyle === "leader" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >Linie</button>
              <button
                onClick={() => setLabelStyle("direct")}
                className={cn("px-1.5 py-0.5 transition-colors",
                  labelStyle === "direct" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >Direkt</button>
            </div>
          )}
        </XsGroup>

        {/* Darstellung */}
        <XsGroup label="Darstellung">
          <select
            value={hatchMode}
            onChange={e => setHatchMode(e.target.value as typeof hatchMode)}
            className="text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-foreground"
            title="Schraffur-Modus"
          >
            <option value="none">Uniform</option>
            <option value="auto">Auto (Typ)</option>
            <option value="custom">Anpassen</option>
          </select>
          <XsToolBtn icon={Layers} label="3D-Fläche"
            active={!!state?.showSectionSurface}
            onClick={() => send({ t: "toggleSectionSurface" })}
            title="Schnittfläche im 3D-Viewer anzeigen"
            color="bg-sky-600 text-white" />
        </XsGroup>

        {/* Export */}
        <XsGroup label="Export">
          <XsToolBtn icon={Download} label="SVG" active={false}
            onClick={handleExport}
            title="Als SVG exportieren" />
        </XsGroup>

      </div>

      {/* ── Custom hatch assignment panel ──────────────────────────────────── */}
      {hatchMode === "custom" && visibleTypes.length > 0 && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-border bg-card/20 flex-wrap text-[10px]">
          <span className="text-muted-foreground font-semibold">Schraffur:</span>
          {visibleTypes.map(type => (
            <div key={type} className="flex items-center gap-1">
              <span className="text-muted-foreground truncate max-w-[100px]" title={type}>{type}</span>
              <select
                value={customHatchMap[type] ?? DEFAULT_TYPE_HATCH[type] ?? "concrete"}
                onChange={e => setCustomHatchMap(m => ({ ...m, [type]: e.target.value as HatchId }))}
                className="text-[10px] bg-muted border border-border rounded px-1 py-0 text-foreground"
              >
                {ISO_HATCHES.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* ── Chart ────────────────────────────────────────────────────────── */}
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
            style={{ cursor: cursorStyle, display: "block" }}
          >
            <defs>
              <clipPath id="xs-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>

              {/* ── ISO hatch patterns ── */}
              {/* Beton: diagonal 45° */}
              <pattern id="xs-hatch-concrete" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="8">
                <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="0.9" opacity="0.45" />
              </pattern>
              {/* Stahl: Kreuzschraffur */}
              <pattern id="xs-hatch-steel" patternUnits="userSpaceOnUse" x="0" y="0" width="6" height="6">
                <line x1="0" y1="6" x2="6" y2="0" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
                <line x1="0" y1="0" x2="6" y2="6" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
              </pattern>
              {/* Holz: horizontale Linien */}
              <pattern id="xs-hatch-wood" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="5">
                <line x1="0" y1="2.5" x2="8" y2="2.5" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
              </pattern>
              {/* Dämmung: Zickzack */}
              <pattern id="xs-hatch-insulation" patternUnits="userSpaceOnUse" x="0" y="0" width="12" height="8">
                <polyline points="0,4 3,1 6,4 9,7 12,4" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.4" />
              </pattern>
              {/* Erdreich: diagonale mit Punkten */}
              <pattern id="xs-hatch-earth" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="8">
                <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
                <circle cx="2" cy="6" r="0.8" fill="currentColor" opacity="0.45" />
                <circle cx="6" cy="2" r="0.8" fill="currentColor" opacity="0.45" />
              </pattern>
              {/* Sand: feine Punkte */}
              <pattern id="xs-hatch-sand" patternUnits="userSpaceOnUse" x="0" y="0" width="6" height="6">
                <circle cx="1.5" cy="1.5" r="0.7" fill="currentColor" opacity="0.4" />
                <circle cx="4.5" cy="4.5" r="0.7" fill="currentColor" opacity="0.4" />
                <circle cx="1.5" cy="4.5" r="0.4" fill="currentColor" opacity="0.3" />
              </pattern>
              {/* Mauerwerk: Ziegelstruktur */}
              <pattern id="xs-hatch-brick" patternUnits="userSpaceOnUse" x="0" y="0" width="12" height="8">
                <line x1="0" y1="4" x2="12" y2="4" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
                <line x1="6" y1="0" x2="6" y2="4"  stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
                <line x1="0" y1="4" x2="0" y2="8"  stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
                <line x1="12" y1="4" x2="12" y2="8" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
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

              {/* Hatched polygon fills */}
              {svgPolyPaths.map((p, i) => {
                const hatchFill = hatchMode !== "none"
                  ? resolveHatch(p.objectKey)
                  : "url(#xs-hatch-concrete)";
                return (
                  <g key={i} style={{ color: p.color }}>
                    <path d={p.d} fill={p.color} fillOpacity={0.18} stroke="none" />
                    {hatchFill !== "none" && (
                      <path d={p.d} fill={hatchFill} stroke="none" opacity={0.6} />
                    )}
                  </g>
                );
              })}

              {/* Verdeckte Linien (hidden edges, dashed thin) */}
              {showHiddenLines && svgDepthPaths.hid.map(([color, d]) => (
                <path key={color} d={d} stroke={color} strokeWidth={0.7} fill="none"
                  strokeDasharray="3,3" opacity={0.35} />
              ))}
              {/* Ansichtslinien (visible depth edges, solid thin) */}
              {showViewLines && svgDepthPaths.vis.map(([color, d]) => (
                <path key={color} d={d} stroke={color} strokeWidth={0.9} fill="none" opacity={0.55} />
              ))}
              {/* Schnittlinien (direct section cut, thick solid) */}
              {showCutLines && svgPaths.map(([color, d]) => (
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

              {/* Dimension annotations (Koten) */}
              {dimensions.map(dim => {
                const dx = dim.p2[0] - dim.p1[0], dy = dim.p2[1] - dim.p1[1];
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) return null;
                const ux = dx / len, uy = dy / len;
                const nx = -uy, ny = ux; // left-hand perp (same as offset direction)
                const OVERSHOOT_W = 6 / scale; // extension line overshoot in world units
                // Dimension line endpoints (offset from measured points)
                const d1x = dim.p1[0] + nx * dim.offset, d1y = dim.p1[1] + ny * dim.offset;
                const d2x = dim.p2[0] + nx * dim.offset, d2y = dim.p2[1] + ny * dim.offset;
                const ARROW_W = 8 / scale;
                const mid = [(d1x + d2x) / 2, (d1y + d2y) / 2] as [number, number];
                const dist = len.toFixed(3);
                const textW = dist.length * 6.5 + 16;
                return (
                  <g key={dim.id}>
                    {/* Extension lines */}
                    <line
                      x1={xs(dim.p1[0])} y1={ys(dim.p1[1])}
                      x2={xs(d1x + nx * OVERSHOOT_W)} y2={ys(d1y + ny * OVERSHOOT_W)}
                      stroke="#fb923c" strokeWidth={1} />
                    <line
                      x1={xs(dim.p2[0])} y1={ys(dim.p2[1])}
                      x2={xs(d2x + nx * OVERSHOOT_W)} y2={ys(d2y + ny * OVERSHOOT_W)}
                      stroke="#fb923c" strokeWidth={1} />
                    {/* Dimension line */}
                    <line x1={xs(d1x)} y1={ys(d1y)} x2={xs(d2x)} y2={ys(d2y)}
                      stroke="#fb923c" strokeWidth={1.5} />
                    {/* Arrowheads */}
                    <path d={arrowHeadPath(xs(d2x), ys(d2y), xs(d1x), ys(d1y), 8)}
                      stroke="#fb923c" strokeWidth={1.2} fill="none" />
                    <path d={arrowHeadPath(xs(d1x), ys(d1y), xs(d2x), ys(d2y), 8)}
                      stroke="#fb923c" strokeWidth={1.2} fill="none" />
                    {/* Measured points */}
                    <circle cx={xs(dim.p1[0])} cy={ys(dim.p1[1])} r={2.5} fill="#fb923c" />
                    <circle cx={xs(dim.p2[0])} cy={ys(dim.p2[1])} r={2.5} fill="#fb923c" />
                    {/* Dimension text */}
                    <rect x={xs(mid[0]) - textW / 2} y={ys(mid[1]) - 8} width={textW} height={14} rx={2}
                      fill="var(--color-popover)" stroke="#fb923c" strokeWidth={0.8} opacity={0.95} />
                    <text x={xs(mid[0])} y={ys(mid[1]) + 3} textAnchor="middle" fontSize={10}
                      fill="#fb923c" fontFamily="monospace" fontWeight="bold">{dist} m</text>
                  </g>
                );
              })}

              {/* Preview for dim tool */}
              {dimActive && (() => {
                if (dimStep === "p2" && dimP1 && effW) {
                  return (
                    <>
                      <circle cx={xs(dimP1[0])} cy={ys(dimP1[1])} r={3} fill="#fb923c" />
                      <line x1={xs(dimP1[0])} y1={ys(dimP1[1])} x2={xs(effW[0])} y2={ys(effW[1])}
                        stroke="#fb923c" strokeWidth={1} strokeDasharray="3,2" opacity={0.6} />
                    </>
                  );
                }
                if (dimStep === "offset" && dimP1 && dimP2 && effW) {
                  const dx = dimP2[0] - dimP1[0], dy = dimP2[1] - dimP1[1];
                  const len = Math.hypot(dx, dy);
                  if (len < 1e-6) return null;
                  const nx = -dy / len, ny = dx / len;
                  const offset = (effW[0] - dimP1[0]) * nx + (effW[1] - dimP1[1]) * ny;
                  const d1x = dimP1[0] + nx * offset, d1y = dimP1[1] + ny * offset;
                  const d2x = dimP2[0] + nx * offset, d2y = dimP2[1] + ny * offset;
                  return (
                    <>
                      <line x1={xs(dimP1[0])} y1={ys(dimP1[1])} x2={xs(d1x)} y2={ys(d1y)}
                        stroke="#fb923c" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.5} />
                      <line x1={xs(dimP2[0])} y1={ys(dimP2[1])} x2={xs(d2x)} y2={ys(d2y)}
                        stroke="#fb923c" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.5} />
                      <line x1={xs(d1x)} y1={ys(d1y)} x2={xs(d2x)} y2={ys(d2y)}
                        stroke="#fb923c" strokeWidth={1} strokeDasharray="4,2" opacity={0.7} />
                    </>
                  );
                }
                return null;
              })()}

              {/* Point labels */}
              {pointLabels.map(lbl => {
                const sx  = xs(lbl.x), sy  = ys(lbl.y);
                const s0x = xs(0),     s0y = ys(0);
                const xLbl = lbl.x === 0 ? "0.00 m"
                  : `${lbl.x > 0 ? "R" : "L"} ${Math.abs(lbl.x).toFixed(2)} m`;
                const yLbl = `${lbl.y >= 0 ? "+" : ""}${lbl.y.toFixed(2)} m`;
                const elevLbl = elevationOrigin != null
                  ? `${(elevationOrigin + lbl.y).toFixed(2)} m` : null;
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
                        {/* Relative Δh */}
                        <rect x={sx + yTxtDx - (yAnchor === "start" ? 0 : 52)} y={mvy - 9} width={52} height={11} rx={2}
                          fill="var(--color-popover)" opacity={0.88} />
                        <text x={sx + yTxtDx} y={mvy} textAnchor={yAnchor} fontSize={9}
                          fill="#a78bfa" fontFamily="monospace" fontWeight="bold">{yLbl}</text>
                        {/* Absolute elevation */}
                        {elevLbl && (
                          <>
                            <rect x={sx + yTxtDx - (yAnchor === "start" ? 0 : 58)} y={mvy + 4} width={58} height={11} rx={2}
                              fill="var(--color-popover)" opacity={0.88} />
                            <text x={sx + yTxtDx} y={mvy + 13} textAnchor={yAnchor} fontSize={9}
                              fill="#38bdf8" fontFamily="monospace">{elevLbl}</text>
                          </>
                        )}
                      </>
                    )}
                    <circle cx={sx} cy={sy} r={3} fill="#a78bfa" />
                  </g>
                );
              })}

              {ptLabelMode && effW != null && (
                <circle cx={xs(effW[0])} cy={ys(effW[1])} r={3}
                  fill="none" stroke="#a78bfa" strokeWidth={1.2} opacity={0.7} strokeDasharray="2,1" />
              )}
            </g>

            {/* Snap indicator */}
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

            {/* Object labels */}
            {objLabelPositions.map(lbl => {
              if (labelStyle === "direct") {
                return (
                  <g key={lbl.key}>
                    <rect x={lbl.lx} y={lbl.ly} width={lbl.bw} height={lbl.bh} rx={3}
                      fill="var(--color-popover)" stroke={lbl.color} strokeWidth={1} opacity={0.92} />
                    <text x={lbl.lx + lbl.bw / 2} y={lbl.ly + lbl.bh - 4}
                      textAnchor="middle" fontSize={9}
                      fill={lbl.color} fontFamily="sans-serif" fontWeight="600">{lbl.text}</text>
                  </g>
                );
              }
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

            {/* ── X axis ── */}
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

            {/* ── Left Y axis (relative Δh) ── */}
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

            {/* ── Right Y axis (absolute elevation) ── */}
            {elevationOrigin != null && (
              <>
                <line x1={M.left + chartW} y1={M.top} x2={M.left + chartW} y2={M.top + chartH}
                  stroke="var(--color-border)" strokeWidth={1} />
                {yTicks.map(y => {
                  const absElev = elevationOrigin + y;
                  return (
                    <g key={y}>
                      <line x1={M.left + chartW} y1={ys(y)} x2={M.left + chartW + 5} y2={ys(y)}
                        stroke="#38bdf8" strokeWidth={1} opacity={0.7} />
                      <text x={M.left + chartW + 8} y={ys(y) + 3} textAnchor="start" fontSize={9}
                        fill="#38bdf8" fontFamily="monospace" opacity={0.85}>
                        {absElev.toFixed(1)}
                      </text>
                    </g>
                  );
                })}
                <text x={M.left + chartW + 4} y={M.top + 8} textAnchor="start" fontSize={9}
                  fill="#38bdf8" opacity={0.85}>↑ m ü.NHN</text>
              </>
            )}
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

        {/* ── Measurements sidebar ── */}
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
