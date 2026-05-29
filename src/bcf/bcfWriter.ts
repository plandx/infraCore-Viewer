import { strToU8, zipSync } from "fflate";
import { v4 as uuidv4 } from "uuid";
import type { BcfDocument, BcfVersion } from "./bcfTypes";

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildMarkup(topic: BcfDocument["topics"][0]): string {
  const comments = topic.comments.map(c => `
  <Comment Guid="${c.id}" Date="${c.date}" Author="${escXml(c.author)}">
    <Comment>${escXml(c.text)}</Comment>
  </Comment>`).join("");

  const labels = topic.labels.map(l => `    <Labels>${escXml(l)}</Labels>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Topic Guid="${topic.guid}" TopicStatus="${escXml(topic.status)}" TopicType="${escXml(topic.type)}" CreationDate="${topic.creationDate}" CreationAuthor="${escXml(topic.creationAuthor)}" Priority="${escXml(topic.priority)}">
    <Title>${escXml(topic.title)}</Title>
    ${topic.description ? `<Description>${escXml(topic.description)}</Description>` : ""}
    ${topic.assignedTo ? `<AssignedTo>${escXml(topic.assignedTo)}</AssignedTo>` : ""}
${labels}
  </Topic>${comments}
</Markup>`;
}

function buildVersion(version: BcfVersion): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Version VersionId="${version}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="version.xsd"></Version>`;
}

function buildProject(doc: BcfDocument): string {
  const projectId = uuidv4();
  return `<?xml version="1.0" encoding="UTF-8"?><ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project.xsd"><Project ProjectId="${projectId}"><Name>${escXml(doc.projectName)}</Name></Project></ProjectExtension>`;
}

export async function exportBcf(doc: BcfDocument, version: BcfVersion): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};

  files["bcf.version"] = strToU8(buildVersion(version));
  files["project.bcfp"] = strToU8(buildProject(doc));

  for (const topic of doc.topics) {
    const markup = buildMarkup(topic);
    files[`${topic.guid}/markup.bcf`] = strToU8(markup);
  }

  return zipSync(files);
}
