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

export interface BillingEntry {
  key: string;
  guid: string;
  expressId: number;
  modelId: string;
  elementName: string;
  ifcType: string;
  stages: BillingStage[];
  documents: DocumentRef[];
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
  | { t: "dataSync"; entries: BillingEntry[] };
