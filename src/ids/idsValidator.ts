import type {
  IdsDocument,
  IdsSpecification,
  IdsValue,
  IdsElementResult,
  IdsSpecResult,
  IdsValidationReport,
  IdsFailureDetail,
  IdsEntityFacet,
  IdsPropertyFacet,
  IdsAttributeFacet,
} from "./idsTypes";
import type { IFCModelEntry } from "../types/ifc";

function matchValue(value: IdsValue, actual: string): boolean {
  if (value.type === "simple") {
    // Pipe-separated list (e.g. "IFCWALL|IFCBEAM|...") — match any
    const parts = value.value.split("|").map((p) => p.trim());
    return parts.some((p) => p.toLowerCase() === actual.toLowerCase());
  }
  // Empty restriction (xs:restriction base="xs:string" with no children) = any value accepted
  if (value.restrictions.length === 0) return true;

  const enumerations = value.restrictions.filter((r) => r.kind === "enumeration");
  if (enumerations.length > 0) {
    return enumerations.some((r) => actual.toLowerCase() === r.value.toLowerCase());
  }
  for (const r of value.restrictions) {
    if (r.kind === "pattern") {
      try {
        if (new RegExp(r.value, "i").test(actual)) return true;
      } catch {
        // invalid regex — skip
      }
    }
  }
  return true;
}

function getApplicableElements(
  spec: IdsSpecification,
  models: Map<string, IFCModelEntry>
): Array<{ modelId: string; expressId: number; type: string; name?: string; properties: Record<string, unknown> }> {
  const entityFacets = spec.applicability.filter((f) => f.type === "entity") as IdsEntityFacet[];
  const result: Array<{
    modelId: string;
    expressId: number;
    type: string;
    name?: string;
    properties: Record<string, unknown>;
  }> = [];

  for (const [modelId, model] of models) {
    if (!model.elementsByType) continue;
    for (const [type, elements] of Object.entries(model.elementsByType)) {
      const normalizedType = type.toUpperCase().startsWith("IFC")
        ? type.toUpperCase()
        : `IFC${type.toUpperCase()}`;
      if (
        entityFacets.length > 0 &&
        !entityFacets.some((f) => matchValue(f.name, normalizedType))
      ) {
        continue;
      }
      for (const el of elements) {
        const props = (model.properties as Record<number, Record<string, unknown>>)?.[el.expressId] ?? {};
        result.push({
          modelId,
          expressId: el.expressId,
          type: normalizedType,
          name: el.name,
          properties: props,
        });
      }
    }
  }
  return result;
}

function checkPropertyFacet(
  facet: IdsPropertyFacet,
  props: Record<string, unknown>
): IdsFailureDetail | null {
  const psetName = facet.propertySet.type === "simple" ? facet.propertySet.value : null;
  const propName = facet.baseName.type === "simple" ? facet.baseName.value : null;
  if (!psetName || !propName) return null;

  const pset = (props as Record<string, Record<string, unknown>>)?.[psetName];
  const propValue =
    pset?.[propName] ?? (props as Record<string, unknown>)?.[`${psetName}.${propName}`] ?? (props as Record<string, unknown>)?.[propName];

  if (facet.cardinality === "prohibited") {
    if (propValue !== undefined && propValue !== null && propValue !== "") {
      return {
        facetType: "property",
        message: `Eigenschaft "${psetName}.${propName}" sollte nicht vorhanden sein`,
      };
    }
    return null;
  }

  if (propValue === undefined || propValue === null || propValue === "") {
    if (facet.cardinality === "required") {
      return {
        facetType: "property",
        message: `Eigenschaft "${psetName}.${propName}" fehlt`,
      };
    }
    return null;
  }

  if (facet.value) {
    const strVal = String(propValue);
    if (!matchValue(facet.value, strVal)) {
      const expected =
        facet.value.type === "simple" ? facet.value.value : "(Ausdruck)";
      return {
        facetType: "property",
        message: `Eigenschaft "${psetName}.${propName}" = "${strVal}", erwartet: "${expected}"`,
      };
    }
  }
  return null;
}

function checkAttributeFacet(
  facet: IdsAttributeFacet,
  name?: string
): IdsFailureDetail | null {
  const attrName = facet.name.type === "simple" ? facet.name.value : "";
  if (attrName === "Name") {
    if (facet.cardinality === "required" && (!name || name === "")) {
      return { facetType: "attribute", message: `Attribut "Name" fehlt oder leer` };
    }
    if (facet.value && name && !matchValue(facet.value, name)) {
      const expected =
        facet.value.type === "simple" ? facet.value.value : "(Ausdruck)";
      return {
        facetType: "attribute",
        message: `Attribut "Name" = "${name}", erwartet: "${expected}"`,
      };
    }
  }
  return null;
}

export function validateIdsDocument(
  doc: IdsDocument,
  models: Map<string, IFCModelEntry>
): IdsValidationReport {
  const results: IdsSpecResult[] = doc.specifications.map((spec) => {
    const applicable = getApplicableElements(spec, models);
    if (applicable.length === 0) {
      return {
        specificationId: spec.id,
        specificationName: spec.name,
        necessity: spec.necessity,
        status: "skipped",
        applicableCount: 0,
        passCount: 0,
        failCount: 0,
        elements: [],
      };
    }

    const elementResults: IdsElementResult[] = applicable.map((el) => {
      const failures: IdsFailureDetail[] = [];
      for (const req of spec.requirements) {
        let failure: IdsFailureDetail | null = null;
        if (req.type === "property") {
          failure = checkPropertyFacet(req, el.properties);
        } else if (req.type === "attribute") {
          failure = checkAttributeFacet(req, el.name);
        }
        if (failure) failures.push(failure);
      }
      return {
        modelId: el.modelId,
        expressId: el.expressId,
        name: el.name,
        type: el.type,
        status: failures.length === 0 ? "passed" : "failed",
        failures,
      };
    });

    const failCount = elementResults.filter((e) => e.status === "failed").length;
    const passCount = elementResults.filter((e) => e.status === "passed").length;
    return {
      specificationId: spec.id,
      specificationName: spec.name,
      necessity: spec.necessity,
      status: failCount === 0 ? "passed" : "failed",
      applicableCount: applicable.length,
      passCount,
      failCount,
      elements: elementResults,
    };
  });

  return {
    documentId: doc.id,
    documentTitle: doc.info.title,
    timestamp: new Date().toISOString(),
    results,
  };
}
