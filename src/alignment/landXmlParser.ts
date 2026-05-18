import type {
  AlignCoord,
  AlignmentSegment,
  LineSegment,
  CurveSegment,
  TransitionSegment,
  ProfileGeometry,
  ProfileVertex,
  ProfileCurve,
  ProfileTangent,
  StationEquation,
  SampledPoint,
  Alignment,
  ParsedLandXml,
} from "./types";

const EPS = 1e-9;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function dist2D(a: AlignCoord, b: AlignCoord): number { return Math.hypot(b.x - a.x, b.y - a.y); }
function wrapAngle(r: number): number {
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function kids(el: Element | null | undefined): Element[] {
  return Array.from(el?.children ?? []);
}
function byTag(el: Element | null | undefined, tag: string): Element[] {
  return kids(el).filter(c => c.localName === tag);
}
function firstTag(el: Element | null | undefined, tag: string): Element | null {
  return kids(el).find(c => c.localName === tag) ?? null;
}
function attrNum(el: Element | null | undefined, name: string): number | null {
  const raw = el?.getAttribute(name);
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function attrStr(el: Element | null | undefined, name: string): string {
  return (el?.getAttribute(name) ?? "").toLowerCase().trim();
}

// ── Angular unit handling ─────────────────────────────────────────────────────
// German civil-engineering LandXML files often use Gon (gradians) for angular
// attributes (dir, dirStart, dirEnd, delta). The LandXML <Units> element
// declares the unit. We detect it once per file and pass it through parsing.
type AngularUnit = "deg" | "gon" | "rad";

function detectAngularUnit(root: Element): AngularUnit {
  const unitsEl = firstTag(root, "Units") ??
    firstTag(firstTag(root, "Alignments"), "Units") ??
    firstTag(firstTag(root, "Project"), "Units");

  if (unitsEl) {
    // <Angle unit="..."> child of <Units>
    const angleUnit = firstTag(unitsEl, "Angle")?.getAttribute("unit");
    if (angleUnit) {
      const u = angleUnit.toLowerCase().trim();
      if (u.includes("grad") || u === "gon" || u === "g") return "gon";
      if (u.includes("rad") && !u.includes("grad")) return "rad";
    }

    // angularUnit attribute on <Metric> or <Imperial> (most common in German files)
    // e.g. <Metric angularUnit="grad" .../>
    const metricOrImperial =
      firstTag(unitsEl, "Metric") ??
      firstTag(unitsEl, "Imperial") ??
      unitsEl; // fallback: attribute directly on <Units>
    const au = (metricOrImperial.getAttribute("angularUnit") ?? "").toLowerCase().trim();
    if (au) {
      if (au === "grad" || au === "gon" || au === "gradians" || au === "g") return "gon";
      if (au === "radians" || au === "radian" || au === "rad") return "rad";
      if (au === "decimal" || au === "degrees" || au === "degree" || au === "deg") return "deg";
    }
  }

  // Heuristic: dir > 360 is impossible in degrees (full circle) but valid in gon (0–400).
  const sample = root.querySelector?.("[dir]");
  if (sample) {
    const v = Number(sample.getAttribute("dir"));
    if (Number.isFinite(v) && v > 360) return "gon";
  }

  // Spiral-theta verification: for a clothoid θ = (k₀+k₁)/2·L (radians).
  // Compare the file's theta attribute against the geometrically expected value
  // in each candidate unit to determine which unit was actually used.
  // This reliably handles files that omit the angularUnit attribute but use
  // radians (common in ProVI and other German civil-engineering tools).
  try {
    const spirals = (root.getElementsByTagNameNS?.("*", "Spiral")
      ?? root.querySelectorAll?.("Spiral")
      ?? []) as HTMLCollectionOf<Element> | Element[];
    for (let si = 0; si < Math.min((spirals as { length: number }).length, 6); si++) {
      const sp = (spirals as ArrayLike<Element>)[si];
      const theta  = Number(sp.getAttribute("theta")  ?? "");
      const length = Number(sp.getAttribute("length") ?? "");
      const rSRaw  = sp.getAttribute("radiusStart") ?? "";
      const rERaw  = sp.getAttribute("radiusEnd")   ?? "";
      if (!Number.isFinite(theta) || theta <= 0 || !Number.isFinite(length) || length < 0.1) continue;
      const isInf = (s: string) => s === "" || s.toUpperCase() === "INF" || Number(s) > 1e8;
      const k0 = isInf(rSRaw) ? 0 : 1 / Number(rSRaw);
      const k1 = isInf(rERaw) ? 0 : 1 / Number(rERaw);
      if (Math.abs(k0) + Math.abs(k1) < 1e-10) continue;
      const expRad = Math.abs(k0 + k1) / 2 * length;
      if (expRad < 1e-6) continue;
      if (Math.abs(theta               / expRad - 1) < 0.05) return "rad";
      if (Math.abs(theta * Math.PI/200 / expRad - 1) < 0.05) return "gon";
      if (Math.abs(theta * Math.PI/180 / expRad - 1) < 0.05) return "deg";
    }
  } catch { /* ignore DOM API differences */ }

  return "deg";
}

// Convert a direction (azimuth from North, clockwise) in the given unit
// to math radians (from East, counterclockwise).
function azmToRad(value: number, unit: AngularUnit): number {
  let deg: number;
  switch (unit) {
    case "gon": deg = value * 0.9;              break; // 1 gon = 0.9°
    case "rad": deg = value * (180 / Math.PI);  break;
    default:    deg = value;
  }
  return wrapAngle(Math.PI / 2 - deg * (Math.PI / 180));
}

// Convert an unsigned angle (e.g. arc delta) in the given unit to radians.
function absAngleToRad(value: number, unit: AngularUnit): number {
  const v = Math.abs(value);
  switch (unit) {
    case "gon": return v * (Math.PI / 200);   // 400 gon = 2π rad
    case "rad": return v;
    default:    return v * (Math.PI / 180);
  }
}

// ── Coordinate parsing ────────────────────────────────────────────────────────
// LandXML coordinate convention: "Northing Easting [Elevation]"
// We store: x = Easting, y = Northing, z = Elevation (or null)
function parseCoord(text: string | null | undefined): AlignCoord | null {
  if (!text) return null;
  const v = text.trim().split(/\s+/).map(Number);
  if (v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
  return { y: v[0], x: v[1], z: v.length >= 3 && Number.isFinite(v[2]) ? v[2] : null };
}
function coordNode(parent: Element | null | undefined, tag: string): AlignCoord | null {
  return parseCoord(firstTag(parent, tag)?.textContent);
}

// Geometric bearing from two 2-D points (math radians, CCW from East)
function bearing2(from: AlignCoord, to: AlignCoord): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── Curve geometry helpers ────────────────────────────────────────────────────
// Infer arc rotation direction from center/start/end.
// Cross product (center→start) × (center→end): negative → CW, positive → CCW.
// This is authoritative for the SHORT arc (< 180°), which is always assumed for roads.
function inferRot(center: AlignCoord, start: AlignCoord, end: AlignCoord): "cw" | "ccw" {
  const cross =
    (start.x - center.x) * (end.y - center.y) -
    (start.y - center.y) * (end.x - center.x);
  return cross < 0 ? "cw" : "ccw";
}

// Compute the SIGNED sweep angle from a0 to a1 going in the given direction.
// Returns a positive value (magnitude of the sweep).
function sweepAngle(a0: number, a1: number, rot: "cw" | "ccw"): number {
  let da = a1 - a0;
  if (rot === "ccw") {
    // CCW: angle increases
    while (da < 0)          da += 2 * Math.PI;
    while (da >= 2 * Math.PI) da -= 2 * Math.PI;
  } else {
    // CW: angle decreases (da should be negative → make positive)
    while (da > 0)          da -= 2 * Math.PI;
    da = -da;
    while (da >= 2 * Math.PI) da -= 2 * Math.PI;
  }
  return da; // always ≥ 0
}

// Infer arc center when not given in XML.
function inferCenter(
  start: AlignCoord, end: AlignCoord,
  radius: number, rot: "cw" | "ccw", prevTanRad: number
): AlignCoord | null {
  const chord = dist2D(start, end);
  if (chord > 2 * radius + EPS) return null;
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  const h  = Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2));
  const ca = Math.atan2(end.y - start.y, end.x - start.x);
  let nx = -Math.sin(ca), ny = Math.cos(ca); // left normal of chord

  if (Number.isFinite(prevTanRad)) {
    const tx = Math.cos(prevTanRad), ty = Math.sin(prevTanRad);
    const cx = mx + nx * h, cy = my + ny * h;
    const cross = tx * (cy - start.y) - ty * (cx - start.x);
    const wantLeft = rot === "ccw";
    if ((cross > 0) !== wantLeft) { nx = -nx; ny = -ny; }
  } else if (rot === "cw") { nx = -nx; ny = -ny; }

  return { x: mx + nx * h, y: my + ny * h, z: null };
}

// ── Station equations ─────────────────────────────────────────────────────────
function parseStaEquations(alignEl: Element): StationEquation[] {
  return byTag(alignEl, "StaEquation").flatMap(eq => {
    const ahead = attrNum(eq, "staAhead"), back = attrNum(eq, "staBack");
    const intl  = attrNum(eq, "staInternal") ?? back;
    if (ahead === null || back === null || intl === null) return [];
    return [{ staInternal: intl, staAhead: ahead, staBack: back, delta: ahead - back }];
  });
}

export function stationToDisplay(eqs: StationEquation[], sta: number): number {
  let s = sta;
  for (const eq of eqs) { if (sta >= eq.staInternal - EPS) s += eq.delta; }
  return s;
}
export function displayToStation(eqs: StationEquation[], disp: number): number {
  let d = 0;
  for (const eq of eqs) { if (disp >= eq.staInternal + d - EPS) d += eq.delta; }
  return disp - d;
}
// Backward-compat aliases
export const stationInternalToDisplay = stationToDisplay;
export const stationDisplayToInternal = displayToStation;

// ── Segment parsers ───────────────────────────────────────────────────────────
function parseLine(
  el: Element, staStart: number,
  prevEnd: AlignCoord | null, prevTan: number,
  unit: AngularUnit
): LineSegment | null {
  const start = coordNode(el, "Start") ?? prevEnd;
  const end   = coordNode(el, "End");
  if (!start || !end) return null;
  const length = attrNum(el, "length") ?? dist2D(start, end);
  if (length < EPS) return null;
  const dirAttr = attrNum(el, "dir");
  const tan = dirAttr !== null ? azmToRad(dirAttr, unit) : bearing2(start, end);
  void prevTan;
  return {
    type: "Line", staStart, staEnd: staStart + length, length,
    start, end, tangentStartRad: tan, tangentEndRad: bearing2(start, end),
    typeLabel: "Gerade",
  };
}

function parseCurve(
  el: Element, staStart: number,
  prevEnd: AlignCoord | null, prevTan: number,
  unit: AngularUnit
): CurveSegment | null {
  const start  = coordNode(el, "Start") ?? prevEnd;
  const end    = coordNode(el, "End");
  if (!start || !end) return null;

  const radius = attrNum(el, "radius");
  if (!radius || radius < EPS) return null;

  const rotAttr = el.getAttribute("rot");
  const rotFromAttr: "cw" | "ccw" = attrStr(el, "rot") === "cw" ? "cw" : "ccw";

  let center = coordNode(el, "Center");
  const hasCenter = center !== null;

  let rot: "cw" | "ccw";
  let geomDelta: number;
  let a0: number;

  if (hasCenter) {
    // === Center is explicit in XML ===
    // Validate center distance (sanity check for coordinate-order issues)
    const distToStart = dist2D(center!, start);
    const distToEnd   = dist2D(center!, end);
    const tolerance   = radius * 0.05 + 1.0; // 5% or 1 m tolerance
    if (Math.abs(distToStart - radius) > tolerance || Math.abs(distToEnd - radius) > tolerance) {
      // Center coordinates may be in wrong order (E,N vs N,E) — try swapping
      const swapped: AlignCoord = { x: center!.y, y: center!.x, z: center!.z };
      if (
        Math.abs(dist2D(swapped, start) - radius) < Math.abs(distToStart - radius) &&
        Math.abs(dist2D(swapped, end)   - radius) < Math.abs(distToEnd   - radius)
      ) {
        center = swapped;
      }
    }

    a0 = Math.atan2(start.y - center!.y, start.x - center!.x);
    const a1 = Math.atan2(end.y - center!.y, end.x - center!.x);

    // Determine rotation from GEOMETRY (most reliable when center is given).
    // The rot attribute acts as a tiebreaker for ambiguous cases (da ≈ π).
    const geomRot = inferRot(center!, start, end);
    rot = geomRot;

    // Compute actual sweep angle from center+start+end geometry.
    // This guarantees the arc renders from start to end in the correct direction.
    geomDelta = sweepAngle(a0, a1, rot);

    // If geomDelta is very close to 0 or 2π, there may be an issue.
    // Fall back to delta/length attributes if available.
    if (geomDelta < EPS || Math.abs(geomDelta - 2 * Math.PI) < 0.01) {
      const deltaAttr = attrNum(el, "delta");
      const lenAttr   = attrNum(el, "length");
      if (deltaAttr !== null) {
        geomDelta = absAngleToRad(deltaAttr, unit);
        // Use rot attribute to determine direction if delta is ambiguous
        rot = rotAttr ? rotFromAttr : rot;
      } else if (lenAttr !== null) {
        geomDelta = lenAttr / radius;
        rot = rotAttr ? rotFromAttr : rot;
      }
    }
  } else {
    // === Center not in XML: infer it ===
    rot = rotFromAttr;
    const deltaAttr = attrNum(el, "delta");
    const lenAttr   = attrNum(el, "length");
    if (deltaAttr !== null) {
      geomDelta = absAngleToRad(deltaAttr, unit);
    } else if (lenAttr !== null) {
      geomDelta = lenAttr / radius;
    } else {
      const chord = dist2D(start, end);
      geomDelta = 2 * Math.asin(clamp(chord / (2 * radius), -1, 1));
    }
    center = inferCenter(start, end, radius, rot, prevTan);
    if (!center) return null;
    a0 = Math.atan2(start.y - center.y, start.x - center.x);
  }

  const length = attrNum(el, "length") ?? radius * geomDelta;
  if (length < EPS || geomDelta < EPS) return null;

  const sign = rot === "cw" ? -1 : 1;
  const dirAttr = attrNum(el, "dir");
  // Tangent at start: prefer geometric computation (a0+sign*π/2) over dir attribute,
  // since dir can be chord direction in some exporters.
  const tangentStartRad = wrapAngle(a0 + sign * Math.PI / 2);
  const tangentEndRad   = wrapAngle(tangentStartRad + sign * geomDelta);

  // If a dir attribute is present and close to our computed tangent, use it
  // for prevTan propagation; if it's far off, ignore it (chord vs tangent issue).
  const effectiveTanStart =
    dirAttr !== null && Math.abs(wrapAngle(azmToRad(dirAttr, unit) - tangentStartRad)) < 0.2
      ? azmToRad(dirAttr, unit)
      : tangentStartRad;

  void effectiveTanStart;

  return {
    type: "Curve", staStart, staEnd: staStart + length, length,
    start, end, center: center!, radius, geomDelta, rot, a0,
    tangentStartRad, tangentEndRad,
    typeLabel: "Bogen",
  };
}

// Infer spiral rotation from geometry: is the end point to the left or right of
// the entry tangent direction at start? Returns "ccw" if left, "cw" if right.
function inferSpiralRot(start: AlignCoord, end: AlignCoord, tanRad: number): "cw" | "ccw" {
  const tx = Math.cos(tanRad), ty = Math.sin(tanRad);
  const ex = end.x - start.x, ey = end.y - start.y;
  // cross = tangent × (start→end): positive → end is LEFT = CCW
  const cross = tx * ey - ty * ex;
  return cross >= 0 ? "ccw" : "cw";
}

function parseSpiral(
  el: Element, staStart: number,
  prevEnd: AlignCoord | null, prevTan: number,
  unit: AngularUnit
): TransitionSegment | null {
  const start  = coordNode(el, "Start") ?? prevEnd;
  const end    = coordNode(el, "End");
  const length = attrNum(el, "length");
  if (!start || !end || !length || length < EPS) return null;

  const spiralType = el.getAttribute("spiralType") ?? el.getAttribute("spiType") ?? "clothoid";

  // Prefer explicit rot attribute; fall back to geometric inference.
  const rotAttrStr = attrStr(el, "rot");
  const dirStartRaw = attrNum(el, "dirStart") ?? attrNum(el, "dir");
  const entryTan = dirStartRaw !== null ? azmToRad(dirStartRaw, unit) : prevTan;
  const rot: "cw" | "ccw" = rotAttrStr === "cw" || rotAttrStr === "ccw"
    ? (rotAttrStr as "cw" | "ccw")
    : inferSpiralRot(start, end, entryTan);
  const sign = rot === "cw" ? -1 : 1;

  const isInfR = (r: number | null) => r === null || r < EPS || r > 1e8;
  const rSRaw = attrNum(el, "radiusStart") ?? attrNum(el, "radiusIn");
  const rERaw = attrNum(el, "radiusEnd")   ?? attrNum(el, "radiusOut");

  const k0 = isInfR(rSRaw) ? 0 : sign / rSRaw!;
  const k1 = isInfR(rERaw) ? 0 : sign / rERaw!;

  // Entry tangent already computed above (entryTan) for use in rot inference
  const tangentStartRad = entryTan;

  // Exit tangent: from explicit attribute, else computed from ∫κ ds
  const dirEndRaw = attrNum(el, "dirEnd");
  const tangentEndRad = dirEndRaw !== null
    ? azmToRad(dirEndRaw, unit)
    : wrapAngle(tangentStartRad + (k0 + k1) / 2 * length);

  return {
    type: "Transition", staStart, staEnd: staStart + length, length,
    start, end, spiralType, rot, k0, k1,
    tangentStartRad, tangentEndRad,
    typeLabel: "Spirale",
  };
}

// After all segments are parsed: fill in missing spiral curvatures (k0=k1=0)
// by reading the signed curvature from adjacent arc segments.
function fillSpiralCurvatures(segments: AlignmentSegment[]): void {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type !== "Transition") continue;
    if (Math.abs(seg.k0) > 1e-8 || Math.abs(seg.k1) > 1e-8) continue;

    const prev = i > 0 ? segments[i - 1] : null;
    const next = i < segments.length - 1 ? segments[i + 1] : null;

    let k0 = 0, k1 = 0;
    if (prev?.type === "Curve") k0 = (prev.rot === "cw" ? -1 : 1) / prev.radius;
    if (next?.type === "Curve") k1 = (next.rot === "cw" ? -1 : 1) / next.radius;
    if (Math.abs(k0) < 1e-8 && Math.abs(k1) < 1e-8) continue;

    const t = seg as unknown as Record<string, number>;
    t["k0"] = k0;
    t["k1"] = k1;
    if (Math.abs(seg.tangentEndRad - seg.tangentStartRad) < 1e-8) {
      t["tangentEndRad"] = wrapAngle(seg.tangentStartRad + (k0 + k1) / 2 * seg.length);
    }
  }
}

