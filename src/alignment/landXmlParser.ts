import type {
  AlignCoord,
  AlignmentSegment,
  LineSegment,
  CurveSegment,
  TransitionSegment,
  ProfileVertex,
  ProfileCurve,
  ProfileTangent,
  ProfileGeometry,
  StationEquation,
  SampledPoint,
  Alignment,
  ParsedLandXml,
} from "./types";

const EPS = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function dist2D(a: AlignCoord, b: AlignCoord): number {
  return Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
}

function normalizeAngleRad(value: number): number {
  let r = value;
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

function xmlChildren(node: Element | null | undefined): Element[] {
  return Array.from(node?.children || []);
}

function allByLocalName(node: Element | null | undefined, localName: string): Element[] {
  return xmlChildren(node).filter(c => c.localName === localName);
}

function firstByLocalName(node: Element | null | undefined, localName: string): Element | null {
  return xmlChildren(node).find(c => c.localName === localName) || null;
}

function getAttrNum(el: Element | null | undefined, name: string, fallback: number | null = null): number | null {
  const raw = el?.getAttribute?.(name);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const num = Number(String(raw).replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

function parseCoordText(text: string | null | undefined): AlignCoord | null {
  if (!text) return null;
  const values = text
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);
  if (values.length < 2) return null;
  return { y: values[0], x: values[1], z: values.length >= 3 ? values[2] : null };
}

function parseCoordNode(parent: Element | null | undefined, name: string): AlignCoord | null {
  const node = firstByLocalName(parent, name);
  return node ? parseCoordText(node.textContent) : null;
}

function lineDirectionFromPoints(
  start: AlignCoord | null,
  end: AlignCoord | null,
  fallbackRad = 0
): number {
  if (!start || !end) return fallbackRad;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) <= EPS && Math.abs(dy) <= EPS) return fallbackRad;
  return Math.atan2(dy, dx);
}

function xmlDirectionToMathRad(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return normalizeAngleRad((Math.PI / 2) - (value * Math.PI) / 180);
}

function xmlAngleDeltaToRad(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.abs(value) * (Math.PI / 180);
}

export function stationInternalToDisplay(
  stationEquations: StationEquation[],
  internalStation: number
): number {
  let station = internalStation;
  for (const eq of stationEquations || []) {
    if (internalStation >= eq.staInternal - 1e-9) station += eq.delta;
  }
  return station;
}

export function stationDisplayToInternal(
  stationEquations: StationEquation[],
  displayStation: number
): number {
  let cumulativeDelta = 0;
  for (const eq of stationEquations || []) {
    const displayThreshold = eq.staInternal + cumulativeDelta;
    if (displayStation >= displayThreshold - 1e-9) cumulativeDelta += eq.delta;
  }
  return displayStation - cumulativeDelta;
}

function inferRotationFromPoints(
  center: AlignCoord,
  start: AlignCoord,
  end: AlignCoord
): "cw" | "ccw" {
  const cross =
    (start.x - center.x) * (end.y - center.y) -
    (start.y - center.y) * (end.x - center.x);
  return cross < 0 ? "cw" : "ccw";
}

function inferCurveCenterFromGeometry(
  start: AlignCoord,
  end: AlignCoord,
  radius: number,
  rot: "cw" | "ccw",
  dirStartRad: number | null = null
): AlignCoord | null {
  const chord = dist2D(start, end);
  if (!(Number.isFinite(radius) && radius > chord / 2)) return null;
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const halfChord = chord / 2;
  const offset = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const chordAngle = Math.atan2(end.y - start.y, end.x - start.x);
  let nx = -Math.sin(chordAngle);
  let ny = Math.cos(chordAngle);
  if (Number.isFinite(dirStartRad!)) {
    const tangent = { x: Math.cos(dirStartRad!), y: Math.sin(dirStartRad!) };
    const centerLeft = { x: midX + nx * offset, y: midY + ny * offset };
    const radialLeft = { x: centerLeft.x - start.x, y: centerLeft.y - start.y };
    const crossLeft = tangent.x * radialLeft.y - tangent.y * radialLeft.x;
    const expectedPositive = rot !== "cw";
    if (crossLeft > 0 !== expectedPositive) {
      nx *= -1;
      ny *= -1;
    }
  } else if (rot === "cw") {
    nx *= -1;
    ny *= -1;
  }
  return { x: midX + nx * offset, y: midY + ny * offset, z: null };
}

