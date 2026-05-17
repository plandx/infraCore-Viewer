import * as THREE from "three";
import * as WebIFC from "web-ifc";
import type { IFCModelEntry, PropertySet, SpatialNode, ElementNode, FlatElementProps } from "../types/ifc";
import {
  computeModelOffset,
  generateModelColor,
} from "./coordinateUtils";

let ifcApiPromise: Promise<WebIFC.IfcAPI> | null = null;

export function getIfcApi(): Promise<WebIFC.IfcAPI> {
  // Cache the single promise so concurrent callers all wait for the same Init()
  if (ifcApiPromise) return ifcApiPromise;

  ifcApiPromise = (async () => {
    const api = new WebIFC.IfcAPI();

    // Use an absolute URL so it works both in localhost and in Codespaces
    // behind a reverse proxy. The WASM files live in public/wasm/.
    const wasmBase =
      typeof window !== "undefined"
        ? `${window.location.origin}/wasm/`
        : "/wasm/";
    api.SetWasmPath(wasmBase);

    // Verify the WASM file is reachable before calling Init()
    try {
      const probe = await fetch(`${wasmBase}web-ifc.wasm`, { method: "HEAD" });
      if (!probe.ok) {
        throw new Error(
          `WASM nicht gefunden: ${wasmBase}web-ifc.wasm (HTTP ${probe.status})`
        );
      }
    } catch (fetchErr) {
      ifcApiPromise = null;
      throw new Error(`WASM-Fetch fehlgeschlagen: ${fetchErr}`);
    }

    // Wrap Init() with a 30 s timeout so it never hangs silently
    await Promise.race([
      api.Init(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("web-ifc Init() Timeout (30 s)")),
          30_000
        )
      ),
    ]);

    return api;
  })().catch((err) => {
    console.error("[web-ifc] Init fehlgeschlagen:", err);
    ifcApiPromise = null;
    throw err;
  });

  return ifcApiPromise;
}

export type LoadProgress = { phase: string; progress: number };

const FILE_NAME   = 1390159747;
const FILE_SCHEMA = 1109904537;

function extractIFCHeader(api: WebIFC.IfcAPI, modelId: number): import("../types/ifc").IFCHeader {
  const empty: import("../types/ifc").IFCHeader = { schema: "", authors: [], organizations: [], preprocessor: "", timestamp: "" };
  try {
    const fn = api.GetHeaderLine(modelId, FILE_NAME);
    const fs = api.GetHeaderLine(modelId, FILE_SCHEMA);
    const args = fn?.arguments ?? [];
    const strVal = (v: unknown): string => {
      if (!v) return "";
      if (typeof v === "string") return v;
      if (typeof v === "object" && v !== null && "value" in v) return String((v as { value: unknown }).value);
      return "";
    };
    const arrVal = (v: unknown): string[] => {
      if (!Array.isArray(v)) return [];
      return v.map(strVal).filter(Boolean);
    };
    const schemaArgs = fs?.arguments?.[0];
    const schema = Array.isArray(schemaArgs) ? strVal(schemaArgs[0]) : strVal(schemaArgs);
    return {
      schema,
      timestamp: strVal(args[1]),
      authors: arrVal(args[2]),
      organizations: arrVal(args[3]),
      preprocessor: strVal(args[4]),
    };
  } catch {
    return empty;
  }
}