// ── Clothoid (Euler spiral) sampling ──────────────────────────────────────────
function fresnel(x: number): [number, number] {
  if (x === 0) return [0, 0];
  const s = x < 0 ? -1 : 1, a = Math.abs(x);
  const ph = Math.PI / 2, a2 = a * a, a4 = a2 * a2;
  let C = 0, S = 0, pa = a, pp = 1, fac = 1, sg = 1;
  for (let n = 0; n <= 30; n++) {
    if (n > 0) { pa *= a4; pp *= ph * ph; fac *= (2*n-1)*(2*n); sg = -sg; }
    const ct = sg * pp * pa / ((4*n+1) * fac);
    const st = sg * pp * ph * pa * a2 / ((4*n+3) * fac * (2*n+1));
    C += ct; S += st;
    if (Math.abs(ct) < 1e-17 && Math.abs(st) < 1e-17) break;
  }
  return [s * C, s * S];
}

function fresnelInt(th0: number, A: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];
  if (Math.abs(A) < 1e-12) return [Math.cos(th0) * s, Math.sin(th0) * s];
  const absA = Math.abs(A), scale = Math.sqrt(Math.PI / (2 * absA));
  const u = Math.abs(s) * Math.sqrt(2 * absA / Math.PI);
  const [Cu, Su] = fresnel(u);
  const ct = Math.cos(th0), st = Math.sin(th0);
  let dx: number, dy: number;
  if (A > 0) { dx = scale*(ct*Cu - st*Su); dy = scale*(st*Cu + ct*Su); }
  else        { dx = scale*(ct*Cu + st*Su); dy = scale*(st*Cu - ct*Su); }
  return [s < 0 ? -dx : dx, s < 0 ? -dy : dy];
}

