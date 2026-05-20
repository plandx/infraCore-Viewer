import type { SyncState, ColorGroup, ViewerSettings, BasketMode } from "../types/ifc";

export const SYNC_CHANNEL = "infracore-sync";

// ── Message protocol ──────────────────────────────────────────────────────────

export type SyncAction =
  | { k: "select";             modelId: string; expressId: number }
  | { k: "hide";               modelId: string; expressId: number }
  | { k: "showAll" }
  | { k: "isolate";            modelId: string; expressId: number }
  | { k: "colorGroups";        groups: ColorGroup[] | null }
  | { k: "applySmartView";     id: string }
  | { k: "deactivateSmartView" }
  | { k: "settings";           patch: Partial<ViewerSettings> }
  | { k: "fitAll" };

export type SyncMsg =
  | { t: "state"; s: SyncState }  // main → secondaries: full state push
  | { t: "req" }                  // new secondary → main: request current state
  | { t: "act"; a: SyncAction };  // secondary → main: user action

// ── Serialisation ─────────────────────────────────────────────────────────────

/** Produce a structured-clone-safe snapshot of the store's mutable state.
 * Pass `lite = true` to omit elementsByType and spatialTree — used for
 * incremental updates when models haven't changed, saving structured-clone
 * cost on potentially MBs of element data. */
export function serializeState(store: {
  models: Map<string, {
    id: string; name: string; file: File; visible: boolean; color: string;
    opacity: number; size: number;
    elementsByType: Record<string, unknown>;
    spatialTree: unknown;
    status: string;
  }>;
  selectedElement: unknown;
  settings: unknown;
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
  colorGroups: unknown;
  smartViews: unknown;
  activeSmartViewId: string | null;
  loadedPropKeys: string[];
  selectionBasket: Set<string>;
  basketMode: unknown;
  sectionPlanes: unknown;
}, lite = false): SyncState {
  const models: SyncState["models"] = [];
  store.models.forEach((m) => {
    if (m.status === "loaded") {
      models.push({
        id: m.id, name: m.name, file: m.file,
        visible: m.visible, color: m.color, opacity: m.opacity, size: m.size,
        // When lite=true, omit heavy fields — applyRemoteState preserves existing
        elementsByType: lite ? {} : m.elementsByType as SyncState["models"][0]["elementsByType"],
        spatialTree: lite ? null : m.spatialTree as SyncState["models"][0]["spatialTree"],
      });
    }
  });
  return {
    models,
    selectedElement: store.selectedElement as SyncState["selectedElement"],
    settings: store.settings as SyncState["settings"],
    hiddenElements: Array.from(store.hiddenElements),
    isolatedElements: store.isolatedElements ? Array.from(store.isolatedElements) : null,
    colorGroups: store.colorGroups as SyncState["colorGroups"],
    smartViews: store.smartViews as SyncState["smartViews"],
    activeSmartViewId: store.activeSmartViewId,
    loadedPropKeys: store.loadedPropKeys,
    selectionBasket: Array.from(store.selectionBasket),
    basketMode: store.basketMode as BasketMode | null,
    sectionPlanes: store.sectionPlanes as SyncState["sectionPlanes"],
  };
}

// ── Window-open helpers ───────────────────────────────────────────────────────

export const CROSS_SECTION_CHANNEL = "infracore-cross-section";

export type XSSyncLine = { x1: number; y1: number; x2: number; y2: number; color: string; objectKey?: string };
export type XSSyncPolygon = { points: Array<[number, number]>; color: string; objectKey?: string };

/** Label metadata for one IFC element visible in the current cross-section */
export interface XSSyncObjectLabel {
  key: string;                  // "modelId:expressId"
  name: string;                 // element name from elementsByType
  type: string;                 // IFC type (e.g. "IfcWall")
  props: Record<string, string>; // flat loaded properties (string/number only)
}

export interface XSSyncState {
  station: number | null;
  alignmentId: number | null;
  alignmentName: string;
  staStart: number;
  staEnd: number;
  mode: "vertical" | "normal";
  lines: XSSyncLine[];
  polygons: XSSyncPolygon[];
  computing: boolean;
  showSectionSurface: boolean;
  objectLabels: XSSyncObjectLabel[];
  /** Set when using face-based cross-section (no alignment) */
  isFaceSection?: boolean;
  faceOffset?: number;
  theme?: "light" | "dark";
  /** World-Y of the section origin — used for the absolute-elevation right axis */
  elevationOrigin?: number;
}

export type XSMsg =
  | { t: "state"; s: XSSyncState }
  | { t: "req" }
  | { t: "close" }
  | { t: "setStation"; alignmentId: number; station: number }
  | { t: "nextStation"; delta: number }
  | { t: "setMode"; mode: "vertical" | "normal" }
  | { t: "toggleSectionSurface" }
  | { t: "setFaceOffset"; offset: number };

export function openCrossSectionWindow() {
  const url = `${window.location.pathname}?cross-section`;
  window.open(url, "infracore-cross-section", "width=960,height=720,resizable=yes");
}

