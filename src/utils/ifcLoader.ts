import * as THREE from "three";
import * as WebIFC from "web-ifc";
import type { IFCModelEntry, PropertySet } from "../types/ifc";
import {
  computeModelOffset,
  generateModelColor,
  needsCoordinateShift,
} from "./coordinateUtils";

let ifcApiPromise: Promise<WebIFC.IfcAPI> | null = null;

function getIfcApi(): Promise<WebIFC.IfcAPI> {
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
      const material = new THREE.MeshLambertMaterial({
        color: new THREE.Color(r, g, b),
        opacity: a,
        transparent: a < 0.99,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.applyMatrix4(matrix);
      mesh.userData.expressId = flatMesh.expressID;
      group.add(mesh);
      meshCount++;

      geomData.delete();
    }
    flatMesh.delete();
  });

  onProgress({ phase: `${meshCount} Meshes verarbeitet`, progress: 75 });

  // Compute bounding box from raw geometry
  const rawBbox = new THREE.Box3().setFromObject(group);
  let originOffset = new THREE.Vector3();
  let newWorldOrigin = worldOrigin ?? new THREE.Vector3();

  if (needsCoordinateShift(rawBbox) || worldOrigin) {
    originOffset = computeModelOffset(rawBbox, worldOrigin);
    if (!worldOrigin) newWorldOrigin = originOffset.clone();
    group.position.sub(originOffset);
  }

  const bbox = new THREE.Box3().setFromObject(group);

  onProgress({ phase: "Abschließen", progress: 90 });
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
    loadedAt: new Date(),
    size: file.size,
    status: "loaded",
  };

  return { entry, newWorldOrigin };
}

export async function loadIFCProperties(
  file: File,
  expressId: number
): Promise<{ properties: Record<string, unknown>; psets: PropertySet[] }> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const api = await getIfcApi();
  const modelId = api.OpenModel(data, {
    COORDINATE_TO_ORIGIN: false,
  });

  const props: Record<string, unknown> = {};
  const psets: PropertySet[] = [];

  try {
    const itemProps = await api.properties.getItemProperties(
      modelId,
      expressId,
      false
    );
    if (itemProps) {
      Object.entries(itemProps as Record<string, unknown>).forEach(
        ([k, v]) => {
          if (k !== "expressID") props[k] = v;
        }
      );
    }

    const rawPsets = await api.properties.getPropertySets(
      modelId,
      expressId,
      true
    );

    for (const pset of rawPsets) {
      const psetName = String(pset?.Name?.value ?? "PropertySet");
      const psetProps: PropertySet["properties"] = [];

      const hasProp = pset?.HasProperties;
      if (Array.isArray(hasProp)) {
        for (const prop of hasProp) {
          if (!prop) continue;
          psetProps.push({
            name: String(prop?.Name?.value ?? ""),
            value:
              prop?.NominalValue?.value ??
              prop?.Value?.value ??
              null,
            type: String(prop?.type ?? ""),
          });
        }
      }

      psets.push({ name: psetName, properties: psetProps });
    }
  } finally {
    api.CloseModel(modelId);
  }

  return { properties: props, psets };
}
