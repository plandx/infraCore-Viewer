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
function wrapAngle(r: number): number {
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function children(node: Element | null | undefined): Element[] {
  return Array.from(node?.children ?? []);
}

function byTag(node: Element | null | undefined, tag: string): Element[] {
  return children(node).filter(c => c.localName === tag);
}

function firstTag(node: Element | null | undefined, tag: string): Element | null {
  return children(node).find(c => c.localName === tag) ?? null;
}

function attrNum(el: Element | null | undefined, name: string): number | null {
  const raw = el?.getAttribute(name);
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// LandXML coordinate nodes: text content is "N E" or "N E Z"
// (Northing first, Easting second — per LandXML 1.2 spec)
function parseCoord(text: string | null | undefined): AlignCoord | null {
  if (!text) return null;
  const vals = text.trim().split(/\s+/).map(Number);
  if (vals.length < 2 || !Number.isFinite(vals[0]) || !Number.isFinite(vals[1])) return null;
  return {
    y: vals[0], // Northing
    x: vals[1], // Easting
    z: vals.length >= 3 && Number.isFinite(vals[2]) ? vals[2] : null,
  };
}

function coordNode(parent: Element | null | undefined, tag: string): AlignCoord | null {
  const el = firstTag(parent, tag);
  return el ? parseCoord(el.textContent) : null;
}

// LandXML direction: clockwise azimuth from North, in degrees
// → math angle: counterclockwise from East, in radians
function azmToRad(azimuthDeg: number): number {
  return wrapAngle(Math.PI / 2 - azimuthDeg * (Math.PI / 180));
}

// Direction from two points (math radians, CCW from East)
function bearing(from: AlignCoord, to: AlignCoord): number {
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

export function stationToDisplay(eqs: StationEquation[], internalSta: number): number {
  let sta = internalSta;
  for (const eq of eqs) {
    if (internalSta >= eq.staInternal - EPS) sta += eq.delta;
  }
  return sta;
}

export function displayToInternal(eqs: StationEquation[], displaySta: number): number {
  let delta = 0;
  for (const eq of eqs) {
    if (displaySta >= eq.staInternal + delta - EPS) delta += eq.delta;
  }
  return displaySta - delta;
}

// Backwards-compatible aliases used by AlignmentPanel
export const stationInternalToDisplay = stationToDisplay;
export const stationDisplayToInternal = displayToInternal;

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
  const tan = dirAttr !== null ? azmToRad(dirAttr) : bearing(start, end);
  const tanEnd = bearing(start, end); // always from geometry for exit tangent

  return {
    type: "Line",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    tangentStartRad: tan,
    tangentEndRad: tanEnd,
    typeLabel: "Gerade",
  };
  void prevTan;
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

  const radius = attrNum(el, "radius");
  if (!radius || radius < EPS) return null;

  const rot: "cw" | "ccw" =
    (el.getAttribute("rot") ?? "").toLowerCase() === "cw" ? "cw" : "ccw";
  const sign = rot === "cw" ? -1 : 1; // math sign of curvature

  // Arc length from attribute or from delta angle
  const lenAttr   = attrNum(el, "length");
  const deltaAttr = attrNum(el, "delta"); // arc delta in degrees (always positive in LandXML)

  // Find center: prefer explicit, otherwise infer from start/end/radius
  let center = coordNode(el, "Center");
  if (!center) {
    center = inferCenter(start, end, radius, rot, prevTan);
    if (!center) return null;
  }

  // a0 = angle from center to start (math radians)
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);

  // Sweep angle (always positive)
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

  // Tangent at start: perpendicular to radius (sign = rot direction)
  const tangentStartRad = wrapAngle(a0 + sign * Math.PI / 2);
  const tangentEndRad   = wrapAngle(a0 + sign * geomDelta + sign * Math.PI / 2);

  return {
    type: "Curve",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    center,
    radius,
    geomDelta,
    rot,
    a0,
    tangentStartRad,
    tangentEndRad,
    typeLabel: "Bogen",
  };
  void prevTan;
}

// Infer arc center from start/end/radius/rotation
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
  const half = chord / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - half * half));
  // Normal to chord
  const chordAngle = Math.atan2(end.y - start.y, end.x - start.x);
  let nx = -Math.sin(chordAngle);
  let ny =  Math.cos(chordAngle);

  // Use prevTanRad to disambiguate which side the center is on
  if (Number.isFinite(prevTanRad)) {
    const tx = Math.cos(prevTanRad), ty = Math.sin(prevTanRad);
    // For CCW: center is to the left of travel → cross(tangent, center-start) > 0
    const cx1 = midX + nx * h, cy1 = midY + ny * h;
    const cross = tx * (cy1 - start.y) - ty * (cx1 - start.x);
    const wantLeft = rot === "ccw";
    if ((cross > 0) !== wantLeft) { nx = -nx; ny = -ny; }
  } else if (rot === "cw") {
    nx = -nx; ny = -ny;
  }

  return { x: midX + nx * h, y: midY + ny * h, z: null };
}

