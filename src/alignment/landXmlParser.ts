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

// ── Constants ─────────────────────────────────────────────────────────────────
const EPS = 1e-9;

// ── Math helpers ──────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function dist2D(a: AlignCoord, b: AlignCoord): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Wrap angle to (-π, π]
function wrap(r: number): number {
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function kids(node: Element | null | undefined): Element[] {
  return Array.from(node?.children ?? []);
}

function byTag(node: Element | null | undefined, tag: string): Element[] {
  return kids(node).filter(c => c.localName === tag);
}

function firstTag(node: Element | null | undefined, tag: string): Element | null {
  return kids(node).find(c => c.localName === tag) ?? null;
}

function attrNum(el: Element | null | undefined, name: string): number | null {
  const raw = el?.getAttribute(name);
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// LandXML coordinate text: "Northing Easting" or "Northing Easting Elevation"
// → we store x=Easting, y=Northing (consistent with GIS/surveying convention)
function parseCoord(text: string | null | undefined): AlignCoord | null {
  if (!text) return null;
  const v = text.trim().split(/\s+/).map(Number);
  if (v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
  return {
    y: v[0], // Northing
    x: v[1], // Easting
    z: v.length >= 3 && Number.isFinite(v[2]) ? v[2] : null,
  };
}

function coordNode(parent: Element | null | undefined, tag: string): AlignCoord | null {
  const el = firstTag(parent, tag);
  return el ? parseCoord(el.textContent) : null;
}

// LandXML direction: clockwise azimuth from North, degrees
// → math angle: counterclockwise from East, radians
function azmToRad(azDeg: number): number {
  return wrap(Math.PI / 2 - azDeg * (Math.PI / 180));
}

// Direction angle from two 2-D points (math radians)
function bearing2(from: AlignCoord, to: AlignCoord): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── Station equations ─────────────────────────────────────────────────────────
function parseStaEquations(alignEl: Element): StationEquation[] {
  return byTag(alignEl, "StaEquation").flatMap(eq => {
    const staAhead = attrNum(eq, "staAhead");
    const staBack  = attrNum(eq, "staBack");
    const staInt   = attrNum(eq, "staInternal") ?? staBack;
    if (staAhead === null || staBack === null || staInt === null) return [];
    return [{ staInternal: staInt, staAhead, staBack, delta: staAhead - staBack }];
  });
}

export function stationToDisplay(eqs: StationEquation[], sta: number): number {
  let s = sta;
  for (const eq of eqs) { if (sta >= eq.staInternal - EPS) s += eq.delta; }
  return s;
}

export function displayToStation(eqs: StationEquation[], display: number): number {
  let delta = 0;
  for (const eq of eqs) { if (display >= eq.staInternal + delta - EPS) delta += eq.delta; }
  return display - delta;
}

// Backward-compat aliases
export const stationInternalToDisplay = stationToDisplay;
export const stationDisplayToInternal = displayToStation;

// ── Curve helpers ─────────────────────────────────────────────────────────────

// Infer rotation direction from center/start/end geometry.
// Cross product (center→start) × (center→end): positive → CCW, negative → CW.
function inferRot(center: AlignCoord, start: AlignCoord, end: AlignCoord): "cw" | "ccw" {
  const cross =
    (start.x - center.x) * (end.y - center.y) -
    (start.y - center.y) * (end.x - center.x);
  return cross < 0 ? "cw" : "ccw";
}

// Infer arc center from start/end/radius/rot when center is not explicit.
// prevTanRad (math radians) disambiguates which side the center is on.
function inferCenter(
  start: AlignCoord,
  end: AlignCoord,
  radius: number,
  rot: "cw" | "ccw",
  prevTanRad: number
): AlignCoord | null {
  const chord = dist2D(start, end);
  if (chord > 2 * radius + EPS) return null;
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const halfChord = chord / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const ca = Math.atan2(end.y - start.y, end.x - start.x);
  // Normal to chord, perpendicular
  let nx = -Math.sin(ca);
  let ny =  Math.cos(ca);

  if (Number.isFinite(prevTanRad)) {
    // Disambiguate: for CCW the center is to the LEFT of the direction of travel;
    // for CW it is to the RIGHT.
    const tx = Math.cos(prevTanRad), ty = Math.sin(prevTanRad);
    const cx = midX + nx * h, cy = midY + ny * h;
    // cross(tangent, center - start): + means center is to the left
    const cross = tx * (cy - start.y) - ty * (cx - start.x);
    const wantLeft = rot === "ccw";
    if ((cross > 0) !== wantLeft) { nx = -nx; ny = -ny; }
  } else {
    if (rot === "cw") { nx = -nx; ny = -ny; }
  }

  return { x: midX + nx * h, y: midY + ny * h, z: null };
}

// ── Segment parsers ───────────────────────────────────────────────────────────

function parseLine(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTan: number
): LineSegment | null {
  const start = coordNode(el, "Start") ?? prevEnd;
  const end   = coordNode(el, "End");
  if (!start || !end) return null;
  const lenAttr = attrNum(el, "length");
  const length  = lenAttr ?? dist2D(start, end);
  if (length < EPS) return null;

  const dirAttr = attrNum(el, "dir");
  const tan = dirAttr !== null ? azmToRad(dirAttr) : bearing2(start, end);
  void prevTan;
  return {
    type: "Line",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    tangentStartRad: tan,
    tangentEndRad: bearing2(start, end),
    typeLabel: "Gerade",
  };
}

function parseCurve(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTan: number
): CurveSegment | null {
  const start = coordNode(el, "Start") ?? prevEnd;
  const end   = coordNode(el, "End");
  if (!start || !end) return null;

  // radius can come from "radius" attr; some exporters use "rot" for radius — ignore that
  const radius = attrNum(el, "radius");
  if (!radius || radius < EPS) return null;

  // Center: prefer explicit value from XML
  let center = coordNode(el, "Center");
  const hasExplicitCenter = center !== null;

  // Rotation direction
  const rotAttrRaw = el.getAttribute("rot");
  const rotFromAttr: "cw" | "ccw" =
    (rotAttrRaw ?? "").toLowerCase() === "cw" ? "cw" : "ccw";

  let rot: "cw" | "ccw";
  if (hasExplicitCenter) {
    // When center is given in XML, always INFER rotation from geometry.
    // The explicit `rot` attribute is used only if given and as a sanity check.
    const inferred = inferRot(center!, start, end);
    rot = rotAttrRaw ? rotFromAttr : inferred;
  } else {
    // No explicit center: use attribute (or default CCW), then infer center
    rot = rotFromAttr;
    center = inferCenter(start, end, radius, rot, prevTan);
    if (!center) return null;
  }

  const sign = rot === "cw" ? -1 : 1;

  // a0 = angle (math radians) from center TO start point
  const a0 = Math.atan2(start.y - center!.y, start.x - center!.x);

  // Arc sweep angle (always positive = magnitude only, sign in 'rot')
  const lenAttr   = attrNum(el, "length");
  const deltaAttr = attrNum(el, "delta"); // degrees, positive
  let geomDelta: number;
  if (deltaAttr !== null) {
    geomDelta = Math.abs(deltaAttr) * (Math.PI / 180);
  } else if (lenAttr !== null) {
    geomDelta = lenAttr / radius;
  } else {
    const chord = dist2D(start, end);
    geomDelta = 2 * Math.asin(clamp(chord / (2 * radius), -1, 1));
  }
  const length = lenAttr ?? radius * geomDelta;
  if (length < EPS || geomDelta < EPS) return null;

  // Tangent at start: perpendicular to radius in the direction of arc travel
  // If a `dir` attribute (chord/tangent direction) is given, use it; otherwise derive from a0.
  const dirAttr = attrNum(el, "dir");
  const tangentStartRad = dirAttr !== null
    ? azmToRad(dirAttr)
    : wrap(a0 + sign * Math.PI / 2);
  const tangentEndRad = wrap(tangentStartRad + sign * geomDelta);

  return {
    type: "Curve",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    center: center!,
    radius,
    geomDelta,
    rot,
    a0,
    tangentStartRad,
    tangentEndRad,
    typeLabel: "Bogen",
  };
}

function parseSpiral(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTan: number
): TransitionSegment | null {
  const start  = coordNode(el, "Start") ?? prevEnd;
  const end    = coordNode(el, "End");
  const length = attrNum(el, "length");
  if (!start || !end || !length || length < EPS) return null;

  const spiralType = el.getAttribute("spiralType") ?? "clothoid";
  const rotAttr = el.getAttribute("rot");
  const rot: "cw" | "ccw" = (rotAttr ?? "").toLowerCase() === "cw" ? "cw" : "ccw";
  const sign = rot === "cw" ? -1 : 1;

  // Parse radii; treat 0 and very large values as "infinity" (tangent connection)
  const isInfinite = (r: number | null) =>
    r === null || r < EPS || r > 1e7;
  const rStartRaw = attrNum(el, "radiusStart") ?? attrNum(el, "radiusIn");
  const rEndRaw   = attrNum(el, "radiusEnd")   ?? attrNum(el, "radiusOut");

  const k0 = isInfinite(rStartRaw) ? 0 : sign / rStartRaw!;
  const k1 = isInfinite(rEndRaw)   ? 0 : sign / rEndRaw!;

  // Entry tangent
  const dirStartRaw = attrNum(el, "dirStart") ?? attrNum(el, "dir");
  const tangentStartRad = dirStartRaw !== null ? azmToRad(dirStartRaw) : prevTan;

  // Exit tangent: from attribute OR computed via ∫κ ds = (k0+k1)/2 · L
  const dirEndRaw = attrNum(el, "dirEnd");
  const tangentEndRad = dirEndRaw !== null
    ? azmToRad(dirEndRaw)
    : wrap(tangentStartRad + (k0 + k1) / 2 * length);

  return {
    type: "Transition",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    spiralType,
    rot,
    k0,
    k1,
    tangentStartRad,
    tangentEndRad,
    typeLabel: "Spirale",
  };
}

// ── Post-process spirals without explicit curvatures ──────────────────────────
// After all segments are parsed, spirals with k0=k1=0 (no radiusStart/radiusEnd
// in the XML) are filled in by reading the curvatures of adjacent arc segments.
// The sign comes from each arc's own rot, not from the spiral's rot.
function fillSpiralCurvatures(segments: AlignmentSegment[]): void {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type !== "Transition") continue;
    if (Math.abs(seg.k0) > EPS || Math.abs(seg.k1) > EPS) continue;

    const prev = i > 0 ? segments[i - 1] : null;
    const next = i < segments.length - 1 ? segments[i + 1] : null;

    // Use each adjacent arc's OWN rotation sign to determine curvature sign
    let k0 = 0;
    if (prev?.type === "Curve") {
      const s = prev.rot === "cw" ? -1 : 1;
      k0 = s / prev.radius;
    }
    let k1 = 0;
    if (next?.type === "Curve") {
      const s = next.rot === "cw" ? -1 : 1;
      k1 = s / next.radius;
    }

    if (Math.abs(k0) < EPS && Math.abs(k1) < EPS) continue; // still no info

    const t = seg as TransitionSegment;
    const newTanEnd = wrap(seg.tangentStartRad + (k0 + k1) / 2 * seg.length);
    (t as unknown as Record<string, number>)["k0"] = k0;
    (t as unknown as Record<string, number>)["k1"] = k1;
    // Only update tangentEndRad if it was left at start (i.e. never explicitly set)
    if (Math.abs(seg.tangentEndRad - seg.tangentStartRad) < EPS) {
      (t as unknown as Record<string, number>)["tangentEndRad"] = newTanEnd;
    }
  }
}

// ── Fresnel integral for clothoid ─────────────────────────────────────────────
// C(x) = ∫₀ˣ cos(π/2 · t²) dt,  S(x) = ∫₀ˣ sin(π/2 · t²) dt
// Taylor series, accurate to < 0.01 mm for |x| < 5
function fresnel(x: number): [number, number] {
  if (x === 0) return [0, 0];
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const ph = Math.PI / 2;
  const a2 = a * a, a4 = a2 * a2;
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

// ∫₀ˢ [cos(θ₀ + A·t²), sin(θ₀ + A·t²)] dt
function fresnelInt(theta0: number, A: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];
  if (Math.abs(A) < 1e-12) {
    return [Math.cos(theta0) * s, Math.sin(theta0) * s];
  }
  const absA = Math.abs(A);
  const scale = Math.sqrt(Math.PI / (2 * absA));
  const u = Math.abs(s) * Math.sqrt(2 * absA / Math.PI);
  const [Cu, Su] = fresnel(u);
  const ct = Math.cos(theta0), st = Math.sin(theta0);
  let dx: number, dy: number;
  if (A > 0) {
    dx = scale * (ct * Cu - st * Su);
    dy = scale * (st * Cu + ct * Su);
  } else {
    dx = scale * (ct * Cu + st * Su);
    dy = scale * (st * Cu - ct * Su);
  }
  const sg = s < 0 ? -1 : 1;
  return [sg * dx, sg * dy];
}

// Arc-length displacement on a clothoid with linearly varying curvature.
// κ(t) = k0 + (k1-k0)/L · t  →  θ(t) = θ₀ + k0·t + (k1-k0)/(2L)·t²
// Returns [Δx, Δy] from start after arc-length s
function clothoidOffset(theta0: number, k0: number, k1: number, L: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];
  const A = (k1 - k0) / (2 * L);

  // Degenerate: constant curvature (pure arc or straight line)
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(k0) < 1e-12) {
      return [Math.cos(theta0) * s, Math.sin(theta0) * s];
    }
    const da = k0 * s;
    return [
      (Math.sin(theta0 + da) - Math.sin(theta0)) / k0,
      (Math.cos(theta0) - Math.cos(theta0 + da)) / k0,
    ];
  }

  // General case: complete the square.
  // θ(t) = θ'₀ + A·(t + τ)²   where τ = k0/(2A), θ'₀ = θ₀ − A·τ²
  const tau    = k0 / (2 * A);
  const theta1 = theta0 - A * tau * tau;
  const [x1, y1] = fresnelInt(theta1, A, s + tau);
  const [x0, y0] = fresnelInt(theta1, A, tau);
  return [x1 - x0, y1 - y0];
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
    const sign = seg.rot === "cw" ? -1 : 1;
    const angle = seg.a0 + sign * t * seg.geomDelta;
    return {
      x: seg.center.x + seg.radius * Math.cos(angle),
      y: seg.center.y + seg.radius * Math.sin(angle),
      z: seg.start.z !== null && seg.end.z !== null ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: wrap(angle + sign * Math.PI / 2),
    };
  }

  if (seg.type === "Transition") {
    const s = t * seg.length;
    const [dx, dy] = clothoidOffset(seg.tangentStartRad, seg.k0, seg.k1, seg.length, s);
    const L = seg.length;
    const theta = wrap(
      seg.tangentStartRad + seg.k0 * s + (seg.k1 - seg.k0) / (2 * L) * s * s
    );
    return {
      x: seg.start.x + dx,
      y: seg.start.y + dy,
      z: seg.start.z !== null && seg.end.z !== null ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: theta,
    };
  }

  const _: never = seg;
  void _;
  return { x: 0, y: 0, z: null, tangentRad: 0 };
}

