import { unzipSync, strFromU8 } from "fflate";
import { v4 as uuidv4 } from "uuid";
import type {
  BcfDocument, BcfTopic, BcfComment, BcfTopicStatus,
  BcfTopicType, BcfPriority, BcfViewpoint,
} from "./bcfTypes";

function getText(el: Element | null, tag: string): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? "";
}

function getAttr(el: Element | null, attr: string): string {
  return el?.getAttribute(attr) ?? "";
}

// BCF dates are ISO 8601 with timezone, e.g. "2025-12-05T14:46:17+00:00"
function parseDate(raw: string): string {
  if (!raw) return "";
  try { return new Date(raw).toISOString(); } catch { return raw; }
}

// Map localised/non-standard status strings to canonical values
const STATUS_MAP: Record<string, BcfTopicStatus> = {
  open: "Open", offen: "Open",
  "in progress": "In Progress", "in bearbeitung": "In Progress", active: "In Progress",
  resolved: "Resolved", gelöst: "Resolved", done: "Resolved",
  closed: "Closed", abgeschlossen: "Closed",
  reopened: "ReOpened", "re-opened": "ReOpened", wiedergeöffnet: "ReOpened",
};

function normalizeStatus(raw: string): BcfTopicStatus {
  return STATUS_MAP[raw.toLowerCase()] ?? "Open";
}

function parseViewpoint(xml: string): BcfViewpoint | undefined {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const root = doc.documentElement;
    const guid = getAttr(root, "Guid");

    const readVec = (parent: Element | null, tag: string) => {
      const el = parent?.querySelector(tag);
      if (!el) return undefined;
      return {
        x: parseFloat(el.querySelector("X")?.textContent ?? "0"),
        y: parseFloat(el.querySelector("Y")?.textContent ?? "0"),
        z: parseFloat(el.querySelector("Z")?.textContent ?? "0"),
      };
    };

    const camEl = root.querySelector("PerspectiveCamera") ?? root.querySelector("OrthogonalCamera");
    const cameraPosition  = readVec(camEl, "CameraViewPoint");
    const cameraDirection = readVec(camEl, "CameraDirection");
    const cameraUpVector  = readVec(camEl, "CameraUpVector");
    const fovText = camEl?.querySelector("FieldOfView")?.textContent?.trim();
    const fieldOfView = fovText ? parseFloat(fovText) : undefined;

    const selectedIfcGuids: string[] = [];
    root.querySelectorAll("Selection > Component").forEach(c => {
      const g = getAttr(c, "IfcGuid");
      if (g) selectedIfcGuids.push(g);
    });

    const coloring: { color: string; ifcGuids: string[] }[] = [];
    root.querySelectorAll("Coloring > Color").forEach(colorEl => {
      const color = getAttr(colorEl, "Color");
      const guids: string[] = [];
      colorEl.querySelectorAll("Component").forEach(c => {
        const g = getAttr(c, "IfcGuid");
        if (g) guids.push(g);
      });
      if (color && guids.length) coloring.push({ color, ifcGuids: guids });
    });

    return { guid, cameraPosition, cameraDirection, cameraUpVector, fieldOfView, selectedIfcGuids, coloring };
  } catch {
    return undefined;
  }
}

function uint8ToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