function parseSpiral(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTan: number
): TransitionSegment | null {
  const start = coordNode(el, "Start") ?? prevEnd;
  const end   = coordNode(el, "End");
  const length = attrNum(el, "length");
  if (!start || !end || !length || length < EPS) return null;

  const spiralType = el.getAttribute("spiralType") ?? "clothoid";
  const rot: "cw" | "ccw" =
    (el.getAttribute("rot") ?? "").toLowerCase() === "cw" ? "cw" : "ccw";
  const sign = rot === "cw" ? -1 : 1;

  // Parse radii (infinite radius = tangent connection = 0 curvature)
  const rStartRaw = attrNum(el, "radiusStart") ?? attrNum(el, "radiusIn");
  const rEndRaw   = attrNum(el, "radiusEnd")   ?? attrNum(el, "radiusOut");

  // Signed curvatures at start and end
  // Infinity radius → 0 curvature (tangent)
  const k0 = (rStartRaw !== null && rStartRaw > EPS && rStartRaw < 1e8)
    ? sign / rStartRaw : 0;
  const k1 = (rEndRaw !== null && rEndRaw > EPS && rEndRaw < 1e8)
    ? sign / rEndRaw : 0;

  // Entry tangent: from explicit attribute, else from previous segment
  const dirStartRaw = attrNum(el, "dirStart") ?? attrNum(el, "dir");
  const tangentStartRad = dirStartRaw !== null ? azmToRad(dirStartRaw) : prevTan;

  // Exit tangent: from explicit attribute, else computed from curvatures
  // θ_end = θ_start + ∫₀ᴸ κ(s) ds  where κ(s) = k0 + (k1-k0)/L · s
  // ∫ = k0·L + (k1-k0)/2·L = (k0+k1)/2 · L
  const dirEndRaw = attrNum(el, "dirEnd");
  const tangentEndRad = dirEndRaw !== null
    ? azmToRad(dirEndRaw)
    : wrapAngle(tangentStartRad + (k0 + k1) / 2 * length);

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

// ── Clothoid (Euler spiral) integration ───────────────────────────────────────
// For κ(s) = k0 + (k1-k0)/L · s, the heading is:
//   θ(s) = θ₀ + k0·s + (k1-k0)/(2L)·s²
// Position offset from start:
//   [dx, dy] = ∫₀ˢ [cos θ(t), sin θ(t)] dt
//
// We compute this via Fresnel integrals after completing the square.

// Fresnel integrals: C(x) = ∫₀ˣ cos(π/2·t²) dt, S(x) = ∫₀ˣ sin(π/2·t²) dt
// Taylor series — accurate to < 0.01 mm for |x| < 4 (covers all road spirals)
function fresnel(x: number): [number, number] {
  if (x === 0) return [0, 0];
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const pih = Math.PI / 2;
  const a2 = a * a, a4 = a2 * a2;
  let C = 0, S = 0, pa = a, pp = 1, fac = 1, sgn = 1;
  for (let n = 0; n <= 30; n++) {
    if (n > 0) { pa *= a4; pp *= pih * pih; fac *= (2*n-1)*(2*n); sgn = -sgn; }
    const ct = sgn * pp * pa / ((4*n+1) * fac);
    const st = sgn * pp * pih * pa * a2 / ((4*n+3) * fac * (2*n+1));
    C += ct; S += st;
    if (Math.abs(ct) < 1e-17 && Math.abs(st) < 1e-17) break;
  }
  return [s * C, s * S];
}

// ∫₀ˢ [cos(θ₀ + A·t²), sin(θ₀ + A·t²)] dt  (A = (k1-k0)/(2L))
function fresnelIntegral(theta0: number, A: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];
  if (Math.abs(A) < 1e-12) {
    // Straight line or constant curvature (handled below)
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

// Full clothoid offset: κ(t) = k0 + (k1-k0)/L · t  (linear curvature variation)
// Returns [Δx, Δy] from start after arc-length s
function clothoidOffset(theta0: number, k0: number, k1: number, L: number, s: number): [number, number] {
  if (Math.abs(s) < EPS) return [0, 0];

  // Constant curvature: arc
  const A = (k1 - k0) / (2 * L);
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

  // Complete the square: θ(t) = θ'₀ + A·(t + τ)²  where τ = k0/(2A)
  const tau    = k0 / (2 * A);
  const theta0s = theta0 - A * tau * tau;
  const [x1, y1] = fresnelIntegral(theta0s, A, s + tau);
  const [x0, y0] = fresnelIntegral(theta0s, A, tau);
  return [x1 - x0, y1 - y0];
}

// ── Segment sampling ──────────────────────────────────────────────────────────
function sampleSeg(seg: AlignmentSegment, t: number): SampledPoint {
  t = clamp(t, 0, 1);

  if (seg.type === "Line") {
    return {
      x: lerp(seg.start.x, seg.end.x, t),
      y: lerp(seg.start.y, seg.end.y, t),
      z: seg.start.z !== null && seg.end.z !== null
        ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: seg.tangentStartRad,
    };
  }

  if (seg.type === "Curve") {
    const s = t === 1 ? 1 : t; // avoid float imprecision at end
    const sign = seg.rot === "cw" ? -1 : 1;
    const angle = seg.a0 + sign * s * seg.geomDelta;
    return {
      x: seg.center.x + seg.radius * Math.cos(angle),
      y: seg.center.y + seg.radius * Math.sin(angle),
      z: seg.start.z !== null && seg.end.z !== null
        ? lerp(seg.start.z, seg.end.z, t) : null,
      tangentRad: wrapAngle(angle + sign * Math.PI / 2),
    };
  }

  if (seg.type === "Transition") {
    const s = t * seg.length;
    const [dx, dy] = clothoidOffset(seg.tangentStartRad, seg.k0, seg.k1, seg.length, s);
    const theta = wrapAngle(seg.tangentStartRad + seg.k0 * s + (seg.k1 - seg.k0) / (2 * seg.length) * s * s);
    return {
      x: seg.start.x + dx,
      y: seg.start.y + dy,
      z: seg.start.z !== null && seg.end.z !== null
        ? lerp(seg.start.z, seg.end.z, t) : null,
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

  // ProfAlign (design profile with PVIs)
  const profAlignEl = firstTag(firstTag(alignEl, "Profile"), "ProfAlign");
  if (profAlignEl) {
    const profileName =
      profAlignEl.getAttribute("name") ??
      firstTag(alignEl, "Profile")?.getAttribute("name") ?? "";

    const vertices: ProfileVertex[] = [];
    for (const child of children(profAlignEl)) {
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
            type: tag === "ParaCurve" ? "ParaCurve" : "CircCurve",
            sta,
            elev,
            curveLength: len,
            radius: attrNum(child, "radius") ?? undefined,
          });
        }
      }
    }

    if (vertices.length < 2) return empty;
    return buildProfileGeom(profileName, vertices);
  }

  // ProfSurf / PntList2D (surface profile, no vertical curves)
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
    return buildProfileGeom(
      profSurfEl.getAttribute("name") ?? firstTag(alignEl, "Profile")?.getAttribute("name") ?? "Surface",
      vertices
    );
  }

  return empty;
}

