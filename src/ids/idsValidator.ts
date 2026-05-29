import type {
  IdsDocument, IdsSpecification, IdsValue,
  IdsElementResult, IdsSpecResult, IdsValidationReport,
  IdsFailureDetail, IdsEntityFacet, IdsPropertyFacet, IdsAttributeFacet,
} from "./idsTypes";
import type { IFCModelEntry, FlatElementProps } from "../types/ifc";
import { LABEL_TO_IFC } from "../utils/ifcLoader";

// ── Value matching ─────────────────────────────────────────────────────────────

function matchValue(value: IdsValue, actual: string): boolean {
  if (value.type === "simple") {
    // Pipe-separated list (e.g. "IFCWALL|IFCBEAM|...") — match any
    const parts = value.value.split("|").map((p) => p.trim());
    return parts.some((p) => p.toLowerCase() === actual.toLowerCase());
  }
  // Empty restriction = any value accepted
  if (value.restrictions.length === 0) return true;
  const enumerations = value.restrictions.filter((r) => r.kind === "enumeration");
  if (enumerations.length > 0) {
    return enumerations.some((r) => actual.toLowerCase() === r.value.toLowerCase());
  }
  for (const r of value.restrictions) {
    if (r.kind === "pattern") {
      try {
        if (new RegExp(r.value, "i").test(actual)) return true;
      } catch { /* invalid regex */ }
    }
  }
  return true;
}

// Map elementsByType key (German label or fallback) → uppercase IFC name
function normalizeIfcType(label: string): string {
  const ifcName = LABEL_TO_IFC[label];
  if (ifcName) return ifcName.toUpperCase(); // "Wand" → "IFCWALL"
  const up = label.toUpperCase();
  return up.startsWith("IFC") ? up : `IFC${up}`;
}

// ── Applicability checkers (used for filtering, not reporting) ─────────────────

function elementMatchesApplicability(
  spec: IdsSpecification,
  normalizedType: string,
  name: string | undefined,
  flat: FlatElementProps,
): boolean {
  for (const facet of spec.applicability) {
    switch (facet.type) {
      case "entity": {
        if (!matchValue(facet.name, normalizedType)) return false;
        break;
      }
      case "attribute": {
        const attrName = facet.name.type === "simple" ? facet.name.value : "";
        const attrVal = flat[attrName] !== undefined
          ? String(flat[attrName])
          : attrName === "Name" ? (name ?? "") : "";
        if (facet.cardinality === "prohibited") {
          if (attrVal) return false;
        } else {
          if (!attrVal) return false;
          if (facet.value && !matchValue(facet.value, attrVal)) return false;
        }
        break;
      }
      case "property": {
        const psetName = facet.propertySet.type === "simple" ? facet.propertySet.value : null;
        const propName = facet.baseName.type === "simple" ? facet.baseName.value : null;
        if (!psetName || !propName) break;
        const propValue = flat[`${psetName}.${propName}`] ?? flat[propName];
        const strVal = propValue !== undefined && propValue !== null ? String(propValue) : "";
        if (facet.cardinality === "prohibited") {
          if (strVal) return false;
        } else {
          if (!strVal) return false;
          if (facet.value && !matchValue(facet.value, strVal)) return false;
        }
        break;
      }
      // classification / material / partOf: skip (cannot check without full IFC API)
    }
  }
  return true;
}

// ── Element collection ─────────────────────────────────────────────────────────

function getApplicableElements(
  spec: IdsSpecification,
  models: Map<string, IFCModelEntry>,
  loadedProperties: Map<string, Map<number, FlatElementProps>> | null,
): Array<{
  modelId: string; expressId: number; type: string; name?: string;
  flat: FlatElementProps;
}> {
  const hasEntityFacet = spec.applicability.some((f) => f.type === "entity");
  const result: Array<{
    modelId: string; expressId: number; type: string; name?: string;
    flat: FlatElementProps;
  }> = [];

  for (const [modelId, model] of models) {
    if (!model.elementsByType) continue;
    const propMap = loadedProperties?.get(modelId);

    for (const [label, elements] of Object.entries(model.elementsByType)) {
      const normalizedType = normalizeIfcType(label);

      // Quick pre-filter: if any entity facet exists, check type first (cheap)
      if (hasEntityFacet) {
        const entityFacets = spec.applicability.filter((f) => f.type === "entity") as IdsEntityFacet[];
        if (!entityFacets.some((f) => matchValue(f.name, normalizedType))) continue;
      }

      for (const el of elements) {
        const flat: FlatElementProps = propMap?.get(el.expressId) ?? {};
        // Full applicability check (entity + attribute + property facets)
        if (elementMatchesApplicability(spec, normalizedType, el.name, flat)) {
          result.push({ modelId, expressId: el.expressId, type: normalizedType, name: el.name, flat });
        }
      }
    }
  }
  return result;
}