export type PanelType = "hierarchy" | "properties" | "lists" | "smartviews" | "sql" | "qto" | "basket";

export const PANEL_META: Record<PanelType, { label: string; w: number; h: number }> = {
  hierarchy:  { label: "Hierarchiebaum",      w: 380, h: 700 },
  properties: { label: "Eigenschaften",       w: 420, h: 600 },
  lists:      { label: "Lens Rules",          w: 480, h: 640 },
  smartviews: { label: "SmartViews",          w: 480, h: 680 },
  sql:        { label: "SQL-Abfrage",         w: 760, h: 480 },
  qto:        { label: "Listen / Mengen",     w: 900, h: 640 },
  basket:     { label: "Auswahlkorb",         w: 380, h: 600 },
};

export function openSecondaryWindow(panel: PanelType) {
  const { w, h } = PANEL_META[panel];
  const url = `${window.location.pathname}?secondary&panel=${panel}`;
  window.open(url, `infracore-${panel}`, `width=${w},height=${h},resizable=yes`);
}

export function openBillingWindow() {
  const url = `${window.location.pathname}?billing`;
  window.open(url, "infracore-billing", "width=1100,height=760,resizable=yes");
}

// ── Collision window ──────────────────────────────────────────────────────────

export const COLLISION_CHANNEL = "infracore-collision";

export type ClashStatus = "new" | "approved" | "resolved";
export type Severity = "error" | "warning" | "info";
export type CheckType = "hard-clash" | "clearance" | "duplicate";

export interface PropCondition {
  propName: string;
  operator: "contains" | "equals" | "startsWith" | "notEmpty";
  value: string;
}

export interface ComponentFilter {
  ifcTypes: string[];
  conditions: PropCondition[];
}

export interface ClashRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: Severity;
  checkType: CheckType;
  componentA: ComponentFilter;
  componentB: ComponentFilter;
  tolerance: number;
}

export interface ClashResult {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  checkType: CheckType;
  modelIdA: string; expressIdA: number; nameA: string; typeA: string;
  modelIdB: string; expressIdB: number; nameB: string; typeB: string;
  /** For clearance: gap in metres. For hard-clash/duplicate: 0 (exact volume not computed). */
  overlap: number;
  status: ClashStatus;
  propsA?: Record<string, string>;
  propsB?: Record<string, string>;
}

export interface CollisionSyncState {
  rules: ClashRule[];
  results: ClashResult[];
  running: boolean;
  progress: number;
  allTypes: string[];
  loadedPropKeys: string[];
  theme?: "light" | "dark";
}

export type CollisionMsg =
  | { t: "state"; s: CollisionSyncState }
  | { t: "req" }
  | { t: "run"; rules: ClashRule[] }
  | { t: "setStatus"; key: string; status: ClashStatus }
  | { t: "isolate"; modelIdA: string; expressIdA: number; modelIdB: string; expressIdB: number };

const MEP_TYPES    = ["IfcDuctSegment","IfcPipeSegment","IfcCableCarrierSegment","IfcFlowSegment","IfcDistributionFlowElement","IfcDuctFitting","IfcPipeFitting","IfcFlowController","IfcFlowTerminal"];
const STRUCT_TYPES = ["IfcBeam","IfcColumn","IfcWall","IfcSlab","IfcFoundation","IfcPile","IfcMember"];
const ARCH_TYPES   = ["IfcWall","IfcSlab","IfcRoof","IfcCurtainWall","IfcStair","IfcRamp"];

export const DEFAULT_CLASH_RULES: ClashRule[] = [
  {
    id: "rule-struct-mep",
    name: "Tragwerk / TGA Kollision",
    enabled: true,
    severity: "error",
    checkType: "hard-clash",
    tolerance: 0.0005,
    componentA: { ifcTypes: STRUCT_TYPES, conditions: [] },
    componentB: { ifcTypes: MEP_TYPES,   conditions: [] },
  },
  {
    id: "rule-arch-struct",
    name: "Architektur / Tragwerk Kollision",
    enabled: true,
    severity: "warning",
    checkType: "hard-clash",
    tolerance: 0.001,
    componentA: { ifcTypes: ARCH_TYPES,   conditions: [] },
    componentB: { ifcTypes: STRUCT_TYPES, conditions: [] },
  },
  {
    id: "rule-mep-clearance",
    name: "TGA Mindestabstand (0.3 m)",
    enabled: true,
    severity: "warning",
    checkType: "clearance",
    tolerance: 0.3,
    componentA: { ifcTypes: MEP_TYPES, conditions: [] },
    componentB: { ifcTypes: MEP_TYPES, conditions: [] },
  },
  {
    id: "rule-duplicate",
    name: "Duplikat-Elemente",
    enabled: true,
    severity: "info",
    checkType: "duplicate",
    tolerance: 0.01,
    componentA: { ifcTypes: [], conditions: [] },
    componentB: { ifcTypes: [], conditions: [] },
  },
];

export function openCollisionWindow() {
  const url = `${window.location.pathname}?collision`;
  window.open(url, "infracore-collision", "width=1100,height=780,resizable=yes");
}