function buildProfileGeom(profileName: string, vertices: ProfileVertex[]): ProfileGeometry {
  // Compute grades between consecutive PVIs
  const grades: number[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const ds = vertices[i + 1].sta - vertices[i].sta;
    const de = vertices[i + 1].elev - vertices[i].elev;
    grades.push(ds > EPS ? de / ds : 0);
  }

  // Build tangent segments
  const tangents: ProfileTangent[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    tangents.push({
      startSta: vertices[i].sta,
      endSta: vertices[i + 1].sta,
      startElev: vertices[i].elev,
      grade: grades[i],
    });
  }

  // Build vertical curves at PVIs with curveLength > 0
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
      bvc,
      evc,
      g1,
      g2,
      A,
      length: v.curveLength,
      yBVC,
    };
    if (isCirc && v.radius !== undefined) {
      // Circle center: at PVI station, offset by radius in the direction that makes it tangent
      const ySign = A < 0 ? 1 : -1; // center above sag, below crest
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
// station must be in DISPLAY station format (same as vertex sta values)
export function evaluateProfile(profileGeom: ProfileGeometry, station: number): number | null {
  const { vertices, curves, tangents } = profileGeom;
  if (vertices.length < 2) return null;

  const first = vertices[0];
  const last  = vertices[vertices.length - 1];

  // Extrapolate beyond range using end tangents
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

  // Check vertical curves first (they override the tangent zone)
  for (const c of curves) {
    if (station < c.bvc - EPS || station > c.evc + EPS) continue;
    const x = station - c.bvc;
    if (c.model === "parabolic") {
      return c.yBVC + c.g1 * x + (c.A / (2 * c.length)) * x * x;
    }
    // Circular
    if (c.radius !== undefined && c.centerSta !== undefined && c.centerElev !== undefined) {
      const dSta = station - c.centerSta;
      const inner = c.radius * c.radius - dSta * dSta;
      if (inner < 0) {
        // Fallback to parabola (shouldn't happen for valid data)
        return c.yBVC + c.g1 * x + (c.A / (2 * c.length)) * x * x;
      }
      return c.centerElev + (c.ySign ?? 1) * Math.sqrt(inner);
    }
    return c.yBVC + c.g1 * x + (c.A / (2 * c.length)) * x * x;
  }

  // Tangent segment
  for (const t of tangents) {
    if (station >= t.startSta - EPS && station <= t.endSta + EPS) {
      return t.startElev + t.grade * (station - t.startSta);
    }
  }
  return null;
}

// ── Alignment sampling ────────────────────────────────────────────────────────
function findSeg(
  segments: AlignmentSegment[],
  internalSta: number
): { seg: AlignmentSegment; t: number } | null {
  for (const seg of segments) {
    if (internalSta >= seg.staStart - EPS && internalSta <= seg.staEnd + EPS) {
      return {
        seg,
        t: clamp(seg.length > EPS ? (internalSta - seg.staStart) / seg.length : 0, 0, 1),
      };
    }
  }
  if (segments.length > 0) {
    if (internalSta < segments[0].staStart) return { seg: segments[0], t: 0 };
    const last = segments[segments.length - 1];
    if (internalSta > last.staEnd) return { seg: last, t: 1 };
  }
  return null;
}

// Sample alignment at a given DISPLAY station.
// Returns null if no segments exist.
export function sampleAtDisplayStation(
  alignment: Alignment,
  displaySta: number
): SampledPoint | null {
  if (alignment.segments.length === 0) return null;

  const internalSta = displayToInternal(alignment.stationEquations, displaySta);
  const found = findSeg(alignment.segments, internalSta);
  if (!found) return null;

  const pt = sampleSeg(found.seg, found.t);
  pt.station = displaySta;

  // Apply profile elevation (overrides CoordGeom Z)
  if (alignment.zSource === "profile" && alignment.profileGeom.vertices.length >= 2) {
    pt.z = evaluateProfile(alignment.profileGeom, displaySta);
  }

  return pt;
}

// Generate a sequence of display stations for rendering.
// Transitions get proportionally more points for accurate clothoid rendering.
export function buildStationSeries(alignment: Alignment, basePts: number): number[] {
  const series: number[] = [];
  const totalLen = alignment.length;
  if (totalLen < EPS || basePts < 2) return series;

  // Assign point budget per segment proportional to length, minimum 8 per transition
  for (let si = 0; si < alignment.segments.length; si++) {
    const seg = alignment.segments[si];
    const segDisplayStart = stationToDisplay(alignment.stationEquations, seg.staStart);
    const segDisplayEnd   = stationToDisplay(alignment.stationEquations, seg.staEnd);
    const segLen = segDisplayEnd - segDisplayStart;

    const minPts = seg.type === "Transition" ? 24 : 2;
    const nPts = Math.max(minPts, Math.round(basePts * segLen / totalLen));

    for (let i = 0; i < nPts; i++) {
      const t = i / (nPts - 1 + EPS);
      series.push(lerp(segDisplayStart, segDisplayEnd, clamp(t, 0, 1)));
    }
    // Always include exact end station
    if (si < alignment.segments.length - 1) {
      series.push(segDisplayEnd);
    }
  }

  // Add alignment end
  series.push(alignment.staEnd);

  // Deduplicate and sort
  series.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const s of series) {
    if (deduped.length === 0 || s - deduped[deduped.length - 1] > EPS) {
      deduped.push(s);
    }
  }
  return deduped;
}