function clothoidOffset(th0: number, k0: number, k1: number, L: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];
  const A = (k1 - k0) / (2 * L);
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(k0) < 1e-12) return [Math.cos(th0)*s, Math.sin(th0)*s];
    const da = k0 * s;
    return [(Math.sin(th0+da)-Math.sin(th0))/k0, (Math.cos(th0)-Math.cos(th0+da))/k0];
  }
  const tau = k0/(2*A), th1 = th0 - A*tau*tau;
  const [x1,y1] = fresnelInt(th1, A, s+tau);
  const [x0,y0] = fresnelInt(th1, A, tau);
  return [x1-x0, y1-y0];
}

// Bloss spiral: k(s) = k0 + (k1-k0)*(3u²-2u³) where u=s/L
// θ(s) = θ0 + k0*s + (k1-k0)*( s³/L² - s⁴/(2L³) )
// Position is computed via midpoint numerical integration.
function blossOffset(th0: number, k0: number, k1: number, L: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];
  const dk = k1 - k0;
  // Midpoint-rule accuracy is O(h²). For typical railway spirals (dk ≈ 1/R,
  // s ≤ L ≤ 500m) one step per 10 m gives sub-millimetre lateral error.
  const N = Math.max(4, Math.ceil(Math.abs(s) / 10));
  const h = s / N;
  let x = 0, y = 0;
  for (let i = 0; i < N; i++) {
    const sm = (i + 0.5) * h;
    const u = sm / L;
    const theta = th0 + k0 * sm + dk * (sm * sm * sm / (L * L) - sm * sm * sm * sm / (2 * L * L * L));
    x += Math.cos(theta) * h;
    y += Math.sin(theta) * h;
  }
  return [x, y];
}

