import * as THREE from "three";

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

export interface ViewerSettings {
  background: string;
  grid: boolean;
  axes: boolean;
  edges: boolean;
  shadows: boolean;
  fog: boolean;
  logDepthBuffer: boolean;
  clipPlanes: boolean;
  theme: "light" | "dark";
  showSpaces: boolean;
}
