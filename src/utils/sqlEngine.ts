// eslint-disable-next-line @typescript-eslint/no-explicit-any
import alasql from "alasql";
import type { IFCModelEntry, SQLQueryResult } from "../types/ifc";

export interface ElementRow {
  modelId: string;
  modelName: string;
  expressId: number;
  type: string;
  name: string;
}

let dbReady = false;

function ensureTable() {
  if (dbReady) return;
  alasql("DROP TABLE IF EXISTS elements");
  alasql(`CREATE TABLE elements (
    modelId STRING,
    modelName STRING,
    expressId INT,
    type STRING,
    name STRING
  )`);
  dbReady = true;
}

export function rebuildElementTable(models: Map<string, IFCModelEntry>) {
  alasql("DROP TABLE IF EXISTS elements");
  dbReady = false;
  ensureTable();

  const rows: ElementRow[] = [];

  models.forEach((model) => {
    if (model.status !== "loaded") return;

    // From elementsByType
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

    // From spatialTree (containers not in elementsByType)
    if (model.spatialTree) {
      collectSpatialNodes(model.id, model.name, model.spatialTree, rows);
    }
  });

  // Deduplicate by expressId+modelId
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.modelId}:${r.expressId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length > 0) {
    alasql("INSERT INTO elements SELECT * FROM ?", [unique]);
  }
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

export function runSQL(query: string): SQLQueryResult {
  const t0 = performance.now();
  try {
    ensureTable();
    // alasql returns array of objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, unknown>[] = alasql(query) as any;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { columns: [], rows: [], executionTime: performance.now() - t0 };
    }
    const columns = Object.keys(rows[0]);
    const data = rows.map((r) => columns.map((c) => r[c]));
    return { columns, rows: data, executionTime: performance.now() - t0 };
  } catch (err) {
    return { columns: [], rows: [], error: String(err), executionTime: performance.now() - t0 };
  }
}

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
    label: "Elemente suchen",
    sql: "SELECT * FROM elements WHERE name LIKE '%Wand%' OR name LIKE '%Wall%'",
  },
];