// ── Segment sampling ──────────────────────────────────────────────────────────
function sampleSeg(seg: AlignmentSegment, t: number): SampledPoint {
  t = clamp(t, 0, 1);

  if (seg.type === "Line") {
    return {
      x: lerp(seg.start.x, seg.end.x, t),
      y: lerp(seg.start.y, seg.end.y, t),
      z: seg.start.z !== null && seg.end.z !== null ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: seg.tangentStartRad,
    };
  }

  if (seg.type === "Curve") {
    const sign  = seg.rot === "cw" ? -1 : 1;
    const angle = seg.a0 + sign * t * seg.geomDelta;
    return {
      x: seg.center.x + seg.radius * Math.cos(angle),
      y: seg.center.y + seg.radius * Math.sin(angle),
      z: seg.start.z !== null && seg.end.z !== null ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: wrapAngle(angle + sign * Math.PI / 2),
    };
  }

  if (seg.type === "Transition") {
    const s = t * seg.length;
    const [dx, dy] = seg.spiralType === "bloss"
      ? blossOffset(seg.tangentStartRad, seg.k0, seg.k1, seg.length, s)
      : clothoidOffset(seg.tangentStartRad, seg.k0, seg.k1, seg.length, s);
    const L = seg.length, theta = wrapAngle(
      seg.tangentStartRad + seg.k0*s + (seg.k1-seg.k0)/(2*L)*s*s
    );
    return {
      x: seg.start.x + dx, y: seg.start.y + dy,
      z: seg.start.z !== null && seg.end.z !== null ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: theta,
    };
  }

  const _: never = seg; void _; return { x: 0, y: 0, z: null, tangentRad: 0 };
}

