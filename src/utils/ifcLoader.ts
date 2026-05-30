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

      // web-ifc vertex format: [x, y, z, nx, ny, nz, ...] interleaved.
      // Use InterleavedBuffer to avoid deinterleaving: one fast slice() instead of
      // two Float32Array allocations + a per-vertex copy loop.
      const stride = 6;
      const vertCount = vertexData.length / stride;

      // vertexData is a view into WASM memory — must be copied before geomData.delete().
      // slice() is a single memcpy, much faster than a JS loop for large meshes.
      const interleavedData = vertexData.slice();
      const ib = new THREE.InterleavedBuffer(interleavedData, stride);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0));
      geometry.setAttribute("normal",   new THREE.InterleavedBufferAttribute(ib, 3, 3));

      // Use Uint16 indices when the mesh has < 65536 vertices — half the index bandwidth.
      const indexAttr = vertCount < 65536
        ? new THREE.BufferAttribute(new Uint16Array(indexData), 1)
        : new THREE.BufferAttribute(indexData.slice(), 1); // Uint32, but must copy from WASM
      geometry.setIndex(indexAttr);

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
      // Pre-compute bounding sphere now (during load) so the first render frame
      // doesn't stall on lazy computation for all 10K+ meshes simultaneously.
      geometry.computeBoundingSphere();
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

  // Keep the model open in propModelCache so the first element click is instant.
  // evictPropModelCache() will close it when the model is removed.
  if (!propModelCache.has(file)) {
    propModelCache.set(file, { modelId, api });
  } else {
    api.CloseModel(modelId);
  }
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

interface CachedModel {
  modelId: number;
  api: WebIFC.IfcAPI;
  /** Forward index: expressId → list of psetIds (from IfcRelDefinesByProperties) */
  relDefIndex?: Map<number, number[]>;
  /** Forward index: expressId → list of psetIds from type (IfcRelDefinesByType) */
  relTypeIndex?: Map<number, number[]>;
  /** Aggregation index: child expressId → parent expressId (from IfcRelAggregates + IfcRelDecomposes) */
  parentIndex?: Map<number, number>;
}
const propModelCache = new Map<File, CachedModel>();

/** Build (once per open model) a forward index: expressId → [psetId, ...].
 *  This is O(R+T) but runs only once; subsequent lookups are O(1). */
function buildRelDefIndex(cached: CachedModel): void {
  if (cached.relDefIndex) return;
  const { api, modelId } = cached;
  const relDefIndex = new Map<number, number[]>();
  const relTypeIndex = new Map<number, number[]>();

  try {
    const relIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYPROPERTIES);
    const total = relIds.size();
    for (let i = 0; i < total; i++) {
      const rel = api.GetLine(modelId, relIds.get(i), false, false) as Record<string, unknown> | null;
      if (!rel) continue;
      const psetId = (rel.RelatingPropertyDefinition as { value?: number } | null)?.value;
      if (!psetId) continue;
      const objs = toRefArray(rel.RelatedObjects);
      for (const o of objs) {
        const eid = o?.value;
        if (!eid) continue;
        const arr = relDefIndex.get(eid);
        if (arr) arr.push(psetId); else relDefIndex.set(eid, [psetId]);
      }
    }
  } catch { /* ignore — model may not have these rels */ }

  try {
    const relIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYTYPE);
    const total = relIds.size();
    for (let i = 0; i < total; i++) {
      const rel = api.GetLine(modelId, relIds.get(i), false, false) as Record<string, unknown> | null;
      if (!rel) continue;
      const typeId = (rel.RelatingType as { value?: number } | null)?.value;
      if (!typeId) continue;
      const typeObj = api.GetLine(modelId, typeId, false, false) as Record<string, unknown> | null;
      const typePsets = Array.isArray(typeObj?.HasPropertySets) ? typeObj!.HasPropertySets as { value?: number }[] : [];
      const psetIds = typePsets.map(p => p?.value).filter((v): v is number => !!v);
      if (psetIds.length === 0) continue;
      const objs = toRefArray(rel.RelatedObjects);
      for (const o of objs) {
        const eid = o?.value;
        if (!eid) continue;
        const arr = relTypeIndex.get(eid);
        if (arr) arr.push(...psetIds); else relTypeIndex.set(eid, [...psetIds]);
      }
    }
  } catch { /* ignore */ }

  // Build child → parent aggregation index from IfcRelAggregates and IfcRelDecomposes.
  // Needed for IfcBuildingElementPart and similar parts that carry no own PSets —
  // their PSets live on the parent assembly/element.
  const parentIndex = new Map<number, number>();
  const AGG_TYPES = [WebIFC.IFCRELAGGREGATES, WebIFC.IFCRELDECOMPOSES];
  for (const relType of AGG_TYPES) {
    try {
      const relIds = api.GetLineIDsWithType(modelId, relType);
      const total = relIds.size();
      for (let i = 0; i < total; i++) {
        const rel = api.GetLine(modelId, relIds.get(i), false, false) as Record<string, unknown> | null;
        if (!rel) continue;
        const parentId = (rel.RelatingObject as { value?: number } | null)?.value;
        if (!parentId) continue;
        const children = toRefArray(rel.RelatedObjects);
        for (const c of children) {
          const childId = c?.value;
          if (childId) parentIndex.set(childId, parentId);
        }
      }
    } catch { /* type may not exist in this schema */ }
  }

  cached.relDefIndex = relDefIndex;
  cached.relTypeIndex = relTypeIndex;
  cached.parentIndex = parentIndex;
}

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
  const cached = await getOrOpenPropModel(file);
  const { api, modelId } = cached;

  const props: Record<string, unknown> = {};
  const psets: PropertySet[] = [];
  const seenPsetIds = new Set<number>();

  // Keep wrapped {value, type} objects so the UI's isIfcRef() filter hides handles (type=5).
  try {
    const itemProps = await api.properties.getItemProperties(modelId, expressId, false);
    if (itemProps) {
      for (const [k, v] of Object.entries(itemProps as Record<string, unknown>)) {
        if (k !== "expressID") props[k] = v;
      }
    }
  } catch { /* ignore */ }

  // Build forward index on first use (O(R+T), cached afterwards).
  // This is schema-independent and works for all IFC element types including
  // IfcPile and other IFC4.x types where web-ifc inverse lookup is unreliable.
  buildRelDefIndex(cached);

  const addPset = async (psetId: number) => {
    if (seenPsetIds.has(psetId)) return;
    seenPsetIds.add(psetId);
    await loadAndParsePset(api, modelId, psetId, psets);
  };

  // Instance psets via forward index (IfcRelDefinesByProperties)
  for (const psetId of cached.relDefIndex?.get(expressId) ?? []) {
    await addPset(psetId);
  }

  // Type psets via forward index (IfcRelDefinesByType)
  for (const psetId of cached.relTypeIndex?.get(expressId) ?? []) {
    await addPset(psetId);
  }

  // Fallback: also try inverse-based lookup in case the index missed anything
  // (e.g. elements added after index was built, or IFC2X3 edge cases).
  let elemLine: RawLine | null = null;
  try { elemLine = api.GetLine(modelId, expressId, false, true) as RawLine | null; } catch { /* ignore */ }

  for (const ref of toRefArray(elemLine?.IsDefinedBy)) {
    const relId = ref?.value;
    if (!relId) continue;
    try {
      const rel = api.GetLine(modelId, relId, false, false) as RawLine | null;
      if (!rel?.RelatingPropertyDefinition) continue;
      for (const pref of toRefArray(rel.RelatingPropertyDefinition)) {
        const psetId = pref?.value;
        if (psetId) await addPset(psetId);
      }
    } catch { /* skip */ }
  }

  // Fallback: inherit from aggregation parent when element has no own psets.
  // Uses the forward parentIndex (IfcRelAggregates + IfcRelDecomposes) —
  // schema-independent, covers IfcBuildingElementPart, IfcDiscreteAccessory, etc.
  if (psets.length === 0) {
    const parentId = cached.parentIndex?.get(expressId);
    if (parentId) {
      for (const psetId of cached.relDefIndex?.get(parentId) ?? []) await addPset(psetId);
      for (const psetId of cached.relTypeIndex?.get(parentId) ?? []) await addPset(psetId);
      // Walk one more level up (part → assembly → building element)
      if (psets.length === 0) {
        const grandParentId = cached.parentIndex?.get(parentId);
        if (grandParentId) {
          for (const psetId of cached.relDefIndex?.get(grandParentId) ?? []) await addPset(psetId);
          for (const psetId of cached.relTypeIndex?.get(grandParentId) ?? []) await addPset(psetId);
        }
      }
    }
  }

  return { properties: props, psets };
}