function parseLineSegment(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTangentRad: number
): LineSegment | null {
  const lenAttr = getAttrNum(el, "length");
  const start = parseCoordNode(el, "Start") || prevEnd;
  const end = parseCoordNode(el, "End");
  if (!start || !end) return null;
  const length = lenAttr ?? dist2D(start, end);
  if (length < EPS) return null;
  const dirAttrRaw = getAttrNum(el, "dir");
  const tangentStartRad =
    dirAttrRaw !== null
      ? xmlDirectionToMathRad(dirAttrRaw) ?? lineDirectionFromPoints(start, end, prevTangentRad)
      : lineDirectionFromPoints(start, end, prevTangentRad);
  const tangentEndRad = lineDirectionFromPoints(start, end, tangentStartRad);
  return {
    type: "Line",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    tangentStartRad,
    tangentEndRad,
    typeLabel: "Gerade",
  };
}

function parseCurveSegment(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTangentRad: number
): CurveSegment | null {
  const lenAttr = getAttrNum(el, "length");
  const radius = getAttrNum(el, "radius") ?? getAttrNum(el, "rot");
  const rot: "cw" | "ccw" =
    (el.getAttribute("rot") || "ccw").toLowerCase() === "cw" ? "cw" : "ccw";
  const start = parseCoordNode(el, "Start") || prevEnd;
  const end = parseCoordNode(el, "End");
  let center = parseCoordNode(el, "Center");
  if (!start || !end) return null;
  const realRadius = getAttrNum(el, "radius") ?? (center ? dist2D(start, center) : null);
  if (!realRadius || realRadius < EPS) return null;
  const length = lenAttr ?? (realRadius * (getAttrNum(el, "delta") ?? 0) * (Math.PI / 180));
  if (!center) {
    center = inferCurveCenterFromGeometry(start, end, realRadius, rot, prevTangentRad);
  }
  if (!center) return null;
  const inferredRot = inferRotationFromPoints(center, start, end);
  const actualRot: "cw" | "ccw" =
    el.getAttribute("rot") ? rot : inferredRot;
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const dirXmlRaw = getAttrNum(el, "dir");
  const tangentStartRad =
    dirXmlRaw !== null
      ? xmlDirectionToMathRad(dirXmlRaw) ?? prevTangentRad
      : prevTangentRad;
  const deltaAttr = getAttrNum(el, "delta");
  let geomDelta: number;
  if (deltaAttr !== null) {
    geomDelta = xmlAngleDeltaToRad(deltaAttr) ?? 0;
  } else {
    const chord = dist2D(start, end);
    geomDelta = 2 * Math.asin(clamp(chord / (2 * realRadius), -1, 1));
  }
  const sign = actualRot === "cw" ? -1 : 1;
  const tangentEndRad = normalizeAngleRad(tangentStartRad + sign * geomDelta);
  const realLength = lenAttr ?? realRadius * geomDelta;
  return {
    type: "Curve",
    staStart,
    staEnd: staStart + realLength,
    length: realLength,
    start,
    end,
    center,
    radius: realRadius,
    geomDelta,
    rot: actualRot,
    a0,
    tangentStartRad,
    tangentEndRad,
    typeLabel: "Bogen",
  };
}

function parseTransitionSegment(
  el: Element,
  staStart: number,
  prevEnd: AlignCoord | null,
  prevTangentRad: number
): TransitionSegment | null {
  const lenAttr = getAttrNum(el, "length");
  const start = parseCoordNode(el, "Start") || prevEnd;
  const end = parseCoordNode(el, "End");
  if (!start || !end) return null;
  const length = lenAttr ?? dist2D(start, end);
  if (length < EPS) return null;
  const spiralType = el.getAttribute("spiralType") || "clothoid";
  const dirXmlRaw = getAttrNum(el, "dirStart") ?? getAttrNum(el, "dir");
  const tangentStartRad =
    dirXmlRaw !== null
      ? xmlDirectionToMathRad(dirXmlRaw) ?? lineDirectionFromPoints(start, end, prevTangentRad)
      : lineDirectionFromPoints(start, end, prevTangentRad);
  const dirEndRaw = getAttrNum(el, "dirEnd");
  const tangentEndRad =
    dirEndRaw !== null
      ? xmlDirectionToMathRad(dirEndRaw) ?? tangentStartRad
      : tangentStartRad;
  return {
    type: "Transition",
    staStart,
    staEnd: staStart + length,
    length,
    start,
    end,
    spiralType,
    tangentStartRad,
    tangentEndRad,
    typeLabel: "Spirale",
  };
}