function parseMarkup(
  xml: string,
  guid: string,
  snapshot?: Uint8Array,
  viewpointXml?: string,
): BcfTopic | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const topicEl = doc.querySelector("Topic");
  if (!topicEl) return null;

  // BCF 2.1: Date/Author/Comment inside <Comment> are CHILD ELEMENTS, Guid is an attribute
  const comments: BcfComment[] = [];
  for (const cEl of Array.from(doc.querySelectorAll("Comment[Guid]"))) {
    const text = getText(cEl, "Comment");
    const dateRaw = getText(cEl, "Date") || getAttr(cEl, "Date");
    comments.push({
      id: getAttr(cEl, "Guid") || uuidv4(),
      text,
      author: getText(cEl, "Author") || getAttr(cEl, "Author"),
      date: parseDate(dateRaw) || new Date().toISOString(),
      modifiedDate: parseDate(getText(cEl, "ModifiedDate")) || undefined,
      modifiedAuthor: getText(cEl, "ModifiedAuthor") || undefined,
    });
  }

  const labels: string[] = [];
  for (const lEl of Array.from(doc.querySelectorAll("Labels, Label"))) {
    const t = lEl.textContent?.trim();
    if (t) labels.push(t);
  }

  // BCF 2.1: TopicStatus/TopicType/Priority are attributes; CreationDate/Author are child elements
  const statusRaw   = getAttr(topicEl, "TopicStatus")   || getText(topicEl, "TopicStatus");
  const typeRaw     = getAttr(topicEl, "TopicType")      || getText(topicEl, "TopicType") || "Issue";
  const priorityRaw = getAttr(topicEl, "Priority")       || getText(topicEl, "Priority")  || "Normal";

  const status   = normalizeStatus(statusRaw);
  const type     = typeRaw as BcfTopicType;
  const priority = priorityRaw as BcfPriority;

  const creationDate  = parseDate(getText(topicEl, "CreationDate")  || getAttr(topicEl, "CreationDate"))  || new Date().toISOString();
  const modifiedDateRaw = getText(topicEl, "ModifiedDate") || getAttr(topicEl, "ModifiedDate");
  const modifiedDate  = parseDate(modifiedDateRaw) || creationDate;
  const dueDateRaw    = getText(topicEl, "DueDate");
  const dueDate       = dueDateRaw ? parseDate(dueDateRaw) : undefined;

  const creationAuthor = getText(topicEl, "CreationAuthor") || getAttr(topicEl, "CreationAuthor");
  const modifiedAuthor = getText(topicEl, "ModifiedAuthor") || undefined;
  const assignedTo     = getText(topicEl, "AssignedTo")     || undefined;
  const stage          = getText(topicEl, "Stage")           || undefined;

  const indexRaw = getText(topicEl, "Index");
  const index = indexRaw ? parseInt(indexRaw, 10) : undefined;
  const area = getText(topicEl, "Zone") || getText(topicEl, "Area") || undefined;
  const visibleFor = getText(topicEl, "VisibleFor") || undefined;
  const approval = getText(topicEl, "Approval") || undefined;

  const referenceLinks: string[] = [];
  for (const rl of Array.from(topicEl.querySelectorAll("ReferenceLink"))) {
    const t = rl.textContent?.trim();
    if (t) referenceLinks.push(t);
  }

  const KNOWN_TAGS = new Set([
    "Title", "CreationDate", "CreationAuthor", "ModifiedDate", "ModifiedAuthor",
    "Description", "AssignedTo", "DueDate", "Stage", "Labels", "Label", "Priority",
    "Comment", "Index", "Zone", "Area", "VisibleFor", "Approval", "ReferenceLink",
    "BimSnippet", "DocumentReference", "Viewpoints",
  ]);
  const customFields: Record<string, string> = {};
  for (const child of Array.from(topicEl.children)) {
    if (!KNOWN_TAGS.has(child.tagName) && child.children.length === 0) {
      const t = child.textContent?.trim();
      if (t) customFields[child.tagName] = t;
    }
  }

  const snapshotDataUrl = snapshot
    ? `data:image/png;base64,${uint8ToBase64(snapshot)}`
    : undefined;

  const viewpoint = viewpointXml ? parseViewpoint(viewpointXml) : undefined;

  return {
    id: uuidv4(),
    guid: getAttr(topicEl, "Guid") || guid,
    title: getText(topicEl, "Title") || "Untitled",
    description: getText(topicEl, "Description") || undefined,
    status,
    type,
    priority,
    assignedTo,
    dueDate,
    stage,
    creationDate,
    modifiedDate,
    creationAuthor,
    modifiedAuthor,
    labels,
    comments,
    snapshot: snapshotDataUrl,
    viewpoint,
    source: "manual",
    index,
    area,
    visibleFor,
    approval,
    referenceLinks: referenceLinks.length > 0 ? referenceLinks : undefined,
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
  };
}

export async function importBcf(file: File): Promise<BcfDocument> {
  const buffer = await file.arrayBuffer();
  const zip = unzipSync(new Uint8Array(buffer));

  const topics: BcfTopic[] = [];

  const topicGuids = new Set<string>();
  for (const path of Object.keys(zip)) {
    if (path.endsWith("/markup.bcf")) topicGuids.add(path.split("/")[0]);
  }

  for (const guid of topicGuids) {
    const markupData    = zip[`${guid}/markup.bcf`];
    if (!markupData) continue;
    const snapshotData  = zip[`${guid}/snapshot.png`];
    const viewpointData = zip[`${guid}/viewpoint.bcfv`];
    const viewpointXml  = viewpointData ? strFromU8(viewpointData) : undefined;

    const topic = parseMarkup(strFromU8(markupData), guid, snapshotData, viewpointXml);
    if (topic) topics.push(topic);
  }

  topics.sort((a, b) => b.creationDate.localeCompare(a.creationDate));

  let projectName = "Imported Project";
  const projectFile = zip["project.bcfp"] ?? zip["project.bcf"];
  if (projectFile) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(strFromU8(projectFile), "application/xml");
    const name = doc.querySelector("Name")?.textContent?.trim();
    if (name) projectName = name;
  }

  return { id: uuidv4(), projectName, topics };
}
