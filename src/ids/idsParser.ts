import type {
  IdsDocument, IdsSpecification, IdsFacet, IdsValue,
  IdsRestriction, IdsCardinality, IfcVersion,
} from "./idsTypes";

const XS_NS = "http://www.w3.org/2001/XMLSchema";

// querySelector falls back to namespace-aware lookup so xs:restriction etc. are found
function qsel(el: Element, localName: string): Element | null {
  return (
    el.getElementsByTagNameNS(XS_NS, localName)[0] ??
    el.querySelector(localName) ??
    null
  );
}

function qselAll(el: Element, localName: string): Element[] {
  const ns = Array.from(el.getElementsByTagNameNS(XS_NS, localName));
  if (ns.length) return ns;
  return Array.from(el.querySelectorAll(localName));
}

function parseValue(el: Element | null): IdsValue | undefined {
  if (!el) return undefined;

  const simple = el.querySelector("simpleValue");
  if (simple) return { type: "simple", value: simple.textContent?.trim() ?? "" };

  // xs:restriction or restriction (namespace-aware)
  const restriction = qsel(el, "restriction");
  if (restriction) {
    const base = restriction.getAttribute("base") ?? "xs:string";
    const restrictions: IdsRestriction[] = [];

    qselAll(restriction, "enumeration").forEach(e =>
      restrictions.push({ kind: "enumeration", value: e.getAttribute("value") ?? "" })
    );
    qselAll(restriction, "pattern").forEach(e =>
      restrictions.push({ kind: "pattern", value: e.getAttribute("value") ?? "" })
    );
    const numericKinds = [
      "minLength", "maxLength", "minInclusive", "maxInclusive",
      "minExclusive", "maxExclusive", "length",
    ] as const;
    for (const kind of numericKinds) {
      const node = qsel(restriction, kind);
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
    const nameEl = el.querySelector(":scope > name");
    const name = parseValue(nameEl ?? null);
    if (name) {
      facets.push({
        type: "entity",
        name,
        predefinedType: parseValue(el.querySelector(":scope > predefinedType")),
      });
    }
  });

  container.querySelectorAll(":scope > attribute").forEach(el => {
    const nameEl = el.querySelector(":scope > name");
    const name = parseValue(nameEl ?? null);
    if (name) {
      facets.push({
        type: "attribute",
        cardinality: parseCardinality(el),
        name,
        value: parseValue(el.querySelector(":scope > value")),
      });
    }
  });

  container.querySelectorAll(":scope > property").forEach(el => {
    const propertySet = parseValue(el.querySelector(":scope > propertySet"));
    // IDS 1.0 uses <name>, older drafts used <baseName> — support both
    const baseName =
      parseValue(el.querySelector(":scope > baseName")) ??
      parseValue(el.querySelector(":scope > name"));
    if (propertySet && baseName) {
      facets.push({
        type: "property",
        cardinality: parseCardinality(el),
        propertySet,
        baseName,
        value: parseValue(el.querySelector(":scope > value")),
        dataType: el.getAttribute("dataType") ?? undefined,
      });
    }
  });

  container.querySelectorAll(":scope > classification").forEach(el => {
    facets.push({
      type: "classification",
      cardinality: parseCardinality(el),
      system: parseValue(el.querySelector(":scope > system")),
      value: parseValue(el.querySelector(":scope > value")),
    });
  });

  container.querySelectorAll(":scope > material").forEach(el => {
    facets.push({
      type: "material",
      cardinality: parseCardinality(el),
      value: parseValue(el.querySelector(":scope > value")),
    });
  });

  container.querySelectorAll(":scope > partOf").forEach(el => {
    const entityEl = el.querySelector(":scope > entity");
    const entityName = entityEl
      ? parseValue(entityEl.querySelector(":scope > name"))
      : undefined;
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