// ── Profile parsing ───────────────────────────────────────────────────────────
function parseProfile(alignEl: Element): ProfileGeometry {
  const empty: ProfileGeometry = { profileName: "", vertices: [], curves: [], tangents: [] };

  const profAlignEl = firstTag(firstTag(alignEl, "Profile"), "ProfAlign");
  if (profAlignEl) {
    const profileName = profAlignEl.getAttribute("name") ??
      firstTag(alignEl, "Profile")?.getAttribute("name") ?? "";
    const vertices: ProfileVertex[] = [];
    for (const child of kids(profAlignEl)) {
      const tag = child.localName;
      if (tag === "PVI") {
        const parts = (child.textContent ?? "").trim().split(/\s+/).map(Number);
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          vertices.push({ type: "PVI", sta: parts[0], elev: parts[1],
            curveLength: Number.isFinite(parts[2]) ? parts[2] : 0 });
        }
      } else if (tag === "ParaCurve" || tag === "CircCurve") {
        let sta = attrNum(child, "sta"), elev = attrNum(child, "elev");
        const len = attrNum(child, "length") ?? attrNum(child, "len");
        // Fallback: ProVI-style inline text "station elev" (no sta/elev attributes)
        if ((sta === null || elev === null) && child.textContent) {
          const parts = child.textContent.trim().split(/\s+/).map(Number);
          if (parts.length >= 2) {
            if (sta === null && Number.isFinite(parts[0])) sta = parts[0];
            if (elev === null && Number.isFinite(parts[1])) elev = parts[1];
          }
        }
        if (sta !== null && elev !== null && len !== null) {
          vertices.push({ type: tag as "ParaCurve" | "CircCurve", sta, elev, curveLength: len,
            radius: attrNum(child, "radius") ?? undefined });
        }
      }
    }
    if (vertices.length < 2) return empty;
    return buildProfile(profileName, vertices);
  }

  const profSurfEl = firstTag(firstTag(alignEl, "Profile"), "ProfSurf") ??
    firstTag(firstTag(alignEl, "Profile"), "PntList2D");
  if (profSurfEl) {
    const pntEl = profSurfEl.localName === "PntList2D" ? profSurfEl : firstTag(profSurfEl, "PntList2D");
    if (!pntEl) return empty;
    const nums = (pntEl.textContent ?? "").trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return empty;
    const vertices: ProfileVertex[] = [];
    for (let i = 0; i+1 < nums.length; i += 2)
      vertices.push({ type: "PVI", sta: nums[i], elev: nums[i+1], curveLength: 0 });
    if (vertices.length < 2) return empty;
    return buildProfile(
      profSurfEl.getAttribute("name") ?? firstTag(alignEl, "Profile")?.getAttribute("name") ?? "Surface",
      vertices
    );
  }
  return empty;
}

