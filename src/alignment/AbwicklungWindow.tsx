import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { ZoomIn, Loader2, Download, Ruler, Trash2, Eye, Tag, Magnet } from "lucide-react";
import { cn } from "../lib/utils";
import { ABWICKLUNG_CHANNEL } from "../utils/windowSync";
import type { AbwicklungMsg, AbwicklungSyncState, XSSyncObjectLabel } from "../utils/windowSync";

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

// Elevation → hue: blue (low) → red (high)
function elevColor(elev: number, elevMin: number, elevMax: number): string {
  const t = elevMax > elevMin ? Math.max(0, Math.min(1, (elev - elevMin) / (elevMax - elevMin))) : 0.5;
  return `hsl(${((1 - t) * 240).toFixed(0)},80%,55%)`;
}

const M = { top: 12, right: 20, bottom: 44, left: 62 };

// ── Ribbon helpers ────────────────────────────────────────────────────────────

function AbwGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col shrink-0 border-r border-border">
      <div className="flex items-center gap-1 px-2 flex-1 min-w-0">{children}</div>
      <div className="text-[9px] text-muted-foreground/60 font-medium tracking-wide text-center px-2 pb-0.5 shrink-0">{label}</div>
    </div>
  );
}

function AbwBtn({ icon: Icon, label, onClick, active, title, color = "bg-sky-600 text-white" }: {
  icon: (p: { size: number }) => ReactNode; label?: string; onClick: () => void;
  active?: boolean; title?: string; color?: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors whitespace-nowrap",
        active ? color : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
      )}>
      <Icon size={12} />
      {label && <span>{label}</span>}
    </button>
  );
}

// ── Label layout (same de-overlap as LS/XS) ────────────────────────────────────

type ObjLabelPos = { key: string; text: string; color: string; cx: number; cy: number; lx: number; ly: number; bw: number; bh: number };

