import type { ClashRule, ClashResult, ClashStatus, Severity, CheckType } from "./windowSync";
import type { IFCModelEntry } from "../types/ifc";

const SERVER = "http://127.0.0.1:8765";

async function uploadIfMissing(
  models: Map<string, IFCModelEntry>,
  onProgress: (pct: number) => void,
): Promise<Map<string, string>> {
  // name → viewer UUID mapping (returned to caller for result translation)
  const nameToId = new Map<string, string>();
  for (const [id, m] of models) nameToId.set(m.name, id);

  const health = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .catch(() => null);

  if (!health) throw new Error("Python Server nicht erreichbar (http://127.0.0.1:8765)");

  const onServer = new Set<string>(health.models as string[]);
  const needed   = [...models.values()].filter((m) => m.visible && m.file);
  let done = 0;

  for (const m of needed) {
    if (!onServer.has(m.name)) {
      const fd = new FormData();
      fd.append("name", m.name);
      fd.append("file", m.file!);
      await fetch(`${SERVER}/upload`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
    }
    onProgress(5 + (++done / needed.length) * 20);
  }

  return nameToId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toServerRule(rule: ClashRule): Record<string, any> {
  return {
    id:         rule.id,
    name:       rule.name,
    severity:   rule.severity,
    check_type: rule.checkType,
    tolerance:  rule.tolerance,
    set_a: {
      ifc_types:  rule.componentA.ifcTypes,
      conditions: rule.componentA.conditions.map(c => ({
        prop_name: c.propName,
        operator:  c.operator,
        value:     c.value,
      })),
    },
    set_b: {
      ifc_types:  rule.componentB.ifcTypes,
      conditions: rule.componentB.conditions.map(c => ({
        prop_name: c.propName,
        operator:  c.operator,
        value:     c.value,
      })),
    },
  };
}

export async function runServerClash(
  models: Map<string, IFCModelEntry>,
  rules: ClashRule[],
  onProgress: (pct: number) => void,
): Promise<ClashResult[]> {
  onProgress(2);

  const nameToId = await uploadIfMissing(models, onProgress);

  onProgress(30);

  const enabledRules = rules.filter((r) => r.enabled);
  const response = await fetch(`${SERVER}/clash`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ rules: enabledRules.map(toServerRule) }),
    signal:  AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Server-Fehler ${response.status}`);
  }

  onProgress(90);

  const data = await response.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results as any[]).map((r) => ({
    ruleId:     r.rule_id,
    ruleName:   r.rule_name,
    severity:   r.severity    as Severity,
    checkType:  r.check_type  as CheckType,
    modelIdA:   nameToId.get(r.model_name_a) ?? r.model_name_a,
    expressIdA: r.express_id_a,
    nameA:      r.name_a,
    typeA:      r.type_a,
    modelIdB:   nameToId.get(r.model_name_b) ?? r.model_name_b,
    expressIdB: r.express_id_b,
    nameB:      r.name_b,
    typeB:      r.type_b,
    overlap:    r.overlap,
    status:     "new" as ClashStatus,
  }));
}
