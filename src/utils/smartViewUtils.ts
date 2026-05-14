import type { SmartRule, SmartTier, FlatElementProps, SmartCondition } from "../types/ifc";

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

export const PALETTE = [
  "#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7",
  "#73daca", "#ff9e64", "#2ac3de", "#b4f9f8", "#cfc9c2",
  "#1abc9c", "#e056fd", "#fd9644", "#45aaf2", "#a55eea",
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

export function evaluateTier(tier: SmartTier, props: FlatElementProps): boolean {
  if (tier.rules.length === 0) return true;
  const results = tier.rules.map((r) => evaluateRule(r, props));
  return tier.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}