function parseProfileGeometry(alignEl: Element): ProfileGeometry {
  const emptyResult: ProfileGeometry = {
    profileName: "",
    vertices: [],
    curves: [],
    tangents: [],
    rawGrades: [],
  };

  const profAlignEl = firstByLocalName(firstByLocalName(alignEl, "Profile"), "ProfAlign");
  if (profAlignEl) {
    const profileName =
      profAlignEl.getAttribute("name") ||
      firstByLocalName(alignEl, "Profile")?.getAttribute("name") ||
      "";
    const vertices: ProfileVertex[] = [];
    const curves: ProfileCurve[] = [];

    for (const child of xmlChildren(profAlignEl)) {
      const ln = child.localName;
      if (ln === "PVI") {
        const text = child.textContent?.trim();
        if (text) {
          const parts = text.split(/\s+/).map(Number);
          if (parts.length >= 2) {
            vertices.push({
              type: "PVI",
              sta: parts[0],
              elev: parts[1],
              curveLength: parts[2] ?? 0,
            });
          }
        }
      } else if (ln === "ParaCurve" || ln === "CircCurve") {
        const staAttr = getAttrNum(child, "sta");
        const elevAttr = getAttrNum(child, "elev");
        const lenAttr = getAttrNum(child, "length") ?? getAttrNum(child, "len");
        if (staAttr !== null && elevAttr !== null && lenAttr !== null) {
          vertices.push({
            type: ln === "ParaCurve" ? "ParaCurve" : "CircCurve",
            sta: staAttr,
            elev: elevAttr,
            curveLength: lenAttr,
            radius: getAttrNum(child, "radius") ?? undefined,
          });
        }
      }
    }

    if (vertices.length < 2) return emptyResult;

    const rawGrades: number[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const dSta = vertices[i + 1].sta - vertices[i].sta;
      const dElev = vertices[i + 1].elev - vertices[i].elev;
      rawGrades.push(dSta > EPS ? dElev / dSta : 0);
    }

    const tangents: ProfileTangent[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      tangents.push({
        index: i,
        startSta: vertices[i].sta,
        endSta: vertices[i + 1].sta,
        startElev: vertices[i].elev,
        grade: rawGrades[i],
      });
    }

    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (v.curveLength > EPS) {
        const g1 = i > 0 ? rawGrades[i - 1] : 0;
        const g2 = i < rawGrades.length ? rawGrades[i] : 0;
        const halfLen = v.curveLength / 2;
        const bvc = v.sta - halfLen;
        const evc = v.sta + halfLen;
        const yBVC = v.elev - g1 * halfLen;
        const yEVC = v.elev + g2 * halfLen;
        const A = g2 - g1;
        const isCirc = v.type === "CircCurve";
        curves.push({
          index: curves.length,
          model: isCirc ? "circular" : "parabolic",
          sta: v.sta,
          elev: v.elev,
          length: v.curveLength,
          bvc,
          evc,
          g1,
          g2,
          A,
          yBVC,
          yEVC,
          radius: v.radius,
          center: isCirc && v.radius !== undefined
            ? { x: v.sta, y: v.elev + (A < 0 ? v.radius : -v.radius), z: null }
            : undefined,
          ySign: isCirc ? (A < 0 ? 1 : -1) : undefined,
        });
      }
    }

    return { profileName, vertices, curves, tangents, rawGrades };
  }

  const profSurfEl =
    firstByLocalName(firstByLocalName(alignEl, "Profile"), "ProfSurf") ||
    firstByLocalName(firstByLocalName(alignEl, "Profile"), "PntList2D");

  if (profSurfEl) {
    const pntListEl =
      profSurfEl.localName === "PntList2D"
        ? profSurfEl
        : firstByLocalName(profSurfEl, "PntList2D");
    if (!pntListEl) return emptyResult;
    const text = pntListEl.textContent?.trim() || "";
    const nums = text.split(/\s+/).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return emptyResult;
    const vertices: ProfileVertex[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      vertices.push({ type: "PVI", sta: nums[i], elev: nums[i + 1], curveLength: 0 });
    }
    if (vertices.length < 2) return emptyResult;
    const rawGrades: number[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const dSta = vertices[i + 1].sta - vertices[i].sta;
      const dElev = vertices[i + 1].elev - vertices[i].elev;
      rawGrades.push(dSta > EPS ? dElev / dSta : 0);
    }
    const tangents: ProfileTangent[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      tangents.push({
        index: i,
        startSta: vertices[i].sta,
        endSta: vertices[i + 1].sta,
        startElev: vertices[i].elev,
        grade: rawGrades[i],
      });
    }
    const profileName =
      profSurfEl.getAttribute("name") ||
      firstByLocalName(alignEl, "Profile")?.getAttribute("name") ||
      "Surface";
    return { profileName, vertices, curves: [], tangents, rawGrades };
  }

  return emptyResult;
}

