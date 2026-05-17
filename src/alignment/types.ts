export interface AlignCoord {
  x: number;
  y: number;
  z: number | null;
}

export interface BaseSegment {
  staStart: number;
  staEnd: number;
  length: number;
  start: AlignCoord;
  end: AlignCoord;
  tangentStartRad: number;
  tangentEndRad: number;
  typeLabel: string;
}

export interface LineSegment extends BaseSegment {
  type: "Line";
}

export interface CurveSegment extends BaseSegment {
  type: "Curve";
  center: AlignCoord;
  radius: number;
  geomDelta: number;
  rot: "cw" | "ccw";
  a0: number;
}

export interface TransitionSegment extends BaseSegment {
  type: "Transition";
  spiralType: string;
  rot?: "cw" | "ccw";
  radiusStart?: number;
  radiusEnd?: number;
}

export type AlignmentSegment = LineSegment | CurveSegment | TransitionSegment;

export interface ProfileVertex {
  type: string;
  sta: number;
  elev: number;
  curveLength: number;
  radius?: number;
}

export interface ProfileCurve {
  index: number;
  model: "parabolic" | "circular";
  sta: number;
  elev: number;
  length: number;
  bvc: number;
  evc: number;
  g1: number;
  g2: number;
  A: number;
  yBVC: number;
  yEVC: number;
  radius?: number;
  center?: AlignCoord;
  ySign?: number;
}

export interface ProfileTangent {
  index: number;
  startSta: number;
  endSta: number;
  startElev: number;
  grade: number;
}

export interface ProfileGeometry {
  profileName: string;
  vertices: ProfileVertex[];
  curves: ProfileCurve[];
  tangents: ProfileTangent[];
  rawGrades: number[];
}

export interface StationEquation {
  staAhead: number;
  staBack: number;
  staInternal: number;
  delta: number;
}

export interface SampledPoint {
  x: number;
  y: number;
  z: null | number;
  tangentRad: number;
  internalStation?: number;
  station?: number;
}

export interface Alignment {
  id: number;
  fileName: string;
  name: string;
  displayName: string;
  staStart: number;
  staEnd: number;
  internalStaStart: number;
  internalStaEnd: number;
  length: number;
  segments: AlignmentSegment[];
  profileGeom: ProfileGeometry;
  stationEquations: StationEquation[];
  hasZValues: boolean;
  zSource: "profile" | "coordgeom" | "none";
  zStatus: string;
  isMain: boolean;
  isSubAxis: boolean;
  parentId?: number;
  sourceMainName: string;
  offsetH: number;
  offsetX: number;
  offsetTag: string;
}

export interface ParsedLandXml {
  alignments: Alignment[];
  nextId: number;
}
