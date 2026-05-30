import JSZip from "jszip";
import type { SmartView, ColorGroup, QTOList, SectionPlane } from "../types/ifc";
import type { ClashRule } from "./windowSync";
import type { BcfDocument, BcfClashRule } from "../bcf/bcfTypes";
import type { IdsDocument } from "../ids/idsTypes";

export interface ProjectMeta {
  version: 1;
  savedAt: string;
  projectName: string;
}

export interface ModelMeta {
  id: string;
  name: string;
  color: string;
  opacity: number;
  visible: boolean;
  /** File name inside the zip models/ folder */
  zipEntry: string;
}

export interface ProjectData {
  meta: ProjectMeta;
  models: ModelMeta[];
  smartViews: SmartView[];
  colorGroups: ColorGroup[] | null;
  qtoLists: QTOList[];
  sectionPlanes: SectionPlane[];
  collisionRules: ClashRule[];
  bcfDocument: BcfDocument;
  bcfClashRules: BcfClashRule[];
  idsDocuments: IdsDocument[];
  propertyOverrides?: Record<string, Record<string, Record<string, unknown>>>;
}

/** Save all project data + IFC files to a .icproj ZIP blob. */
export async function saveProject(
  data: Omit<ProjectData, "meta">,
  ifcFiles: Map<string, File>, // modelId → File
  projectName: string,
): Promise<Blob> {
  const zip = new JSZip();

  const meta: ProjectMeta = {
    version: 1,
    savedAt: new Date().toISOString(),
    projectName,
  };

  const projectData: ProjectData = { ...data, meta };
  zip.file("project.json", JSON.stringify(projectData, null, 2));

  const modelsFolder = zip.folder("models")!;
  for (const model of data.models) {
    const file = ifcFiles.get(model.id);
    if (file) {
      modelsFolder.file(model.zipEntry, file);
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export interface LoadedProject {
  data: ProjectData;
  /** modelId → File (reconstructed from zip entries) */
  ifcFiles: Map<string, File>;
}

/** Parse a .icproj ZIP blob and extract project data + IFC files. */
export async function loadProject(blob: Blob): Promise<LoadedProject> {
  const zip = await JSZip.loadAsync(blob);

  const projectJson = await zip.file("project.json")?.async("string");
  if (!projectJson) throw new Error("Ungültige Projektdatei: project.json fehlt");

  const data = JSON.parse(projectJson) as ProjectData;
  if (data.meta?.version !== 1) throw new Error("Nicht unterstützte Projektdatei-Version");

  const ifcFiles = new Map<string, File>();
  for (const model of data.models) {
    const entry = zip.file(`models/${model.zipEntry}`);
    if (entry) {
      const ab = await entry.async("arraybuffer");
      const file = new File([ab], model.name, { type: "application/octet-stream" });
      ifcFiles.set(model.id, file);
    }
  }

  return { data, ifcFiles };
}

/** Download a blob to the user's disk. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
