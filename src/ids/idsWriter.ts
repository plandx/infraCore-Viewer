import type { IdsDocument, IdsSpecification, IdsFacet, IdsValue } from "./idsTypes";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeValue(value: IdsValue | undefined, tagName: string): string {
  if (!value) return "";
  if (value.type === "simple") {
    return `<${tagName}><simpleValue>${escXml(value.value)}</simpleValue></${tagName}>`;
  }
  const restrictions = value.restrictions
    .map(r => {
      if (r.kind === "enumeration") return `<xs:enumeration value="${escXml(r.value)}"/>`;
      if (r.kind === "pattern") return `<xs:pattern value="${escXml(r.value)}"/>`;
      return `<xs:${r.kind} value="${escXml(r.value)}"/>`;
    })
    .join("");
  return `<${tagName}><restriction base="${escXml(value.base)}">${restrictions}</restriction></${tagName}>`;
}

function serializeFacet(facet: IdsFacet): string {
  switch (facet.type) {
    case "entity":
      return (
        `<entity>` +
        serializeValue(facet.name, "name") +
        (facet.predefinedType ? serializeValue(facet.predefinedType, "predefinedType") : "") +
        `</entity>`
      );
    case "attribute":
      return (
        `<attribute cardinality="${facet.cardinality}">` +
        serializeValue(facet.name, "name") +
        (facet.value ? serializeValue(facet.value, "value") : "") +
        `</attribute>`
      );
    case "property":
      return (
        `<property cardinality="${facet.cardinality}"` +
        (facet.dataType ? ` dataType="${escXml(facet.dataType)}"` : "") +
        `>` +
        serializeValue(facet.propertySet, "propertySet") +
        serializeValue(facet.baseName, "baseName") +
        (facet.value ? serializeValue(facet.value, "value") : "") +
        `</property>`
      );
    case "classification":
      return (
        `<classification cardinality="${facet.cardinality}">` +
        (facet.system ? serializeValue(facet.system, "system") : "") +
        (facet.value ? serializeValue(facet.value, "value") : "") +
        `</classification>`
      );
    case "material":
      return (
        `<material cardinality="${facet.cardinality}">` +
        (facet.value ? serializeValue(facet.value, "value") : "") +
        `</material>`
      );
    case "partOf":
      return (
        `<partOf cardinality="${facet.cardinality}"` +
        (facet.relation ? ` relation="${escXml(facet.relation)}"` : "") +
        `><entity>` +
        serializeValue(facet.entity, "name") +
        `</entity></partOf>`
      );
  }
}

function serializeSpec(spec: IdsSpecification): string {
  const attrs = [
    `name="${escXml(spec.name)}"`,
    `ifcVersion="${spec.ifcVersion.join(" ")}"`,
    `necessity="${spec.necessity}"`,
    spec.description ? `description="${escXml(spec.description)}"` : "",
    spec.instructions ? `instructions="${escXml(spec.instructions)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    `<specification ${attrs}>` +
    `<applicability>${spec.applicability.map(serializeFacet).join("")}</applicability>` +
    `<requirements>${spec.requirements.map(serializeFacet).join("")}</requirements>` +
    `</specification>`
  );
}

export function serializeIdsToXml(doc: IdsDocument): string {
  const { info } = doc;
  const infoXml = [
    `<title>${escXml(info.title)}</title>`,
    info.copyright ? `<copyright>${escXml(info.copyright)}</copyright>` : "",
    info.version ? `<version>${escXml(info.version)}</version>` : "",
    info.description ? `<description>${escXml(info.description)}</description>` : "",
    info.author ? `<author>${escXml(info.author)}</author>` : "",
    info.date ? `<date>${escXml(info.date)}</date>` : "",
    info.purpose ? `<purpose>${escXml(info.purpose)}</purpose>` : "",
    info.milestone ? `<milestone>${escXml(info.milestone)}</milestone>` : "",
  ]
    .filter(Boolean)
    .join("");

  const specsXml = doc.specifications.map(serializeSpec).join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ids xmlns="http://standards.buildingsmart.org/IDS" ` +
    `xmlns:xs="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">` +
    `<info>${infoXml}</info>` +
    `<specifications>${specsXml}</specifications>` +
    `</ids>`
  );
}
