import { unzipSync, strFromU8 } from "fflate";
import { v4 as uuidv4 } from "uuid";
import type { BcfDocument, BcfTopic, BcfComment, BcfTopicStatus, BcfTopicType, BcfPriority } from "./bcfTypes";

function getText(el: Element | null, tag: string): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? "";
}

function getAttr(el: Element | null, attr: string): string {
  return el?.getAttribute(attr) ?? "";
}

function parseMarkup(xml: string, guid: string): BcfTopic | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const topicEl = doc.querySelector("Topic");
  if (!topicEl) return null;

  const comments: BcfComment[] = [];
  for (const cEl of Array.from(doc.querySelectorAll("Comment"))) {
    const text = getText(cEl, "Comment");
    if (!text) continue;
    comments.push({
      id: getAttr(cEl, "Guid") || uuidv4(),
      text,
      author: getAttr(cEl, "Author"),
      date: getAttr(cEl, "Date"),
      modifiedDate: getAttr(cEl, "ModifiedDate") || undefined,
    });
  }

  const labels: string[] = [];
  for (const lEl of Array.from(doc.querySelectorAll("Labels"))) {
    const t = lEl.textContent?.trim();
    if (t) labels.push(t);
  }

  const status = (getAttr(topicEl, "TopicStatus") || "Open") as BcfTopicStatus;
  const type = (getAttr(topicEl, "TopicType") || "Issue") as BcfTopicType;
  const priority = (getAttr(topicEl, "Priority") || "Normal") as BcfPriority;
  const creationDate = getAttr(topicEl, "CreationDate") || new Date().toISOString();

  return {
    id: uuidv4(),
    guid: getAttr(topicEl, "Guid") || guid,
    title: getText(topicEl, "Title") || "Untitled",
    description: getText(topicEl, "Description") || undefined,
    status,
    type,
    priority,
    assignedTo: getText(topicEl, "AssignedTo") || undefined,
    creationDate,
    modifiedDate: getAttr(topicEl, "ModifiedDate") || creationDate,
    creationAuthor: getAttr(topicEl, "CreationAuthor") || "",
    labels,
    comments,
    source: "manual",
  };
}

export async function importBcf(file: File): Promise<BcfDocument> {
  const buffer = await file.arrayBuffer();
  const zip = unzipSync(new Uint8Array(buffer));

  const topics: BcfTopic[] = [];

  for (const [path, data] of Object.entries(zip)) {
    if (!path.endsWith("/markup.bcf")) continue;
    const parts = path.split("/");
    const guid = parts[0];
    const xml = strFromU8(data);
    const topic = parseMarkup(xml, guid);
    if (topic) topics.push(topic);
  }

  topics.sort((a, b) => b.creationDate.localeCompare(a.creationDate));

  let projectName = "Imported Project";
  const projectFile = zip["project.bcfp"];
  if (projectFile) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(strFromU8(projectFile), "application/xml");
    const name = doc.querySelector("Name")?.textContent?.trim();
    if (name) projectName = name;
  }

  return {
    id: uuidv4(),
    projectName,
    topics,
  };
}