// ── Profile parsing ───────────────────────────────────────────────────────────
function parseProfile(alignEl: Element): ProfileGeometry {
  const empty: ProfileGeometry = { profileName: "", vertices: [], curves: [], tangents: [] };

  // ProfAlign: design profile with PVI / ParaCurve / CircCurve nodes
  const profAlignEl = firstTag(firstTag(alignEl, "Profile"), "ProfAlign");
  if (profAlignEl) {
    const profileName =
      profAlignEl.getAttribute("name") ??
      firstTag(alignEl, "Profile")?.getAttribute("name") ?? "";
    const vertices: ProfileVertex[] = [];

    for (const child of kids(profAlignEl)) {
      const tag = child.localName;
      if (tag === "PVI") {
        const parts = (child.textContent ?? "").trim().split(/\s+/).map(Number);
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          vertices.push({
            type: "PVI",
            sta: parts[0],
            elev: parts[1],
            curveLength: Number.isFinite(parts[2]) ? parts[2] : 0,
          });
        }
      } else if (tag === "ParaCurve" || tag === "CircCurve") {
        const sta  = attrNum(child, "sta");
        const elev = attrNum(child, "elev");
        const len  = attrNum(child, "length") ?? attrNum(child, "len");
        if (sta !== null && elev !== null && len !== null) {
          vertices.push({
            type: tag as "ParaCurve" | "CircCurve",
            sta,
            elev,
            curveLength: len,
            radius: attrNum(child, "radius") ?? undefined,
          });
        }
      }
    }

    if (vertices.length < 2) return empty;
    return buildProfile(profileName, vertices);
  }

  // ProfSurf / PntList2D: surface/existing ground profile (no vertical curves)
  const profSurfEl =
    firstTag(firstTag(alignEl, "Profile"), "ProfSurf") ??
    firstTag(firstTag(alignEl, "Profile"), "PntList2D");
  if (profSurfEl) {
    const pntEl = profSurfEl.localName === "PntList2D"
      ? profSurfEl
      : firstTag(profSurfEl, "PntList2D");
    if (!pntEl) return empty;
    const nums = (pntEl.textContent ?? "").trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return empty;
    const vertices: ProfileVertex[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      vertices.push({ type: "PVI", sta: nums[i], elev: nums[i + 1], curveLength: 0 });
    }
    if (vertices.length < 2) return empty;
    return buildProfile(
      profSurfEl.getAttribute("name") ?? firstTag(alignEl, "Profile")?.getAttribute("name") ?? "Surface",
      vertices
    );
  }

  return empty;
}

