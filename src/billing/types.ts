export interface BillingStage {
  id: string;
  label: string;
  date: string;
  degree: number;
  note: string;
}

export interface DocumentRef {
  id: string;
  docId: string;
  title: string;
  url: string;
}

// ── Legacy quantities (kept for backward compat with requestQuantities flow) ─

export interface ElementQuantities {
  volume: number;       // m³
  surfaceArea: number;  // m²
  bboxX: number;        // size X  m
  bboxY: number;        // size Y  m
  bboxZ: number;        // size Z  m
  bboxCenterX?: number; // world-space center
  bboxCenterY?: number;
  bboxCenterZ?: number;
  computedAt: string;
}

// ── Element identity fingerprint ─────────────────────────────────────────────

export interface ElementIdentity {
  guid: string;
  bboxCenterX: number;
  bboxCenterY: number;
  bboxCenterZ: number;
  bboxSizeX: number;
  bboxSizeY: number;
  bboxSizeZ: number;
  volume: number;
  capturedAt: string;
}

// ── Extended quantity model ──────────────────────────────────────────────────

export type { QuantityType, QuantityUnit, QuantitySource, QuantityItem, QuantitySet }
  from "./quantityTypes";

// ── Billing entry ────────────────────────────────────────────────────────────

export interface BillingEntry {
  key: string;
  guid: string;
  expressId: number;
  modelId: string;
  elementName: string;
  ifcType: string;
  stages: BillingStage[];
  documents: DocumentRef[];
  quantities?: ElementQuantities;   // legacy
  quantitySet?: import("./quantityTypes").QuantitySet;  // extended
  identity?: ElementIdentity;       // tamper-detection fingerprint
  createdAt: string;
}

export interface BillingExport {
  version: 1;
  exportedAt: string;
  entries: BillingEntry[];
}

export interface ElementInfo {
  key: string;
  guid: string;
  expressId: number;
  modelId: string;
  name: string;
  ifcType: string;
}

export type BillingMsg =
  | { t: "ready" }
  | { t: "elements"; list: ElementInfo[] }
  | { t: "moduleActive"; active: boolean }
  | { t: "dataSync"; entries: BillingEntry[] }
  | { t: "isolateTracked" }
  | { t: "selectEntry"; key: string }
  | { t: "requestQuantities"; key: string }
  | { t: "quantities"; key: string; data: ElementQuantities | null }
  | { t: "requestIfcQuantities"; key: string }
  | { t: "ifcQuantities"; key: string; items: import("./quantityTypes").QuantityItem[] | null }
  | { t: "startInspection"; key: string; elementName: string };
