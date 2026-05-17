import * as THREE from "three";

export type ActiveTool = "select" | "measure" | "section";
export type BasketMode = "highlight" | "ghost" | "isolate";

/** A single property override: edited value + optional IFC type code override */
export interface PropOverride {
  value: string;
  /** web-ifc numeric type code (1=LABEL, 14=REAL, 16=INTEGER, 18=BOOLEAN, …) */
  ifcType?: number;
}

// ── SmartViews ────────────────────────────────────────────────────────────────

/** Flat property bag for one element: direct IFC attrs + "PsetName.PropName" keys */
export type FlatElementProps = Record<string, unknown>;

export type SmartCondition =
  | "eq" | "neq"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "gt" | "lt" | "gte" | "lte"
  | "is_true" | "is_false"
  | "exists" | "not_exists";

export type TierAction =
  | "add"               // Hinzufügen — show matched (remove from hidden)
  | "remove"            // Entfernen — hide matched
  | "removeOthers"      // Andere entfernen — hide all non-matched
  | "color"             // Farbig einstellen — apply flat color
  | "transparent"       // Durchsichtig einstellen — apply color at low opacity
  | "opaque"            // Undurchsichtig einstellen — apply color at full opacity
  | "autoColor"         // Auto-Farbe — group by key, palette colors
  | "addAndColor"       // Hinzufügen + Einfärben
  | "addAndTransparent" // Hinzufügen + Durchsichtig
  | "addAndAutoColor";  // Hinzufügen + Auto-Farbe

export interface SmartRule {
  id: string;
  property: string;    // e.g. "_type", "Name", "Pset_WallCommon.IsExternal"
  condition: SmartCondition;
  value: string;       // ignored for exists / not_exists / is_true / is_false
}

export interface SmartTier {
  id: string;
  name: string;
  rules: SmartRule[];
  logic: "AND" | "OR";
  action: TierAction;
  color: string;        // hex, used for color/transparent/opaque/addAnd* actions
  colorByKey: string;   // property key, used for autoColor / addAndAutoColor
  opacity: number;      // 0–1, used for transparent / addAndTransparent (default 0.15)
}

export interface SmartView {
  id: string;
  name: string;
  tiers: SmartTier[];
}

// Keep SmartAction as alias for backward compat with any remaining refs
export type SmartAction = TierAction;

// ── Multi-window sync ──────────────────────────────────────────────────────────

/** Serialisable model snapshot (no Three.js objects) */
export interface SyncModel {
  id: string;
  name: string;
  file: File;          // File is structured-clone-able → safe over BroadcastChannel
  visible: boolean;
  color: string;
  opacity: number;
  size: number;
  elementsByType: Record<string, ElementNode[]>;
  spatialTree: SpatialNode | null;
}

export interface SectionPlane {
  id: string;
  name: string;
  /** Unit normal pointing toward the visible side */
  normal: [number, number, number];
  /** A world-space point on the plane */
  point: [number, number, number];
  enabled: boolean;
  color: string;
  /** When set, this plane belongs to a box-section group with this shared UUID */
  boxId?: string;
}

export interface SyncState {
  models: SyncModel[];
  selectedElement: SelectedElement | null;
  settings: ViewerSettings;
  hiddenElements: string[];
  isolatedElements: string[] | null;
  colorGroups: ColorGroup[] | null;
  smartViews: SmartView[];
  activeSmartViewId: string | null;
  loadedPropKeys: string[];
  selectionBasket: string[];    // "modelId:expressId"
  basketMode: BasketMode | null;
  sectionPlanes: SectionPlane[];
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
  guid?: string;
}

export interface IFCHeader {
  schema: string;
  authors: string[];
  organizations: string[];
  preprocessor: string;
  timestamp: string;
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
  header?: IFCHeader;
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
  opacity?: number;   // if < 1 renders semi-transparent; omit or 1 = fully opaque
}

export interface ViewerSettings {
  background: string;
  grid: boolean;
  axes: boolean;
  edges: boolean;
  shadows: boolean;
  fog: boolean;
  logDepthBuffer: boolean;
  theme: "light" | "dark";
  showSpaces: boolean;
  orthographic: boolean;
}

// ── Quantity Take-Off Lists ───────────────────────────────────────────────────

export interface QTOFilter {
  id: string;
  key: string;           // property key: "_type", "Name", "Pset_WallCommon.IsExternal"
  condition: SmartCondition;
  value: string;
}

export interface QTOColumn {
  id: string;
  key: string;
  label: string;         // user-defined display name
}

export interface QTOList {
  id: string;
  name: string;
  filters: QTOFilter[];
  filterLogic: "AND" | "OR";
  columns: QTOColumn[];
}