function buildProfile(profileName: string, vertices: ProfileVertex[]): ProfileGeometry {
  // Grades between consecutive PVIs
  const grades: number[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const ds = vertices[i + 1].sta - vertices[i].sta;
    const de = vertices[i + 1].elev - vertices[i].elev;
    grades.push(ds > EPS ? de / ds : 0);
  }

  const tangents: ProfileTangent[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    tangents.push({
      startSta: vertices[i].sta,
      endSta: vertices[i + 1].sta,
      startElev: vertices[i].elev,
      grade: grades[i],
    });
  }

  const curves: ProfileCurve[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.curveLength < EPS) continue;
    const g1 = i > 0 ? grades[i - 1] : 0;
    const g2 = i < grades.length ? grades[i] : 0;
    const halfL = v.curveLength / 2;
    const bvc = v.sta - halfL;
    const evc = v.sta + halfL;
    const yBVC = v.elev - g1 * halfL;
    const A = g2 - g1;
    const isCirc = v.type === "CircCurve";
    const curve: ProfileCurve = {
      model: isCirc ? "circular" : "parabolic",
      bvc, evc, g1, g2, A,
      length: v.curveLength,
      yBVC,
    };
    if (isCirc && v.radius !== undefined) {
      const ySign = A < 0 ? 1 : -1;
      curve.radius = v.radius;
      curve.centerSta = v.sta;
      curve.centerElev = v.elev + ySign * v.radius;
      curve.ySign = ySign;
    }
    curves.push(curve);
  }

  return { profileName, vertices, curves, tangents };
}