function deOverlapLabels(labels: ObjLabelPos[]): void {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        const acx = a.lx + a.bw / 2, acy = a.ly + a.bh / 2;
        const bcx = b.lx + b.bw / 2, bcy = b.ly + b.bh / 2;
        const ox = (a.bw / 2 + b.bw / 2 + 4) - Math.abs(bcx - acx);
        const oy = (a.bh / 2 + b.bh / 2 + 4) - Math.abs(bcy - acy);
        if (ox > 0 && oy > 0) {
          if (ox <= oy) { const p = ox / 2 + 0.5; if (bcx >= acx) { a.lx -= p; b.lx += p; } else { a.lx += p; b.lx -= p; } }
          else          { const p = oy / 2 + 0.5; if (bcy >= acy) { a.ly -= p; b.ly += p; } else { a.ly += p; b.ly -= p; } }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function buildLabelPositions(
  objectLabels: XSSyncObjectLabel[],
  lines: AbwicklungSyncState["lines"],
  propKey: string,
  vMin: number, vtMin: number, vRange: number, vtRange: number,
  chartW: number, chartH: number,
  mode: "leader" | "direct",
): ObjLabelPos[] {
  const _xs = (s: number) => M.left + (s - vMin) / vRange * chartW;
  const _ys = (t: number) => M.top  + chartH * (1 - (t - vtMin) / vtRange);

  const groups = new Map<string, { sMin: number; sMax: number; tMin: number; tMax: number; color: string }>();
  for (const l of lines) {
    if (!l.objectKey) continue;
    const g = groups.get(l.objectKey);
    if (g) {
      g.sMin = Math.min(g.sMin, l.s1, l.s2); g.sMax = Math.max(g.sMax, l.s1, l.s2);
      g.tMin = Math.min(g.tMin, l.t1, l.t2); g.tMax = Math.max(g.tMax, l.t1, l.t2);
    } else {
      groups.set(l.objectKey, { sMin: Math.min(l.s1,l.s2), sMax: Math.max(l.s1,l.s2), tMin: Math.min(l.t1,l.t2), tMax: Math.max(l.t1,l.t2), color: l.color });
    }
  }
  const BH = 15;
  const positions: ObjLabelPos[] = [];
  for (const lbl of objectLabels) {
    const g = groups.get(lbl.key);
    if (!g) continue;
    const text = propKey === "name" ? lbl.name : propKey === "type" ? lbl.type : (lbl.props[propKey] ?? lbl.name);
    if (!text) continue;
    const cx = _xs((g.sMin + g.sMax) / 2);
    const cy = _ys((g.tMin + g.tMax) / 2);
    const bw = Math.max(40, text.length * 6.5 + 12);
    positions.push({ key: lbl.key, text, color: g.color, cx, cy, lx: cx - bw / 2, ly: mode === "direct" ? cy - BH / 2 : _ys(g.tMax) - BH - 8, bw, bh: BH });
  }
  deOverlapLabels(positions);
  return positions;
}

// ── Screen-space snap ─────────────────────────────────────────────────────────

type SnapInfo = { pt: [number, number]; type: "vertex" | "edge" };

function computeSnapScreen(
  svgX: number, svgY: number,
  segs: Array<{ sx1: number; sy1: number; sx2: number; sy2: number; sta1: number; lat1: number; sta2: number; lat2: number }>,
): SnapInfo | null {
  const T = 12;
  let best: SnapInfo | null = null;
  let bestD = Infinity;
  for (const l of segs) {
    for (const [px, py, ws, wt] of [[l.sx1,l.sy1,l.sta1,l.lat1],[l.sx2,l.sy2,l.sta2,l.lat2]] as [number,number,number,number][]) {
      const d = Math.hypot(svgX-px, svgY-py);
      if (d < T && d < bestD) { bestD = d; best = { pt: [ws, wt], type: "vertex" }; }
    }
  }
  if (best) return best;
  for (const l of segs) {
    const dx = l.sx2-l.sx1, dy = l.sy2-l.sy1;
    const len2 = dx*dx+dy*dy;
    if (len2 < 1e-12) continue;
    const tt = Math.max(0, Math.min(1, ((svgX-l.sx1)*dx+(svgY-l.sy1)*dy)/len2));
    const px = l.sx1+tt*dx, py = l.sy1+tt*dy;
    const d = Math.hypot(svgX-px, svgY-py);
    if (d < T && d < bestD) { bestD = d; best = { pt: [l.sta1+tt*(l.sta2-l.sta1), l.lat1+tt*(l.lat2-l.lat1)], type: "edge" }; }
  }
  return best;
}

// ── Main component ─────────────────────────────────────────────────────────────

type Meas = { p1: [number, number]; p2: [number, number] };

export function AbwicklungWindow() {
  const [state, setState]   = useState<AbwicklungSyncState | null>(null);
  const chRef               = useRef<BroadcastChannel | null>(null);
  const svgRef              = useRef<SVGSVGElement>(null);
  const containerRef        = useRef<HTMLDivElement>(null);
  const svgRectRef          = useRef<DOMRect | null>(null);
  const [size, setSize]     = useState({ w: 1200, h: 520 });

  // ── Independent X/Y zoom ─────────────────────────────────────────────────
  const [viewSta, setViewSta] = useState<[number, number] | null>(null);
  const [viewLat, setViewLat] = useState<[number, number] | null>(null);

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
    const sendClose = () => { try { ch.postMessage({ t: "close" } satisfies AbwicklungMsg); } catch { /**/ } };
    window.addEventListener("beforeunload", sendClose);
    return () => { window.removeEventListener("beforeunload", sendClose); ch.close(); chRef.current = null; };
  }, []);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => { document.documentElement.classList.toggle("dark", state?.theme !== "light"); }, [state?.theme]);

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

  const lines           = state?.lines           ?? [];
  const objectLabels    = state?.objectLabels     ?? [];
  const elevationOrigin = state?.elevationOrigin  ?? 0;

  // ── Domain ────────────────────────────────────────────────────────────────
  const domain = useMemo(() => ({
    sMin: state?.staStart ?? 0,
    sMax: state?.staEnd   ?? 1000,
    tMin: -(state?.leftOffset  ?? 10),
    tMax:   state?.rightOffset ?? 10,
  }), [state?.staStart, state?.staEnd, state?.leftOffset, state?.rightOffset]);

  useEffect(() => { setViewSta(null); setViewLat(null); }, [state?.alignmentId, state?.staStart, state?.staEnd]);

  const vMin  = viewSta ? viewSta[0] : domain.sMin;
  const vMax  = viewSta ? viewSta[1] : domain.sMax;
  const vtMin = viewLat ? viewLat[0] : domain.tMin;
  const vtMax = viewLat ? viewLat[1] : domain.tMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top  - M.bottom);

  const vRange  = vMax  - vMin  || 1;
  const vtRange = vtMax - vtMin || 1;

  const xs = useCallback((sta: number) => M.left + (sta  - vMin)  / vRange  * chartW, [vMin,  vRange,  chartW]);
  const ys = useCallback((lat: number) => M.top  + chartH * (1 - (lat - vtMin) / vtRange), [vtMin, vtRange, chartH]);

  // ── vpRef for stable callbacks ────────────────────────────────────────────
  const vpRef = useRef({ vMin, vMax, vtMin, vtMax, vRange, vtRange, chartW, chartH });
  vpRef.current = { vMin, vMax, vtMin, vtMax, vRange, vtRange, chartW, chartH };

  const viewStaRef  = useRef<[number, number] | null>(null);
  const viewLatRef  = useRef<[number, number] | null>(null);
  const domainRef   = useRef(domain);
  useEffect(() => { viewStaRef.current = viewSta; }, [viewSta]);
  useEffect(() => { viewLatRef.current = viewLat; }, [viewLat]);
  useEffect(() => { domainRef.current  = domain;  }, [domain]);

  // ── Axis locks ────────────────────────────────────────────────────────────
  const [lockX, setLockX] = useState(false);
  const [lockY, setLockY] = useState(false);
  const lockXRef = useRef(false), lockYRef = useRef(false);
  useEffect(() => { lockXRef.current = lockX; }, [lockX]);
  useEffect(() => { lockYRef.current = lockY; }, [lockY]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lx = lockXRef.current, ly = lockYRef.current;
      if (lx && ly) return;
      const rect = svg.getBoundingClientRect();
      const f = e.deltaY > 0 ? 1.25 : 1 / 1.25;
      if (!lx) {
        const cur = viewStaRef.current ?? [domainRef.current.sMin, domainRef.current.sMax] as [number, number];
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - M.left) / (rect.width - M.left - M.right)));
        const pivot = cur[0] + frac * (cur[1] - cur[0]);
        setViewSta([pivot - (pivot - cur[0]) * f, pivot + (cur[1] - pivot) * f]);
      }
      if (!ly) {
        const cur = viewLatRef.current ?? [domainRef.current.tMin, domainRef.current.tMax] as [number, number];
        const frac = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top - M.top) / (rect.height - M.top - M.bottom)));
        const pivot = cur[0] + frac * (cur[1] - cur[0]);
        setViewLat([pivot - (pivot - cur[0]) * f, pivot + (cur[1] - pivot) * f]);
      }
      svgRectRef.current = null;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pan ───────────────────────────────────────────────────────────────────
  const dragRef = useRef<{ mx: number; my: number; sMin: number; sMax: number; tMin: number; tMax: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // ── Rubber-band zoom ──────────────────────────────────────────────────────
  const [zoomBoxMode, setZoomBoxMode]   = useState(false);
  const [zoomBoxRect, setZoomBoxRect]   = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const zoomBoxStartRef = useRef<{ svgX: number; svgY: number } | null>(null);
  const zoomBoxModeRef  = useRef(false);
  useEffect(() => { zoomBoxModeRef.current = zoomBoxMode; }, [zoomBoxMode]);

  // ── Measurement tool ─────────────────────────────────────────────────────
  const [measActive, setMeasActive]     = useState(false);
  const [measurements, setMeasurements] = useState<Meas[]>([]);
  const [pending, setPending]           = useState<[number, number] | null>(null);
  const [mouseWorld, setMouseWorld]     = useState<[number, number] | null>(null);

  // ── Snap ──────────────────────────────────────────────────────────────────
  const [snapActive, setSnapActive]     = useState(false);
  const [snapDisplay, setSnapDisplay]   = useState<SnapInfo | null>(null);
  const snapRef       = useRef<SnapInfo | null>(null);
  const snapActiveRef = useRef(false);
  useEffect(() => { snapActiveRef.current = snapActive; }, [snapActive]);

  // ── Object labels ─────────────────────────────────────────────────────────
  const [objLabelsVisible, setObjLabelsVisible] = useState(false);
  const [objLabelProp, setObjLabelProp]         = useState("name");
  const [labelStyle, setLabelStyle]             = useState<"leader" | "direct">("leader");

  const availablePropKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const lbl of objectLabels) for (const k of Object.keys(lbl.props)) keys.add(k);
    return ["name", "type", ...Array.from(keys).sort()];
  }, [objectLabels]);

  const objLabelPositions = useMemo(() => {
    if (!objLabelsVisible || objectLabels.length === 0) return [];
    return buildLabelPositions(objectLabels, lines, objLabelProp, vMin, vtMin, vRange, vtRange, chartW, chartH, labelStyle);
  }, [objLabelsVisible, objectLabels, lines, objLabelProp, vMin, vtMin, vRange, vtRange, chartW, chartH, labelStyle]);

  // ── Color mode ────────────────────────────────────────────────────────────
  const [colorMode, setColorMode] = useState<"ifc" | "elevation">("ifc");

  const [elevMin, elevMax] = useMemo(() => {
    if (lines.length === 0) return [0, 100];
    let lo = Infinity, hi = -Infinity;
    for (const l of lines) { const abs = l.elevMid + elevationOrigin; if (abs < lo) lo = abs; if (abs > hi) hi = abs; }
    return [lo, hi];
  }, [lines, elevationOrigin]);

  // ── Offset inputs ─────────────────────────────────────────────────────────
  const [offsetInput, setOffsetInput] = useState({ left: "10", right: "10" });
  useEffect(() => {
    setOffsetInput({ left: (state?.leftOffset ?? 10).toFixed(0), right: (state?.rightOffset ?? 10).toFixed(0) });
  }, [state?.leftOffset, state?.rightOffset]);

  const applyOffsets = () => {
    const l = parseFloat(offsetInput.left), r = parseFloat(offsetInput.right);
    if (isFinite(l) && isFinite(r) && l >= 0 && r >= 0)
      chRef.current?.postMessage({ t: "setOffsets", left: l, right: r } satisfies AbwicklungMsg);
  };

  // ── Station range inputs ──────────────────────────────────────────────────
  const [rangeInput, setRangeInput] = useState({ start: "", end: "" });
  useEffect(() => {
    setRangeInput({ start: (state?.staStart ?? 0).toFixed(0), end: (state?.staEnd ?? 0).toFixed(0) });
  }, [state?.staStart, state?.staEnd]);

  const applyRange = () => {
    const s = parseFloat(rangeInput.start), e = parseFloat(rangeInput.end);
    if (isFinite(s) && isFinite(e) && s < e)
      chRef.current?.postMessage({ t: "setRange", staStart: s, staEnd: e } satisfies AbwicklungMsg);
  };

  // ── SVG paths batched by color ─────────────────────────────────────────────
  const svgPaths = useMemo(() => {
    if (colorMode === "elevation") {
      return lines.flatMap(l => {
        if (Math.max(l.s1, l.s2) < vMin || Math.min(l.s1, l.s2) > vMax) return [];
        if (Math.max(l.t1, l.t2) < vtMin || Math.min(l.t1, l.t2) > vtMax) return [];
        return [{ color: elevColor(l.elevMid + elevationOrigin, elevMin, elevMax),
          d: `M${xs(l.s1).toFixed(1)},${ys(l.t1).toFixed(1)}L${xs(l.s2).toFixed(1)},${ys(l.t2).toFixed(1)}`,
          single: true }];
      });
    }
    const byColor = new Map<string, string>();
    for (const l of lines) {
      if (Math.max(l.s1, l.s2) < vMin) continue;
      if (Math.min(l.s1, l.s2) > vMax) continue;
      if (Math.max(l.t1, l.t2) < vtMin) continue;
      if (Math.min(l.t1, l.t2) > vtMax) continue;
      const seg = `M${xs(l.s1).toFixed(1)},${ys(l.t1).toFixed(1)}L${xs(l.s2).toFixed(1)},${ys(l.t2).toFixed(1)}`;
      byColor.set(l.color, (byColor.get(l.color) ?? "") + seg);
    }
    return [...byColor.entries()].map(([color, d]) => ({ color, d, single: false }));
  }, [lines, xs, ys, colorMode, elevMin, elevMax, elevationOrigin, vMin, vMax, vtMin, vtMax]);

  // ── Screen-coordinate segments for snap — culled to visible viewport ──────
  const screenSegs = useMemo(() => {
    const result = [];
    for (const l of lines) {
      if (Math.max(l.s1, l.s2) < vMin) continue;
      if (Math.min(l.s1, l.s2) > vMax) continue;
      if (Math.max(l.t1, l.t2) < vtMin) continue;
      if (Math.min(l.t1, l.t2) > vtMax) continue;
      result.push({ sx1: xs(l.s1), sy1: ys(l.t1), sx2: xs(l.s2), sy2: ys(l.t2),
        sta1: l.s1, lat1: l.t1, sta2: l.s2, lat2: l.t2 });
    }
    return result;
  }, [lines, xs, ys, vMin, vMax, vtMin, vtMax]);
  const screenSegsRef = useRef(screenSegs);
  screenSegsRef.current = screenSegs;

  // ── Ticks ─────────────────────────────────────────────────────────────────
  const xTicks = useMemo(() => computeTicks(vMin, vMax, Math.max(4, Math.floor(chartW / 110))), [vMin, vMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vtMin, vtMax, Math.max(3, Math.floor(chartH / 40))), [vtMin, vtMax, chartH]);

  // ── rAF throttle ─────────────────────────────────────────────────────────
  const rafIdRef      = useRef<number | null>(null);
  const pendingPosRef = useRef<{ svgX: number; svgY: number } | null>(null);

  // ── SVG Export ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const style = getComputedStyle(document.documentElement);
    const resolve = (v: string) => { const m = v.match(/var\(([^)]+)\)/); if (!m) return v; return style.getPropertyValue(m[1].trim()).trim() || "#888"; };
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(size.w));
    clone.setAttribute("height", String(size.h));
    clone.querySelectorAll<SVGElement>("*").forEach(el => {
      for (const a of ["stroke", "fill", "color"]) { const v = el.getAttribute(a); if (v?.includes("var(")) el.setAttribute(a, resolve(v)); }
    });
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", String(size.w)); bg.setAttribute("height", String(size.h));
    bg.setAttribute("fill", state?.theme === "light" ? "#ffffff" : "#1a1b26");
    clone.insertBefore(bg, clone.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = `abwicklung_${state?.alignmentName || "export"}.svg`; a.click();
    URL.revokeObjectURL(url);
  }, [size, state?.theme, state?.alignmentName]);

  // ── World helpers ─────────────────────────────────────────────────────────
  const svgToWorld = (svgX: number, svgY: number, vp: typeof vpRef.current): [number, number] => [
    vp.vMin  + (svgX - M.left) / vp.chartW * vp.vRange,
    vp.vtMin + (1 - (svgY - M.top) / vp.chartH) * vp.vtRange,
  ];

  const activeToolRef = useRef({ measActive });
  activeToolRef.current = { measActive };

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();

    if (zoomBoxModeRef.current) {
      const rect = svgRectRef.current;
      zoomBoxStartRef.current = { svgX: e.clientX - rect.left, svgY: e.clientY - rect.top };
      return;
    }

    if (activeToolRef.current.measActive) return;
    dragRef.current = { mx: e.clientX, my: e.clientY, sMin: vMin, sMax: vMax, tMin: vtMin, tMax: vtMax };
    setPanning(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
    const rect = svgRectRef.current;
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    // Rubber-band rect update
    if (zoomBoxModeRef.current && zoomBoxStartRef.current) {
      const s = zoomBoxStartRef.current;
      setZoomBoxRect({ x: Math.min(s.svgX, svgX), y: Math.min(s.svgY, svgY), w: Math.abs(svgX - s.svgX), h: Math.abs(svgY - s.svgY) });
      return;
    }

    if (dragRef.current) {
      const dxPx = e.clientX - dragRef.current.mx, dyPx = e.clientY - dragRef.current.my;
      const vp = vpRef.current;
      svgRectRef.current = null;
      if (!lockXRef.current) { const dSta = -(dxPx / vp.chartW) * (dragRef.current.sMax - dragRef.current.sMin); setViewSta([dragRef.current.sMin + dSta, dragRef.current.sMax + dSta]); }
      if (!lockYRef.current) { const dLat =  (dyPx / vp.chartH) * (dragRef.current.tMax - dragRef.current.tMin); setViewLat([dragRef.current.tMin + dLat, dragRef.current.tMax + dLat]); }
      return;
    }

    pendingPosRef.current = { svgX, svgY };
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const p = pendingPosRef.current;
        if (!p) return;
        const raw = svgToWorld(p.svgX, p.svgY, vpRef.current);
        setMouseWorld(raw);
        if (snapActiveRef.current) {
          const s = computeSnapScreen(p.svgX, p.svgY, screenSegsRef.current);
          const prev = snapRef.current;
          if (s?.pt[0] !== prev?.pt[0] || s?.pt[1] !== prev?.pt[1] || s?.type !== prev?.type) { snapRef.current = s; setSnapDisplay(s); }
        } else if (snapRef.current) { snapRef.current = null; setSnapDisplay(null); }
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;

    // Commit rubber-band zoom
    if (zoomBoxModeRef.current && zoomBoxStartRef.current) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const endSvgX = e.clientX - svgRectRef.current.left;
      const endSvgY = e.clientY - svgRectRef.current.top;
      const { svgX: startSvgX, svgY: startSvgY } = zoomBoxStartRef.current;
      const vp = vpRef.current;
      if (Math.abs(endSvgX - startSvgX) > 5 && Math.abs(endSvgY - startSvgY) > 5) {
        const staMin = vp.vMin + (Math.min(startSvgX, endSvgX) - M.left) / vp.chartW * vp.vRange;
        const staMax = vp.vMin + (Math.max(startSvgX, endSvgX) - M.left) / vp.chartW * vp.vRange;
        const latMax = vp.vtMin + (1 - (Math.min(startSvgY, endSvgY) - M.top) / vp.chartH) * vp.vtRange;
        const latMin = vp.vtMin + (1 - (Math.max(startSvgY, endSvgY) - M.top) / vp.chartH) * vp.vtRange;
        if (staMax - staMin > 0.5 && latMax - latMin > 0.1) {
          setViewSta([staMin, staMax]);
          setViewLat([latMin, latMax]);
        }
      }
      zoomBoxStartRef.current = null;
      setZoomBoxRect(null);
      return;
    }

    if (!dragRef.current) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const raw = svgToWorld(e.clientX - svgRectRef.current.left, e.clientY - svgRectRef.current.top, vpRef.current);
      const w: [number, number] = snapActiveRef.current && snapRef.current ? snapRef.current.pt : raw;
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
    snapRef.current = null;
    setSnapDisplay(null);
    zoomBoxStartRef.current = null;
    setZoomBoxRect(null);
  };

  const isZoomed = viewSta !== null || viewLat !== null;
  const effW = snapActive && snapDisplay ? snapDisplay.pt : mouseWorld;

  const cursorStyle = zoomBoxMode ? "crosshair" : measActive ? "crosshair" : panning ? "grabbing" : "grab";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden select-none">

      {/* ── Identity bar ─────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3.5 border-b border-border/60"
        style={{ height: "36px", fontSize: "14px", background: "var(--toolbar-bg)", borderTop: "3px solid #10b981", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" className="shrink-0 rounded-[3px]">
          <rect width="32" height="32" rx="5" fill="#E8312A"/>
          <text x="16" y="23" fontFamily="Arial" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle">iC</text>
        </svg>
        <span className="font-bold text-[11px] tracking-tight">Abwicklung</span>
        {state?.alignmentName && <span className="text-[10px] text-muted-foreground">— {state.alignmentName}</span>}
        {state?.staStart != null && state?.staEnd != null && (
          <span className="text-[10px] font-mono text-emerald-400">{fmtSta(state.staStart)} – {fmtSta(state.staEnd)}</span>
        )}
        <div className="flex-1" />
        {state?.computing && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        {effW != null && (
          <span className={cn("text-[10px] font-mono", snapActive && snapDisplay ? "text-amber-400" : "text-muted-foreground")}>
            Sta:&nbsp;{fmtSta(effW[0])}&nbsp;&nbsp;
            Lat:&nbsp;{effW[1] >= 0 ? "+" : ""}{effW[1].toFixed(2)}&nbsp;m
            {snapActive && snapDisplay && <span className="ml-1 text-[9px] opacity-70">{snapDisplay.type === "vertex" ? "●" : "—"}</span>}
          </span>
        )}
        <div className={`w-1.5 h-1.5 rounded-full ${state != null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
      </div>

      {/* ── Ribbon ───────────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-stretch border-b border-border overflow-x-auto"
        style={{ height: "60px", fontSize: "14px", background: "var(--toolbar-bg)" }}
      >
        <AbwGroup label="Station">
          <span className="text-[9px] text-muted-foreground">Von</span>
          <input value={rangeInput.start} onChange={e => setRangeInput(r => ({ ...r, start: e.target.value }))}
            onBlur={applyRange} onKeyDown={e => { if (e.key === "Enter") applyRange(); }}
            className="w-16 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground" placeholder="0" />
          <span className="text-[9px] text-muted-foreground">Bis</span>
          <input value={rangeInput.end} onChange={e => setRangeInput(r => ({ ...r, end: e.target.value }))}
            onBlur={applyRange} onKeyDown={e => { if (e.key === "Enter") applyRange(); }}
            className="w-16 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground" placeholder="1000" />
        </AbwGroup>

        <AbwGroup label="Korridor (m)">
          <span className="text-[9px] text-muted-foreground">Li</span>
          <input value={offsetInput.left} onChange={e => setOffsetInput(o => ({ ...o, left: e.target.value }))}
            onBlur={applyOffsets} onKeyDown={e => { if (e.key === "Enter") applyOffsets(); }}
            className="w-12 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground" placeholder="10" />
          <span className="text-[9px] text-muted-foreground">Re</span>
          <input value={offsetInput.right} onChange={e => setOffsetInput(o => ({ ...o, right: e.target.value }))}
            onBlur={applyOffsets} onKeyDown={e => { if (e.key === "Enter") applyOffsets(); }}
            className="w-12 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground" placeholder="10" />
        </AbwGroup>

        <AbwGroup label="Farbe">
          <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
            <button onClick={() => setColorMode("ifc")}
              className={cn("px-2 py-0.5 transition-colors", colorMode === "ifc" ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground")}>IFC</button>
            <button onClick={() => setColorMode("elevation")}
              className={cn("px-2 py-0.5 transition-colors", colorMode === "elevation" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground")}>Höhe</button>
          </div>
        </AbwGroup>

        <AbwGroup label="Werkzeuge">
          <AbwBtn icon={Ruler} label="Messen" active={measActive}
            onClick={() => { setMeasActive(a => !a); setPending(null); }}
            color="bg-amber-500 text-white" />
          {measurements.length > 0 && (
            <button onClick={() => { setMeasurements([]); setPending(null); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-red-400 transition-colors">
              <Trash2 size={12} />
            </button>
          )}
          <AbwBtn icon={Magnet} label="Fang" active={snapActive}
            onClick={() => setSnapActive(a => !a)} color="bg-sky-600 text-white" />
        </AbwGroup>

        <AbwGroup label="Beschriftung">
          <AbwBtn icon={Tag} active={objLabelsVisible}
            onClick={() => setObjLabelsVisible(a => !a)} color="bg-emerald-600 text-white" />
          {objLabelsVisible && availablePropKeys.length > 0 && (
            <select value={objLabelProp} onChange={e => setObjLabelProp(e.target.value)}
              className="text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-foreground max-w-[120px]">
              {availablePropKeys.map(k => <option key={k} value={k}>{k === "name" ? "Name" : k === "type" ? "Typ" : k}</option>)}
            </select>
          )}
          {objLabelsVisible && (
            <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
              <button onClick={() => setLabelStyle("leader")}
                className={cn("px-1.5 py-0.5 transition-colors", labelStyle === "leader" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground")}>Linie</button>
              <button onClick={() => setLabelStyle("direct")}
                className={cn("px-1.5 py-0.5 transition-colors", labelStyle === "direct" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground")}>Direkt</button>
            </div>
          )}
        </AbwGroup>

        <AbwGroup label="Ansicht">
          <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
            <button onClick={() => setLockX(a => !a)}
              className={cn("px-2 py-0.5 transition-colors", lockX ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground")}
              title={lockX ? "Station fixiert" : "Station fixieren"}>Sta</button>
            <button onClick={() => setLockY(a => !a)}
              className={cn("px-2 py-0.5 transition-colors", lockY ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground")}
              title={lockY ? "Quer fixiert" : "Quer fixieren"}>Quer</button>
          </div>
          <AbwBtn icon={ZoomIn} label="Box" active={zoomBoxMode}
            onClick={() => { setZoomBoxMode(a => !a); setZoomBoxRect(null); zoomBoxStartRef.current = null; }}
            title="Rechteck-Zoom" color="bg-sky-600 text-white" />
          {isZoomed && (
            <button onClick={() => { setViewSta(null); setViewLat(null); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground"
              title="Zoom zurücksetzen">
              <ZoomIn size={11} /><span>Reset</span>
            </button>
          )}
        </AbwGroup>

        <AbwGroup label="Export">
          <button onClick={handleExport}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground transition-colors">
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
            style={{ cursor: cursorStyle, display: "block" }}
          >
            <defs>
              <clipPath id="abw-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>
            </defs>

            {/* Grid */}
            {yTicks.map(t => <line key={t} x1={M.left} y1={ys(t)} x2={M.left + chartW} y2={ys(t)} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />)}
            {xTicks.map(s => <line key={s} x1={xs(s)} y1={M.top} x2={xs(s)} y2={M.top + chartH} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />)}

            <g clipPath="url(#abw-clip)">

              {/* IFC edge lines */}
              {svgPaths.map((p, i) => <path key={p.single ? i : p.color} d={p.d} stroke={p.color} strokeWidth={1.2} fill="none" />)}

              {/* Alignment centerline */}
              {vtMin < 0 && vtMax > 0 && (
                <line x1={M.left} y1={ys(0)} x2={M.left + chartW} y2={ys(0)} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="8,4" opacity={0.7} />
              )}

              {/* Corridor boundaries */}
              {state?.leftOffset != null && vtMin < -state.leftOffset && vtMax > -state.leftOffset && (
                <line x1={M.left} y1={ys(-state.leftOffset)} x2={M.left + chartW} y2={ys(-state.leftOffset)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,4" opacity={0.5} />
              )}
              {state?.rightOffset != null && vtMin < state.rightOffset && vtMax > state.rightOffset && (
                <line x1={M.left} y1={ys(state.rightOffset)} x2={M.left + chartW} y2={ys(state.rightOffset)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,4" opacity={0.5} />
              )}

              {/* Object labels */}
              {objLabelPositions.map(lbl => {
                if (labelStyle === "direct") {
                  return (
                    <g key={lbl.key}>
                      <rect x={lbl.lx} y={lbl.ly} width={lbl.bw} height={lbl.bh} rx={3}
                        fill="var(--color-popover)" stroke={lbl.color} strokeWidth={1} opacity={0.92} />
                      <text x={lbl.lx + lbl.bw / 2} y={lbl.ly + lbl.bh - 4} textAnchor="middle" fontSize={9}
                        fill={lbl.color} fontFamily="sans-serif" fontWeight="600">{lbl.text}</text>
                    </g>
                  );
                }
                const clampedCx = Math.max(M.left, Math.min(M.left + chartW, lbl.cx));
                const clampedCy = Math.max(M.top,  Math.min(M.top + chartH,  lbl.cy));
                const boxCx = lbl.lx + lbl.bw / 2, boxCy = lbl.ly + lbl.bh / 2;
                const edgeX = boxCx + (clampedCx < boxCx ? -lbl.bw / 2 : lbl.bw / 2);
                return (
                  <g key={lbl.key}>
                    <line x1={clampedCx} y1={clampedCy} x2={edgeX} y2={boxCy} stroke={lbl.color} strokeWidth={0.8} strokeDasharray="3,2" opacity={0.65} />
                    <circle cx={clampedCx} cy={clampedCy} r={2.5} fill={lbl.color} opacity={0.8} />
                    <rect x={lbl.lx} y={lbl.ly} width={lbl.bw} height={lbl.bh} rx={3}
                      fill="var(--color-popover)" stroke={lbl.color} strokeWidth={1} opacity={0.95} />
                    <text x={lbl.lx + lbl.bw / 2} y={lbl.ly + lbl.bh - 4} textAnchor="middle" fontSize={9}
                      fill={lbl.color} fontFamily="sans-serif" fontWeight="600">{lbl.text}</text>
                  </g>
                );
              })}

              {/* Measurements */}
              {measurements.map((meas, i) => {
                const dist = Math.hypot(meas.p2[0]-meas.p1[0], meas.p2[1]-meas.p1[1]);
                const mx = (xs(meas.p1[0]) + xs(meas.p2[0])) / 2, my = (ys(meas.p1[1]) + ys(meas.p2[1])) / 2;
                return (
                  <g key={i}>
                    <line x1={xs(meas.p1[0])} y1={ys(meas.p1[1])} x2={xs(meas.p2[0])} y2={ys(meas.p2[1])} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4,2" />
                    <circle cx={xs(meas.p1[0])} cy={ys(meas.p1[1])} r={3.5} fill="#fbbf24" />
                    <circle cx={xs(meas.p2[0])} cy={ys(meas.p2[1])} r={3.5} fill="#fbbf24" />
                    <rect x={mx - 32} y={my - 9} width={64} height={15} rx={3} fill="var(--color-popover)" stroke="var(--color-border)" strokeWidth={1} opacity={0.95} />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize={10} fill="#fbbf24" fontFamily="monospace" fontWeight="bold">{dist.toFixed(3)} m</text>
                  </g>
                );
              })}

              {/* Pending measurement */}
              {pending != null && (
                <>
                  <circle cx={xs(pending[0])} cy={ys(pending[1])} r={4} fill="#fbbf24" />
                  {effW != null && (() => {
                    const dist = Math.hypot(effW[0]-pending[0], effW[1]-pending[1]);
                    return (
                      <>
                        <line x1={xs(pending[0])} y1={ys(pending[1])} x2={xs(effW[0])} y2={ys(effW[1])} stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
                        <text x={(xs(pending[0])+xs(effW[0]))/2} y={(ys(pending[1])+ys(effW[1]))/2 - 5} textAnchor="middle" fontSize={10} fill="#fbbf24" fontFamily="monospace">{dist.toFixed(3)} m</text>
                      </>
                    );
                  })()}
                </>
              )}
            </g>

            {/* Snap indicator */}
            {snapActive && snapDisplay && (() => {
              const sx = xs(snapDisplay.pt[0]), sy = ys(snapDisplay.pt[1]);
              return snapDisplay.type === "vertex" ? (
                <g>
                  <rect x={sx-5} y={sy-5} width={10} height={10} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.9} transform={`rotate(45,${sx},${sy})`} />
                  <circle cx={sx} cy={sy} r={1.5} fill="#f59e0b" opacity={0.9} />
                </g>
              ) : (
                <g>
                  <circle cx={sx} cy={sy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.9} />
                  <circle cx={sx} cy={sy} r={1.5} fill="#f59e0b" opacity={0.9} />
                </g>
              );
            })()}

            {/* Rubber-band zoom rect */}
            {zoomBoxRect && zoomBoxRect.w > 2 && zoomBoxRect.h > 2 && (
              <rect x={zoomBoxRect.x} y={zoomBoxRect.y} width={zoomBoxRect.w} height={zoomBoxRect.h}
                fill="#3b82f6" fillOpacity={0.08} stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5,3"
                style={{ pointerEvents: "none" }} />
            )}

            {/* ── X axis (station) ── */}
            <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH} stroke="var(--color-border)" strokeWidth={1} />
            {xTicks.map(sta => (
              <g key={sta}>
                <line x1={xs(sta)} y1={M.top + chartH} x2={xs(sta)} y2={M.top + chartH + 5} stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={xs(sta)} y={M.top + chartH + 15} textAnchor="middle" fontSize={9} fill="var(--color-muted-foreground)" fontFamily="monospace">{fmtSta(sta)}</text>
              </g>
            ))}
            <text x={M.left + chartW} y={M.top + chartH + 30} textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)">Station [m]</text>

            {/* ── Y axis (lateral) ── */}
            <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH} stroke="var(--color-border)" strokeWidth={1} />
            {yTicks.map(t => (
              <g key={t}>
                <line x1={M.left-5} y1={ys(t)} x2={M.left} y2={ys(t)} stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={M.left-8} y={ys(t)+3} textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {t >= 0 ? "+" : ""}{t.toFixed(0)}
                </text>
              </g>
            ))}
            <text x={M.left+4} y={M.top+8} textAnchor="start" fontSize={9} fill="var(--color-muted-foreground)">↑ Quer [m] +re</text>

            {/* Legend */}
            <g>
              <line x1={M.left+chartW-100} y1={M.top+8} x2={M.left+chartW-80} y2={M.top+8} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="8,4" opacity={0.7} />
              <text x={M.left+chartW-76} y={M.top+11} fontSize={8} fill="var(--color-muted-foreground)" fontFamily="monospace">Achse</text>
              <line x1={M.left+chartW-45} y1={M.top+8} x2={M.left+chartW-25} y2={M.top+8} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,4" opacity={0.6} />
              <text x={M.left+chartW-21} y={M.top+11} fontSize={8} fill="var(--color-muted-foreground)" fontFamily="monospace">Korridor</text>
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
                {state == null ? "Verbindung zum Hauptfenster wird hergestellt…" : "Bereich im Profilviewer auswählen und Abwicklung öffnen"}
              </div>
            </div>
          )}
        </div>

        {/* ── Measurements sidebar ─────────────────────────────────────────── */}
        {measurements.length > 0 && (
          <div className="w-52 shrink-0 border-l border-border overflow-y-auto p-2 flex flex-col gap-1.5 bg-card/20">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Messungen</span>
              <button onClick={() => { setMeasurements([]); setPending(null); }} className="text-muted-foreground hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
            </div>
            {measurements.map((meas, i) => {
              const dSta = meas.p2[0]-meas.p1[0], dLat = meas.p2[1]-meas.p1[1];
              return (
                <div key={i} className="bg-muted/40 rounded px-2 py-1.5 text-[10px] border border-border/50">
                  <div className="font-mono font-semibold text-amber-400 mb-0.5">{Math.hypot(dSta, dLat).toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">ΔSta {dSta >= 0 ? "+" : ""}{dSta.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">ΔQuer {dLat >= 0 ? "+" : ""}{dLat.toFixed(3)} m</div>
                  <button onClick={() => setMeasurements(ms => ms.filter((_,j) => j !== i))} className="text-muted-foreground hover:text-red-400 mt-1 text-[9px] transition-colors">löschen</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
