import * as THREE from "three";

export type ActiveTool = "select" | "measure" | "section";

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
