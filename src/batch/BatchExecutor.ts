import type { BatchRule, BatchOperation, PreviewChange, PreviewResult, TargetFilter, FilterOp } from "./types";
import type { FlatElementProps } from "../types/ifc";

// ── Filter helpers ──────────────────────────────────────────────────────────

function matchesOp(actual: string, op: FilterOp, expected: string): boolean {
  switch (op) {
    case "eq":       return actual === expected;
    case "neq":      return actual !== expected;
    case "contains": return actual.toLowerCase().includes(expected.toLowerCase());
    case "regex":    try { return new RegExp(expected, "i").test(actual); } catch { return false; }
    case "empty":    return !actual || actual.trim() === "";
    case "notEmpty": return !!actual && actual.trim() !== "";
  }
}

function matchesFilter(
  filter: TargetFilter,
  ifcType: string,
  name: string,
  props: FlatElementProps | null,
  basketKeys: Set<string>,
  modelId: string,
  expressId: number,
): boolean {
  switch (filter.kind) {
    case "all": return true;
    case "ifcType": return ifcType === filter.value || ifcType === `Ifc${filter.value}`;
    case "basket": return basketKeys.has(`${modelId}:${expressId}`);
    case "propCondition": {
      if (!props) return false;
      const raw = props[filter.key];
      const actual = raw !== undefined && raw !== null ? String(raw) : "";
      return matchesOp(actual, filter.op, filter.value);
    }
  }
}

// ── Template substitution ───────────────────────────────────────────────────

function applyTemplate(template: string, name: string, props: FlatElementProps | null): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (key === "Name") return name;
    if (props) {
      const val = props[key];
      if (val !== undefined && val !== null) return String(val);
    }
    return "";
  });
}

// ── Operation executor ──────────────────────────────────────────────────────

function applyOp(
  op: BatchOperation,
  name: string,
  props: FlatElementProps | null,
): { key: string; newValue: string } | null {
  switch (op.type) {
    case "set_property":
      return { key: op.key, newValue: op.value };

    case "template": {
      const newValue = applyTemplate(op.template, name, props);
      return newValue ? { key: op.targetKey, newValue } : null;
    }

    case "copy_property": {
      if (!props) return null;
      const val = props[op.fromKey];
      if (val === undefined || val === null) return null;
      return { key: op.toKey, newValue: String(val) };
    }

    case "find_replace": {
      const raw = props?.[op.key];
      const current = raw !== undefined && raw !== null ? String(raw) : "";
      if (!current) return null;
      let newValue: string;
      try {
        newValue = op.useRegex
          ? current.replace(new RegExp(op.find, "g"), op.replace)
          : current.split(op.find).join(op.replace);
      } catch { return null; }
      if (newValue === current) return null;
      return { key: op.key, newValue };
    }

    case "name_to_prop":
      return name ? { key: op.targetKey, newValue: name } : null;

    case "prop_to_name": {
      if (!props) return null;
      const val = props[op.sourceKey];
      if (!val) return null;
      return { key: "Name", newValue: String(val) };
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface ElementRow {
  modelId: string;
  expressId: number;
  name: string;
  ifcType: string;
  props: FlatElementProps | null;
}

export function buildElementRows(
  models: Map<string, { status: string; name: string; elementsByType: Record<string, unknown[]> }>,
  propMap: Map<string, Map<number, FlatElementProps>> | null,
): ElementRow[] {
  const rows: ElementRow[] = [];
  models.forEach((m, modelId) => {
    if (m.status !== "loaded") return;
    const perModel = propMap?.get(modelId) ?? null;
    for (const [ifcType, els] of Object.entries(m.elementsByType)) {
      for (const el of els as Array<{ expressId: number; name: string }>) {
        rows.push({
          modelId,
          expressId: el.expressId,
          name: el.name || `${ifcType} #${el.expressId}`,
          ifcType,
          props: perModel?.get(el.expressId) ?? null,
        });
      }
    }
  });
  return rows;
}

export function executeRule(
  rule: BatchRule,
  rows: ElementRow[],
  basketKeys: Set<string>,
  maxChanges = 50,
): PreviewResult {
  const allChanges: PreviewChange[] = [];
  const errors: string[] = [];
  let matchedCount = 0;

  for (const row of rows) {
    const matches = matchesFilter(
      rule.filter, row.ifcType, row.name, row.props, basketKeys, row.modelId, row.expressId,
    );
    if (!matches) continue;
    matchedCount++;

    for (const op of rule.operations) {
      try {
        const result = applyOp(op, row.name, row.props);
        if (!result) continue;
        const oldVal = row.props?.[result.key];
        const oldValue = oldVal !== undefined && oldVal !== null ? String(oldVal) : "";
        if (oldValue === result.newValue) continue;
        allChanges.push({
          modelId: row.modelId,
          expressId: row.expressId,
          elementName: row.name,
          key: result.key,
          oldValue,
          newValue: result.newValue,
        });
      } catch (e) {
        errors.push(`#${row.expressId} ${op.type}: ${e}`);
      }
    }
  }

  return {
    ruleId: rule.id,
    matchedCount,
    changeCount: allChanges.length,
    changes: allChanges.slice(0, maxChanges),
    errors: errors.slice(0, 10),
  };
}

export function collectEdits(
  rule: BatchRule,
  rows: ElementRow[],
  basketKeys: Set<string>,
): Array<{ modelId: string; expressId: number; key: string; value: string; ifcType?: number }> {
  const edits: Array<{ modelId: string; expressId: number; key: string; value: string; ifcType?: number }> = [];

  for (const row of rows) {
    const matches = matchesFilter(
      rule.filter, row.ifcType, row.name, row.props, basketKeys, row.modelId, row.expressId,
    );
    if (!matches) continue;

    for (const op of rule.operations) {
      try {
        const result = applyOp(op, row.name, row.props);
        if (!result) continue;
        const ifcType = op.type === "set_property" ? op.ifcValueType : undefined;
        edits.push({ modelId: row.modelId, expressId: row.expressId, key: result.key, value: result.newValue, ifcType });
      } catch { /* skip */ }
    }
  }

  return edits;
}
