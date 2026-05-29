export type BcfVersion = "2.0" | "2.1" | "3.0";
export type BcfTopicStatus = "Open" | "In Progress" | "Resolved" | "Closed" | "ReOpened";
export type BcfTopicType = "Issue" | "Request" | "Clash" | "IDS" | "Remark" | "Error";
export type BcfPriority = "Critical" | "Major" | "Normal" | "Minor";

export interface BcfViewpoint {
  guid: string;
  cameraPosition?: { x: number; y: number; z: number };
  cameraDirection?: { x: number; y: number; z: number };
  cameraUpVector?: { x: number; y: number; z: number };
  fieldOfView?: number;
  /** IFC GUIDs of selected components (base64-encoded, from BCF spec) */
  selectedIfcGuids?: string[];
  /** Colored component groups */
  coloring?: { color: string; ifcGuids: string[] }[];
}

export interface BcfComment {
  id: string;
  text: string;
  author: string;
  date: string;
  modifiedDate?: string;
  modifiedAuthor?: string;
}

export interface BcfTopic {
  id: string;
  guid: string;
  title: string;
  description?: string;
  status: BcfTopicStatus;
  type: BcfTopicType;
  priority: BcfPriority;
  assignedTo?: string;
  dueDate?: string;
  stage?: string;
  creationDate: string;
  modifiedDate: string;
  creationAuthor: string;
  modifiedAuthor?: string;
  labels: string[];
  comments: BcfComment[];
  /** Base64 PNG data URL of the snapshot */
  snapshot?: string;
  viewpoint?: BcfViewpoint;
  source: "manual" | "ids" | "clash";
  sourceRef?: string;
  relatedExpressIds?: { modelId: string; expressId: number }[];
}

export interface BcfDocument {
  id: string;
  projectName: string;
  topics: BcfTopic[];
}
