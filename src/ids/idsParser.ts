import type {
  IdsDocument, IdsSpecification, IdsFacet, IdsValue,
  IdsRestriction, IdsCardinality, IfcVersion,
} from "./idsTypes";

function parseValue(el: Element | null): IdsValue | undefined {
  if (!el) return undefined;
  const simple = el.querySelector("simpleValue");
  if (simple) return { type: "simple", value: simple.textContent?.trim() ?? "" };
  const restriction = el.querySelector("restriction");
  if (restriction) {
    const base = restriction.getAttribute("base") ?? "xs:string";
    const restrictions: IdsRestriction[] = [];
    restriction.querySelectorAll("enumeration").forEach(e =>
      restrictions.push({ kind: "enumeration", value: e.getAttribute("value") ?? "" })
    );
    restriction.querySelectorAll("pattern").forEach(e =>
      restrictions.push({ kind: "pattern", value: e.getAttribute("value") ?? "" })
    );
    const numericKinds = [
      "minLength", "maxLength", "minInclusive", "maxInclusive",
      "minExclusive", "maxExclusive", "length",
    ] as const;
    for (const kind of numericKinds) {
      const node = restriction.querySelector(kind);
      if (node) restrictions.push({ kind, value: node.getAttribute("value") ?? "" });
    }
    return { type: "restriction", base, restrictions };
  }
  return undefined;
}

function parseCardinality(el: Element): IdsCardinality {
  return (el.getAttribute("cardinality") as IdsCardinality) ?? "required";
}

function parseFacets(container: Element): IdsFacet[] {
  const facets: IdsFacet[] = [];

  container.querySelectorAll(":scope > entity").forEach(el => {
    const name = parseValue(el.querySelector("name"));
    if (name) {
      facets.push({
        type: "entity",
        name,
        predefinedType: parseValue(el.querySelector("predefinedType")),
      });
    }
  });

  container.querySelectorAll(":scope > attribute").forEach(el => {
    const name = parseValue(el.querySelector("name"));
    if (name) {
      facets.push({
        type: "attribute",
        cardinality: parseCardinality(el),
        name,
        value: parseValue(el.querySelector("value")),
      });
    }
  });

  container.querySelectorAll(":scope > property").forEach(el => {
    const propertySet = parseValue(el.querySelector("propertySet"));
    const baseName = parseValue(el.querySelector("baseName"));
    if (propertySet && baseName) {
      facets.push({
        type: "property",
        cardinality: parseCardinality(el),
        propertySet,
        baseName,
        value: parseValue(el.querySelector("value")),
        dataType: el.getAttribute("dataType") ?? undefined,
      });
    }
  });

  container.querySelectorAll(":scope > classification").forEach(el => {
    facets.push({
      type: "classification",
      cardinality: parseCardinality(el),
      system: parseValue(el.querySelector("system")),
      value: parseValue(el.querySelector("value")),
    });
  });

  container.querySelectorAll(":scope > material").forEach(el => {
    facets.push({
      type: "material",
      cardinality: parseCardinality(el),
      value: parseValue(el.querySelector("value")),
    });
  });

  container.querySelectorAll(":scope > partOf").forEach(el => {
    const entityEl = el.querySelector("entity");
    const entityName = entityEl ? parseValue(entityEl.querySelector("name")) : undefined;
    if (entityName) {
      facets.push({
        type: "partOf",
        cardinality: parseCardinality(el),
        entity: entityName,
        relation: el.getAttribute("relation") ?? undefined,
      });
    }
  });

  return facets;
}

export function parseIdsXml(xml: string): IdsDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  const info = root.querySelector("info");
  const getText = (sel: string) => info?.querySelector(sel)?.textContent?.trim();

  const specs: IdsSpecification[] = [];
  root.querySelectorAll("specification").forEach(spec => {
    const applicabilityEl = spec.querySelector("applicability");
    const requirementsEl = spec.querySelector("requirements");
    const ifcVersionStr = spec.getAttribute("ifcVersion") ?? "IFC2X3 IFC4";

    specs.push({
      id: crypto.randomUUID(),
      name: spec.getAttribute("name") ?? "Unnamed",
      ifcVersion: ifcVersionStr.split(" ").filter(Boolean) as IfcVersion[],
      description: spec.getAttribute("description") ?? undefined,
      instructions: spec.getAttribute("instructions") ?? undefined,
      necessity: (spec.getAttribute("necessity") as IdsCardinality) ?? "required",
      applicability: applicabilityEl ? parseFacets(applicabilityEl) : [],
      requirements: requirementsEl ? parseFacets(requirementsEl) : [],
    });
  });

  return {
    id: crypto.randomUUID(),
    info: {
      title: getText("title") ?? "Untitled IDS",
      copyright: getText("copyright"),
      version: getText("version"),
      description: getText("description"),
      author: getText("author"),
      date: getText("date"),
      purpose: getText("purpose"),
      milestone: getText("milestone"),
    },
    specifications: specs,
  };
}