export async function loadIFCFile(
  file: File,
  modelIndex: number,
  worldOrigin: THREE.Vector3 | null,
  onProgress: (p: LoadProgress) => void
): Promise<{
  entry: Omit<IFCModelEntry, "id">;
  newWorldOrigin: THREE.Vector3;
}> {
  onProgress({ phase: "Datei lesen", progress: 5 });
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  onProgress({ phase: "IFC Parser initialisieren", progress: 10 });
  const api = await getIfcApi();

  onProgress({ phase: "IFC parsen", progress: 20 });
  const modelId = api.OpenModel(data, {
    COORDINATE_TO_ORIGIN: false,
    CIRCLE_SEGMENTS: 12,
  });

  const group = new THREE.Group();
  group.name = file.name;

  onProgress({ phase: "Geometrie aufbauen", progress: 35 });

  let meshCount = 0;
  const matCache = new Map<string, THREE.MeshLambertMaterial>();
  api.StreamAllMeshes(modelId, (flatMesh) => {
    const placedGeometries = flatMesh.geometries;
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placed = placedGeometries.get(i);
      const geomData = api.GetGeometry(modelId, placed.geometryExpressID);

      const vertexData = api.GetVertexArray(
        geomData.GetVertexData(),
        geomData.GetVertexDataSize()
      );
      const indexData = api.GetIndexArray(
        geomData.GetIndexData(),
        geomData.GetIndexDataSize()
      );

      if (vertexData.length === 0 || indexData.length === 0) {
        geomData.delete();
        continue;
      }

      // web-ifc vertex format: [x, y, z, nx, ny, nz, ...] interleaved
      const stride = 6;
      const vertCount = vertexData.length / stride;
      const positions = new Float32Array(vertCount * 3);
      const normals = new Float32Array(vertCount * 3);

      for (let j = 0; j < vertCount; j++) {
        const src = j * stride;
        const dst = j * 3;
        positions[dst] = vertexData[src];
        positions[dst + 1] = vertexData[src + 1];
        positions[dst + 2] = vertexData[src + 2];
        normals[dst] = vertexData[src + 3];
        normals[dst + 1] = vertexData[src + 4];
        normals[dst + 2] = vertexData[src + 5];
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(indexData, 1));

      const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation);
      const { x: r, y: g, z: b, w: a } = placed.color;
      const matKey = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a < 0.99 ? Math.round(a * 255) : 255}`;
      let material = matCache.get(matKey);
      if (!material) {
        material = new THREE.MeshLambertMaterial({
          color: new THREE.Color(r, g, b),
          opacity: a,
          transparent: a < 0.99,
          side: THREE.DoubleSide,
        });
        matCache.set(matKey, material);
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.applyMatrix4(matrix);
      mesh.userData.expressId = flatMesh.expressID;
      group.add(mesh);
      meshCount++;

      geomData.delete();
    }
    // flatMesh.delete() entfernt — in web-ifc 0.0.77 nicht mehr verfügbar
  });

  onProgress({ phase: `${meshCount} Meshes verarbeitet`, progress: 75 });

  // Compute bounding box from raw geometry (before any offset)
  const rawBbox = new THREE.Box3().setFromObject(group);
  let newWorldOrigin = worldOrigin ?? new THREE.Vector3();

  // Always shift to keep geometry near origin — infrastructure models routinely
  // sit at national-grid coordinates (millions of metres) which break float32.
  const originOffset = computeModelOffset(rawBbox, worldOrigin);
  if (!worldOrigin) newWorldOrigin = originOffset.clone();
  group.position.sub(originOffset);

  const bbox = new THREE.Box3().setFromObject(group);

  onProgress({ phase: "Struktur extrahieren", progress: 80 });
  const { spatialTree, elementsByType } = await extractStructure(api, modelId);

  onProgress({ phase: "Abschließen", progress: 95 });

  const header = extractIFCHeader(api, modelId);

  api.CloseModel(modelId);
  onProgress({ phase: "Fertig", progress: 100 });

  const entry: Omit<IFCModelEntry, "id"> = {
    name: file.name,
    file,
    mesh: group,
    visible: true,
    color: generateModelColor(modelIndex),
    opacity: 1,
    boundingBox: bbox,
    originOffset,
    properties: {},
    spatialTree,
    elementsByType,
    loadedAt: new Date(),
    size: file.size,
    status: "loaded",
    header,
  };

  return { entry, newWorldOrigin };
}

// ── Persistent per-file model cache ──────────────────────────────────────────
// Keeps an open web-ifc model handle for each File so repeated property
// lookups (element clicks) don't re-read and re-parse the file each time.

interface CachedModel { modelId: number; api: WebIFC.IfcAPI }
const propModelCache = new Map<File, CachedModel>();

async function getOrOpenPropModel(file: File): Promise<CachedModel> {
  const hit = propModelCache.get(file);
  if (hit) return hit;
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const api = await getIfcApi();
  const modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
  const entry: CachedModel = { modelId, api };
  propModelCache.set(file, entry);
  return entry;
}

export function evictPropModelCache(file: File) {
  const entry = propModelCache.get(file);
  if (entry) { try { entry.api.CloseModel(entry.modelId); } catch { /* ignore */ } }
  propModelCache.delete(file);
}

export async function loadIFCProperties(
  file: File,
  expressId: number
): Promise<{ properties: Record<string, unknown>; psets: PropertySet[] }> {
  const { api, modelId } = await getOrOpenPropModel(file);

  const props: Record<string, unknown> = {};
  const psets: PropertySet[] = [];

  const itemProps = await api.properties.getItemProperties(modelId, expressId, false);
  if (itemProps) {
    Object.entries(itemProps as Record<string, unknown>).forEach(([k, v]) => {
      if (k !== "expressID") props[k] = v;
    });
  }

  const instancePsets = await api.properties.getPropertySets(modelId, expressId, true, false);
  const typePsets = await api.properties.getPropertySets(modelId, expressId, true, true).catch(() => []);
  const rawPsets = [...instancePsets, ...typePsets];

  for (const pset of rawPsets) {
    const psetName = String(pset?.Name?.value ?? "PropertySet");
    const psetProps: PropertySet["properties"] = [];
    const hasProp = pset?.HasProperties;
    if (Array.isArray(hasProp)) {
      for (const prop of hasProp) {
        if (!prop) continue;
        psetProps.push({
          name: String(prop?.Name?.value ?? ""),
          value: prop?.NominalValue?.value ?? prop?.Value?.value ?? null,
          type: String(prop?.type ?? ""),
        });
      }
    }
    psets.push({ name: psetName, properties: psetProps });
  }

  return { properties: props, psets };
}

// ─────────────────────────────────────────────────────────────────────────────
// Basket property loading (opens file once, reads multiple elements with psets)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadBasketProperties(
  file: File,
  expressIds: number[]
): Promise<Map<number, { properties: Record<string, unknown>; psets: PropertySet[] }>> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const api = await getIfcApi();
  const modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
  const result = new Map<number, { properties: Record<string, unknown>; psets: PropertySet[] }>();

  try {
    for (const eid of expressIds) {
      const props: Record<string, unknown> = {};
      const psets: PropertySet[] = [];

      try {
        const itemProps = await api.properties.getItemProperties(modelId, eid, false);
        if (itemProps) {
          for (const [k, v] of Object.entries(itemProps as Record<string, unknown>)) {
            if (k === "expressID") continue;
            const scalar = (v as { value?: unknown } | null)?.value;
            props[k] = scalar !== undefined ? scalar : v;
          }
        }
      } catch { /* element may have no direct props */ }

      try {
        const _iPsets = await api.properties.getPropertySets(modelId, eid, true, false);
        const _tPsets = await api.properties.getPropertySets(modelId, eid, true, true).catch(() => []);
        const rawPsets = [..._iPsets, ..._tPsets];
        for (const pset of rawPsets) {
          if (!pset) continue;
          const psetName = String(pset?.Name?.value ?? "PropertySet");
          const psetProps: PropertySet["properties"] = [];
          const hasProp = pset?.HasProperties;
          if (Array.isArray(hasProp)) {
            for (const prop of hasProp) {
              if (!prop) continue;
              psetProps.push({
                name: String(prop?.Name?.value ?? ""),
                value: prop?.NominalValue?.value ?? prop?.Value?.value ?? null,
                type: String(prop?.type ?? ""),
              });
            }
          }
          if (psetProps.length > 0) psets.push({ name: psetName, properties: psetProps });
        }
      } catch { /* psets optional */ }

      result.set(eid, { properties: props, psets });
    }
  } finally {
    api.CloseModel(modelId);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch property loading (opens file once, reads all elements)
// ─────────────────────────────────────────────────────────────────────────────

function extractScalar(v: unknown): unknown {
  if (v !== null && typeof v === "object" && "value" in (v as object)) {
    return (v as { value: unknown }).value;
  }
  return v;
}

/**
 * Opens the IFC file once and reads all properties for the given expressIds.
 * Returns Map<expressId, flatProps>.
 * onProgress(done, total) is called after each element.
 */
export async function loadAllElementProperties(
  file: File,
  expressIds: number[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<number, FlatElementProps>> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const api = await getIfcApi();
  const modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });

  const result = new Map<number, FlatElementProps>();

  try {
    for (let i = 0; i < expressIds.length; i++) {
      const eid = expressIds[i];
      const flat: FlatElementProps = {};

      try {
        const raw = await api.properties.getItemProperties(modelId, eid, false);
        if (raw) {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (k !== "expressID" && k !== "type") flat[k] = extractScalar(v);
          }
        }
      } catch { /* element may have no direct props */ }

      try {
        const _iPsets = await api.properties.getPropertySets(modelId, eid, true, false);
        const _tPsets = await api.properties.getPropertySets(modelId, eid, true, true).catch(() => []);
        const rawPsets = [..._iPsets, ..._tPsets];
        for (const pset of rawPsets) {
          if (!pset) continue;
          const psetName = String(pset?.Name?.value ?? "PropertySet");
          const hasProp = pset?.HasProperties;
          if (!Array.isArray(hasProp)) continue;
          for (const prop of hasProp) {
            if (!prop) continue;
            const name = String(prop?.Name?.value ?? "");
            const value = extractScalar(
              prop?.NominalValue?.value !== undefined ? prop.NominalValue
                : prop?.Value?.value !== undefined ? prop.Value
                : prop?.NominalValue ?? prop?.Value ?? null
            );
            if (!name) continue;
            flat[`${psetName}.${name}`] = value;
            if (!(name in flat)) flat[name] = value;
          }
        }
      } catch { /* psets optional */ }

      result.set(eid, flat);
      onProgress?.(i + 1, expressIds.length);
    }
  } finally {
    api.CloseModel(modelId);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spatial structure + element-type extraction
// ─────────────────────────────────────────────────────────────────────────────

/** IFC types that represent elements (not spatial containers) */
const ELEMENT_TYPES: Record<number, string> = {
  [WebIFC.IFCWALL]:              "Wand",
  [WebIFC.IFCWALLSTANDARDCASE]: "Wand",
  [WebIFC.IFCBEAM]:              "Träger",
  [WebIFC.IFCCOLUMN]:            "Stütze",
  [WebIFC.IFCSLAB]:              "Decke/Platte",
  [WebIFC.IFCDOOR]:              "Tür",
  [WebIFC.IFCWINDOW]:            "Fenster",
  [WebIFC.IFCROOF]:              "Dach",
  [WebIFC.IFCSTAIR]:             "Treppe",
  [WebIFC.IFCSTAIRFLIGHT]:       "Treppenflug",
  [WebIFC.IFCRAILING]:           "Geländer",
  [WebIFC.IFCSPACE]:             "Raum",
  [WebIFC.IFCPLATE]:             "Platte",
  [WebIFC.IFCMEMBER]:            "Bauteil",
  [WebIFC.IFCFOOTING]:           "Fundament",
  [WebIFC.IFCPILE]:              "Pfahl",
  [WebIFC.IFCCOVERING]:          "Verkleidung",
  [WebIFC.IFCFURNISHINGELEMENT]: "Möbel",
  [WebIFC.IFCFLOWSEGMENT]:       "Leitungssegment",
  [WebIFC.IFCPIPESEGMENT]:       "Rohr",
  [WebIFC.IFCDUCTFITTING]:       "Lüftungsformstück",
  [WebIFC.IFCDUCTSEGMENT]:       "Lüftungskanal",
  [WebIFC.IFCCABLEFITTING]:      "Kabelformstück",
  [WebIFC.IFCCABLESEGMENT]:      "Kabel",
  [WebIFC.IFCBUILDINGELEMENTPROXY]: "Generisches Element",
  [WebIFC.IFCCIVILELEMENT]:      "Infrastrukturelement",
  [WebIFC.IFCTRANSPORTELEMENT]:  "Fördertechnik",
};

function getLabel(line: Record<string, unknown> | null): string {
  if (!line) return "";
  const name = (line.Name as { value?: string } | undefined)?.value
    ?? (line.LongName as { value?: string } | undefined)?.value
    ?? "";
  return name.trim();
}

async function extractStructure(
  api: WebIFC.IfcAPI,
  modelId: number
): Promise<{ spatialTree: SpatialNode | null; elementsByType: Record<string, ElementNode[]> }> {
  const elementsByType: Record<string, ElementNode[]> = {};

  // ── 1. Spatial tree ──────────────────────────────────────────────────────
  let spatialTree: SpatialNode | null = null;
  try {
    const raw = await api.properties.getSpatialStructure(modelId, false);

    function convert(node: { expressID: number; type: string; children?: unknown[] }): SpatialNode {
      const line = api.GetLine(modelId, node.expressID) as Record<string, unknown> | null;
      const children: SpatialNode[] = (node.children ?? []).map((c) =>
        convert(c as { expressID: number; type: string; children?: unknown[] })
      );
      return {
        expressId: node.expressID,
        type: node.type,
        name: getLabel(line) || node.type,
        children,
      };
    }

    spatialTree = convert(raw as { expressID: number; type: string; children?: unknown[] });
  } catch (e) {
    console.warn("[IFC] Spatial structure extraction failed:", e);
  }

  // ── 2. Elements by type ──────────────────────────────────────────────────
  for (const [typeNum, label] of Object.entries(ELEMENT_TYPES)) {
    try {
      const ids = api.GetLineIDsWithType(modelId, Number(typeNum));
      if (ids.size() === 0) continue;

      const nodes: ElementNode[] = [];
      for (let i = 0; i < ids.size(); i++) {
        const eid = ids.get(i);
        const line = api.GetLine(modelId, eid) as Record<string, unknown> | null;
        nodes.push({
          expressId: eid,
          type: label,
          name: getLabel(line) || `${label} #${eid}`,
        });
      }
      if (nodes.length > 0) {
        elementsByType[label] = (elementsByType[label] ?? []).concat(nodes);
      }
    } catch {
      // type not in this model — skip silently
    }
  }

  return { spatialTree, elementsByType };
}
