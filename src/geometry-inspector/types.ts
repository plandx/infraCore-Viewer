export type PickMode = "face" | "boundary" | "edge";

export interface InspFace {
  id: number;
  area: number;        // m²
  normal: [number, number, number];
  center: [number, number, number];
}

/** All boundary edges of one face grouped as a single selectable unit. */
export interface InspFaceBoundary {
  id: number;          // = faceId (1:1)
  faceId: number;
  totalLength: number; // m
  center: [number, number, number];
  segments: Array<{
    start: [number, number, number];
    end:   [number, number, number];
  }>;
}

/** One individual hard-edge segment. */
export interface InspEdge {
  id: number;
  length: number;      // m
  start: [number, number, number];
  end:   [number, number, number];
}

export interface InspectionSession {
  modelId: string;
  expressId: number;
  elementName: string;
  billingKey: string | null;
  ifcType: string;
}
