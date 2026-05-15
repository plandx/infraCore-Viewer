export type PickMode = "face" | "edge";

export interface InspFace {
  id: number;
  area: number;        // m²
  normal: [number, number, number];
  center: [number, number, number];
}

export interface InspEdge {
  id: number;
  length: number;      // m
  start: [number, number, number];
  end: [number, number, number];
}

export interface InspectionSession {
  modelId: string;
  expressId: number;
  elementName: string;
  billingKey: string | null;
}