// ── Main parser ───────────────────────────────────────────────────────────────
function parseAlignment(
  alignEl: Element,
  fileName: string,
  id: number
): Alignment | null {
  const name = alignEl.getAttribute("name") ?? `Alignment_${id}`;
  const staStartAttr = attrNum(alignEl, "staStart");
  const staEndAttr   = attrNum(alignEl, "staEnd") ?? attrNum(alignEl, "length");

  const stationEquations = parseStaEquations(alignEl);
  const profileGeom = parseProfile(alignEl);

  // Parse segments from CoordGeom
  const coordGeomEl = firstTag(alignEl, "CoordGeom");
  const segments: AlignmentSegment[] = [];
  let cursor: AlignCoord | null = null;
  let prevTan = 0;
  let runSta = staStartAttr ?? 0;

  if (coordGeomEl) {
    for (const child of children(coordGeomEl)) {
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

    // Fallback: PntList3D / IrregularLine (polyline)
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
              const tan = bearing(cursor, pt);
              const seg: LineSegment = {
                type: "Line",
                staStart: runSta,
                staEnd: runSta + d,
                length: d,
                start: cursor,
                end: pt,
                tangentStartRad: tan,
                tangentEndRad: tan,
                typeLabel: "Gerade",
              };
              segments.push(seg);
              prevTan = tan;
              runSta = seg.staEnd;
            }
          }
          cursor = pt;
        }
      }
    }
  }

  if (segments.length === 0) return null;

  const internalStaStart = staStartAttr ?? segments[0].staStart;
  const internalStaEnd   = (() => {
    if (staEndAttr !== null) {
      return staStartAttr !== null ? staStartAttr + staEndAttr : staEndAttr;
    }
    return segments[segments.length - 1].staEnd;
  })();

  const displayStaStart = stationToDisplay(stationEquations, internalStaStart);
  const displayStaEnd   = stationToDisplay(stationEquations, internalStaEnd);

  const hasZCoord = segments.some(s => s.start.z !== null || s.end.z !== null);
  const hasProfile = profileGeom.vertices.length >= 2;
  const zSource: Alignment["zSource"] = hasProfile ? "profile" : hasZCoord ? "coordgeom" : "none";
  const zStatus = zSource === "profile"
    ? `Profil: ${profileGeom.profileName}`
    : zSource === "coordgeom"
    ? "Z aus CoordGeom"
    : "Kein Z";

  return {
    id,
    fileName,
    name,
    displayName: name,
    staStart: displayStaStart,
    staEnd: displayStaEnd,
    length: displayStaEnd - displayStaStart,
    internalStaStart,
    internalStaEnd,
    segments,
    profileGeom,
    stationEquations,
    hasZValues: hasZCoord || hasProfile,
    zSource,
    zStatus,
  };
}

export function parseLandXmlText(
  xmlText: string,
  fileName: string,
  nextIdStart = 0
): ParsedLandXml {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    return { alignments: [], nextId: nextIdStart };
  }

  const root = doc.documentElement;
  const alignmentsEl = firstTag(root, "Alignments") ?? root;
  const alignEls = byTag(alignmentsEl, "Alignment");

  const alignments: Alignment[] = [];
  let nextId = nextIdStart;
  for (const el of alignEls) {
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