// ── Profile evaluation ────────────────────────────────────────────────────────
// `station` must be in DISPLAY format (same as vertex sta values in XML).
export function evaluateProfile(profileGeom: ProfileGeometry, station: number): number | null {
  const { vertices, curves, tangents } = profileGeom;
  if (vertices.length < 2) return null;

  const first = vertices[0];
  const last  = vertices[vertices.length - 1];

  // Extrapolate beyond range
  if (station < first.sta - EPS) {
    if (tangents.length === 0) return null;
    const t = tangents[0];
    return t.startElev + t.grade * (station - t.startSta);
  }
  if (station > last.sta + EPS) {
    if (tangents.length === 0) return null;
    const t = tangents[tangents.length - 1];
    return t.startElev + t.grade * (station - t.startSta);
  }

  // Vertical curves take priority over tangents in their zone
  for (const c of curves) {
    if (station < c.bvc - EPS || station > c.evc + EPS) continue;
    const x = station - c.bvc;
    if (c.model === "parabolic") {
      return c.yBVC + c.g1 * x + (c.A / (2 * c.length)) * x * x;
    }
    if (c.radius !== undefined && c.centerSta !== undefined && c.centerElev !== undefined) {
      const d = station - c.centerSta;
      const inner = c.radius * c.radius - d * d;
      if (inner >= 0) return c.centerElev + (c.ySign ?? 1) * Math.sqrt(inner);
    }
    return c.yBVC + c.g1 * x + (c.A / (2 * c.length)) * x * x;
  }

  for (const t of tangents) {
    if (station >= t.startSta - EPS && station <= t.endSta + EPS) {
      return t.startElev + t.grade * (station - t.startSta);
    }
  }
  return null;
}