function buildProfile(profileName: string, vertices: ProfileVertex[]): ProfileGeometry {
  const grades: number[] = [];
  for (let i = 0; i < vertices.length-1; i++) {
    const ds = vertices[i+1].sta - vertices[i].sta, de = vertices[i+1].elev - vertices[i].elev;
    grades.push(ds > EPS ? de/ds : 0);
  }
  const tangents: ProfileTangent[] = [];
  for (let i = 0; i < vertices.length-1; i++)
    tangents.push({ startSta: vertices[i].sta, endSta: vertices[i+1].sta, startElev: vertices[i].elev, grade: grades[i] });

  const curves: ProfileCurve[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.curveLength < EPS) continue;
    const g1 = i > 0 ? grades[i-1] : 0, g2 = i < grades.length ? grades[i] : 0;
    const halfL = v.curveLength/2, bvc = v.sta-halfL, evc = v.sta+halfL;
    const yBVC = v.elev - g1*halfL, A = g2 - g1;
    const isCirc = v.type === "CircCurve";
    const curve: ProfileCurve = { model: isCirc ? "circular" : "parabolic",
      bvc, evc, g1, g2, A, length: v.curveLength, yBVC };
    if (isCirc && v.radius !== undefined) {
      const ySign = A < 0 ? 1 : -1;
      curve.radius = v.radius; curve.centerSta = v.sta;
      curve.centerElev = v.elev + ySign*v.radius; curve.ySign = ySign;
    }
    curves.push(curve);
  }
  return { profileName, vertices, curves, tangents };
}

// ── Profile evaluation ────────────────────────────────────────────────────────
// station is in DISPLAY format (same as PVI sta values in LandXML)
export function evaluateProfile(profileGeom: ProfileGeometry, station: number): number | null {
  const { vertices, curves, tangents } = profileGeom;
  if (vertices.length < 2) return null;
  const first = vertices[0], last = vertices[vertices.length-1];

  if (station < first.sta - EPS) {
    if (!tangents.length) return null;
    const t = tangents[0]; return t.startElev + t.grade*(station - t.startSta);
  }
  if (station > last.sta + EPS) {
    if (!tangents.length) return null;
    const t = tangents[tangents.length-1]; return t.startElev + t.grade*(station - t.startSta);
  }
  for (const c of curves) {
    if (station < c.bvc-EPS || station > c.evc+EPS) continue;
    const x = station - c.bvc;
    if (c.model === "parabolic") return c.yBVC + c.g1*x + (c.A/(2*c.length))*x*x;
    if (c.radius !== undefined && c.centerSta !== undefined && c.centerElev !== undefined) {
      const d = station - c.centerSta, inner = c.radius*c.radius - d*d;
      if (inner >= 0) return c.centerElev + (c.ySign ?? 1)*Math.sqrt(inner);
    }
    return c.yBVC + c.g1*x + (c.A/(2*c.length))*x*x;
  }
  for (const t of tangents)
    if (station >= t.startSta-EPS && station <= t.endSta+EPS)
      return t.startElev + t.grade*(station - t.startSta);
  return null;
}

// ── Alignment sampling ────────────────────────────────────────────────────────
function findSeg(segments: AlignmentSegment[], sta: number): { seg: AlignmentSegment; t: number } | null {
  for (const seg of segments)
    if (sta >= seg.staStart-EPS && sta <= seg.staEnd+EPS)
      return { seg, t: clamp(seg.length > EPS ? (sta-seg.staStart)/seg.length : 0, 0, 1) };
  if (segments.length > 0) {
    if (sta < segments[0].staStart) return { seg: segments[0], t: 0 };
    const last = segments[segments.length-1];
    if (sta > last.staEnd) return { seg: last, t: 1 };
  }
  return null;
}

