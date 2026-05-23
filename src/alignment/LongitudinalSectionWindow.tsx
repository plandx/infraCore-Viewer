import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { Ruler, Trash2, ZoomIn, Loader2, Tag, Download, Eye, Layers } from "lucide-react";
import { cn } from "../lib/utils";
import { LS_CHANNEL } from "../utils/windowSync";
import type { LSMsg, LSSyncState, XSSyncObjectLabel, LSDepthLineSync } from "../utils/windowSync";

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

const M = { top: 12, right: 20, bottom: 44, left: 72 };

type Meas     = { p1: [number, number]; p2: [number, number] };
type SnapInfo = { pt: [number, number]; type: "vertex" | "edge" };

// ── Ribbon helpers ────────────────────────────────────────────────────────────

type LsIconComp = (props: { size: number }) => ReactNode;

function XsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col shrink-0 border-r border-border">
      <div className="flex items-center gap-1 px-2 flex-1 min-w-0">{children}</div>
      <div className="text-[9px] text-muted-foreground/60 font-medium tracking-wide text-center px-2 pb-0.5 shrink-0">{label}</div>
    </div>
  );
}

function XsToolBtn({ icon: Icon, label, onClick, active, title, color = "bg-sky-600 text-white" }: {
  icon: LsIconComp; label?: string; onClick: () => void;
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

// ── Snap (screen-pixel based) ────────────────────────────────────────────────

function computeSnapScreen(
  svgX: number, svgY: number,
  segs: Array<{ sx1: number; sy1: number; sx2: number; sy2: number; sta1: number; elev1: number; sta2: number; elev2: number }>,
): SnapInfo | null {
  const T = 12;
  let best: SnapInfo | null = null;
  let bestD = Infinity;

  for (const l of segs) {
    for (const [px, py, ws, we] of [
      [l.sx1, l.sy1, l.sta1, l.elev1],
      [l.sx2, l.sy2, l.sta2, l.elev2],
    ] as [number, number, number, number][]) {
      const d = Math.hypot(svgX - px, svgY - py);
      if (d < T && d < bestD) { bestD = d; best = { pt: [ws, we], type: "vertex" }; }
    }
  }
  if (best) return best;

  for (const l of segs) {
    const dx = l.sx2 - l.sx1, dy = l.sy2 - l.sy1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const t  = Math.max(0, Math.min(1, ((svgX - l.sx1) * dx + (svgY - l.sy1) * dy) / len2));
    const px = l.sx1 + t * dx, py = l.sy1 + t * dy;
    const d  = Math.hypot(svgX - px, svgY - py);
    if (d < T && d < bestD) {
      bestD = d;
      best = { pt: [l.sta1 + t * (l.sta2 - l.sta1), l.elev1 + t * (l.elev2 - l.elev1)], type: "edge" };
    }
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
  lines: Array<{ sta1: number; elev1: number; sta2: number; elev2: number; color: string; objectKey?: string }>,
  propKey: string,
  vMin: number, vEMin: number, vRange: number, vERange: number,
  chartW: number, chartH: number,
  mode: "leader" | "direct",
  elevationOrigin: number,
): ObjLabelPos[] {
  const _xs = (sta: number) => M.left + (sta - vMin) / vRange * chartW;
  const _ys = (elev: number) => M.top  + chartH * (1 - (elev - vEMin) / vERange);

  const groups = new Map<string, { sMin: number; sMax: number; eMin: number; eMax: number; color: string }>();
  for (const l of lines) {
    if (!l.objectKey) continue;
    const absE1 = l.elev1 + elevationOrigin;
    const absE2 = l.elev2 + elevationOrigin;
    const g = groups.get(l.objectKey);
    if (g) {
      g.sMin = Math.min(g.sMin, l.sta1, l.sta2);
      g.sMax = Math.max(g.sMax, l.sta1, l.sta2);
      g.eMin = Math.min(g.eMin, absE1, absE2);
      g.eMax = Math.max(g.eMax, absE1, absE2);
    } else {
      groups.set(l.objectKey, {
        sMin: Math.min(l.sta1, l.sta2), sMax: Math.max(l.sta1, l.sta2),
        eMin: Math.min(absE1, absE2), eMax: Math.max(absE1, absE2),
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
    const cx = _xs((g.sMin + g.sMax) / 2);
    const cy = _ys((g.eMin + g.eMax) / 2);
    const bw = Math.max(40, text.length * 6.5 + 12);
    const initLy = mode === "direct" ? cy - BH / 2 : _ys(g.eMax) - BH - 8;
    positions.push({ key: lbl.key, text, color: g.color, cx, cy, lx: cx - bw / 2, ly: initLy, bw, bh: BH });
  }

  deOverlapLabels(positions);
  return positions;
}

export function LongitudinalSectionWindow() {
  const [state, setState]   = useState<LSSyncState | null>(null);
  const chRef               = useRef<BroadcastChannel | null>(null);
  const svgRef              = useRef<SVGSVGElement>(null);
  const containerRef        = useRef<HTMLDivElement>(null);
  const svgRectRef          = useRef<DOMRect | null>(null);
  const [size, setSize]     = useState({ w: 1200, h: 540 });

  // ── Independent X/Y zoom state ───────────────────────────────────────────
  const [viewSta, setViewSta]   = useState<[number, number] | null>(null);
  const [viewElev, setViewElev] = useState<[number, number] | null>(null);

  // ── BroadcastChannel ─────────────────────────────────────────────────────
  useEffect(() => {
    document.title = "Längenschnitt — infraCore";
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(LS_CHANNEL); } catch { return; }
    chRef.current = ch;
    ch.onmessage = (ev: MessageEvent<LSMsg>) => {
      if (ev.data.t === "state") setState(ev.data.s);
    };
    ch.postMessage({ t: "req" } satisfies LSMsg);

    const sendClose = () => { try { ch.postMessage({ t: "close" } satisfies LSMsg); } catch { /* ignore */ } };
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

  const lines      = state?.lines      ?? [];
  const profile    = state?.profile    ?? [];
  const elevationOrigin = state?.elevationOrigin ?? 0;

  // ── Domain ────────────────────────────────────────────────────────────────
  const domain = useMemo(() => {
    const staStart = state?.staStart ?? 0;
    const staEnd   = state?.staEnd   ?? 1000;
    let eMin = Infinity, eMax = -Infinity;
    for (const l of lines) {
      const e1 = l.elev1 + elevationOrigin, e2 = l.elev2 + elevationOrigin;
      eMin = Math.min(eMin, e1, e2); eMax = Math.max(eMax, e1, e2);
    }
    for (const p of profile) {
      const e = p.elev + elevationOrigin;
      eMin = Math.min(eMin, e); eMax = Math.max(eMax, e);
    }
    if (!isFinite(eMin)) { eMin = 0; eMax = 100; }
    const ep = Math.max(2, (eMax - eMin) * 0.15);
    return { sMin: staStart, sMax: staEnd, eMin: eMin - ep, eMax: eMax + ep };
  }, [lines, profile, elevationOrigin, state?.staStart, state?.staEnd]);

  // Reset when alignment or data changes
  useEffect(() => { setViewSta(null); setViewElev(null); }, [state?.alignmentId, state?.staStart, state?.staEnd]);
  useEffect(() => { setViewElev(null); }, [domain.eMin, domain.eMax]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vertical exaggeration (Überhöhung) ───────────────────────────────────
  const [vExag, setVExag] = useState(1);
  const [vExagInput, setVExagInput] = useState("1");

  const applyVExag = (raw: string) => {
    const v = parseFloat(raw);
    if (isFinite(v) && v >= 0.1 && v <= 500) setVExag(v);
  };

  const vMin  = viewSta  ? viewSta[0]  : domain.sMin;
  const vMax  = viewSta  ? viewSta[1]  : domain.sMax;

  const chartW = Math.max(1, size.w - M.left - M.right);
  const chartH = Math.max(1, size.h - M.top - M.bottom);

  // Raw elevation range — default to 1:1 physical scale (1 m in X = 1 m in Y on screen)
  const elevRange1to1  = (domain.sMax - domain.sMin) * chartH / chartW;
  const elevCenter1to1 = (domain.eMin + domain.eMax) / 2;
  const rawVEMin = viewElev ? viewElev[0] : elevCenter1to1 - elevRange1to1 / 2;
  const rawVEMax = viewElev ? viewElev[1] : elevCenter1to1 + elevRange1to1 / 2;

  // Exaggerated elevation range: same center, compressed by vExag
  const rawVECenter = (rawVEMin + rawVEMax) / 2;
  const rawVEHalf   = (rawVEMax - rawVEMin) / 2;
  const vEMin = rawVECenter - rawVEHalf / vExag;
  const vEMax = rawVECenter + rawVEHalf / vExag;

  const vRange  = vMax  - vMin  || 1;
  const vERange = vEMax - vEMin || 1;

  const xs = useCallback((sta: number)  => M.left + (sta  - vMin)  / vRange  * chartW,  [vMin,  vRange,  chartW]);
  const ys = useCallback((elev: number) => M.top  + chartH * (1 - (elev - vEMin) / vERange), [vEMin, vERange, chartH]);

  // ── vpRef for stable callbacks ────────────────────────────────────────────
  const vpRef = useRef({ vMin, vMax, vEMin, vEMax, vRange, vERange, chartW, chartH, rawVEMin, rawVEMax });
  vpRef.current = { vMin, vMax, vEMin, vEMax, vRange, vERange, chartW, chartH, rawVEMin, rawVEMax };

  // ── Stable refs for wheel/pan handler (avoid stale closures) ─────────────
  const viewStaRef  = useRef<[number, number] | null>(null);
  const viewElevRef = useRef<[number, number] | null>(null);
  const domainRef   = useRef(domain);
  useEffect(() => { viewStaRef.current  = viewSta;  }, [viewSta]);
  useEffect(() => { viewElevRef.current = viewElev; }, [viewElev]);
  useEffect(() => { domainRef.current   = domain;   }, [domain]);

  // ── Axis lock (fixiert die jeweilige Achse beim Zoomen/Pannen) ────────────
  const [lockX, setLockX] = useState(false);
  const [lockY, setLockY] = useState(false);
  const lockXRef = useRef(false);
  const lockYRef = useRef(false);
  useEffect(() => { lockXRef.current = lockX; }, [lockX]);
  useEffect(() => { lockYRef.current = lockY; }, [lockY]);

  // ── vExag ref for zoom-box handler ───────────────────────────────────────
  const vExagRef = useRef(vExag);
  useEffect(() => { vExagRef.current = vExag; }, [vExag]);

  // ── Zoom-box (rubber-band rect zoom) ────────────────────────────────────
  const [zoomBoxMode, setZoomBoxMode]   = useState(false);
  const [zoomBoxRect, setZoomBoxRect]   = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const zoomBoxStartRef = useRef<{ svgX: number; svgY: number } | null>(null);
  const zoomBoxModeRef  = useRef(false);
  useEffect(() => { zoomBoxModeRef.current = zoomBoxMode; }, [zoomBoxMode]);

  // ── Wheel zoom — beide Achsen gleichzeitig, Pivot am Mauszeiger ──────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lx = lockXRef.current, ly = lockYRef.current;
      if (lx && ly) return;

      const rect = svg.getBoundingClientRect();
      const cw   = rect.width  - M.left - M.right;
      const ch   = rect.height - M.top  - M.bottom;
      const f    = e.deltaY > 0 ? 1.25 : 1 / 1.25;

      // Station axis (X)
      if (!lx) {
        const cur = viewStaRef.current ?? [domainRef.current.sMin, domainRef.current.sMax] as [number, number];
        const frac  = Math.max(0, Math.min(1, (e.clientX - rect.left - M.left) / cw));
        const pivot = cur[0] + frac * (cur[1] - cur[0]);
        setViewSta([pivot - (pivot - cur[0]) * f, pivot + (cur[1] - pivot) * f]);
      }

      // Elevation axis (Y) — fall back to the actual rendered range (rawVEMin/rawVEMax),
      // not domain.eMin/eMax, so the first zoom event uses the correct 1:1 baseline
      if (!ly) {
        const vp = vpRef.current;
        const cur = viewElevRef.current ?? [vp.rawVEMin, vp.rawVEMax] as [number, number];
        const frac  = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top - M.top) / ch));
        const pivot = cur[0] + frac * (cur[1] - cur[0]);
        setViewElev([pivot - (pivot - cur[0]) * f, pivot + (cur[1] - pivot) * f]);
      }

      svgRectRef.current = null;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pan ───────────────────────────────────────────────────────────────────
  const dragRef = useRef<{ mx: number; my: number; sMin: number; sMax: number; eMin: number; eMax: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // ── Measurement tool ─────────────────────────────────────────────────────
  const [measActive, setMeasActive] = useState(false);
  const [measurements, setMeasurements] = useState<Meas[]>([]);
  const [pending, setPending] = useState<[number, number] | null>(null);
  const [mouseWorld, setMouseWorld] = useState<[number, number] | null>(null);

  // ── Snap ──────────────────────────────────────────────────────────────────
  const [snapActive, setSnapActive]     = useState(false);
  const [snapDisplay, setSnapDisplay]   = useState<SnapInfo | null>(null);
  const snapRef                         = useRef<SnapInfo | null>(null);
  const snapActiveRef                   = useRef(false);
  useEffect(() => { snapActiveRef.current = snapActive; }, [snapActive]);

  // ── rAF throttle ─────────────────────────────────────────────────────────
  const rafIdRef      = useRef<number | null>(null);
  const pendingPosRef = useRef<{ svgX: number; svgY: number } | null>(null);
  const linesRef      = useRef(lines);
  linesRef.current    = lines;

  // ── Depth view ────────────────────────────────────────────────────────────
  const depthLines: LSDepthLineSync[] = state?.depthLines ?? [];
  const depthViewActive  = state?.depthView    ?? false;
  const depthDistVal     = state?.depthDistance ?? 3;
  const [showCutLines,    setShowCutLines]    = useState(true);
  const [showViewLines,   setShowViewLines]   = useState(false);
  const [showHiddenLines, setShowHiddenLines] = useState(false);
  const [depthDistInput, setDepthDistInput] = useState("3");
  useEffect(() => { setDepthDistInput(String(depthDistVal)); }, [depthDistVal]);

  const sendDepthView = (enabled: boolean, distance?: number) => {
    chRef.current?.postMessage({ t: "setDepthView", enabled, distance } satisfies LSMsg);
  };

  // ── Object labels ─────────────────────────────────────────────────────────
  const [objLabelsVisible, setObjLabelsVisible] = useState(false);
  const [objLabelProp, setObjLabelProp]         = useState("name");
  const [labelStyle, setLabelStyle]             = useState<"leader" | "direct">("leader");

  const objectLabels = state?.objectLabels ?? [];

  const availablePropKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const lbl of objectLabels) for (const k of Object.keys(lbl.props)) keys.add(k);
    return ["name", "type", ...Array.from(keys).sort()];
  }, [objectLabels]);

  const objLabelPositions = useMemo(() => {
    if (!objLabelsVisible || objectLabels.length === 0) return [];
    return buildLabelPositions(
      objectLabels, lines, objLabelProp,
      vMin, vEMin, vRange, vERange, chartW, chartH,
      labelStyle, elevationOrigin,
    );
  }, [objLabelsVisible, objectLabels, lines, objLabelProp, vMin, vEMin, vRange, vERange, chartW, chartH, labelStyle, elevationOrigin]);

  // ── ISO hatches ───────────────────────────────────────────────────────────
  const [hatchMode, setHatchMode]     = useState<"none" | "auto" | "custom">("none");
  const [customHatchMap, setCustomHatchMap] = useState<Record<string, HatchId>>({});

  const objectKeyToType = useMemo(() => {
    const m = new Map<string, string>();
    for (const lbl of objectLabels) m.set(lbl.key, lbl.type);
    return m;
  }, [objectLabels]);

  const resolveHatch = useCallback((objectKey: string | undefined): string => {
    if (hatchMode === "none" || !objectKey) return "url(#ls-hatch-concrete)";
    const type = objectKeyToType.get(objectKey) ?? "";
    if (hatchMode === "custom") {
      const h = customHatchMap[type] ?? DEFAULT_TYPE_HATCH[type] ?? "concrete";
      return h === "none" ? "none" : `url(#ls-hatch-${h})`;
    }
    const h = DEFAULT_TYPE_HATCH[type] ?? "concrete";
    return `url(#ls-hatch-${h})`;
  }, [hatchMode, objectKeyToType, customHatchMap]);

  // Build band polygons per objectKey for hatching
  const hatchPolygons = useMemo(() => {
    if (hatchMode === "none") return [];
    const groups = new Map<string, { sta: number; elev: number }[]>();
    for (const l of lines) {
      if (!l.objectKey) continue;
      let pts = groups.get(l.objectKey);
      if (!pts) { pts = []; groups.set(l.objectKey, pts); }
      pts.push({ sta: l.sta1, elev: l.elev1 + elevationOrigin });
      pts.push({ sta: l.sta2, elev: l.elev2 + elevationOrigin });
    }
    const result: Array<{ objectKey: string; d: string }> = [];
    for (const [key, pts] of groups) {
      if (pts.length < 2) continue;
      const sorted = [...pts].sort((a, b) => a.sta - b.sta);
      const staMins = sorted.map(p => p.sta);
      const uniqueStas = [...new Set(staMins)].sort((a, b) => a - b);
      const topElev = uniqueStas.map(s => {
        const atS = sorted.filter(p => p.sta === s);
        return { sta: s, elev: Math.max(...atS.map(p => p.elev)) };
      });
      const botElev = uniqueStas.map(s => {
        const atS = sorted.filter(p => p.sta === s);
        return { sta: s, elev: Math.min(...atS.map(p => p.elev)) };
      });
      if (topElev.length < 2) continue;
      const top = topElev.map((p, i) => `${i === 0 ? "M" : "L"}${xs(p.sta).toFixed(1)},${ys(p.elev).toFixed(1)}`).join("");
      const bot = [...botElev].reverse().map(p => `L${xs(p.sta).toFixed(1)},${ys(p.elev).toFixed(1)}`).join("");
      result.push({ objectKey: key, d: top + bot + "Z" });
    }
    return result;
  }, [hatchMode, lines, elevationOrigin, xs, ys]);

  const visibleTypes = useMemo(() => {
    if (hatchMode !== "custom") return [];
    const types = new Set<string>();
    for (const l of lines) {
      if (l.objectKey) {
        const t = objectKeyToType.get(l.objectKey);
        if (t) types.add(t);
      }
    }
    return Array.from(types).sort();
  }, [hatchMode, lines, objectKeyToType]);

  // ── SVG paths batched by color ─────────────────────────────────────────────
  const svgPaths = useMemo(() => {
    const byColor = new Map<string, string>();
    for (const l of lines) {
      const x1s = xs(l.sta1).toFixed(1);
      const y1s = ys(l.elev1 + elevationOrigin).toFixed(1);
      const x2s = xs(l.sta2).toFixed(1);
      const y2s = ys(l.elev2 + elevationOrigin).toFixed(1);
      byColor.set(l.color, (byColor.get(l.color) ?? "") + `M${x1s},${y1s}L${x2s},${y2s}`);
    }
    return [...byColor.entries()];
  }, [lines, xs, ys, elevationOrigin]);

  // Depth lines batched by color (visible and hidden separately)
  const svgDepthPaths = useMemo(() => {
    const visible = new Map<string, string>();
    const hidden  = new Map<string, string>();
    for (const l of depthLines) {
      const x1s = xs(l.sta1).toFixed(1);
      const y1s = ys(l.elev1 + elevationOrigin).toFixed(1);
      const x2s = xs(l.sta2).toFixed(1);
      const y2s = ys(l.elev2 + elevationOrigin).toFixed(1);
      const seg = `M${x1s},${y1s}L${x2s},${y2s}`;
      if (l.hidden) hidden.set(l.color,  (hidden.get(l.color)  ?? "") + seg);
      else          visible.set(l.color, (visible.get(l.color) ?? "") + seg);
    }
    return { visible: [...visible.entries()], hidden: [...hidden.entries()] };
  }, [depthLines, xs, ys, elevationOrigin]);

  // Screen-coordinate segments for snap
  const screenSegs = useMemo(() => lines.map(l => ({
    sx1: xs(l.sta1), sy1: ys(l.elev1 + elevationOrigin),
    sx2: xs(l.sta2), sy2: ys(l.elev2 + elevationOrigin),
    sta1: l.sta1, elev1: l.elev1 + elevationOrigin,
    sta2: l.sta2, elev2: l.elev2 + elevationOrigin,
  })), [lines, xs, ys, elevationOrigin]);

  const screenSegsRef = useRef(screenSegs);
  screenSegsRef.current = screenSegs;

  // Profile polyline path
  const profilePath = useMemo(() => {
    const pts = profile.filter(p => p.sta >= vMin && p.sta <= vMax);
    if (pts.length < 2) return "";
    return pts.map((p, i) =>
      `${i === 0 ? "M" : "L"}${xs(p.sta).toFixed(1)},${ys(p.elev + elevationOrigin).toFixed(1)}`
    ).join(" ");
  }, [profile, vMin, vMax, xs, ys, elevationOrigin]);

  // ── Ticks ─────────────────────────────────────────────────────────────────
  const xTicks = useMemo(() => computeTicks(vMin, vMax, Math.max(4, Math.floor(chartW / 110))), [vMin, vMax, chartW]);
  const yTicks = useMemo(() => computeTicks(vEMin, vEMax, Math.max(4, Math.floor(chartH / 40))), [vEMin, vEMax, chartH]);

  // ── Range inputs ──────────────────────────────────────────────────────────
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
      chRef.current?.postMessage({ t: "setRange", staStart: s, staEnd: e } satisfies LSMsg);
  };

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
    a.download = `laengenschnitt_${state?.alignmentName || "export"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [size, state?.theme, state?.alignmentName]);

  // ── svgToWorld ────────────────────────────────────────────────────────────
  const svgToWorld = (svgX: number, svgY: number, vp: typeof vpRef.current): [number, number] => [
    vp.vMin + (svgX - M.left) / vp.chartW * vp.vRange,
    vp.vEMin + (1 - (svgY - M.top) / vp.chartH) * vp.vERange,
  ];

  const activeToolRef = useRef({ measActive });
  activeToolRef.current = { measActive };

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (zoomBoxModeRef.current) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const rect = svgRectRef.current;
      zoomBoxStartRef.current = { svgX: e.clientX - rect.left, svgY: e.clientY - rect.top };
      return;
    }
    if (activeToolRef.current.measActive || e.button !== 0) return;
    // Store raw (pre-exaggeration) elevation range so pan works correctly with any vExag
    dragRef.current = { mx: e.clientX, my: e.clientY, sMin: vMin, sMax: vMax, eMin: rawVEMin, eMax: rawVEMax };
    setPanning(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
    const rect = svgRectRef.current;
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    if (zoomBoxModeRef.current && zoomBoxStartRef.current) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const svgX2 = e.clientX - svgRectRef.current.left;
      const svgY2 = e.clientY - svgRectRef.current.top;
      const s = zoomBoxStartRef.current;
      setZoomBoxRect({ x: Math.min(s.svgX, svgX2), y: Math.min(s.svgY, svgY2), w: Math.abs(svgX2 - s.svgX), h: Math.abs(svgY2 - s.svgY) });
      return;
    }

    if (dragRef.current) {
      const dxPx = e.clientX - dragRef.current.mx;
      const dyPx = e.clientY - dragRef.current.my;
      const vp   = vpRef.current;
      svgRectRef.current = null;
      if (!lockXRef.current) {
        const staRange = dragRef.current.sMax - dragRef.current.sMin;
        const dSta = -(dxPx / vp.chartW) * staRange;
        setViewSta([dragRef.current.sMin + dSta, dragRef.current.sMax + dSta]);
      }
      if (!lockYRef.current) {
        // Pixels map to the displayed (exaggerated) range; shift the raw range by the same amount
        const dElev = (dyPx / vp.chartH) * vp.vERange;
        setViewElev([dragRef.current.eMin + dElev, dragRef.current.eMax + dElev]);
      }
      return;
    }

    pendingPosRef.current = { svgX, svgY };
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const p = pendingPosRef.current;
        if (!p) return;
        const vp  = vpRef.current;
        const raw = svgToWorld(p.svgX, p.svgY, vp);
        setMouseWorld(raw);

        if (snapActiveRef.current) {
          const s = computeSnapScreen(p.svgX, p.svgY, screenSegsRef.current);
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
    if (zoomBoxModeRef.current && zoomBoxStartRef.current) {
      if (!svgRectRef.current) svgRectRef.current = e.currentTarget.getBoundingClientRect();
      const endSvgX = e.clientX - svgRectRef.current.left;
      const endSvgY = e.clientY - svgRectRef.current.top;
      const { svgX: startSvgX, svgY: startSvgY } = zoomBoxStartRef.current;
      const dx = Math.abs(endSvgX - startSvgX);
      const dy = Math.abs(endSvgY - startSvgY);
      if (dx >= 5 && dy >= 5) {
        const vp = vpRef.current;
        const staMin = vp.vMin + (Math.min(startSvgX, endSvgX) - M.left) / vp.chartW * vp.vRange;
        const staMax = vp.vMin + (Math.max(startSvgX, endSvgX) - M.left) / vp.chartW * vp.vRange;
        const elevMax = vp.vEMin + (1 - (Math.min(startSvgY, endSvgY) - M.top) / vp.chartH) * vp.vERange;
        const elevMin = vp.vEMin + (1 - (Math.max(startSvgY, endSvgY) - M.top) / vp.chartH) * vp.vERange;
        if (staMax - staMin > 0.5 && elevMax - elevMin > 0.1) {
          setViewSta([staMin, staMax]);
          const eMid = (elevMin + elevMax) / 2;
          const eHalf = (elevMax - elevMin) / 2;
          setViewElev([eMid - eHalf * vExagRef.current, eMid + eHalf * vExagRef.current]);
        }
      }
      zoomBoxStartRef.current = null;
      setZoomBoxRect(null);
      return;
    }
    if (e.button === 0 && !dragRef.current) {
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

  const isZoomed = viewSta !== null || viewElev !== null;
  const effW: [number, number] | null = snapActive && snapDisplay ? snapDisplay.pt : mouseWorld;

  const cursorStyle = measActive || zoomBoxMode ? "crosshair" : panning ? "grabbing" : "grab";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden select-none">

      {/* ── Row 1: Identity bar ───────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3.5 border-b border-border/60"
        style={{ height: '36px', fontSize: '14px', background: 'var(--toolbar-bg)', borderTop: '3px solid var(--color-primary)', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" className="shrink-0 rounded-[3px]">
          <rect width="32" height="32" rx="5" fill="#E8312A"/>
          <text x="16" y="23" fontFamily="Arial" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle">iC</text>
        </svg>
        <span className="font-bold text-[11px] tracking-tight">Längenschnitt</span>
        {state?.alignmentName && (
          <span className="text-[10px] text-muted-foreground">— {state.alignmentName}</span>
        )}
        {state?.staStart != null && state?.staEnd != null && (
          <span className="text-[10px] font-mono text-sky-400">{fmtSta(state.staStart)} – {fmtSta(state.staEnd)}</span>
        )}
        <div className="flex-1" />
        {state?.computing && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        {effW != null && (
          <span className={cn("text-[10px] font-mono",
            snapActive && snapDisplay ? "text-amber-400" : "text-muted-foreground")}>
            Sta:&nbsp;{fmtSta(effW[0])}&nbsp;&nbsp;
            H:&nbsp;{effW[1].toFixed(3)}&nbsp;m&nbsp;ü.NHN
            {snapActive && snapDisplay && (
              <span className="ml-1 text-[9px] opacity-70">
                {snapDisplay.type === "vertex" ? "●" : "—"}
              </span>
            )}
          </span>
        )}
        <div className={`w-1.5 h-1.5 rounded-full ${state != null ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
      </div>

      {/* ── Row 2: Ribbon ─────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-stretch border-b border-border overflow-x-auto"
        style={{ height: '60px', fontSize: '14px', background: 'var(--toolbar-bg)' }}
      >

        <XsGroup label="Station">
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
        </XsGroup>

        <XsGroup label="Überhöhung">
          {[1, 2, 5, 10, 20].map(v => (
            <button
              key={v}
              onClick={() => { setVExag(v); setVExagInput(String(v)); }}
              className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                vExag === v ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >{v}×</button>
          ))}
          <input
            type="number"
            min={0.1} max={500} step={1}
            value={vExagInput}
            onChange={e => setVExagInput(e.target.value)}
            onBlur={() => applyVExag(vExagInput)}
            onKeyDown={e => { if (e.key === "Enter") applyVExag(vExagInput); }}
            className="w-10 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
            title="Benutzerdefinierte Überhöhung"
            placeholder="1"
          />
        </XsGroup>

        <XsGroup label="Werkzeuge">
          <XsToolBtn icon={Ruler} label="Messen" active={measActive} onClick={() => { setMeasActive(a => !a); setPending(null); }} color="bg-amber-500 text-white" />
          {measurements.length > 0 && (
            <button onClick={() => { setMeasurements([]); setPending(null); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-red-400 transition-colors"
              title="Alle Messungen löschen">
              <Trash2 size={12} />
            </button>
          )}
          <XsToolBtn icon={Eye} label="Fang" active={snapActive} onClick={() => setSnapActive(a => !a)} color="bg-sky-600 text-white" />
        </XsGroup>

        <XsGroup label="Beschriftung">
          <XsToolBtn icon={Tag} active={objLabelsVisible} onClick={() => setObjLabelsVisible(a => !a)} color="bg-emerald-600 text-white" />
          {objLabelsVisible && availablePropKeys.length > 0 && (
            <select
              value={objLabelProp}
              onChange={e => setObjLabelProp(e.target.value)}
              className="text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-foreground max-w-[120px]"
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

        <XsGroup label="Linien">
          <XsToolBtn icon={Eye} label="Schnitt" active={showCutLines} onClick={() => setShowCutLines(v => !v)} color="bg-sky-600 text-white" />
          <XsToolBtn icon={Eye} label="Ansicht" active={showViewLines} onClick={() => {
            const next = !showViewLines;
            setShowViewLines(next);
            if (next && !depthViewActive) sendDepthView(true);
            else if (!next && !showHiddenLines && depthViewActive) sendDepthView(false);
          }} color="bg-emerald-600 text-white" />
          <XsToolBtn icon={Layers} label="Verdeckt" active={showHiddenLines} onClick={() => {
            const next = !showHiddenLines;
            setShowHiddenLines(next);
            if (next && !depthViewActive) sendDepthView(true);
            else if (!next && !showViewLines && depthViewActive) sendDepthView(false);
          }} color="bg-violet-600 text-white" />
          {depthViewActive && (
            <input
              type="number"
              min={0.1} max={50} step={0.5}
              value={depthDistInput}
              onChange={e => setDepthDistInput(e.target.value)}
              onBlur={() => {
                const v = parseFloat(depthDistInput);
                if (isFinite(v) && v > 0) sendDepthView(true, v);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const v = parseFloat(depthDistInput);
                  if (isFinite(v) && v > 0) sendDepthView(true, v);
                }
              }}
              className="w-12 text-center text-[10px] font-mono bg-background border border-border rounded px-1 py-0.5 text-foreground"
              title="Tiefendistanz in Metern"
            />
          )}
        </XsGroup>

        <XsGroup label="Schraffur">
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
        </XsGroup>

        <XsGroup label="Ansicht">
          <div className="flex bg-muted rounded overflow-hidden text-[10px] font-medium">
            <button
              onClick={() => setLockX(a => !a)}
              className={cn("px-2 py-0.5 transition-colors",
                lockX ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"
              )}
              title={lockX ? "Station fixiert — nur Höhe zoomen/pannen" : "Station fixieren"}
            >Sta</button>
            <button
              onClick={() => setLockY(a => !a)}
              className={cn("px-2 py-0.5 transition-colors",
                lockY ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"
              )}
              title={lockY ? "Höhe fixiert — nur Station zoomen/pannen" : "Höhe fixieren"}
            >Höhe</button>
          </div>
          <XsToolBtn icon={ZoomIn} label="Box" active={zoomBoxMode}
            onClick={() => { setZoomBoxMode(a => !a); setZoomBoxRect(null); zoomBoxStartRef.current = null; }}
            title="Rechteck-Zoom" color="bg-sky-600 text-white" />
          {isZoomed && (
            <button onClick={() => { setViewSta(null); setViewElev(null); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground"
              title="Zoom zurücksetzen">
              <ZoomIn size={11} />
            </button>
          )}
        </XsGroup>

        <XsGroup label="Export">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Als SVG exportieren"
          >
            <Download size={12} /><span>SVG</span>
          </button>
        </XsGroup>

      </div>

      {/* ── Custom hatch panel ─────────────────────────────────────────────── */}
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

      {/* ── Chart + optional sidebar ──────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        <div ref={containerRef} className="flex-1 min-w-0 min-h-0 relative">
          {/* SVG always mounted for wheel listener */}
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
              <clipPath id="ls-clip">
                <rect x={M.left} y={M.top} width={chartW} height={chartH} />
              </clipPath>

              {/* ISO hatch patterns */}
              <pattern id="ls-hatch-concrete" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="8">
                <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="0.9" opacity="0.45" />
              </pattern>
              <pattern id="ls-hatch-steel" patternUnits="userSpaceOnUse" x="0" y="0" width="6" height="6">
                <line x1="0" y1="6" x2="6" y2="0" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
                <line x1="0" y1="0" x2="6" y2="6" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
              </pattern>
              <pattern id="ls-hatch-wood" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="5">
                <line x1="0" y1="2.5" x2="8" y2="2.5" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
              </pattern>
              <pattern id="ls-hatch-insulation" patternUnits="userSpaceOnUse" x="0" y="0" width="12" height="8">
                <polyline points="0,4 3,1 6,4 9,7 12,4" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.4" />
              </pattern>
              <pattern id="ls-hatch-earth" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="8">
                <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
                <circle cx="2" cy="6" r="0.8" fill="currentColor" opacity="0.45" />
                <circle cx="6" cy="2" r="0.8" fill="currentColor" opacity="0.45" />
              </pattern>
              <pattern id="ls-hatch-sand" patternUnits="userSpaceOnUse" x="0" y="0" width="6" height="6">
                <circle cx="1.5" cy="1.5" r="0.7" fill="currentColor" opacity="0.4" />
                <circle cx="4.5" cy="4.5" r="0.7" fill="currentColor" opacity="0.4" />
                <circle cx="1.5" cy="4.5" r="0.4" fill="currentColor" opacity="0.3" />
              </pattern>
              <pattern id="ls-hatch-brick" patternUnits="userSpaceOnUse" x="0" y="0" width="12" height="8">
                <line x1="0" y1="4" x2="12" y2="4" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
                <line x1="6" y1="0" x2="6" y2="4"  stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
                <line x1="0" y1="4" x2="0" y2="8"  stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
                <line x1="12" y1="4" x2="12" y2="8" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
              </pattern>
            </defs>

            {/* Horizontal grid lines */}
            {yTicks.map(e => (
              <line key={e}
                x1={M.left} y1={ys(e)} x2={M.left + chartW} y2={ys(e)}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />
            ))}
            {/* Vertical grid lines */}
            {xTicks.map(s => (
              <line key={s}
                x1={xs(s)} y1={M.top} x2={xs(s)} y2={M.top + chartH}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2,5" />
            ))}

            <g clipPath="url(#ls-clip)">

              {/* Band hatch polygons */}
              {hatchPolygons.map((p, i) => {
                const hatchFill = resolveHatch(p.objectKey);
                return (
                  <g key={i} style={{ color: "#888" }}>
                    <path d={p.d} fill="#888" fillOpacity={0.08} stroke="none" />
                    {hatchFill !== "none" && (
                      <path d={p.d} fill={hatchFill} stroke="none" opacity={0.5} />
                    )}
                  </g>
                );
              })}

              {/* Verdeckte Linien (hidden edges, dashed thin) */}
              {showHiddenLines && svgDepthPaths.hidden.map(([color, d]) => (
                <path key={`dh-${color}`} d={d} stroke={color} strokeWidth={0.7} fill="none"
                  strokeDasharray="3,3" opacity={0.32} />
              ))}
              {/* Ansichtslinien (visible depth edges, solid thin) */}
              {showViewLines && svgDepthPaths.visible.map(([color, d]) => (
                <path key={`dv-${color}`} d={d} stroke={color} strokeWidth={0.9} fill="none" opacity={0.5} />
              ))}
              {/* Schnittlinien (direct section cut, thick solid) */}
              {showCutLines && svgPaths.map(([color, d]) => (
                <path key={color} d={d} stroke={color} strokeWidth={1.5} fill="none" />
              ))}

              {/* Designed profile grade line */}
              {profilePath && (
                <path d={profilePath} fill="none" stroke="#4ade80"
                  strokeWidth={1.5} strokeDasharray="6,3" opacity={0.85} />
              )}

              {/* Committed measurements */}
              {measurements.map((meas, i) => {
                const dSta  = meas.p2[0] - meas.p1[0];
                const dElev = meas.p2[1] - meas.p1[1];
                const dist  = Math.hypot(dSta, dElev);
                const mx    = (xs(meas.p1[0]) + xs(meas.p2[0])) / 2;
                const my    = (ys(meas.p1[1]) + ys(meas.p2[1])) / 2;
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
                  {effW != null && (() => {
                    const dSta  = effW[0] - pending[0];
                    const dElev = effW[1] - pending[1];
                    const dist  = Math.hypot(dSta, dElev);
                    const mx    = (xs(pending[0]) + xs(effW[0])) / 2;
                    const my    = (ys(pending[1]) + ys(effW[1])) / 2;
                    return (
                      <>
                        <line x1={xs(pending[0])} y1={ys(pending[1])} x2={xs(effW[0])} y2={ys(effW[1])}
                          stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
                        <text x={mx} y={my - 5} textAnchor="middle" fontSize={10}
                          fill="#fbbf24" fontFamily="monospace">{dist.toFixed(3)} m</text>
                      </>
                    );
                  })()}
                </>
              )}

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
            </g>

            {/* Snap indicator (outside clip so it's always visible) */}
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

            {/* Zoom-box rubber-band rectangle */}
            {zoomBoxRect && zoomBoxRect.w > 2 && zoomBoxRect.h > 2 && (
              <rect
                x={zoomBoxRect.x} y={zoomBoxRect.y}
                width={zoomBoxRect.w} height={zoomBoxRect.h}
                fill="#3b82f6" fillOpacity={0.08}
                stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5,3"
                style={{ pointerEvents: "none" }}
              />
            )}

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

            {/* ── Y axis (absolute elevation) ── */}
            <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH}
              stroke="var(--color-border)" strokeWidth={1} />
            {yTicks.map(e => (
              <g key={e}>
                <line x1={M.left - 5} y1={ys(e)} x2={M.left} y2={ys(e)}
                  stroke="var(--color-muted-foreground)" strokeWidth={1} />
                <text x={M.left - 8} y={ys(e) + 3}
                  textAnchor="end" fontSize={9}
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {e.toFixed(1)}
                </text>
              </g>
            ))}
            <text x={M.left + 4} y={M.top + 8}
              textAnchor="start" fontSize={9} fill="var(--color-muted-foreground)">
              {vExag === 1 ? "↑ m ü.NHN" : `↑ m ü.NHN (${vExag}×)`}
            </text>

            {/* Legend */}
            <g>
              <line x1={M.left + chartW - 80} y1={M.top + 8}
                    x2={M.left + chartW - 60} y2={M.top + 8}
                    stroke="#4ade80" strokeWidth={1.5} strokeDasharray="6,3" />
              <text x={M.left + chartW - 56} y={M.top + 11}
                fontSize={8} fill="var(--color-muted-foreground)" fontFamily="monospace">
                Gradiente
              </text>
            </g>
          </svg>

          {state?.computing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-card/90 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground shadow-lg">
                <Loader2 size={16} className="animate-spin" /> Berechne Längenschnitt…
              </div>
            </div>
          )}
          {state?.alignmentId == null && !state?.computing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-card/90 rounded-lg px-6 py-4 text-center text-sm text-muted-foreground shadow-lg">
                {state == null
                  ? "Verbindung zum Hauptfenster wird hergestellt…"
                  : "Bereich im Profilviewer auswählen (Taste P → LS-Modus) und Längenschnitt öffnen"}
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
              const dSta  = meas.p2[0] - meas.p1[0];
              const dElev = meas.p2[1] - meas.p1[1];
              const dist  = Math.hypot(dSta, dElev);
              return (
                <div key={i} className="bg-muted/40 rounded px-2 py-1.5 text-[10px] border border-border/50">
                  <div className="font-mono font-semibold text-amber-400 mb-0.5">{dist.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">ΔSta {dSta >= 0 ? "+" : ""}{dSta.toFixed(3)} m</div>
                  <div className="font-mono text-muted-foreground">ΔH {dElev >= 0 ? "+" : ""}{dElev.toFixed(3)} m</div>
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