// ── Alignment station / segment lookup ───────────────────────────────────────
function findSeg(
  segments: AlignmentSegment[],
  internalSta: number
): { seg: AlignmentSegment; t: number } | null {
  for (const seg of segments) {
    if (internalSta >= seg.staStart - EPS && internalSta <= seg.staEnd + EPS) {
      return { seg, t: clamp(seg.length > EPS ? (internalSta - seg.staStart) / seg.length : 0, 0, 1) };
    }
  }
  if (segments.length > 0) {
    if (internalSta < segments[0].staStart) return { seg: segments[0], t: 0 };
    const last = segments[segments.length - 1];
    if (internalSta > last.staEnd) return { seg: last, t: 1 };
  }
  return null;
}

// Sample at a DISPLAY station. Returns null if alignment has no segments.
export function sampleAtDisplayStation(alignment: Alignment, displaySta: number): SampledPoint | null {
  if (alignment.segments.length === 0) return null;

  const internalSta = displayToStation(alignment.stationEquations, displaySta);
  const found = findSeg(alignment.segments, internalSta);
  if (!found) return null;

  const pt = sampleSeg(found.seg, found.t);
  pt.station = displaySta;

  // Profile elevation overrides CoordGeom Z
  if (alignment.zSource === "profile" && alignment.profileGeom.vertices.length >= 2) {
    pt.z = evaluateProfile(alignment.profileGeom, displaySta);
  }

  return pt;
}