export function sampleAtDisplayStation(alignment: Alignment, displaySta: number): SampledPoint | null {
  if (!alignment.segments.length) return null;
  const found = findSeg(alignment.segments, displayToStation(alignment.stationEquations, displaySta));
  if (!found) return null;
  const pt = sampleSeg(found.seg, found.t);
  pt.station = displaySta;
  if (alignment.zSource === "profile" && alignment.profileGeom.vertices.length >= 2)
    pt.z = evaluateProfile(alignment.profileGeom, displaySta);
  return pt;
}

export function buildStationSeries(alignment: Alignment, basePts: number): number[] {
  const series: number[] = [];
  const totalLen = alignment.length;
  if (totalLen < EPS || basePts < 2) return series;

  for (let si = 0; si < alignment.segments.length; si++) {
    const seg = alignment.segments[si];
    const ds = stationToDisplay(alignment.stationEquations, seg.staStart);
    const de = stationToDisplay(alignment.stationEquations, seg.staEnd);
    const minPts = seg.type === "Transition" ? 24 : seg.type === "Curve" ? 12 : 2;
    const nPts = Math.max(minPts, Math.round(basePts * (de-ds) / totalLen));
    for (let i = 0; i < nPts; i++)
      series.push(lerp(ds, de, nPts > 1 ? i/(nPts-1) : 0));
    series.push(de);
  }
  series.push(alignment.staEnd);

  series.sort((a, b) => a-b);
  const out: number[] = [];
  for (const s of series)
    if (!out.length || s - out[out.length-1] > EPS) out.push(s);
  return out;
}

// ── Main parser ───────────────────────────────────────────────────────────────
function parseAlignment(
  alignEl: Element, fileName: string, id: number, unit: AngularUnit
): Alignment | null {
  const name = alignEl.getAttribute("name") ?? `Alignment_${id}`;
  const staStartAttr = attrNum(alignEl, "staStart");
  const staEndAttr   = attrNum(alignEl, "staEnd") ?? attrNum(alignEl, "length");
  const stationEquations = parseStaEquations(alignEl);
  const profileGeom = parseProfile(alignEl);

  const coordGeomEl = firstTag(alignEl, "CoordGeom");
  const segments: AlignmentSegment[] = [];
  let cursor: AlignCoord | null = null, prevTan = 0, runSta = staStartAttr ?? 0;

  if (coordGeomEl) {
    for (const child of kids(coordGeomEl)) {
      let seg: AlignmentSegment | null = null;
      if (child.localName === "Line")   seg = parseLine(child, runSta, cursor, prevTan, unit);
      else if (child.localName === "Curve")  seg = parseCurve(child, runSta, cursor, prevTan, unit);
      else if (child.localName === "Spiral") seg = parseSpiral(child, runSta, cursor, prevTan, unit);
      if (seg) { segments.push(seg); cursor = seg.end; prevTan = seg.tangentEndRad; runSta = seg.staEnd; }
    }

    if (!segments.length) {
      const pntEl = firstTag(coordGeomEl, "PntList3D") ?? firstTag(coordGeomEl, "IrregularLine");
      if (pntEl) {
        const nums = (pntEl.textContent ?? "").trim().split(/\s+/).map(Number).filter(Number.isFinite);
        const step = nums.length % 3 === 0 ? 3 : 2;
        for (let i = 0; i+step-1 < nums.length; i += step) {
          const pt: AlignCoord = step === 3
            ? { y: nums[i], x: nums[i+1], z: nums[i+2] }
            : { y: nums[i], x: nums[i+1], z: null };
          if (cursor) {
            const d = dist2D(cursor, pt);
            if (d > EPS) {
              const tan = bearing2(cursor, pt);
              segments.push({ type: "Line", staStart: runSta, staEnd: runSta+d, length: d,
                start: cursor, end: pt, tangentStartRad: tan, tangentEndRad: tan, typeLabel: "Gerade" });
              prevTan = tan; runSta += d;
            }
          }
          cursor = pt;
        }
      }
    }
  }

  if (!segments.length) return null;
  fillSpiralCurvatures(segments);

  const intStart = staStartAttr ?? segments[0].staStart;
  const intEnd   = staEndAttr !== null
    ? (staStartAttr !== null ? staStartAttr + staEndAttr : staEndAttr)
    : segments[segments.length-1].staEnd;

  const dispStart = stationToDisplay(stationEquations, intStart);
  const dispEnd   = stationToDisplay(stationEquations, intEnd);
  const hasZ = segments.some(s => s.start.z !== null || s.end.z !== null);
  const hasProf = profileGeom.vertices.length >= 2;
  const zSource: Alignment["zSource"] = hasProf ? "profile" : hasZ ? "coordgeom" : "none";

  return {
    id, fileName, name, displayName: name,
    staStart: dispStart, staEnd: dispEnd, length: dispEnd - dispStart,
    internalStaStart: intStart, internalStaEnd: intEnd,
    segments, profileGeom, stationEquations,
    hasZValues: hasZ || hasProf, zSource,
    zStatus: zSource === "profile"
      ? `Profil: ${profileGeom.profileName}`
      : zSource === "coordgeom" ? "Z aus CoordGeom" : "Kein Z",
  };
}

