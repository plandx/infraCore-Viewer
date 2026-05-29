export type BcfVersion = "2.0" | "2.1" | "3.0";
export type BcfTopicStatus = "Open" | "In Progress" | "Resolved" | "Closed" | "ReOpened";
export type BcfTopicType = "Issue" | "Request" | "Clash" | "IDS" | "Remark" | "Error";
export type BcfPriority = "Critical" | "Major" | "Normal" | "Minor";

export interface BcfComment {
  id: string;
  text: string;
  author: string;
  date: string;
  modifiedDate?: string;
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
  creationDate: string;
  modifiedDate: string;
  creationAuthor: string;
  labels: string[];
  comments: BcfComment[];
  source: "manual" | "ids" | "clash";
  sourceRef?: string;
  relatedExpressIds?: { modelId: string; expressId: number }[];
}

export interface BcfDocument {
  id: string;
  projectName: string;
  topics: BcfTopic[];
}