// Generate station sequence with extra density at transition elements.
export function buildStationSeries(alignment: Alignment, basePts: number): number[] {
  const series: number[] = [];
  const totalLen = alignment.length;
  if (totalLen < EPS || basePts < 2) return series;

  for (let si = 0; si < alignment.segments.length; si++) {
    const seg = alignment.segments[si];
    const segDStart = stationToDisplay(alignment.stationEquations, seg.staStart);
    const segDEnd   = stationToDisplay(alignment.stationEquations, seg.staEnd);
    const segLen = segDEnd - segDStart;

    // Transitions need at least 24 points; lines need only 2
    const minPts = seg.type === "Transition" ? 24 : 2;
    const nPts = Math.max(minPts, Math.round(basePts * segLen / totalLen));

    for (let i = 0; i < nPts; i++) {
      const t = nPts > 1 ? i / (nPts - 1) : 0;
      series.push(lerp(segDStart, segDEnd, clamp(t, 0, 1)));
    }
    // Exact end of each segment
    series.push(segDEnd);
  }
  series.push(alignment.staEnd);

  // Sort and deduplicate
  series.sort((a, b) => a - b);
  const out: number[] = [];
  for (const s of series) {
    if (out.length === 0 || s - out[out.length - 1] > EPS) out.push(s);
  }
  return out;
}

