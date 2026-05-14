import { getIfcApi } from "./ifcLoader";
import type { PropertySet } from "../types/ifc";

export interface ElementEditOverride {
  expressId: number;
  /** key: direct attribute name OR "PsetName.PropName" → new string value */
  overrides: Record<string, string>;
}

/**
 * Opens the IFC file, applies the given property overrides, and returns the
 * serialised IFC file as Uint8Array ready for download.
 *
 * Direct attributes (e.g. "Name") are written to the element line.
 * Pset properties ("Pset_WallCommon.IsExternal") update the corresponding
 * IFCPROPERTYSINGLEVALUE NominalValue.
 */
export async function writeIFCWithOverrides(
  file: File,
  elementOverrides: ElementEditOverride[]
): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const api = await getIfcApi();
  const modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });

  try {
    for (const { expressId, overrides } of elementOverrides) {
      if (Object.keys(overrides).length === 0) continue;

      // ── Separate direct-attr keys from pset keys ───────────────────────────
      const directAttrs: Record<string, string> = {};
      const psetAttrs: Record<string, Record<string, string>> = {}; // psetName → propName → value

      for (const [key, value] of Object.entries(overrides)) {
        const dot = key.indexOf(".");
        if (dot === -1) {
          directAttrs[key] = value;
        } else {
          const psetName = key.slice(0, dot);
          const propName = key.slice(dot + 1);
          if (!psetAttrs[psetName]) psetAttrs[psetName] = {};
          psetAttrs[psetName][propName] = value;
        }
      }

      // ── Write direct attributes ────────────────────────────────────────────
      if (Object.keys(directAttrs).length > 0) {
        try {
          const line = api.GetLine(modelId, expressId) as Record<string, unknown>;
          let changed = false;
          for (const [attrKey, newVal] of Object.entries(directAttrs)) {
            const existing = line[attrKey];
            if (existing !== null && typeof existing === "object" && "value" in (existing as object)) {
              (existing as Record<string, unknown>).value = newVal;
              changed = true;
            } else {
              // Attribute missing or not an IFC-wrapped value — write as LABEL
              line[attrKey] = { type: 1, value: newVal };
              changed = true;
            }
          }
          if (changed) api.WriteLine(modelId, line);
        } catch { /* element line inaccessible — skip */ }
      }

      // ── Write pset property values ─────────────────────────────────────────
      if (Object.keys(psetAttrs).length > 0) {
        try {
          const rawPsets = await api.properties.getPropertySets(modelId, expressId, true);
          for (const pset of rawPsets as Array<Record<string, unknown> & { HasProperties?: unknown[] }>) {
            if (!pset) continue;
            const psetName = String((pset.Name as { value?: string } | undefined)?.value ?? "");
            const wantedProps = psetAttrs[psetName];
            if (!wantedProps) continue;

            const hasProp = pset.HasProperties;
            if (!Array.isArray(hasProp)) continue;

            for (const prop of hasProp as Array<Record<string, unknown>>) {
              if (!prop) continue;
              const propName = String((prop.Name as { value?: string } | undefined)?.value ?? "");
              if (!(propName in wantedProps)) continue;
              const propExpressId = prop.expressID as number | undefined;
              if (typeof propExpressId !== "number") continue;

              try {
                const propLine = api.GetLine(modelId, propExpressId) as Record<string, unknown>;
                const nom = propLine.NominalValue as Record<string, unknown> | null | undefined;
                const newVal = wantedProps[propName];

                if (nom && typeof nom === "object") {
                  const inner = nom.value;
                  if (inner !== null && typeof inner === "object" && "value" in (inner as object)) {
                    // Double-nested: { type: X, value: { type: Y, value: actual } }
                    (inner as Record<string, unknown>).value = newVal;
                  } else {
                    nom.value = newVal;
                  }
                } else {
                  propLine.NominalValue = { type: 1, value: newVal };
                }
                api.WriteLine(modelId, propLine);
              } catch { /* skip individual property write errors */ }
            }
          }
        } catch { /* psets inaccessible — skip */ }
      }
    }

    return api.WriteFile(modelId);
  } finally {
    api.CloseModel(modelId);
  }
}

/** Trigger a browser file download from a Uint8Array. */
export function downloadFile(data: Uint8Array, filename: string, mimeType = "application/octet-stream") {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Keep PropertySet in scope for the import (used by ifcLoader via shared types)
type _PS = PropertySet;
void (null as unknown as _PS);