function toRefArray(v: unknown): { value?: number }[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v as { value?: number }[];
  return [v as { value?: number }];
}

async function loadAndParsePset(
  api: WebIFC.IfcAPI,
  modelId: number,
  psetId: number,
  out: PropertySet[]
): Promise<void> {
  try {
    const pset = api.GetLine(modelId, psetId, true) as RawLine | null;
    if (!pset) return;
    const parsed = parsePsetLine(pset);
    if (parsed.properties.length > 0) out.push(parsed);
  } catch { /* skip malformed pset */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Basket property loading (opens file once, reads multiple elements with psets)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadBasketProperties(
  file: File,
  expressIds: number[]
): Promise<Map<number, { properties: Record<string, unknown>; psets: PropertySet[] }>> {
  const cached = await getOrOpenPropModel(file);
  const { api, modelId } = cached;
  const result = new Map<number, { properties: Record<string, unknown>; psets: PropertySet[] }>();

  buildRelDefIndex(cached);

  for (const eid of expressIds) {
    const props: Record<string, unknown> = {};
    const psets: PropertySet[] = [];
    const seenPsetIds = new Set<number>();

    const addPset = async (psetId: number) => {
      if (seenPsetIds.has(psetId)) return;
      seenPsetIds.add(psetId);
      await loadAndParsePset(api, modelId, psetId, psets);
    };

    try {
      const itemProps = await api.properties.getItemProperties(modelId, eid, false);
      if (itemProps) {
        for (const [k, v] of Object.entries(itemProps as Record<string, unknown>)) {
          if (k === "expressID") continue;
          const scalar = (v as { value?: unknown } | null)?.value;
          props[k] = scalar !== undefined ? scalar : v;
        }
      }
    } catch { /* ignore */ }

    // Use forward index (schema-independent, reliable for all IFC types)
    for (const psetId of cached.relDefIndex?.get(eid) ?? []) await addPset(psetId);
    for (const psetId of cached.relTypeIndex?.get(eid) ?? []) await addPset(psetId);

    // Inverse fallback for edge cases
    let elemLine: RawLine | null = null;
    try { elemLine = api.GetLine(modelId, eid, false, true) as RawLine | null; } catch { /* ignore */ }
    for (const ref of toRefArray(elemLine?.IsDefinedBy)) {
      const relId = ref?.value;
      if (!relId) continue;
      try {
        const rel = api.GetLine(modelId, relId, false, false) as RawLine | null;
        if (!rel?.RelatingPropertyDefinition) continue;
        for (const pref of toRefArray(rel.RelatingPropertyDefinition)) {
          const psetId = pref?.value;
          if (psetId) await addPset(psetId);
        }
      } catch { /* skip */ }
    }

    // Aggregation parent fallback — uses forward parentIndex, no inverse lookups
    if (psets.length === 0) {
      const parentId = cached.parentIndex?.get(eid);
      if (parentId) {
        for (const psetId of cached.relDefIndex?.get(parentId) ?? []) await addPset(psetId);
        for (const psetId of cached.relTypeIndex?.get(parentId) ?? []) await addPset(psetId);
        if (psets.length === 0) {
          const grandParentId = cached.parentIndex?.get(parentId);
          if (grandParentId) {
            for (const psetId of cached.relDefIndex?.get(grandParentId) ?? []) await addPset(psetId);
            for (const psetId of cached.relTypeIndex?.get(grandParentId) ?? []) await addPset(psetId);
          }
        }
      }
    }

    result.set(eid, { properties: props, psets });
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

type RawLine = Record<string, unknown>;

function extractPropValue(prop: RawLine): unknown {
  // IfcPropertySingleValue
  if (prop.NominalValue !== undefined) return extractScalar(prop.NominalValue);

  // IfcQuantity* — each subtype has its own value field
  for (const field of ["LengthValue", "AreaValue", "VolumeValue", "CountValue", "WeightValue", "TimeValue"]) {
    if (prop[field] !== undefined) return extractScalar(prop[field]);
  }

  // IfcPropertyEnumeratedValue
  if (Array.isArray(prop.EnumerationValues)) {
    return (prop.EnumerationValues as unknown[]).map(v => extractScalar(v)).join(", ");
  }

  // IfcPropertyBoundedValue
  if (prop.UpperBoundValue !== undefined || prop.LowerBoundValue !== undefined) {
    const lo = extractScalar(prop.LowerBoundValue);
    const hi = extractScalar(prop.UpperBoundValue);
    return `${lo ?? ""}…${hi ?? ""}`;
  }

  // IfcPropertyListValue
  if (Array.isArray(prop.ListValues)) {
    return (prop.ListValues as unknown[]).map(v => extractScalar(v)).join(", ");
  }

  // IfcPropertyTableValue — use defining values as a summary
  if (Array.isArray(prop.DefiningValues)) {
    return (prop.DefiningValues as unknown[]).map(v => extractScalar(v)).join(", ");
  }

  // IfcPropertyReferenceValue
  if (prop.PropertyReference !== undefined) return extractScalar(prop.PropertyReference);

  // Generic fallback
  if (prop.Value !== undefined) return extractScalar(prop.Value);

  return null;
}

function parsePsetLine(pset: RawLine): { name: string; properties: PropertySet["properties"] } {
  const name = String((pset.Name as { value?: string } | undefined)?.value ?? "PropertySet");
  const props: PropertySet["properties"] = [];

  // IfcPropertySet → HasProperties
  const hasProp = pset.HasProperties;
  if (Array.isArray(hasProp)) {
    for (const prop of hasProp as RawLine[]) {
      if (!prop) continue;
      const propName = String((prop.Name as { value?: string } | undefined)?.value ?? "");
      if (!propName) continue;
      props.push({ name: propName, value: extractPropValue(prop), type: String(prop.type ?? "") });
    }
  }

  // IfcElementQuantity → Quantities
  const quantities = pset.Quantities;
  if (Array.isArray(quantities)) {
    for (const qty of quantities as RawLine[]) {
      if (!qty) continue;
      const propName = String((qty.Name as { value?: string } | undefined)?.value ?? "");
      if (!propName) continue;
      props.push({ name: propName, value: extractPropValue(qty), type: String(qty.type ?? "") });
    }
  }

  // IfcPreDefinedPropertySet subtypes expose fixed attributes directly
  // (e.g. IfcDoorLiningProperties, IfcWindowPanelProperties, etc.)
  const SKIP_KEYS = new Set(["expressID", "type", "GlobalId", "OwnerHistory", "Name", "Description"]);
  if (props.length === 0 && hasProp === undefined && quantities === undefined) {
    for (const [k, v] of Object.entries(pset)) {
      if (SKIP_KEYS.has(k)) continue;
      props.push({ name: k, value: extractScalar(v), type: "" });
    }
  }

  return { name, properties: props };
}

function applyPset(
  pset: RawLine,
  eids: Iterable<number>,
  result: Map<number, FlatElementProps>,
) {
  const { name: psetName, properties } = parsePsetLine(pset);
  if (properties.length === 0) return;
  for (const eid of eids) {
    const flat = result.get(eid);
    if (!flat) continue;
    for (const { name, value } of properties) {
      if (!name) continue;
      flat[`${psetName}.${name}`] = value;
      if (!(name in flat)) flat[name] = value;
    }
  }
}

/**
 * Loads all element properties in a single optimized pass.
 *
 * Instead of calling getPropertySets() per element (which runs
 * GetInversePropertyForItem on every element — O(N×R) WASM calls),
 * this function:
 *   1. Batch-reads direct item properties via GetLines()
 *   2. Loads all IfcRelDefinesByProperties relationships once
 *   3. Builds a psetId → elementIds index
 *   4. Loads each unique property set exactly once and distributes it
 *   5. Repeats for type-level sets via IfcRelDefinesByType
 *
 * Complexity: O(R + P) instead of O(N × R).
 * Typical speedup on large models: 20–50×.
 */
const YIELD_EVERY = 80;
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function loadAllElementProperties(
  file: File,
  expressIds: number[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<number, FlatElementProps>> {
  const { api, modelId } = await getOrOpenPropModel(file);
  const result = new Map<number, FlatElementProps>();

  const eidSet = new Set(expressIds);

  let lines: unknown[];
  try {
    lines = api.GetLines(modelId, expressIds, false, false);
  } catch {
    lines = [];
    for (let i = 0; i < expressIds.length; i++) {
      try { lines.push(api.GetLine(modelId, expressIds[i])); } catch { lines.push(null); }
      if (i % YIELD_EVERY === 0) await yieldToMain();
    }
  }
  for (let i = 0; i < expressIds.length; i++) {
    const flat: FlatElementProps = {};
    const line = lines[i] as RawLine | null;
    if (line) {
      for (const [k, v] of Object.entries(line)) {
        if (k !== "expressID" && k !== "type") flat[k] = extractScalar(v);
      }
    }
    result.set(expressIds[i], flat);
  }
  onProgress?.(Math.round(expressIds.length * 0.2), expressIds.length);
  await yieldToMain();

  {
    const relIds     = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYPROPERTIES);
    const psetToEids = new Map<number, Set<number>>();
    const total      = relIds.size();

    for (let i = 0; i < total; i++) {
      const rel = api.GetLine(modelId, relIds.get(i)) as RawLine | null;
      if (rel) {
        const psetId = (rel.RelatingPropertyDefinition as { value?: number } | null)?.value;
        if (psetId) {
          const related = toRefArray(rel.RelatedObjects);
          for (const obj of related) {
            const eid = obj?.value;
            if (eid && eidSet.has(eid)) {
              if (!psetToEids.has(psetId)) psetToEids.set(psetId, new Set());
              psetToEids.get(psetId)!.add(eid);
            }
          }
        }
      }
      if (i % YIELD_EVERY === 0) await yieldToMain();
    }

    let p = 0;
    for (const [psetId, eids] of psetToEids) {
      try {
        const pset = api.GetLine(modelId, psetId, true) as RawLine | null;
        if (pset) applyPset(pset, eids, result);
      } catch { /* malformed pset */ }
      p++;
      if (p % YIELD_EVERY === 0) await yieldToMain();
    }
  }
  onProgress?.(Math.round(expressIds.length * 0.7), expressIds.length);
  await yieldToMain();

  {
    const relIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYTYPE);
    const total  = relIds.size();

    for (let i = 0; i < total; i++) {
      const rel = api.GetLine(modelId, relIds.get(i)) as RawLine | null;
      if (rel) {
        const typeId = (rel.RelatingType as { value?: number } | null)?.value;
        if (typeId) {
          const eids = new Set<number>();
          const related = toRefArray(rel.RelatedObjects);
          for (const obj of related) {
            const eid = obj?.value;
            if (eid && eidSet.has(eid)) eids.add(eid);
          }
          if (eids.size > 0) {
            const typeObj = api.GetLine(modelId, typeId) as RawLine | null;
            if (typeObj) {
              const psetRefs = Array.isArray(typeObj.HasPropertySets)
                ? typeObj.HasPropertySets as { value?: number }[]
                : [];
              for (const ref of psetRefs) {
                const psetId = ref?.value;
                if (!psetId) continue;
                try {
                  const pset = api.GetLine(modelId, psetId, true) as RawLine | null;
                  if (pset) applyPset(pset, eids, result);
                } catch { /* skip */ }
              }
            }
          }
        }
      }
      if (i % YIELD_EVERY === 0) await yieldToMain();
    }
  }
  onProgress?.(expressIds.length, expressIds.length);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spatial structure + element-type extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * German display labels for well-known IFC types.
 * Types NOT listed here fall back to their IFC class name (e.g. "IfcTendonAnchor").
 * This map is for UX quality only — completeness is handled by CANDIDATE_TYPE_CODES.
 */
const ELEMENT_LABELS: Partial<Record<number, string>> = {
  // Walls
  [WebIFC.IFCWALL]:                    "Wand",
  [WebIFC.IFCWALLSTANDARDCASE]:        "Wand",
  [WebIFC.IFCWALLELEMENTEDCASE]:       "Wand",
  [WebIFC.IFCCURTAINWALL]:             "Vorhangfassade",
  // Slabs / Plates
  [WebIFC.IFCSLAB]:                    "Decke/Platte",
  [WebIFC.IFCSLABSTANDARDCASE]:        "Decke/Platte",
  [WebIFC.IFCSLABELEMENTEDCASE]:       "Decke/Platte",
  [WebIFC.IFCPLATE]:                   "Platte",
  [WebIFC.IFCPLATESTANDARDCASE]:       "Platte",
  // Beams / Columns / Members
  [WebIFC.IFCBEAM]:                    "Träger",
  [WebIFC.IFCBEAMSTANDARDCASE]:        "Träger",
  [WebIFC.IFCCOLUMN]:                  "Stütze",
  [WebIFC.IFCCOLUMNSTANDARDCASE]:      "Stütze",
  [WebIFC.IFCMEMBER]:                  "Stabwerk",
  [WebIFC.IFCMEMBERSTANDARDCASE]:      "Stabwerk",
  // Openings / Doors / Windows
  [WebIFC.IFCDOOR]:                    "Tür",
  [WebIFC.IFCDOORSTANDARDCASE]:        "Tür",
  [WebIFC.IFCWINDOW]:                  "Fenster",
  [WebIFC.IFCWINDOWSTANDARDCASE]:      "Fenster",
  [WebIFC.IFCOPENINGELEMENT]:          "Öffnung",
  [WebIFC.IFCVOIDINGFEATURE]:          "Aussparung",
  // Roof / Stair / Railing
  [WebIFC.IFCROOF]:                    "Dach",
  [WebIFC.IFCSTAIR]:                   "Treppe",
  [WebIFC.IFCSTAIRFLIGHT]:             "Treppenflug",
  [WebIFC.IFCRAILING]:                 "Geländer",
  [WebIFC.IFCRAMP]:                    "Rampe",
  [WebIFC.IFCRAMPFLIGHT]:              "Rampenflucht",
  // Foundation / Earthworks
  [WebIFC.IFCFOOTING]:                 "Fundament",
  [WebIFC.IFCPILE]:                    "Pfahl",
  [WebIFC.IFCEARTHWORKSCUT]:           "Erdschnitt",
  [WebIFC.IFCEARTHWORKSFILL]:          "Erdaufschüttung",
  // Reinforcement
  [WebIFC.IFCREINFORCINGBAR]:          "Bewehrungsstab",
  [WebIFC.IFCREINFORCINGMESH]:         "Bewehrungsmatte",
  [WebIFC.IFCREINFORCINGELEMENT]:      "Bewehrung",
  [WebIFC.IFCTENDON]:                  "Spannglied",
  [WebIFC.IFCTENDONANCHOR]:            "Spanngliedanker",
  [WebIFC.IFCTENDONCONDUIT]:           "Spanngliedhüllrohr",
  // Element components / accessories
  [1335981549]:                        "Zubehör",            // IfcDiscreteAccessory
  [647756555]:                         "Verbindungsmittel",  // IfcFastener
  [377706215]:                         "Mech. Verbindungsmittel", // IfcMechanicalFastener
  // Assemblies / parts
  [4123344466]:                        "Baugruppe",          // IfcElementAssembly
  [2979338954]:                        "Bauteil",            // IfcBuildingElementPart
  [3651124850]:                        "Vorsprung",          // IfcProjectionElement
  // Chimney
  [3296154744]:                        "Schornstein",        // IfcChimney
  // Coverings / Cladding
  [WebIFC.IFCCOVERING]:                "Verkleidung",
  [WebIFC.IFCSHADINGDEVICE]:           "Verschattung",
  // Spaces / Zones
  [WebIFC.IFCSPACE]:                   "Raum",
  [WebIFC.IFCZONE]:                    "Zone",
  [WebIFC.IFCEXTERNALSPATIALELEMENT]:  "Außenraum",
  [WebIFC.IFCSPATIALZONE]:             "Raumzone",
  // Furniture / Equipment
  [WebIFC.IFCFURNISHINGELEMENT]:       "Möbel",
  [WebIFC.IFCSYSTEMFURNITUREELEMENT]:  "Systemmöbel",
  [WebIFC.IFCMEDICALDEVICE]:           "Medizingerät",
  // MEP — Piping / Ducts
  [WebIFC.IFCPIPESEGMENT]:             "Rohr",
  [WebIFC.IFCPIPEFITTING]:             "Rohrformstück",
  [WebIFC.IFCDUCTSEGMENT]:             "Lüftungskanal",
  [WebIFC.IFCDUCTFITTING]:             "Lüftungsformstück",
  [WebIFC.IFCDUCTSILENCER]:            "Schalldämpfer",
  [WebIFC.IFCFLOWSEGMENT]:             "Leitungssegment",
  [WebIFC.IFCFLOWFITTING]:             "Leitungsformstück",
  // MEP — Cables
  [WebIFC.IFCCABLESEGMENT]:            "Kabel",
  [WebIFC.IFCCABLEFITTING]:            "Kabelformstück",
  [WebIFC.IFCCABLECARRIERSEGMENT]:     "Kabeltragsystem",
  [WebIFC.IFCCABLECARRIERFITTING]:     "Kabeltragsystem-Formstück",
  // MEP — Terminals / Fixtures
  [WebIFC.IFCAIRTERMINAL]:             "Luftauslass",
  [WebIFC.IFCAIRTERMINALBOX]:          "Luftdosierbox",
  [WebIFC.IFCLAMP]:                    "Klemme",
  [WebIFC.IFCLIGHTFIXTURE]:            "Leuchte",
  [WebIFC.IFCOUTLET]:                  "Steckdose",
  [WebIFC.IFCSANITARYTERMINAL]:        "Sanitärobjekt",
  [WebIFC.IFCSTACKTERMINAL]:           "Lüftungsdachaufsatz",
  [WebIFC.IFCFIRESUPPRESSIONTERMINAL]: "Feuerlöschanlage",
  [WebIFC.IFCWASTETERMINAL]:           "Ablauf",
  [WebIFC.IFCELECTRICAPPLIANCE]:       "Elektrogerät",
  // MEP — Controllers / Sensors
  [WebIFC.IFCALARM]:                   "Alarm",
  [WebIFC.IFCACTUATOR]:                "Stellantrieb",
  [WebIFC.IFCSENSOR]:                  "Sensor",
  [WebIFC.IFCCONTROLLER]:              "Regler",
  [WebIFC.IFCPROTECTIVEDEVICE]:        "Schutzgerät",
  [WebIFC.IFCSWITCHINGDEVICE]:         "Schalter",
  [WebIFC.IFCELECTRICTIMECONTROL]:     "Zeitschalter",
  [WebIFC.IFCJUNCTIONBOX]:             "Verteilerkasten",
  [WebIFC.IFCELECTRICDISTRIBUTIONBOARD]: "Schaltschrank",
  // MEP — HVAC Equipment
  [WebIFC.IFCAIRTOAIRHEATRECOVERY]:    "Wärmetauscher",
  [WebIFC.IFCBOILER]:                  "Kessel",
  [WebIFC.IFCBURNER]:                  "Brenner",
  [WebIFC.IFCCHILLER]:                 "Kältemaschine",
  [WebIFC.IFCCOIL]:                    "Wärmetauscher-Coil",
  [WebIFC.IFCCONDENSER]:               "Kondensator",
  [WebIFC.IFCCOOLEDBEAM]:              "Kühldecke",
  [WebIFC.IFCCOOLINGTOWER]:            "Kühlturm",
  [WebIFC.IFCDAMPER]:                  "Klappe",
  [WebIFC.IFCELECTRICGENERATOR]:       "Generator",
  [WebIFC.IFCELECTRICMOTOR]:           "Elektromotor",
  [WebIFC.IFCENGINE]:                  "Motor",
  [WebIFC.IFCEVAPORATIVECOOLER]:       "Verdunstungskühler",
  [WebIFC.IFCEVAPORATOR]:              "Verdampfer",
  [WebIFC.IFCFAN]:                     "Ventilator",
  [WebIFC.IFCFILTER]:                  "Filter",
  [WebIFC.IFCFLOWMETER]:               "Durchflussmesser",
  [WebIFC.IFCHEATEXCHANGER]:           "Wärmetauscher",
  [WebIFC.IFCHUMIDIFIER]:              "Befeuchter",
  [WebIFC.IFCINTERCEPTOR]:             "Abscheider",
  [WebIFC.IFCMOTORCONNECTION]:         "Motoranschluss",
  [WebIFC.IFCPUMP]:                    "Pumpe",
  [WebIFC.IFCSOLARDEVICE]:             "Solaranlage",
  [WebIFC.IFCSPACEHEATER]:             "Heizkörper",
  [WebIFC.IFCTANK]:                    "Tank",
  [WebIFC.IFCTRANSFORMER]:             "Transformator",
  [WebIFC.IFCTUBEBUNDLE]:              "Rohrbündelwärmetauscher",
  [WebIFC.IFCUNITARYEQUIPMENT]:        "Klimagerät",
  [WebIFC.IFCVALVE]:                   "Ventil",
  [WebIFC.IFCVIBRATIONISOLATOR]:       "Schwingungsdämpfer",
  // Transport
  [WebIFC.IFCTRANSPORTELEMENT]:        "Fördertechnik",
  // Civil / Infrastructure
  [WebIFC.IFCCIVILELEMENT]:            "Infrastrukturelement",
  [WebIFC.IFCBUILDINGELEMENTPROXY]:    "Generisches Element",
  [WebIFC.IFCGEOGRAPHICELEMENT]:       "Geographisches Element",
  [WebIFC.IFCANNOTATION]:              "Annotation",
  [WebIFC.IFCVIRTUALELEMENT]:          "Virtuelles Element",
  // Roads / Railways (IFC4.3)
  [WebIFC.IFCPAVEMENT]:                "Fahrbahndecke",
  [WebIFC.IFCKERB]:                    "Bordstein",
  [WebIFC.IFCROAD]:                    "Straße",
  [WebIFC.IFCRAILWAY]:                 "Bahn",
  [WebIFC.IFCBRIDGE]:                  "Brücke",
  [WebIFC.IFCBRIDGEPART]:              "Brückenteil",
  [WebIFC.IFCFACILITY]:                "Anlage",
  [WebIFC.IFCFACILITYPART]:            "Anlagenteil",
  [WebIFC.IFCALIGNMENT]:               "Trasse",
  [WebIFC.IFCSIGN]:                    "Schild",
  [WebIFC.IFCSIGNAL]:                  "Signal",
  [WebIFC.IFCLINEARPOSITIONINGELEMENT]: "Linienpositionierung",
  // Storage / Misc
  [WebIFC.IFCELECTRICFLOWSTORAGEDEVICE]: "Stromspeicher",
};

/**
 * Maps German display labels → canonical IFC schema names (CamelCase).
 * Used by the Clash Detection UI so that allTypes contains proper IFC names
 * that the server can pass to model.by_type().
 *
 * Multiple type codes that share the same German label (e.g. IfcWall +
 * IfcWallStandardCase → "Wand") are mapped to the base IFC type; the server's
 * by_type(…, include_subtypes=True) call handles all variants automatically.
 */
export const LABEL_TO_IFC: Record<string, string> = {
  "Wand":                       "IfcWall",
  "Vorhangfassade":             "IfcCurtainWall",
  "Decke/Platte":               "IfcSlab",
  "Platte":                     "IfcPlate",
  "Träger":                     "IfcBeam",
  "Stütze":                     "IfcColumn",
  "Stabwerk":                   "IfcMember",
  "Tür":                        "IfcDoor",
  "Fenster":                    "IfcWindow",
  "Öffnung":                    "IfcOpeningElement",
  "Aussparung":                 "IfcVoidingFeature",
  "Dach":                       "IfcRoof",
  "Treppe":                     "IfcStair",
  "Treppenflug":                "IfcStairFlight",
  "Geländer":                   "IfcRailing",
  "Rampe":                      "IfcRamp",
  "Rampenflucht":               "IfcRampFlight",
  "Fundament":                  "IfcFooting",
  "Pfahl":                      "IfcPile",
  "Erdschnitt":                 "IfcEarthworksCut",
  "Erdaufschüttung":            "IfcEarthworksFill",
  "Bewehrungsstab":             "IfcReinforcingBar",
  "Bewehrungsmatte":            "IfcReinforcingMesh",
  "Bewehrung":                  "IfcReinforcingElement",
  "Spannglied":                 "IfcTendon",
  "Spanngliedanker":            "IfcTendonAnchor",
  "Spanngliedhüllrohr":         "IfcTendonConduit",
  "Zubehör":                    "IfcDiscreteAccessory",
  "Verbindungsmittel":          "IfcFastener",
  "Mech. Verbindungsmittel":    "IfcMechanicalFastener",
  "Baugruppe":                  "IfcElementAssembly",
  "Bauteil":                    "IfcBuildingElementPart",
  "Vorsprung":                  "IfcProjectionElement",
  "Schornstein":                "IfcChimney",
  "Verkleidung":                "IfcCovering",
  "Verschattung":               "IfcShadingDevice",
  "Raum":                       "IfcSpace",
  "Zone":                       "IfcZone",
  "Außenraum":                  "IfcExternalSpatialElement",
  "Raumzone":                   "IfcSpatialZone",
  "Möbel":                      "IfcFurnishingElement",
  "Systemmöbel":                "IfcSystemFurnitureElement",
  "Medizingerät":               "IfcMedicalDevice",
  "Rohr":                       "IfcPipeSegment",
  "Rohrformstück":              "IfcPipeFitting",
  "Lüftungskanal":              "IfcDuctSegment",
  "Lüftungsformstück":          "IfcDuctFitting",
  "Schalldämpfer":              "IfcDuctSilencer",
  "Leitungssegment":            "IfcFlowSegment",
  "Leitungsformstück":          "IfcFlowFitting",
  "Kabel":                      "IfcCableSegment",
  "Kabelformstück":             "IfcCableFitting",
  "Kabeltragsystem":            "IfcCableCarrierSegment",
  "Kabeltragsystem-Formstück":  "IfcCableCarrierFitting",
  "Luftauslass":                "IfcAirTerminal",
  "Luftdosierbox":              "IfcAirTerminalBox",
  "Klemme":                     "IfcLamp",
  "Leuchte":                    "IfcLightFixture",
  "Steckdose":                  "IfcOutlet",
  "Sanitärobjekt":              "IfcSanitaryTerminal",
  "Lüftungsdachaufsatz":        "IfcStackTerminal",
  "Feuerlöschanlage":           "IfcFireSuppressionTerminal",
  "Ablauf":                     "IfcWasteTerminal",
  "Elektrogerät":               "IfcElectricAppliance",
  "Alarm":                      "IfcAlarm",
  "Stellantrieb":               "IfcActuator",
  "Sensor":                     "IfcSensor",
  "Regler":                     "IfcController",
  "Schutzgerät":                "IfcProtectiveDevice",
  "Schalter":                   "IfcSwitchingDevice",
  "Zeitschalter":               "IfcElectricTimeControl",
  "Verteilerkasten":            "IfcJunctionBox",
  "Schaltschrank":              "IfcElectricDistributionBoard",
  "Wärmetauscher":              "IfcAirToAirHeatRecovery",
  "Wärmetauscher-Coil":         "IfcCoil",
  "Kessel":                     "IfcBoiler",
  "Brenner":                    "IfcBurner",
  "Kältemaschine":              "IfcChiller",
  "Kondensator":                "IfcCondenser",
  "Kühldecke":                  "IfcCooledBeam",
  "Kühlturm":                   "IfcCoolingTower",
  "Klappe":                     "IfcDamper",
  "Generator":                  "IfcElectricGenerator",
  "Elektromotor":               "IfcElectricMotor",
  "Motor":                      "IfcEngine",
  "Verdunstungskühler":         "IfcEvaporativeCooler",
  "Verdampfer":                 "IfcEvaporator",
  "Ventilator":                 "IfcFan",
  "Filter":                     "IfcFilter",
  "Durchflussmesser":           "IfcFlowMeter",
  "Befeuchter":                 "IfcHumidifier",
  "Abscheider":                 "IfcInterceptor",
  "Motoranschluss":             "IfcMotorConnection",
  "Pumpe":                      "IfcPump",
  "Solaranlage":                "IfcSolarDevice",
  "Heizkörper":                 "IfcSpaceHeater",
  "Tank":                       "IfcTank",
  "Transformator":              "IfcTransformer",
  "Rohrbündelwärmetauscher":    "IfcTubeBundle",
  "Klimagerät":                 "IfcUnitaryEquipment",
  "Ventil":                     "IfcValve",
  "Schwingungsdämpfer":         "IfcVibrationIsolator",
  "Fördertechnik":              "IfcTransportElement",
  "Infrastrukturelement":       "IfcCivilElement",
  "Generisches Element":        "IfcBuildingElementProxy",
  "Geographisches Element":     "IfcGeographicElement",
  "Annotation":                 "IfcAnnotation",
  "Virtuelles Element":         "IfcVirtualElement",
  "Fahrbahndecke":              "IfcPavement",
  "Bordstein":                  "IfcKerb",
  "Straße":                     "IfcRoad",
  "Bahn":                       "IfcRailway",
  "Brücke":                     "IfcBridge",
  "Brückenteil":                "IfcBridgePart",
  "Anlage":                     "IfcFacility",
  "Anlagenteil":                "IfcFacilityPart",
  "Trasse":                     "IfcAlignment",
  "Schild":                     "IfcSign",
  "Signal":                     "IfcSignal",
  "Linienpositionierung":       "IfcLinearPositioningElement",
  "Stromspeicher":              "IfcElectricFlowStorageDevice",
  "Standort":                   "IfcSite",
  "Gebäude":                    "IfcBuilding",
  "Geschoss":                   "IfcBuildingStorey",
};

/** Reverse of LABEL_TO_IFC: IFC schema name → German display label. */
export const IFC_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(LABEL_TO_IFC).map(([label, ifc]) => [ifc, label])
);

/**
 * Returns true for IFC type names that represent physical objects/products
 * (elements, spatial structure, annotations) and should appear in the browser.
 *
 * Uses a blacklist of non-element type name prefixes derived from the IFC schema
 * taxonomy so that any IFC version (2x3, 4, 4.3) works without hardcoding class lists.
 */
function isPhysicalElementType(typeName: string): boolean {
  const n = typeName.toUpperCase();

  // Relationships — never physical elements
  if (n.startsWith("IFCREL")) return false;

  // Property / quantity definitions
  if (n.startsWith("IFCPROPERTYSET") || n.startsWith("IFCPROPERTYTEMPLATE") ||
      n.startsWith("IFCPROPERTYDEFINITION") || n.startsWith("IFCPREDEFINED") ||
      n.startsWith("IFCQUANTITY") || n.startsWith("IFCELEMENTQUANTITY")) return false;

  // Materials
  if (n.startsWith("IFCMATERIAL")) return false;

  // Cross-section profiles
  if (n.startsWith("IFCPROFILEDEF") || n.startsWith("IFCARBITRARYPROFILE") ||
      n.startsWith("IFCARBITRARYCLOSED") || n.startsWith("IFCARBITRARYOPEN") ||
      n.startsWith("IFCCOMPOSITEPROFILE") || n.startsWith("IFCDERIVEDPROFILE") ||
      n.startsWith("IFCPARAMETERIZEDPROFILE") || n.startsWith("IFCCIRCLEPROFILE") ||
      n.startsWith("IFCELLIPSEPROFILE") || n.startsWith("IFCRECTANGLEPROFILE") ||
      n.startsWith("IFCROUNDEDRECTANGLE") || n.startsWith("IFCASYMMETRIC") ||
      n.startsWith("IFCI_SHAPE") || n.startsWith("IFCL_SHAPE") ||
      n.startsWith("IFCT_SHAPE") || n.startsWith("IFCU_SHAPE") ||
      n.startsWith("IFCZ_SHAPE") || n.startsWith("IFCCENTER")) return false;

  // Geometry/representation containers
  if (n.startsWith("IFCREPRESENTATION") || n.startsWith("IFCSHAPEASPECT") ||
      n.startsWith("IFCPRODUCTDEFINITIONSHAPE") || n.startsWith("IFCGEOMETRIC")) return false;

  // Geometry primitives (solids, surfaces, curves, topology)
  if (n.startsWith("IFCEXTRUDED") || n.startsWith("IFCREVOLVED") ||
      n.startsWith("IFCSWEPT") || n.startsWith("IFCBOOLEAN") ||
      n.startsWith("IFCHALFSPACE") || n.startsWith("IFCADVANCED") ||
      n.startsWith("IFCMANIFOLD") || n.startsWith("IFCFACETED") ||
      n.startsWith("IFCSHELLBASED") || n.startsWith("IFCCLOSEDSHELL") ||
      n.startsWith("IFCOPENSHELL")) return false;

  // Topology
  if (n.startsWith("IFCFACE") || n.startsWith("IFCEDGE") ||
      n.startsWith("IFCVERTEX") || n.startsWith("IFCLOOP") ||
      n.startsWith("IFCSUBEDGE") || n.startsWith("IFCORIENTED")) return false;

  // Curves and points
  if (n.startsWith("IFCCIRCLE") || n.startsWith("IFCELLIPSE") ||
      n.startsWith("IFCLINE") || n.startsWith("IFCBSPLINE") ||
      n.startsWith("IFCNURBS") || n.startsWith("IFCRATIONALB") ||
      n.startsWith("IFCCOMPOSITE") || n.startsWith("IFCTRIMMED") ||
      n.startsWith("IFCOFFSET") || n.startsWith("IFCINDEXEDPOLY") ||
      n.startsWith("IFCGRADIENT") || n.startsWith("IFCCLOTHOID") ||
      n.startsWith("IFCPOLY") || n.startsWith("IFCPOINT") ||
      n.startsWith("IFCVECTOR") || n.startsWith("IFCDIRECTION") ||
      n.startsWith("IFCPLANE") || n.startsWith("IFCCYLINDRICAL") ||
      n.startsWith("IFCSPHERE") || n.startsWith("IFCTOROIDAL") ||
      n.startsWith("IFCCURVEBOUNDED")) return false;

  // Placement / coordinate systems
  if (n.startsWith("IFCCARTESIAN") || n.startsWith("IFCAXIS") ||
      n.startsWith("IFCLOCALPLACEMENT") || n.startsWith("IFCGRIDPLACEMENT") ||
      n.startsWith("IFCLINEARPLACEMENT") || n.startsWith("IFCCENTRELINEPLACEMENT") ||
      n.startsWith("IFCLINEAXIS")) return false;

  // Units and measures
  if (n.startsWith("IFCSIUNIT") || n.startsWith("IFCUNIT") ||
      n.startsWith("IFCCONVERSION") || n.startsWith("IFCDERIVED") ||
      n.startsWith("IFCMEASURE") || n.startsWith("IFCNAMEDUNIT")) return false;

  // Owner / metadata
  if (n.startsWith("IFCOWNERHISTORY") || n.startsWith("IFCAPPLICATION") ||
      n.startsWith("IFCORGANIZATION") || n.startsWith("IFCPERSON") ||
      n.startsWith("IFCPOSTALADDRESS") || n.startsWith("IFCTELECOMADDRESS") ||
      n.startsWith("IFCADDRESS")) return false;

  // Styles / presentation
  if (n.startsWith("IFCPRESENTATION") || n.startsWith("IFCSTYLEDITEM") ||
      n.startsWith("IFCSTYLEDREPRESENTATION") || n.startsWith("IFCSURFACESTYLE") ||
      n.startsWith("IFCCOLOUR") || n.startsWith("IFCPIXEL") ||
      n.startsWith("IFCIMAGETEXTURE") || n.startsWith("IFCBLOBTEXTURE") ||
      n.startsWith("IFCTEXTUREMAP") || n.startsWith("IFCTEXTURECOORD") ||
      n.startsWith("IFCFILLAREA") || n.startsWith("IFCCURVESTYLE") ||
      n.startsWith("IFCTEXTLITERAL") || n.startsWith("IFCTEXTSTYLE") ||
      n.startsWith("IFCFONTSTYLE")) return false;

  // Library / document / approval
  if (n.startsWith("IFCDOCUMENT") || n.startsWith("IFCLIBRARY") ||
      n.startsWith("IFCAPPROVAL") || n.startsWith("IFCCLASSIFICATION") ||
      n.startsWith("IFCCONSTRAINT") || n.startsWith("IFCMETRIC") ||
      n.startsWith("IFCOBJECTIVE") || n.startsWith("IFCEXTERNALREFERENCE") ||
      n.startsWith("IFCEXTERNALINFORMATION")) return false;

  // Scheduling / work management
  if (n.startsWith("IFCTASK") || n.startsWith("IFCWORK") ||
      n.startsWith("IFCSCHEDULE") || n.startsWith("IFCEVENTTIME") ||
      n.startsWith("IFCLAGTIME") || n.startsWith("IFCWORKTIME") ||
      n.startsWith("IFCACTOR") || n.startsWith("IFCOCCUPANT")) return false;

  // Grid axes
  if (n.startsWith("IFCGRID")) return false;

  // Connection geometry
  if (n.startsWith("IFCCONNECTION")) return false;

  // Table / misc data structures
  if (n === "IFCTABLE" || n === "IFCTABLEROW" || n === "IFCTABLECOLUMN") return false;

  // Project root is not a physical element
  if (n === "IFCPROJECT") return false;

  return true;
}

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

    // web-ifc's getSpatialStructure misses two cases:
    // 1. IfcElementAssembly children (linked via IfcRelAggregates but not spatial containers)
    // 2. Spatial containers (storeys, buildings) that getSpatialStructure skips in some files
    // Fix: read all IfcRelAggregates, build a map, then attach any missing children to tree nodes.
    // Use flatten=false so RelatingObject / RelatedObjects stay as {value: number} references.
    const aggIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELAGGREGATES);
    const aggMap = new Map<number, number[]>();
    for (let i = 0; i < aggIds.size(); i++) {
      try {
        const rel = api.GetLine(modelId, aggIds.get(i), false, false) as Record<string, unknown> | null;
        if (!rel) continue;
        const relatingRaw = rel.RelatingObject;
        const relating = typeof relatingRaw === "object" && relatingRaw !== null
          ? (relatingRaw as { value?: number }).value
          : typeof relatingRaw === "number" ? relatingRaw : undefined;
        const relatedRaw = rel.RelatedObjects;
        const related = Array.isArray(relatedRaw) ? relatedRaw as Array<unknown> : [];
        if (!relating) continue;
        const childIds = related.map(r =>
          typeof r === "object" && r !== null ? (r as { value?: number }).value
          : typeof r === "number" ? r : undefined
        ).filter((v): v is number => v !== undefined);
        if (childIds.length) aggMap.set(relating, childIds);
      } catch { /* skip */ }
    }

    // Helper to make a node from an expressId
    const makeNode = (cid: number): SpatialNode => {
      const cLine = api.GetLine(modelId, cid, false) as Record<string, unknown> | null;
      const cType = api.GetNameFromTypeCode(api.GetLineType(modelId, cid)) || "IfcElement";
      return { expressId: cid, type: cType, name: getLabel(cLine) || cType, children: [] };
    };

    // Collect all expressIds currently in tree
    const inTree = new Set<number>();
    function markTree(n: SpatialNode) { inTree.add(n.expressId); n.children.forEach(markTree); }
    markTree(spatialTree);

    // Walk the tree and attach any aggregated children not yet present
    function resolveAgg(n: SpatialNode) {
      const childIds = aggMap.get(n.expressId);
      if (childIds) {
        for (const cid of childIds) {
          if (inTree.has(cid)) continue;
          const child = makeNode(cid);
          inTree.add(cid);
          n.children.push(child);
          resolveAgg(child);
        }
      }
      n.children.forEach(resolveAgg);
    }
    resolveAgg(spatialTree);

    const nestsIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELNESTS);
    const nestsMap = new Map<number, number[]>();
    for (let i = 0; i < nestsIds.size(); i++) {
      try {
        const rel = api.GetLine(modelId, nestsIds.get(i), false, false) as Record<string, unknown> | null;
        if (!rel) continue;
        const relatingRaw = rel.RelatingObject;
        const relating = typeof relatingRaw === "object" && relatingRaw !== null
          ? (relatingRaw as { value?: number }).value
          : typeof relatingRaw === "number" ? relatingRaw : undefined;
        const relatedRaw = rel.RelatedObjects;
        const related = Array.isArray(relatedRaw) ? relatedRaw as Array<unknown> : [];
        if (!relating) continue;
        const childIds = related.map(r =>
          typeof r === "object" && r !== null ? (r as { value?: number }).value
          : typeof r === "number" ? r : undefined
        ).filter((v): v is number => v !== undefined);
        if (childIds.length) nestsMap.set(relating, childIds);
      } catch { /* skip */ }
    }

    function resolveNests(n: SpatialNode) {
      const childIds = nestsMap.get(n.expressId);
      if (childIds) {
        for (const cid of childIds) {
          if (inTree.has(cid)) continue;
          const child = makeNode(cid);
          inTree.add(cid);
          n.children.push(child);
          resolveNests(child);
        }
      }
      n.children.forEach(resolveNests);
    }
    resolveNests(spatialTree);

    const containedIds = api.GetLineIDsWithType(modelId, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    const containerMap = new Map<number, ElementNode[]>();
    for (let i = 0; i < containedIds.size(); i++) {
      try {
        const rel = api.GetLine(modelId, containedIds.get(i), false, false) as Record<string, unknown> | null;
        if (!rel) continue;
        const structRaw = rel.RelatingStructure;
        const structId = typeof structRaw === "object" && structRaw !== null
          ? (structRaw as { value?: number }).value
          : typeof structRaw === "number" ? structRaw : undefined;
        if (!structId) continue;
        const relatedRaw = rel.RelatedElements;
        const related = Array.isArray(relatedRaw) ? relatedRaw as Array<unknown> : [];
        const elements: ElementNode[] = [];
        for (const r of related) {
          const cid = typeof r === "object" && r !== null ? (r as { value?: number }).value
            : typeof r === "number" ? r : undefined;
          if (!cid) continue;
          const cLine = api.GetLine(modelId, cid, false) as Record<string, unknown> | null;
          const cType = api.GetNameFromTypeCode(api.GetLineType(modelId, cid)) || "IfcElement";
          elements.push({ expressId: cid, type: cType, name: getLabel(cLine) || `${cType} #${cid}` });
        }
        if (elements.length > 0) containerMap.set(structId, elements);
      } catch { /* skip */ }
    }

    function applyContained(n: SpatialNode) {
      if (containerMap.has(n.expressId)) {
        n.elements = containerMap.get(n.expressId)!;
      }
      n.children.forEach(applyContained);
    }
    applyContained(spatialTree);

  } catch (e) {
    console.warn("[IFC] Spatial structure extraction failed:", e);
  }

  let allModelTypes: { typeID: number; typeName: string }[] = [];
  try {
    allModelTypes = api.GetAllTypesOfModel(modelId) ?? [];
  } catch {
    for (const [k, v] of Object.entries(ELEMENT_LABELS)) {
      allModelTypes.push({ typeID: Number(k), typeName: String(v) });
    }
  }

  for (const { typeID, typeName } of allModelTypes) {
    if (!isPhysicalElementType(typeName)) continue;
    try {
      const ids = api.GetLineIDsWithType(modelId, typeID);
      if (ids.size() === 0) continue;
      const label =
        ELEMENT_LABELS[typeID] ??
        IFC_TO_LABEL[typeName] ??
        typeName; // fallback: IFC class name as-is
      const nodes: ElementNode[] = [];
      for (let i = 0; i < ids.size(); i++) {
        const eid = ids.get(i);
        const line = api.GetLine(modelId, eid) as Record<string, unknown> | null;
        const guid = (line?.GlobalId as { value?: string } | undefined)?.value ?? undefined;
        nodes.push({
          expressId: eid,
          type: label,
          name: getLabel(line) || `${label} #${eid}`,
          guid,
        });
      }
      if (nodes.length > 0) {
        elementsByType[label] = (elementsByType[label] ?? []).concat(nodes);
      }
    } catch {
      // type not present in this model or API error — skip silently
    }
  }

  return { spatialTree, elementsByType };
}
