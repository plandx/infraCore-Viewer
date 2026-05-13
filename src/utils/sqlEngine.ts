import type { IFCModelEntry, SQLQueryResult } from "../types/ifc";

export interface ElementRow {
  modelId: string;
  modelName: string;
  expressId: number;
  type: string;
  name: string;
}

let elementTable: ElementRow[] = [];

export function rebuildElementTable(models: Map<string, IFCModelEntry>) {
  const rows: ElementRow[] = [];

  models.forEach((model) => {
    if (model.status !== "loaded") return;

    for (const [typeName, elements] of Object.entries(model.elementsByType)) {
      for (const el of elements) {
        rows.push({
          modelId: model.id,
          modelName: model.name,
          expressId: el.expressId,
          type: typeName,
          name: el.name,
        });
      }
    }

    if (model.spatialTree) {
      collectSpatialNodes(model.id, model.name, model.spatialTree, rows);
    }
  });

  // Deduplicate by expressId+modelId
  const seen = new Set<string>();
  elementTable = rows.filter((r) => {
    const key = `${r.modelId}:${r.expressId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSpatialNodes(
  modelId: string,
  modelName: string,
  node: { expressId: number; type: string; name: string; children: typeof node[] },
  out: ElementRow[]
) {
  out.push({ modelId, modelName, expressId: node.expressId, type: node.type, name: node.name });
  for (const child of node.children ?? []) {
    collectSpatialNodes(modelId, modelName, child, out);
  }
}

// ─── Mini SQL Engine ────────────────────────────────────────────────────────
// Supports: SELECT ... FROM elements [WHERE ...] [GROUP BY ...] [ORDER BY ... [DESC]] [LIMIT n]

export function runSQL(rawQuery: string): SQLQueryResult {
  const t0 = performance.now();
  try {
    const result = executeQuery(rawQuery.trim(), elementTable);
    return { ...result, executionTime: performance.now() - t0 };
  } catch (err) {
    return { columns: [], rows: [], error: String(err), executionTime: performance.now() - t0 };
  }
}

function executeQuery(
  query: string,
  table: ElementRow[]
): Omit<SQLQueryResult, "executionTime"> {
  // Normalise whitespace
  const q = query.replace(/\s+/g, " ").trim();
  const upper = q.toUpperCase();

  if (!upper.startsWith("SELECT")) {
    throw new Error("Nur SELECT-Abfragen werden unterstützt.");
  }

  // ── Split into clauses ─────────────────────────────────────────────────
  const fromIdx   = upper.indexOf(" FROM ");
  const whereIdx  = upper.indexOf(" WHERE ");
  const groupIdx  = upper.indexOf(" GROUP BY ");
  const orderIdx  = upper.indexOf(" ORDER BY ");
  const limitIdx  = upper.indexOf(" LIMIT ");

  if (fromIdx === -1) throw new Error("FROM fehlt in der Abfrage.");

  const selectClause = q.slice("SELECT ".length, fromIdx).trim();
  const afterFrom = q.slice(fromIdx + " FROM ".length).trim();

  // The table name ends at the next keyword or end-of-string
  const nextKeyword = Math.min(
    ...[whereIdx, groupIdx, orderIdx, limitIdx]
      .filter((i) => i > fromIdx)
      .map((i) => i - fromIdx - " FROM ".length)
  );
  const tableName = (nextKeyword === Infinity ? afterFrom : afterFrom.slice(0, nextKeyword)).trim();

  if (tableName.toLowerCase() !== "elements") {
    throw new Error(`Unbekannte Tabelle „${tableName}". Verfügbar: elements`);
  }

  const whereStr = whereIdx !== -1
    ? q.slice(whereIdx + " WHERE ".length, Math.min(
        ...[groupIdx, orderIdx, limitIdx].filter((i) => i > whereIdx)
      ) || q.length).trim()
    : null;

  const groupStr = groupIdx !== -1
    ? q.slice(groupIdx + " GROUP BY ".length, Math.min(
        ...[orderIdx, limitIdx].filter((i) => i > groupIdx)
      ) || q.length).trim()
    : null;

  const orderStr = orderIdx !== -1
    ? q.slice(orderIdx + " ORDER BY ".length, limitIdx > orderIdx ? limitIdx : q.length).trim()
    : null;

  const limitVal = limitIdx !== -1
    ? parseInt(q.slice(limitIdx + " LIMIT ".length).trim(), 10)
    : null;

  // ── Filter rows by WHERE ───────────────────────────────────────────────
  let rows: Record<string, unknown>[] = table as unknown as Record<string, unknown>[];
  if (whereStr) {
    rows = rows.filter((row) => evalWhere(whereStr, row));
  }

  // ── Parse SELECT fields ───────────────────────────────────────────────
  const fields = parseSelectFields(selectClause);
  const hasAgg = fields.some((f) => f.isAgg);

  // ── GROUP BY ──────────────────────────────────────────────────────────
  if (groupStr || hasAgg) {
    const groupKeys = groupStr ? groupStr.split(",").map((s) => s.trim().toLowerCase()) : [];
    rows = applyGroupBy(rows, fields, groupKeys);
  } else {
    // Simple projection
    rows = rows.map((row) => projectRow(row, fields));
  }

  // ── ORDER BY ─────────────────────────────────────────────────────────
  if (orderStr) {
    const parts = orderStr.split(",").map((s) => s.trim());
    rows = rows.sort((a, b) => {
      for (const part of parts) {
        const tokens = part.split(/\s+/);
        const col = tokens[0].toLowerCase();
        const desc = tokens[1]?.toUpperCase() === "DESC";
        const va = a[col] ?? a[tokens[0]] ?? 0;
        const vb = b[col] ?? b[tokens[0]] ?? 0;
        const cmp = typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  // ── LIMIT ─────────────────────────────────────────────────────────────
  if (limitVal != null && !isNaN(limitVal)) {
    rows = rows.slice(0, limitVal);
  }

  // ── Build result ──────────────────────────────────────────────────────
  const columns = rows.length > 0 ? Object.keys(rows[0]) : fields.map((f) => f.alias || f.raw);
  const data = rows.map((r) => columns.map((c) => r[c]));

  return { columns, rows: data };
}

// ── SELECT field parser ────────────────────────────────────────────────────

interface FieldDef {
  raw: string;
  expr: string;         // e.g. "type", "COUNT(*)", "COUNT(name)"
  alias: string;        // resolved column name
  isAgg: boolean;
  aggFn?: string;       // COUNT, SUM, AVG, MAX, MIN
  aggArg?: string;      // field or *
}

function parseSelectFields(clause: string): FieldDef[] {
  if (clause === "*") {
    return [{ raw: "*", expr: "*", alias: "*", isAgg: false }];
  }

  return clause.split(",").map((raw) => {
    raw = raw.trim();
    // Check for alias: expr AS alias
    const asMatch = raw.match(/^(.+?)\s+AS\s+(\S+)$/i);
    const alias = asMatch ? asMatch[2] : null;
    const expr = asMatch ? asMatch[1].trim() : raw;

    // Aggregate function
    const aggMatch = expr.match(/^(COUNT|SUM|AVG|MAX|MIN)\((.+?)\)$/i);
    if (aggMatch) {
      const fn = aggMatch[1].toUpperCase();
      const arg = aggMatch[2].trim();
      return {
        raw, expr, alias: alias ?? (fn === "COUNT" ? "count" : `${fn.toLowerCase()}_${arg}`),
        isAgg: true, aggFn: fn, aggArg: arg,
      };
    }

    return { raw, expr, alias: alias ?? expr.toLowerCase(), isAgg: false };
  });
}

function projectRow(row: Record<string, unknown>, fields: FieldDef[]): Record<string, unknown> {
  if (fields.length === 1 && fields[0].raw === "*") return { ...row };
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.isAgg) {
      out[f.alias] = row[f.expr.toLowerCase()] ?? row[f.expr] ?? null;
    }
  }
  return out;
}

function applyGroupBy(
  rows: Record<string, unknown>[],
  fields: FieldDef[],
  groupKeys: string[]
): Record<string, unknown>[] {
  // Group rows
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const key = groupKeys.map((k) => String(row[k] ?? "")).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  if (groups.size === 0 && rows.length > 0) {
    // No group keys → aggregate entire table
    groups.set("__all__", rows);
  }

  const result: Record<string, unknown>[] = [];

  for (const [, group] of groups) {
    const out: Record<string, unknown> = {};

    // All fields are wildcards → use group keys only
    const effectiveFields = fields.length === 1 && fields[0].raw === "*"
      ? groupKeys.map((k): FieldDef => ({ raw: k, expr: k, alias: k, isAgg: false }))
      : fields;

    for (const f of effectiveFields) {
      if (f.isAgg) {
        out[f.alias] = computeAgg(f.aggFn!, f.aggArg!, group);
      } else {
        out[f.alias] = group[0][f.expr.toLowerCase()] ?? group[0][f.expr] ?? null;
      }
    }

    result.push(out);
  }

  return result;
}

function computeAgg(fn: string, arg: string, rows: Record<string, unknown>[]): unknown {
  if (fn === "COUNT") return rows.length;
  const vals = rows.map((r) => Number(r[arg.toLowerCase()] ?? r[arg] ?? 0)).filter((v) => !isNaN(v));
  switch (fn) {
    case "SUM": return vals.reduce((a, b) => a + b, 0);
    case "AVG": return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    case "MAX": return vals.length > 0 ? Math.max(...vals) : null;
    case "MIN": return vals.length > 0 ? Math.min(...vals) : null;
  }
  return null;
}

// ── WHERE evaluator ────────────────────────────────────────────────────────

function evalWhere(expr: string, row: Record<string, unknown>): boolean {
  // Split on top-level AND/OR (not inside parentheses)
  const orParts = splitTopLevel(expr, / OR /i);
  if (orParts.length > 1) return orParts.some((p) => evalWhere(p, row));

  const andParts = splitTopLevel(expr, / AND /i);
  if (andParts.length > 1) return andParts.every((p) => evalWhere(p, row));

  // Strip outer parentheses
  const trimmed = expr.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return evalWhere(trimmed.slice(1, -1), row);
  }

  return evalCondition(trimmed, row);
}

function splitTopLevel(expr: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0, last = 0;
  const str = expr;

  // Find all matches of sep at depth 0
  const matches: { index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(sep.source, "gi");
  while ((m = re.exec(str)) !== null) {
    // Count parens up to this point
    let d = 0;
    for (let i = 0; i < m.index; i++) {
      if (str[i] === "(") d++;
      else if (str[i] === ")") d--;
    }
    if (d === 0) matches.push({ index: m.index, length: m[0].length });
  }

  if (matches.length === 0) return [expr];

  for (const match of matches) {
    parts.push(str.slice(last, match.index));
    last = match.index + match.length;
  }
  parts.push(str.slice(last));
  void depth;
  return parts;
}

function evalCondition(cond: string, row: Record<string, unknown>): boolean {
  // LIKE
  let m = cond.match(/^(\w+)\s+LIKE\s+'(.+)'$/i);
  if (m) {
    const val = String(row[m[1].toLowerCase()] ?? row[m[1]] ?? "").toLowerCase();
    const pattern = m[2].replace(/%/g, ".*").replace(/_/g, ".").toLowerCase();
    return new RegExp(`^${pattern}$`).test(val);
  }
  // NOT LIKE
  m = cond.match(/^(\w+)\s+NOT\s+LIKE\s+'(.+)'$/i);
  if (m) {
    const val = String(row[m[1].toLowerCase()] ?? row[m[1]] ?? "").toLowerCase();
    const pattern = m[2].replace(/%/g, ".*").replace(/_/g, ".").toLowerCase();
    return !new RegExp(`^${pattern}$`).test(val);
  }
  // IS NULL / IS NOT NULL
  m = cond.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
  if (m) return row[m[1].toLowerCase()] != null;
  m = cond.match(/^(\w+)\s+IS\s+NULL$/i);
  if (m) return row[m[1].toLowerCase()] == null;

  // Comparison operators: =, !=, <>, >=, <=, >, <
  m = cond.match(/^(\w+)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/);
  if (m) {
    const field = m[1].toLowerCase();
    const op = m[2];
    const rawVal = m[3].trim().replace(/^'(.*)'$/, "$1"); // strip quotes
    const rowVal = row[field] ?? row[m[1]];
    const lhs = isNumeric(rawVal) ? Number(rowVal) : String(rowVal ?? "").toLowerCase();
    const rhs = isNumeric(rawVal) ? Number(rawVal) : rawVal.toLowerCase();

    switch (op) {
      case "=":  return lhs === rhs;
      case "!=":
      case "<>": return lhs !== rhs;
      case ">":  return (lhs as number) > (rhs as number);
      case "<":  return (lhs as number) < (rhs as number);
      case ">=": return (lhs as number) >= (rhs as number);
      case "<=": return (lhs as number) <= (rhs as number);
    }
  }

  throw new Error(`Kann Bedingung nicht auswerten: ${cond}`);
}

function isNumeric(s: string): boolean {
  return !isNaN(Number(s)) && s.trim() !== "";
}

// ── Sample queries ─────────────────────────────────────────────────────────

export const SAMPLE_QUERIES = [
  {
    label: "Alle Elemente",
    sql: "SELECT modelName, type, name, expressId FROM elements ORDER BY type, name LIMIT 100",
  },
  {
    label: "Typen & Anzahl",
    sql: "SELECT type, COUNT(*) AS Anzahl FROM elements GROUP BY type ORDER BY Anzahl DESC",
  },
  {
    label: "Modelle",
    sql: "SELECT modelName, COUNT(*) AS Elemente FROM elements GROUP BY modelName",
  },
  {
    label: "Name enthält…",
    sql: "SELECT * FROM elements WHERE name LIKE '%Wand%' LIMIT 50",
  },
  {
    label: "Elemente eines Typs",
    sql: "SELECT name, expressId FROM elements WHERE type = 'Wand' ORDER BY name LIMIT 50",
  },
];