export function parseLandXmlText(xmlText: string, fileName: string, nextIdStart = 0): ParsedLandXml {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) return { alignments: [], nextId: nextIdStart };

  const root = doc.documentElement;
  const unit = detectAngularUnit(root);
  const container = firstTag(root, "Alignments") ?? root;
  const alignments: Alignment[] = [];
  let nextId = nextIdStart;
  for (const el of byTag(container, "Alignment")) {
    const a = parseAlignment(el, fileName, nextId, unit);
    if (a) { alignments.push(a); nextId++; }
  }
  return { alignments, nextId };
}

export function generateStationSeries(alignment: Alignment, interval: number): number[] {
  if (interval <= 0) return [];
  const series: number[] = [];
  const start = Math.ceil(alignment.staStart / interval) * interval;
  for (let s = start; s <= alignment.staEnd + EPS; s += interval) series.push(s);
  if (!series.length || Math.abs(series[series.length-1] - alignment.staEnd) > EPS)
    series.push(alignment.staEnd);
  return series;
}

export interface ApproxPoint {
  x: number;
  y: number;
  z: number;
  sta: number;
}

// Builds a polyline for display:
// - Lines: exact (2 pts)
// - Curves: exact circular arc at arcSpacingM intervals
// - Transitions: polygonalised spiral using geometry-derived entry tangent
//
// Entry tangents for spirals are derived from adjacent non-spiral segments
// (whose tangentEndRad comes from pure coordinate geometry) to avoid any
// dependency on the file's angular unit — dirStart/dirEnd attributes are
// not used here at all.
export function buildRobustPolyline(alignment: Alignment, arcSpacingM: number): ApproxPoint[] {
  const eqs = alignment.stationEquations;
  const hasProfile = alignment.profileGeom.vertices.length >= 2;
  const segs = alignment.segments;

  const getElev = (coordZ: number | null, sta: number): number => {
    if (hasProfile) return evaluateProfile(alignment.profileGeom, sta) ?? coordZ ?? 0;
    return coordZ ?? 0;
  };

  const pts: ApproxPoint[] = [];

  const pushPt = (x: number, y: number, z: number, sta: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(x - last.x) < 1e-9 && Math.abs(y - last.y) < 1e-9) return;
    pts.push({ x, y, z, sta });
  };

  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const dispStart = stationToDisplay(eqs, seg.staStart);
    const dispEnd   = stationToDisplay(eqs, seg.staEnd);

    if (seg.type === "Line") {
      pushPt(seg.start.x, seg.start.y, getElev(seg.start.z, dispStart), dispStart);
      pushPt(seg.end.x,   seg.end.y,   getElev(seg.end.z,   dispEnd),   dispEnd);

    } else if (seg.type === "Curve") {
      const sign = seg.rot === "cw" ? -1 : 1;
      const n = Math.max(4, Math.ceil(seg.length / Math.max(1, arcSpacingM)));
      for (let i = 0; i <= n; i++) {
        const t     = i / n;
        const angle = seg.a0 + sign * t * seg.geomDelta;
        const x     = seg.center.x + seg.radius * Math.cos(angle);
        const y     = seg.center.y + seg.radius * Math.sin(angle);
        const sta   = lerp(dispStart, dispEnd, t);
        pushPt(x, y, getElev(lerp(seg.start.z ?? 0, seg.end.z ?? 0, t), sta), sta);
      }

    } else {
      // Transition (clothoid or Bloss): polygonalise using the entry tangent
      // derived from the nearest preceding non-Transition segment.
      // That segment's tangentEndRad is computed from coordinate geometry
      // (arc center/radius or line bearing) — never from angular attributes —
      // so it is correct regardless of the file's angular unit.
      // Fallback: chord bearing when the alignment starts with a spiral.
      let entryTan = Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x);
      for (let k = si - 1; k >= 0; k--) {
        if (segs[k].type !== "Transition") { entryTan = segs[k].tangentEndRad; break; }
      }

      const n = Math.max(4, Math.ceil(seg.length / Math.max(1, arcSpacingM)));
      for (let i = 0; i <= n; i++) {
        const t   = i / n;
        const sta = lerp(dispStart, dispEnd, t);
        if (i === 0) {
          pushPt(seg.start.x, seg.start.y, getElev(seg.start.z, sta), sta);
        } else if (i === n) {
          // Always snap to XML endpoint — prevents any integration drift from
          // creating a gap to the next segment.
          pushPt(seg.end.x, seg.end.y, getElev(seg.end.z, sta), sta);
        } else {
          const s = t * seg.length;
          const [dx, dy] = seg.spiralType === "bloss"
            ? blossOffset(entryTan, seg.k0, seg.k1, seg.length, s)
            : clothoidOffset(entryTan, seg.k0, seg.k1, seg.length, s);
          pushPt(seg.start.x + dx, seg.start.y + dy, getElev(null, sta), sta);
        }
      }
    }
  }
  return pts;
}