export function evaluateProfile(profileGeom: ProfileGeometry, station: number): number | null {
  if (!profileGeom || profileGeom.vertices.length < 2) return null;
  const { vertices, curves, tangents } = profileGeom;
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (station < first.sta - EPS) {
    if (tangents.length > 0) {
      const t = tangents[0];
      return t.startElev + t.grade * (station - t.startSta);
    }
    return null;
  }
  if (station > last.sta + EPS) {
    if (tangents.length > 0) {
      const t = tangents[tangents.length - 1];
      return t.startElev + t.grade * (station - t.startSta);
    }
    return null;
  }

  for (const curve of curves) {
    if (station >= curve.bvc - EPS && station <= curve.evc + EPS) {
      const x = station - curve.bvc;
      if (curve.model === "parabolic") {
        return curve.yBVC + curve.g1 * x + (curve.A / (2 * curve.length)) * x * x;
      } else if (curve.model === "circular" && curve.radius !== undefined && curve.center) {
        const r = curve.radius;
        const dSta = station - curve.center.x;
        const inner = r * r - dSta * dSta;
        if (inner < 0) {
          return curve.yBVC + curve.g1 * x + (curve.A / (2 * curve.length)) * x * x;
        }
        return curve.center.y + (curve.ySign ?? 1) * Math.sqrt(inner);
      }
    }
  }

  for (const t of tangents) {
    if (station >= t.startSta - EPS && station <= t.endSta + EPS) {
      return t.startElev + t.grade * (station - t.startSta);
    }
  }
  return null;
}

function sampleSegment(seg: AlignmentSegment, t: number): SampledPoint {
  t = clamp(t, 0, 1);
  if (seg.type === "Line") {
    const x = lerp(seg.start.x, seg.end.x, t);
    const y = lerp(seg.start.y, seg.end.y, t);
    const z =
      seg.start.z !== null && seg.end.z !== null
        ? lerp(seg.start.z, seg.end.z, t)
        : null;
    return { x, y, z, tangentRad: seg.tangentStartRad };
  }
  if (seg.type === "Curve") {
    const sign = seg.rot === "cw" ? -1 : 1;
    const angle = seg.a0 + sign * t * seg.geomDelta;
    const x = seg.center.x + seg.radius * Math.cos(angle);
    const y = seg.center.y + seg.radius * Math.sin(angle);
    const tangentRad = normalizeAngleRad(angle + sign * (Math.PI / 2));
    const z =
      seg.start.z !== null && seg.end.z !== null
        ? lerp(seg.start.z, seg.end.z, t)
        : null;
    return { x, y, z, tangentRad };
  }
  if (seg.type === "Transition") {
    const p0x = seg.start.x;
    const p0y = seg.start.y;
    const p1x = seg.end.x;
    const p1y = seg.end.y;
    const t0x = Math.cos(seg.tangentStartRad) * seg.length;
    const t0y = Math.sin(seg.tangentStartRad) * seg.length;
    const t1x = Math.cos(seg.tangentEndRad) * seg.length;
    const t1y = Math.sin(seg.tangentEndRad) * seg.length;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const x = h00 * p0x + h10 * t0x + h01 * p1x + h11 * t1x;
    const y = h00 * p0y + h10 * t0y + h01 * p1y + h11 * t1y;
    const tangentRad = normalizeAngleRad(lerp(seg.tangentStartRad, seg.tangentEndRad, t));
    const z =
      seg.start.z !== null && seg.end.z !== null
        ? lerp(seg.start.z, seg.end.z, t)
        : null;
    return { x, y, z, tangentRad };
  }
  const _: never = seg;
  void _;
  return { x: 0, y: 0, z: null, tangentRad: 0 };
}