// ── Main parser ───────────────────────────────────────────────────────────────
function parseAlignment(alignEl: Element, fileName: string, id: number): Alignment | null {
  const name = alignEl.getAttribute("name") ?? `Alignment_${id}`;
  const staStartAttr = attrNum(alignEl, "staStart");
  const staEndAttr   = attrNum(alignEl, "staEnd") ?? attrNum(alignEl, "length");

  const stationEquations = parseStaEquations(alignEl);
  const profileGeom = parseProfile(alignEl);

  const coordGeomEl = firstTag(alignEl, "CoordGeom");
  const segments: AlignmentSegment[] = [];
  let cursor: AlignCoord | null = null;
  let prevTan = 0;
  let runSta = staStartAttr ?? 0;

  if (coordGeomEl) {
    for (const child of kids(coordGeomEl)) {
      const tag = child.localName;
      let seg: AlignmentSegment | null = null;
      if (tag === "Line") {
        seg = parseLine(child, runSta, cursor, prevTan);
      } else if (tag === "Curve") {
        seg = parseCurve(child, runSta, cursor, prevTan);
      } else if (tag === "Spiral") {
        seg = parseSpiral(child, runSta, cursor, prevTan);
      }
      if (seg) {
        segments.push(seg);
        cursor = seg.end;
        prevTan = seg.tangentEndRad;
        runSta = seg.staEnd;
      }
    }

    // Fallback: PntList3D or IrregularLine polyline
    if (segments.length === 0) {
      const pntEl =
        firstTag(coordGeomEl, "PntList3D") ??
        firstTag(coordGeomEl, "IrregularLine");
      if (pntEl) {
        const nums = (pntEl.textContent ?? "").trim().split(/\s+/).map(Number).filter(Number.isFinite);
        const step = nums.length % 3 === 0 ? 3 : 2;
        for (let i = 0; i + step - 1 < nums.length; i += step) {
          const pt: AlignCoord = step === 3
            ? { y: nums[i], x: nums[i + 1], z: nums[i + 2] }
            : { y: nums[i], x: nums[i + 1], z: null };
          if (cursor) {
            const d = dist2D(cursor, pt);
            if (d > EPS) {
              const tan = bearing2(cursor, pt);
              segments.push({
                type: "Line",
                staStart: runSta, staEnd: runSta + d,
                length: d, start: cursor, end: pt,
                tangentStartRad: tan, tangentEndRad: tan,
                typeLabel: "Gerade",
              });
              prevTan = tan;
              runSta += d;
            }
          }
          cursor = pt;
        }
      }
    }
  }

  if (segments.length === 0) return null;

  // Post-process: fill missing spiral curvatures from adjacent arc segments
  fillSpiralCurvatures(segments);

  const internalStaStart = staStartAttr ?? segments[0].staStart;
  const internalStaEnd   = (() => {
    if (staEndAttr !== null) return staStartAttr !== null ? staStartAttr + staEndAttr : staEndAttr;
    return segments[segments.length - 1].staEnd;
  })();

  const displayStaStart = stationToDisplay(stationEquations, internalStaStart);
  const displayStaEnd   = stationToDisplay(stationEquations, internalStaEnd);

  const hasZ  = segments.some(s => s.start.z !== null || s.end.z !== null);
  const hasProf = profileGeom.vertices.length >= 2;
  const zSource: Alignment["zSource"] = hasProf ? "profile" : hasZ ? "coordgeom" : "none";
  const zStatus = zSource === "profile"
    ? `Profil: ${profileGeom.profileName}`
    : zSource === "coordgeom" ? "Z aus CoordGeom" : "Kein Z";

  return {
    id, fileName, name, displayName: name,
    staStart: displayStaStart,
    staEnd:   displayStaEnd,
    length:   displayStaEnd - displayStaStart,
    internalStaStart,
    internalStaEnd,
    segments,
    profileGeom,
    stationEquations,
    hasZValues: hasZ || hasProf,
    zSource,
    zStatus,
  };
}

export function parseLandXmlText(xmlText: string, fileName: string, nextIdStart = 0): ParsedLandXml {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    return { alignments: [], nextId: nextIdStart };
  }
  const root = doc.documentElement;
  const container = firstTag(root, "Alignments") ?? root;
  const alignments: Alignment[] = [];
  let nextId = nextIdStart;
  for (const el of byTag(container, "Alignment")) {
    const a = parseAlignment(el, fileName, nextId);
    if (a) { alignments.push(a); nextId++; }
  }
  return { alignments, nextId };
}

export function generateStationSeries(alignment: Alignment, interval: number): number[] {
  if (interval <= 0) return [];
  const series: number[] = [];
  const start = Math.ceil(alignment.staStart / interval) * interval;
  for (let s = start; s <= alignment.staEnd + EPS; s += interval) series.push(s);
  if (series.length === 0 || Math.abs(series[series.length - 1] - alignment.staEnd) > EPS) {
    series.push(alignment.staEnd);
  }
  return series;
}
