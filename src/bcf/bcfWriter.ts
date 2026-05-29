import { strToU8, zipSync } from "fflate";
import { v4 as uuidv4 } from "uuid";
import type { BcfDocument, BcfVersion } from "./bcfTypes";

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildMarkup(topic: BcfDocument["topics"][0], vpGuid: string | null): string {
  // BCF 2.1 spec: CreationDate, CreationAuthor, ModifiedDate etc. are child elements
  const comments = topic.comments.map(c => `
  <Comment Guid="${c.id}">
    <Date>${escXml(c.date)}</Date>
    <Author>${escXml(c.author)}</Author>
    <Comment>${escXml(c.text)}</Comment>
    ${c.modifiedDate ? `<ModifiedDate>${escXml(c.modifiedDate)}</ModifiedDate>` : ""}
    ${c.modifiedAuthor ? `<ModifiedAuthor>${escXml(c.modifiedAuthor)}</ModifiedAuthor>` : ""}
  </Comment>`).join("");

  const labels = topic.labels.map(l => `    <Labels>${escXml(l)}</Labels>`).join("\n");

  const viewpointEl = vpGuid ? `
  <Viewpoints Guid="${vpGuid}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
    <Snapshot>snapshot.png</Snapshot>
  </Viewpoints>` : "";

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<Markup>
  <Topic Guid="${topic.guid}" TopicStatus="${escXml(topic.status)}" TopicType="${escXml(topic.type)}">
    <Title>${escXml(topic.title)}</Title>
    <CreationDate>${escXml(topic.creationDate)}</CreationDate>
    <CreationAuthor>${escXml(topic.creationAuthor)}</CreationAuthor>
    <ModifiedDate>${escXml(topic.modifiedDate)}</ModifiedDate>
    ${topic.modifiedAuthor ? `<ModifiedAuthor>${escXml(topic.modifiedAuthor)}</ModifiedAuthor>` : ""}
    ${topic.description ? `<Description>${escXml(topic.description)}</Description>` : ""}
    ${topic.assignedTo ? `<AssignedTo>${escXml(topic.assignedTo)}</AssignedTo>` : ""}
    ${topic.dueDate ? `<DueDate>${escXml(topic.dueDate)}</DueDate>` : ""}
    ${topic.stage ? `<Stage>${escXml(topic.stage)}</Stage>` : ""}
    <Priority>${escXml(topic.priority)}</Priority>
${labels}
  </Topic>${comments}${viewpointEl}
</Markup>`;
}

function buildViewpoint(topic: BcfDocument["topics"][0], vpGuid: string): string {
  const vp = topic.viewpoint;
  const cp = vp?.cameraPosition;
  const cd = vp?.cameraDirection;
  const cu = vp?.cameraUpVector;

  const selectionXml = (vp?.selectedIfcGuids ?? []).length > 0
    ? `\n  <Components>\n    <ViewSetupHints SpacesVisible="false" SpaceBoundariesVisible="false" OpeningsVisible="false" />\n    <Selection>\n${(vp!.selectedIfcGuids!).map(g => `      <Component IfcGuid="${g}" />`).join("\n")}\n    </Selection>\n    <Visibility DefaultVisibility="true" />\n  </Components>`
    : "";

  const cameraXml = cp && cd && cu
    ? `\n  <PerspectiveCamera>\n    <CameraViewPoint><X>${cp.x}</X><Y>${cp.y}</Y><Z>${cp.z}</Z></CameraViewPoint>\n    <CameraDirection><X>${cd.x}</X><Y>${cd.y}</Y><Z>${cd.z}</Z></CameraDirection>\n    <CameraUpVector><X>${cu.x}</X><Y>${cu.y}</Y><Z>${cu.z}</Z></CameraUpVector>\n    <FieldOfView>${vp?.fieldOfView ?? 60}</FieldOfView>\n  </PerspectiveCamera>`
    : "";

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<VisualizationInfo Guid="${vpGuid}">${selectionXml}${cameraXml}\n</VisualizationInfo>`;
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function buildVersion(version: BcfVersion): string {
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Version VersionId="${version}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="version.xsd">\n  <DetailedVersion>${version}</DetailedVersion>\n</Version>`;
}

function buildProject(doc: BcfDocument): string {
  const projectId = uuidv4();
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project.xsd">\n  <Project ProjectId="${projectId}">\n    <Name>${escXml(doc.projectName)}</Name>\n  </Project>\n</ProjectExtension>`;
}

export async function exportBcf(doc: BcfDocument, version: BcfVersion): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};

  files["bcf.version"] = strToU8(buildVersion(version));
  files["project.bcfp"] = strToU8(buildProject(doc));

  for (const topic of doc.topics) {
    const vpGuid = topic.viewpoint?.guid ?? (topic.snapshot ? uuidv4() : null);
    files[`${topic.guid}/markup.bcf`] = strToU8(buildMarkup(topic, vpGuid));

    if (vpGuid) {
      files[`${topic.guid}/viewpoint.bcfv`] = strToU8(buildViewpoint(topic, vpGuid));
    }

    // Re-embed snapshot if present (stored as data URL)
    if (topic.snapshot) {
      const b64 = topic.snapshot.replace(/^data:image\/png;base64,/, "");
      try { files[`${topic.guid}/snapshot.png`] = base64ToUint8(b64); } catch { /* skip */ }
    }
  }

  return zipSync(files);
}
