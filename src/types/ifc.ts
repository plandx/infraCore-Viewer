import * as THREE from "three";

export type ActiveTool = "select" | "measure" | "section";

// ── SmartViews ────────────────────────────────────────────────────────────────

/** Flat property bag for one element: direct IFC attrs + "PsetName.PropName" keys */
export type FlatElementProps = Record<string, unknown>;

export type SmartCondition =
  | "eq" | "neq"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "gt" | "lt" | "gte" | "lte"
  | "is_true" | "is_false"
  | "exists" | "not_exists";

export type SmartAction = "show" | "hide" | "color";

export interface SmartRule {
  id: string;
  property: string;    // e.g. "_type", "Name", "Pset_WallCommon.IsExternal"
  condition: SmartCondition;
  value: string;       // ignored for exists / not_exists / is_true / is_false
}

export interface SmartView {
  id: string;
  name: string;
  rules: SmartRule[];
  logic: "AND" | "OR";
  action: SmartAction;
  color: string;       // hex, used when action === "color"
}

export interface Measurement {
  id: string;
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  distance: number;
}

export interface SpatialNode {
  expressId: number;
  type: string;
  name: string;
  children: SpatialNode[];
  /** Leaf elements contained at this level (not further subdivided) */
  elements?: ElementNode[];
}

export interface ElementNode {
  expressId: number;
  type: string;
  name: string;
}

export interface IFCModelEntry {
  id: string;
  name: string;
  file: File;
  mesh: THREE.Group;
  visible: boolean;
  color: string;
  opacity: number;
  boundingBox: THREE.Box3;
  /** World-space origin offset applied to keep coordinates near origin */
  originOffset: THREE.Vector3;
  properties: Record<number, IFCProperties>;
  /** Full spatial structure tree (Site > Building > Storey > ...) */
  spatialTree: SpatialNode | null;
  /** All elements grouped by IFC type */
  elementsByType: Record<string, ElementNode[]>;
  loadedAt: Date;
  size: number;
  status: "loading" | "loaded" | "error";
  error?: string;
}

export interface IFCProperties {
  expressId: number;
  type: string;
  [key: string]: unknown;
}

export interface ModelStats {
  totalModels: number;
  totalVertices: number;
  visibleModels: number;
  sceneExtent: THREE.Box3;
}

export interface SQLQueryResult {
  columns: string[];
  rows: unknown[][];
  error?: string;
  executionTime: number;
}

export interface SelectedElement {
  modelId: string;
  expressId: number;
  properties: Record<string, unknown>;
  psets: PropertySet[];
}

export interface PropertySet {
  name: string;
  properties: { name: string; value: unknown; type: string }[];
}

export interface ColorGroupEntry {
  modelId: string;
  expressId: number;
}

export interface ColorGroup {
  id: string;
  label: string;
  color: string;
  entries: ColorGroupEntry[];
  visible: boolean;
}

export interface ViewerSettings {
  background: string;
  grid: boolean;
  axes: boolean;
  edges: boolean;
  shadows: boolean;
  fog: boolean;
  logDepthBuffer: boolean;
  clipPlanes: boolean;
  /** Unit normal of the clip plane (world space) */
  clipNormal: [number, number, number];
  /** A point on the clip plane (world space, used as visual center) */
  clipPoint: [number, number, number];
  theme: "light" | "dark";
  showSpaces: boolean;
  orthographic: boolean;
}
