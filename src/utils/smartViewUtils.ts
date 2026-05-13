import type { SmartRule, SmartView, FlatElementProps, SmartCondition } from "../types/ifc";

const LABEL: Record<SmartCondition, string> = {
  eq:           "=",
  neq:          "≠",
  contains:     "enthält",
  not_contains: "enthält nicht",
  starts_with:  "beginnt mit",
  ends_with:    "endet mit",
  gt:           ">",
  lt:           "<",
  gte:          "≥",
  lte:          "≤",
  is_true:      "ist wahr",
  is_false:     "ist falsch",
  exists:       "vorhanden",
  not_exists:   "nicht vorhanden",
};

export const CONDITION_LABELS = LABEL;

export const CONDITIONS_WITHOUT_VALUE: SmartCondition[] = [
  "is_true", "is_false", "exists", "not_exists",
];

export function evaluateRule(rule: SmartRule, props: FlatElementProps): boolean {
  const raw = props[rule.property];
  const str = raw === null || raw === undefined ? "" : String(raw);
  const rv  = rule.value;

  switch (rule.condition) {
    case "eq":           return str.toLowerCase() === rv.toLowerCase();
    case "neq":          return str.toLowerCase() !== rv.toLowerCase();
    case "contains":     return str.toLowerCase().includes(rv.toLowerCase());
    case "not_contains": return !str.toLowerCase().includes(rv.toLowerCase());
    case "starts_with":  return str.toLowerCase().startsWith(rv.toLowerCase());
    case "ends_with":    return str.toLowerCase().endsWith(rv.toLowerCase());
    case "gt":           return parseFloat(str) > parseFloat(rv);
    case "lt":           return parseFloat(str) < parseFloat(rv);
    case "gte":          return parseFloat(str) >= parseFloat(rv);
    case "lte":          return parseFloat(str) <= parseFloat(rv);
    case "is_true":      return raw === true || str.toLowerCase() === "true" || str === "1";
    case "is_false":     return raw === false || str.toLowerCase() === "false" || str === "0";
    case "exists":       return raw !== null && raw !== undefined && str !== "";
    case "not_exists":   return raw === null || raw === undefined || str === "";
  }
}

export function evaluateSmartView(view: SmartView, props: FlatElementProps): boolean {
  if (view.rules.length === 0) return false;
  const results = view.rules.map((r) => evaluateRule(r, props));
  return view.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}