// ── Requirement facet checkers ─────────────────────────────────────────────────

function checkPropertyFacet(
  facet: IdsPropertyFacet,
  flat: FlatElementProps,
): IdsFailureDetail | null {
  const psetName = facet.propertySet.type === "simple" ? facet.propertySet.value : null;
  const propName = facet.baseName.type === "simple" ? facet.baseName.value : null;
  if (!psetName || !propName) return null;

  const propValue = flat[`${psetName}.${propName}`] ?? flat[propName];

  if (facet.cardinality === "prohibited") {
    if (propValue !== undefined && propValue !== null && propValue !== "") {
      return { facetType: "property", message: `"${psetName}.${propName}" sollte nicht vorhanden sein` };
    }
    return null;
  }

  if (propValue === undefined || propValue === null || propValue === "") {
    if (facet.cardinality === "required") {
      return { facetType: "property", message: `"${psetName}.${propName}" fehlt` };
    }
    return null;
  }

  if (facet.value) {
    const strVal = String(propValue);
    if (!matchValue(facet.value, strVal)) {
      const expected = facet.value.type === "simple" ? facet.value.value : "(Ausdruck)";
      return { facetType: "property", message: `"${psetName}.${propName}" = "${strVal}", erwartet: "${expected}"` };
    }
  }
  return null;
}

function checkAttributeFacet(
  facet: IdsAttributeFacet,
  flat: FlatElementProps,
  name?: string,
): IdsFailureDetail | null {
  const attrName = facet.name.type === "simple" ? facet.name.value : "";
  const attrValue = flat[attrName] !== undefined
    ? String(flat[attrName])
    : attrName === "Name" ? (name ?? "") : "";

  if (facet.cardinality === "prohibited") {
    if (attrValue) return { facetType: "attribute", message: `Attribut "${attrName}" sollte nicht vorhanden sein` };
    return null;
  }
  if (facet.cardinality === "required" && !attrValue) {
    return { facetType: "attribute", message: `Attribut "${attrName}" fehlt oder leer` };
  }
  if (facet.value && attrValue && !matchValue(facet.value, attrValue)) {
    const expected = facet.value.type === "simple" ? facet.value.value : "(Ausdruck)";
    return { facetType: "attribute", message: `Attribut "${attrName}" = "${attrValue}", erwartet: "${expected}"` };
  }
  return null;
}

// ── Main export ────────────────────────────────────────────────────────────────

export function validateIdsDocument(
  doc: IdsDocument,
  models: Map<string, IFCModelEntry>,
  loadedProperties: Map<string, Map<number, FlatElementProps>> | null,
): IdsValidationReport {
  const propertiesLoaded = loadedProperties !== null && loadedProperties.size > 0;

  const results: IdsSpecResult[] = doc.specifications.map((spec) => {
    const applicable = getApplicableElements(spec, models, loadedProperties);

    if (applicable.length === 0) {
      return {
        specificationId: spec.id, specificationName: spec.name, necessity: spec.necessity,
        status: "skipped", applicableCount: 0, passCount: 0, failCount: 0, elements: [],
        note: "Keine passenden Elemente im Modell gefunden.",
      };
    }

    const elementResults: IdsElementResult[] = applicable.map((el) => {
      const failures: IdsFailureDetail[] = [];
      for (const req of spec.requirements) {
        let failure: IdsFailureDetail | null = null;
        if (req.type === "property") {
          if (!propertiesLoaded) {
            failures.push({ facetType: "property", message: "Properties nicht geladen — zuerst 'Eigenschaften laden' ausführen" });
            break;
          }
          failure = checkPropertyFacet(req, el.flat);
        } else if (req.type === "attribute") {
          failure = checkAttributeFacet(req, el.flat, el.name);
        }
        if (failure) failures.push(failure);
      }
      return {
        modelId: el.modelId, expressId: el.expressId, name: el.name, type: el.type,
        status: failures.length === 0 ? "passed" : "failed",
        failures,
      };
    });

    const failCount = elementResults.filter((e) => e.status === "failed").length;
    const passCount = elementResults.filter((e) => e.status === "passed").length;
    return {
      specificationId: spec.id, specificationName: spec.name, necessity: spec.necessity,
      status: failCount === 0 ? "passed" : "failed",
      applicableCount: applicable.length, passCount, failCount, elements: elementResults,
    };
  });

  return {
    documentId: doc.id, documentTitle: doc.info.title,
    timestamp: new Date().toISOString(), results,
  };
}