function findSegmentForStation(
  segments: AlignmentSegment[],
  internalStation: number
): { seg: AlignmentSegment; t: number } | null {
  for (const seg of segments) {
    if (internalStation >= seg.staStart - EPS && internalStation <= seg.staEnd + EPS) {
      const t = seg.length > EPS ? (internalStation - seg.staStart) / seg.length : 0;
      return { seg, t: clamp(t, 0, 1) };
    }
  }
  if (segments.length > 0) {
    if (internalStation < segments[0].staStart) {
      return { seg: segments[0], t: 0 };
    }
    const last = segments[segments.length - 1];
    if (internalStation > last.staEnd) {
      return { seg: last, t: 1 };
    }
  }
  return null;
}

function sampleAtInternalStation(
  alignment: Alignment,
  internalStation: number
): SampledPoint | null {
  if (alignment.segments.length === 0) return null;
  const found = findSegmentForStation(alignment.segments, internalStation);
  if (!found) return null;
  const pt = sampleSegment(found.seg, found.t);
  if (alignment.zSource === "profile" && alignment.profileGeom.vertices.length >= 2) {
    const displaySta = stationInternalToDisplay(alignment.stationEquations, internalStation);
    const elev = evaluateProfile(alignment.profileGeom, displaySta);
    pt.z = elev;
  }
  pt.internalStation = internalStation;
  pt.station = stationInternalToDisplay(alignment.stationEquations, internalStation);
  return pt;
}

export function sampleAtDisplayStation(
  alignment: Alignment,
  displayStation: number
): SampledPoint | null {
  const internalStation = stationDisplayToInternal(alignment.stationEquations, displayStation);
  return sampleAtInternalStation(alignment, internalStation);
}

function parseStationEquations(alignEl: Element): StationEquation[] {
  const eqs: StationEquation[] = [];
  for (const eq of allByLocalName(alignEl, "StaEquation")) {
    const staAhead = getAttrNum(eq, "staAhead");
    const staBack = getAttrNum(eq, "staBack");
    const staInternal = getAttrNum(eq, "staInternal");
    if (staAhead === null || staBack === null) continue;
    const internalVal = staInternal ?? staBack;
    eqs.push({
      staAhead,
      staBack,
      staInternal: internalVal,
      delta: staAhead - staBack,
    });
  }
  return eqs;
}

