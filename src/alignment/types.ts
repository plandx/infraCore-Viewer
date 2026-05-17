// LandXML coordinate convention: all Start/End/Center nodes are (Northing, Easting[, Elevation])
// We store: x = Easting, y = Northing, z = Elevation (or null when not given)

export interface AlignCoord {
  x: number; // Easting
  y: number; // Northing
  z: number | null; // Elevation
}

export interface BaseSegment {
  staStart: number; // internal station at segment start
  staEnd: number;   // internal station at segment end
  length: number;
  start: AlignCoord;
  end: AlignCoord;
  tangentStartRad: number; // math radians, CCW from East
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
  geomDelta: number; // total sweep angle (positive, always)
  rot: "cw" | "ccw";
  a0: number; // start angle from center (math radians)
}

export interface TransitionSegment extends BaseSegment {
  type: "Transition";
  spiralType: string;
  rot: "cw" | "ccw";
  // signed curvatures at start/end (positive = CCW, negative = CW)
  k0: number; // = 0 for entry from tangent, or ±1/radiusStart
  k1: number; // = ±1/radiusEnd for entry to arc, or 0 for exit to tangent
  typeLabel: string;
}

export type AlignmentSegment = LineSegment | CurveSegment | TransitionSegment;

export interface ProfileVertex {
  type: "PVI" | "ParaCurve" | "CircCurve";
  sta: number;   // display station
  elev: number;
  curveLength: number;
  radius?: number;
}

export interface ProfileCurve {
  model: "parabolic" | "circular";
  bvc: number; // begin vertical curve (display station)
  evc: number; // end vertical curve (display station)
  g1: number;  // incoming grade
  g2: number;  // outgoing grade
  A: number;   // g2 - g1
  length: number;
  yBVC: number; // elevation at BVC
  // circular only:
  radius?: number;
  centerSta?: number; // station of circle center
  centerElev?: number;
  ySign?: number;
}

export interface ProfileTangent {
  startSta: number; // display station
  endSta: number;
  startElev: number;
  grade: number; // m/m (rise over run)
}

export interface ProfileGeometry {
  profileName: string;
  vertices: ProfileVertex[];
  curves: ProfileCurve[];
  tangents: ProfileTangent[];
}

export interface StationEquation {
  staInternal: number;
  staAhead: number;  // display station after the equation
  staBack: number;   // display station before the equation
  delta: number;     // = staAhead - staBack, added to convert internal→display
}

export interface SampledPoint {
  x: number;    // Easting
  y: number;    // Northing
  z: number | null; // Elevation (null = no height info)
  tangentRad: number; // math radians
  station?: number;   // display station
}

export interface Alignment {
  id: number;
  fileName: string;
  name: string;
  displayName: string;
  // All stations in display format:
  staStart: number;
  staEnd: number;
  length: number;
  // Internal stations (differ from display only when StaEquations are present):
  internalStaStart: number;
  internalStaEnd: number;
  segments: AlignmentSegment[];
  profileGeom: ProfileGeometry;
  stationEquations: StationEquation[];
  hasZValues: boolean;
  zSource: "profile" | "coordgeom" | "none";
  zStatus: string;
}

export interface ParsedLandXml {
  alignments: Alignment[];
  nextId: number;
}
