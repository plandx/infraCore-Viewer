export type IfcValueType = 1 | 14 | 16 | 18; // IFCLABEL, IFCREAL, IFCINTEGER, IFCBOOLEAN

export type FilterOp = "eq" | "neq" | "contains" | "regex" | "empty" | "notEmpty";

export type TargetFilter =
  | { kind: "all" }
  | { kind: "ifcType"; value: string }
  | { kind: "propCondition"; key: string; op: FilterOp; value: string }
  | { kind: "basket" };

export type BatchOperation = { id: string } & (
  | { type: "set_property";  key: string; value: string; ifcValueType: IfcValueType }
  | { type: "template";      targetKey: string; template: string }
  | { type: "copy_property"; fromKey: string; toKey: string }
  | { type: "find_replace";  key: string; find: string; replace: string; useRegex: boolean }
  | { type: "name_to_prop";  targetKey: string }
  | { type: "prop_to_name";  sourceKey: string }
);

export interface BatchRule {
  id: string;
  label: string;
  filter: TargetFilter;
  operations: BatchOperation[];
  enabled: boolean;
}

export interface PreviewChange {
  modelId: string;
  expressId: number;
  elementName: string;
  key: string;
  oldValue: string;
  newValue: string;
}

export interface PreviewResult {
  ruleId: string;
  matchedCount: number;
  changeCount: number;
  changes: PreviewChange[]; // first 50 only for display
  errors: string[];
}