function parseAlignment(
  alignEl: Element,
  fileName: string,
  id: number,
  colors: string[]
): Alignment | null {
  const name = alignEl.getAttribute("name") || `Alignment_${id}`;
  const staStartAttr = getAttrNum(alignEl, "staStart");
  const staEndAttr = getAttrNum(alignEl, "staEnd") ?? getAttrNum(alignEl, "length");
  const stationEquations = parseStationEquations(alignEl);
  const profileGeom = parseProfileGeometry(alignEl);
  const coordGeomEl = firstByLocalName(alignEl, "CoordGeom");
  const segments: AlignmentSegment[] = [];
  let cursor: AlignCoord | null = null;
  let prevTangentRad = 0;
  let runningStation = staStartAttr ?? 0;

  if (coordGeomEl) {
    for (const child of xmlChildren(coordGeomEl)) {
      const ln = child.localName;
      let seg: AlignmentSegment | null = null;
      if (ln === "Line") {
        seg = parseLineSegment(child, runningStation, cursor, prevTangentRad);
      } else if (ln === "Curve") {
        seg = parseCurveSegment(child, runningStation, cursor, prevTangentRad);
      } else if (ln === "Spiral") {
        seg = parseTransitionSegment(child, runningStation, cursor, prevTangentRad);
      }
      if (seg) {
        segments.push(seg);
        cursor = seg.end;
        prevTangentRad = seg.tangentEndRad;
        runningStation = seg.staEnd;
      }
    }
  }

  if (segments.length === 0) {
    const pntListEl = firstByLocalName(firstByLocalName(alignEl, "CoordGeom"), "PntList3D") ||
      firstByLocalName(firstByLocalName(alignEl, "CoordGeom"), "IrregularLine");
    if (pntListEl) {
      const text = pntListEl.textContent?.trim() || "";
      const nums = text.split(/\s+/).map(Number).filter(Number.isFinite);
      const step = nums.length % 3 === 0 ? 3 : 2;
      for (let i = 0; i + step - 1 < nums.length; i += step) {
        const pt: AlignCoord =
          step === 3
            ? { y: nums[i], x: nums[i + 1], z: nums[i + 2] }
            : { y: nums[i], x: nums[i + 1], z: null };
        if (cursor) {
          const seg: LineSegment = {
            type: "Line",
            staStart: runningStation,
            staEnd: runningStation + dist2D(cursor, pt),
            length: dist2D(cursor, pt),
            start: cursor,
            end: pt,
            tangentStartRad: lineDirectionFromPoints(cursor, pt, prevTangentRad),
            tangentEndRad: lineDirectionFromPoints(cursor, pt, prevTangentRad),
            typeLabel: "Gerade",
          };
          if (seg.length > EPS) {
            segments.push(seg);
            prevTangentRad = seg.tangentEndRad;
            runningStation = seg.staEnd;
          }
        }
        cursor = pt;
      }
    }
  }

  const internalStaStart = staStartAttr ?? (segments[0]?.staStart ?? 0);
  const internalStaEnd =
    staEndAttr !== null
      ? staStartAttr !== null
        ? staStartAttr + staEndAttr
        : staEndAttr
      : segments[segments.length - 1]?.staEnd ?? internalStaStart;

  const displayStaStart = stationInternalToDisplay(stationEquations, internalStaStart);
  const displayStaEnd = stationInternalToDisplay(stationEquations, internalStaEnd);

  const hasZCoord = segments.some(s => s.start.z !== null || s.end.z !== null);
  const hasProfile = profileGeom.vertices.length >= 2;
  const zSource: "profile" | "coordgeom" | "none" = hasProfile
    ? "profile"
    : hasZCoord
    ? "coordgeom"
    : "none";
  const zStatus =
    zSource === "profile"
      ? `Profil: ${profileGeom.profileName}`
      : zSource === "coordgeom"
      ? "Z aus CoordGeom"
      : "Kein Z";

  const desc = alignEl.getAttribute("desc") || "";
  const isSubAxis =
    desc.toLowerCase().includes("sub") ||
    name.toLowerCase().includes("sub") ||
    name.toLowerCase().includes("offset") ||
    name.toLowerCase().includes("nebenachse");

  return {
    id,
    fileName,
    name,
    displayName: name,
    staStart: displayStaStart,
    staEnd: displayStaEnd,
    internalStaStart,
    internalStaEnd,
    length: displayStaEnd - displayStaStart,
    segments,
    profileGeom,
    stationEquations,
    hasZValues: hasZCoord || hasProfile,
    zSource,
    zStatus,
    isMain: !isSubAxis,
    isSubAxis,
    parentId: undefined,
    sourceMainName: "",
    offsetH: 0,
    offsetX: 0,
    offsetTag: "",
  };

  void colors;
}

export function parseLandXmlText(
  xmlText: string,
  fileName: string,
  nextIdStart = 0
): ParsedLandXml {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    console.warn("LandXML parse error:", parseError.textContent);
    return { alignments: [], nextId: nextIdStart };
  }

  const root = doc.documentElement;
  const alignmentsEl =
    firstByLocalName(root, "Alignments") ||
    root;

  const alignEls = allByLocalName(alignmentsEl, "Alignment");
  const alignments: Alignment[] = [];
  let nextId = nextIdStart;

  for (const alignEl of alignEls) {
    const align = parseAlignment(alignEl, fileName, nextId, []);
    if (align) {
      alignments.push(align);
      nextId++;
    }
  }

  return { alignments, nextId };
}

export function generateStationSeries(alignment: Alignment, interval: number): number[] {
  if (interval <= 0) return [];
  const series: number[] = [];
  const start = Math.ceil(alignment.staStart / interval) * interval;
  for (let sta = start; sta <= alignment.staEnd + EPS; sta += interval) {
    series.push(sta);
  }
  if (series.length === 0 || Math.abs(series[series.length - 1] - alignment.staEnd) > EPS) {
    series.push(alignment.staEnd);
  }
  return series;
}
