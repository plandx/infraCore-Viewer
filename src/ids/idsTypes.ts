export type IdsCardinality = "required" | "optional" | "prohibited";
export type IfcVersion = "IFC2X3" | "IFC4" | "IFC4X3ADD2";

export interface IdsInfo {
  title: string;
  copyright?: string;
  version?: string;
  description?: string;
  author?: string;
  date?: string;
  purpose?: string;
  milestone?: string;
}

export type IdsValue =
  | { type: "simple"; value: string }
  | { type: "restriction"; base: string; restrictions: IdsRestriction[] };

export type IdsRestriction =
  | { kind: "enumeration"; value: string }
  | { kind: "pattern"; value: string }
  | { kind: "minLength"; value: string }
  | { kind: "maxLength"; value: string }
  | { kind: "minInclusive"; value: string }
  | { kind: "maxInclusive"; value: string }
  | { kind: "minExclusive"; value: string }
  | { kind: "maxExclusive"; value: string }
  | { kind: "length"; value: string };

export interface IdsEntityFacet {
  type: "entity";
  name: IdsValue;
  predefinedType?: IdsValue;
}

export interface IdsAttributeFacet {
  type: "attribute";
  name: IdsValue;
  value?: IdsValue;
  cardinality: IdsCardinality;
}

export interface IdsPropertyFacet {
  type: "property";
  propertySet: IdsValue;
  baseName: IdsValue;
  value?: IdsValue;
  dataType?: string;
  cardinality: IdsCardinality;
}

export interface IdsClassificationFacet {
  type: "classification";
  system?: IdsValue;
  value?: IdsValue;
  cardinality: IdsCardinality;
}

export interface IdsMaterialFacet {
  type: "material";
  value?: IdsValue;
  cardinality: IdsCardinality;
}

export interface IdsPartOfFacet {
  type: "partOf";
  entity: IdsValue;
  relation?: string;
  cardinality: IdsCardinality;
}

export type IdsFacet =
  | IdsEntityFacet
  | IdsAttributeFacet
  | IdsPropertyFacet
  | IdsClassificationFacet
  | IdsMaterialFacet
  | IdsPartOfFacet;

export interface IdsSpecification {
  id: string;
  name: string;
  ifcVersion: IfcVersion[];
  description?: string;
  instructions?: string;
  necessity: IdsCardinality;
  applicability: IdsFacet[];
  requirements: IdsFacet[];
}

export interface IdsDocument {
  id: string;
  fileName?: string;
  info: IdsInfo;
  specifications: IdsSpecification[];
}

export interface IdsElementResult {
  modelId: string;
  expressId: number;
  name?: string;
  type?: string;
  status: "passed" | "failed";
  failures: IdsFailureDetail[];
}

export interface IdsFailureDetail {
  facetType: string;
  message: string;
}

export interface IdsSpecResult {
  specificationId: string;
  specificationName: string;
  necessity: IdsCardinality;
  status: "passed" | "failed" | "skipped";
  applicableCount: number;
  passCount: number;
  failCount: number;
  elements: IdsElementResult[];
  note?: string;
}

export interface IdsValidationReport {
  documentId: string;
  documentTitle: string;
  timestamp: string;
  results: IdsSpecResult[];
}
