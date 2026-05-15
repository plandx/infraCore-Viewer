import { useState, useCallback } from "react";
import { X, Plus, Copy, Trash2, Sliders, Play, Check, ChevronDown, AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { useBatchStore } from "./batchStore";
import { buildElementRows, executeRule, collectEdits } from "./BatchExecutor";
import type { BatchOperation, BatchRule, FilterOp, IfcValueType, TargetFilter } from "./types";

interface Props { onClose: () => void; }

function nanoid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// ── Filter summary ────────────────────────────────────────────────────────────

function filterSummary(filter: TargetFilter): string {
  switch (filter.kind) {
    case "all": return "Alle Elemente";
    case "ifcType": return `Typ: ${filter.value || "…"}`;
    case "propCondition": return `${filter.key || "…"} ${filter.op} ${filter.value}`;
    case "basket": return "Auswahlkorb";
  }
}

// ── Operation type labels ─────────────────────────────────────────────────────

const OP_LABELS: Record<BatchOperation["type"], string> = {
  set_property: "Property setzen",
  template: "Vorlage / Formel",
  copy_property: "Property kopieren",
  find_replace: "Suchen & Ersetzen",
  name_to_prop: "Name → Property",
  prop_to_name: "Property → Name",
};

const OP_TYPES: BatchOperation["type"][] = [
  "set_property", "template", "copy_property", "find_replace", "name_to_prop", "prop_to_name",
];

const IFC_VALUE_TYPE_LABELS: Record<IfcValueType, string> = {
  1: "IFCLABEL (Text)",
  14: "IFCREAL (Dezimal)",
  16: "IFCINTEGER (Ganzzahl)",
  18: "IFCBOOLEAN (Ja/Nein)",
};

const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: "ist gleich",
  neq: "ist ungleich",
  contains: "enthält",
  regex: "Regex",
  empty: "ist leer",
  notEmpty: "ist nicht leer",
};

// ── Operation form ────────────────────────────────────────────────────────────

function OperationForm({
  op,
  onChange,
  onRemove,
}: {
  op: BatchOperation;
  onChange: (patch: Partial<BatchOperation>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border rounded-md p-2.5 bg-background/50 space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground"
          value={op.type}
          onChange={(e) => {
            const type = e.target.value as BatchOperation["type"];
            const base = { id: op.id, type };
            switch (type) {
              case "set_property":
                onChange({ ...base, key: "", value: "", ifcValueType: 1 } as Partial<BatchOperation>);
                break;
              case "template":
                onChange({ ...base, targetKey: "", template: "" } as Partial<BatchOperation>);
                break;
              case "copy_property":
                onChange({ ...base, fromKey: "", toKey: "" } as Partial<BatchOperation>);
                break;
              case "find_replace":
                onChange({ ...base, key: "", find: "", replace: "", useRegex: false } as Partial<BatchOperation>);
                break;
              case "name_to_prop":
                onChange({ ...base, targetKey: "" } as Partial<BatchOperation>);
                break;
              case "prop_to_name":
                onChange({ ...base, sourceKey: "" } as Partial<BatchOperation>);
                break;
            }
          }}
        >
          {OP_TYPES.map((t) => (
            <option key={t} value={t}>{OP_LABELS[t]}</option>
          ))}
        </select>
        <button
          onClick={onRemove}
          className="p-1 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-colors"
          title="Operation entfernen"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {op.type === "set_property" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">Property-Schlüssel</label>
              <input
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
                placeholder="z.B. Name oder Pset.Prop"
                value={op.key}
                onChange={(e) => onChange({ key: e.target.value } as Partial<BatchOperation>)}
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">Wert</label>
              <input
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
                placeholder="Neuer Wert"
                value={op.value}
                onChange={(e) => onChange({ value: e.target.value } as Partial<BatchOperation>)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">IFC-Datentyp</label>
            <select
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground"
              value={op.ifcValueType}
              onChange={(e) => onChange({ ifcValueType: Number(e.target.value) as IfcValueType } as Partial<BatchOperation>)}
            >
              {(Object.entries(IFC_VALUE_TYPE_LABELS) as [string, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {op.type === "template" && (
        <>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">Ziel-Property</label>
            <input
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
              placeholder="z.B. Description"
              value={op.targetKey}
              onChange={(e) => onChange({ targetKey: e.target.value } as Partial<BatchOperation>)}
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">
              Vorlage <span className="text-muted-foreground/60">(Platzhalter: {"{Name}"}, {"{Pset.Prop}"})</span>
            </label>
            <input
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono"
              placeholder="{Name} – {Pset_WallCommon.IsExternal}"
              value={op.template}
              onChange={(e) => onChange({ template: e.target.value } as Partial<BatchOperation>)}
            />
          </div>
        </>
      )}

      {op.type === "copy_property" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">Quelle</label>
            <input
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
              placeholder="Von (Schlüssel)"
              value={op.fromKey}
              onChange={(e) => onChange({ fromKey: e.target.value } as Partial<BatchOperation>)}
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">Ziel</label>
            <input
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
              placeholder="Nach (Schlüssel)"
              value={op.toKey}
              onChange={(e) => onChange({ toKey: e.target.value } as Partial<BatchOperation>)}
            />
          </div>
        </div>
      )}

      {op.type === "find_replace" && (
        <>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">Property-Schlüssel</label>
            <input
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
              placeholder="z.B. Name"
              value={op.key}
              onChange={(e) => onChange({ key: e.target.value } as Partial<BatchOperation>)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">Suchen</label>
              <input
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono"
                placeholder="Suchbegriff"
                value={op.find}
                onChange={(e) => onChange({ find: e.target.value } as Partial<BatchOperation>)}
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">Ersetzen</label>
              <input
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono"
                placeholder="Ersatz"
                value={op.replace}
                onChange={(e) => onChange({ replace: e.target.value } as Partial<BatchOperation>)}
              />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={op.useRegex}
              onChange={(e) => onChange({ useRegex: e.target.checked } as Partial<BatchOperation>)}
              className="w-3.5 h-3.5"
            />
            Regulären Ausdruck verwenden
          </label>
        </>
      )}

      {op.type === "name_to_prop" && (
        <div>
          <label className="block text-[10px] text-muted-foreground mb-0.5">Ziel-Property</label>
          <input
            className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
            placeholder="z.B. ObjectType"
            value={op.targetKey}
            onChange={(e) => onChange({ targetKey: e.target.value } as Partial<BatchOperation>)}
          />
        </div>
      )}

      {op.type === "prop_to_name" && (
        <div>
          <label className="block text-[10px] text-muted-foreground mb-0.5">Quell-Property</label>
          <input
            className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
            placeholder="z.B. Tag"
            value={op.sourceKey}
            onChange={(e) => onChange({ sourceKey: e.target.value } as Partial<BatchOperation>)}
          />
        </div>
      )}
    </div>
  );
}

// ── Filter editor ─────────────────────────────────────────────────────────────

function FilterEditor({
  filter,
  basketCount,
  onChange,
}: {
  filter: TargetFilter;
  basketCount: number;
  onChange: (f: TargetFilter) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[10px] text-muted-foreground mb-0.5">Zielauswahl</label>
        <select
          className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground"
          value={filter.kind}
          onChange={(e) => {
            const kind = e.target.value as TargetFilter["kind"];
            switch (kind) {
              case "all": onChange({ kind: "all" }); break;
              case "ifcType": onChange({ kind: "ifcType", value: "" }); break;
              case "propCondition": onChange({ kind: "propCondition", key: "", op: "eq", value: "" }); break;
              case "basket": onChange({ kind: "basket" }); break;
            }
          }}
        >
          <option value="all">Alle Elemente</option>
          <option value="ifcType">IFC-Typ</option>
          <option value="propCondition">Eigenschafts-Bedingung</option>
          <option value="basket">Auswahlkorb</option>
        </select>
      </div>

      {filter.kind === "ifcType" && (
        <input
          className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
          placeholder="z.B. IfcWall"
          value={filter.value}
          onChange={(e) => onChange({ kind: "ifcType", value: e.target.value })}
        />
      )}

      {filter.kind === "propCondition" && (
        <div className="space-y-1.5">
          <input
            className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
            placeholder="Property-Schlüssel (z.B. Name)"
            value={filter.key}
            onChange={(e) => onChange({ ...filter, key: e.target.value })}
          />
          <select
            className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground"
            value={filter.op}
            onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp })}
          >
            {(Object.entries(FILTER_OP_LABELS) as [FilterOp, string][]).map(([op, label]) => (
              <option key={op} value={op}>{label}</option>
            ))}
          </select>
          {filter.op !== "empty" && filter.op !== "notEmpty" && (
            <input
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs"
              placeholder="Vergleichswert"
              value={filter.value}
              onChange={(e) => onChange({ ...filter, value: e.target.value })}
            />
          )}
        </div>
      )}

      {filter.kind === "basket" && (
        <p className="text-xs text-muted-foreground">
          {basketCount > 0
            ? `${basketCount} Element${basketCount !== 1 ? "e" : ""} im Auswahlkorb`
            : "Auswahlkorb ist leer"}
        </p>
      )}
    </div>
  );
}

// ── Rule editor ───────────────────────────────────────────────────────────────

function RuleEditor({ rule }: { rule: BatchRule }) {
  const updateRule = useBatchStore((s) => s.updateRule);
  const previewResult = useBatchStore((s) => s.previewResult);
  const isPreviewing = useBatchStore((s) => s.isPreviewing);
  const isApplying = useBatchStore((s) => s.isApplying);
  const setPreviewResult = useBatchStore((s) => s.setPreviewResult);
  const setIsPreviewing = useBatchStore((s) => s.setIsPreviewing);
  const setIsApplying = useBatchStore((s) => s.setIsApplying);

  const models = useModelStore((s) => s.models);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const selectionBasket = useModelStore((s) => s.selectionBasket);
  const applyPropertyEdits = useModelStore((s) => s.applyPropertyEdits);

  const [addOpOpen, setAddOpOpen] = useState(false);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  const basketCount = selectionBasket.size;

  const handleUpdateOp = useCallback((opId: string, patch: Partial<BatchOperation>) => {
    const ops = rule.operations.map((op) =>
      op.id === opId ? { ...op, ...patch } as BatchOperation : op
    );
    updateRule(rule.id, { operations: ops });
  }, [rule, updateRule]);

  const handleRemoveOp = useCallback((opId: string) => {
    updateRule(rule.id, { operations: rule.operations.filter((op) => op.id !== opId) });
  }, [rule, updateRule]);

  const handleAddOp = useCallback((type: BatchOperation["type"]) => {
    const id = nanoid();
    let op: BatchOperation;
    switch (type) {
      case "set_property": op = { id, type, key: "", value: "", ifcValueType: 1 }; break;
      case "template": op = { id, type, targetKey: "", template: "" }; break;
      case "copy_property": op = { id, type, fromKey: "", toKey: "" }; break;
      case "find_replace": op = { id, type, key: "", find: "", replace: "", useRegex: false }; break;
      case "name_to_prop": op = { id, type, targetKey: "" }; break;
      case "prop_to_name": op = { id, type, sourceKey: "" }; break;
    }
    updateRule(rule.id, { operations: [...rule.operations, op] });
    setAddOpOpen(false);
  }, [rule, updateRule]);

  const handlePreview = useCallback(() => {
    setIsPreviewing(true);
    setApplySuccess(null);
    try {
      const rows = buildElementRows(models as Parameters<typeof buildElementRows>[0], loadedProperties);
      const result = executeRule(rule, rows, selectionBasket);
      setPreviewResult(result);
    } finally {
      setIsPreviewing(false);
    }
  }, [rule, models, loadedProperties, selectionBasket, setIsPreviewing, setPreviewResult]);

  const handleApply = useCallback(() => {
    setIsApplying(true);
    setApplySuccess(null);
    try {
      const rows = buildElementRows(models as Parameters<typeof buildElementRows>[0], loadedProperties);
      const edits = collectEdits(rule, rows, selectionBasket);
      if (edits.length > 0) {
        applyPropertyEdits(edits);
        setApplySuccess(`${edits.length} Eigenschaft${edits.length !== 1 ? "en" : ""} bei ${new Set(edits.map((e) => `${e.modelId}:${e.expressId}`)).size} Element${new Set(edits.map((e) => `${e.modelId}:${e.expressId}`)).size !== 1 ? "en" : ""} gesetzt.`);
      } else {
        setApplySuccess("Keine Änderungen — alle Werte sind bereits aktuell.");
      }
    } finally {
      setIsApplying(false);
    }
  }, [rule, models, loadedProperties, selectionBasket, applyPropertyEdits, setIsApplying]);

  const showResult = previewResult?.ruleId === rule.id ? previewResult : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-4">
      {/* Label */}
      <div>
        <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Regelbezeichnung</label>
        <input
          className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-sm font-medium"
          value={rule.label}
          onChange={(e) => updateRule(rule.id, { label: e.target.value })}
        />
      </div>

      {/* Filter */}
      <div className="border border-border rounded-md p-3 bg-card/50">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Zielauswahl</p>
        <FilterEditor
          filter={rule.filter}
          basketCount={basketCount}
          onChange={(f) => updateRule(rule.id, { filter: f })}
        />
      </div>

      {/* Operations */}
      <div className="border border-border rounded-md p-3 bg-card/50">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
          Operationen <span className="text-muted-foreground/60">({rule.operations.length})</span>
        </p>

        <div className="space-y-2">
          {rule.operations.map((op) => (
            <OperationForm
              key={op.id}
              op={op}
              onChange={(patch) => handleUpdateOp(op.id, patch)}
              onRemove={() => handleRemoveOp(op.id)}
            />
          ))}
        </div>

        {/* Add operation dropdown */}
        <div className="relative mt-2">
          <button
            onClick={() => setAddOpOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-muted hover:bg-muted/80 border border-border text-foreground transition-colors"
          >
            <Plus size={12} />
            Operation hinzufügen
            <ChevronDown size={11} className={cn("transition-transform", addOpOpen && "rotate-180")} />
          </button>
          {addOpOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAddOpOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-40 bg-popover border border-border rounded-md shadow-xl min-w-[200px] py-1">
                {OP_TYPES.map((type) => (
                  <button
                    key={type}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 text-foreground"
                    onClick={() => handleAddOp(type)}
                  >
                    {OP_LABELS[type]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Preview & Apply */}
      <div className="border border-border rounded-md p-3 bg-card/50">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Vorschau &amp; Anwenden</p>

        {loadedProperties === null && (
          <div className="flex items-start gap-2 p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 mb-3">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              Eigenschaften noch nicht geladen — bitte zuerst ein Element im Viewer auswählen oder eine Abfrage ausführen
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handlePreview}
            disabled={isPreviewing || rule.operations.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-muted hover:bg-primary/20 hover:text-primary border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Play size={12} />
            {isPreviewing ? "Berechne…" : "Vorschau"}
          </button>

          {showResult && (
            <button
              onClick={handleApply}
              disabled={isApplying || showResult.changeCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Check size={12} />
              {isApplying ? "Anwenden…" : `Anwenden (${showResult.changeCount})`}
            </button>
          )}
        </div>

        {applySuccess && (
          <div className="mt-2 flex items-center gap-2 p-2.5 rounded bg-green-500/10 border border-green-500/30 text-xs text-green-400">
            <Check size={12} />
            {applySuccess}
          </div>
        )}

        {showResult && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-3 text-xs">
              <span className="text-muted-foreground">
                Treffer: <strong className="text-foreground">{showResult.matchedCount}</strong>
              </span>
              <span className="text-muted-foreground">
                Änderungen: <strong className={showResult.changeCount > 0 ? "text-primary" : "text-foreground"}>{showResult.changeCount}</strong>
              </span>
            </div>

            {showResult.errors.length > 0 && (
              <div className="p-2 rounded bg-destructive/10 border border-destructive/30 text-xs text-destructive space-y-0.5">
                {showResult.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}

            {showResult.changes.length > 0 && (
              <div className="overflow-x-auto rounded border border-border">
                <table className="text-xs border-collapse w-full min-w-[480px]">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground border-b border-border whitespace-nowrap">Element</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground border-b border-border whitespace-nowrap">Property</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground border-b border-border whitespace-nowrap">Vorher</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground border-b border-border whitespace-nowrap">Nachher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {showResult.changes.map((ch, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                        <td className="px-2 py-1 border-b border-border/40 text-foreground/80 max-w-[140px] truncate" title={ch.elementName}>
                          {ch.elementName}
                        </td>
                        <td className="px-2 py-1 border-b border-border/40 font-mono text-primary/80 max-w-[120px] truncate" title={ch.key}>
                          {ch.key}
                        </td>
                        <td className="px-2 py-1 border-b border-border/40 text-muted-foreground max-w-[140px] truncate" title={ch.oldValue}>
                          {ch.oldValue || <em className="opacity-50">leer</em>}
                        </td>
                        <td className="px-2 py-1 border-b border-border/40 text-green-400 max-w-[140px] truncate" title={ch.newValue}>
                          {ch.newValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {showResult.changeCount > showResult.changes.length && (
                  <p className="text-[10px] text-muted-foreground px-2 py-1.5 border-t border-border">
                    … und {showResult.changeCount - showResult.changes.length} weitere Änderungen (nur erste 50 angezeigt)
                  </p>
                )}
              </div>
            )}

            {showResult.changes.length === 0 && showResult.matchedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Keine Änderungen — alle Werte sind bereits aktuell.
              </p>
            )}

            {showResult.matchedCount === 0 && (
              <p className="text-xs text-muted-foreground">
                Kein Element entspricht dem Filter.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main BatchPanel ───────────────────────────────────────────────────────────

export function BatchPanel({ onClose }: Props) {
  const rules = useBatchStore((s) => s.rules);
  const selectedRuleId = useBatchStore((s) => s.selectedRuleId);
  const addRule = useBatchStore((s) => s.addRule);
  const duplicateRule = useBatchStore((s) => s.duplicateRule);
  const removeRule = useBatchStore((s) => s.removeRule);
  const updateRule = useBatchStore((s) => s.updateRule);
  const selectRule = useBatchStore((s) => s.selectRule);

  const selectedRule = rules.find((r) => r.id === selectedRuleId) ?? null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-stretch justify-stretch p-4">
      <div
        className="flex flex-col w-full bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <Sliders size={16} className="text-primary shrink-0" />
          <span className="font-semibold text-sm">Batch-Änderungen</span>
          <span className="text-xs text-muted-foreground">
            — {rules.length} {rules.length === 1 ? "Regel" : "Regeln"}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: rule list */}
          <div className="w-[280px] shrink-0 flex flex-col border-r border-border">
            <div className="p-2 shrink-0">
              <button
                onClick={addRule}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors"
              >
                <Plus size={13} />
                Neue Regel
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-1 pb-2 space-y-0.5">
              {rules.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6 px-3">
                  Noch keine Regeln.<br />Erstelle eine neue Regel.
                </p>
              )}
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => selectRule(rule.id)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded text-xs transition-colors group relative",
                    rule.id === selectedRuleId
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "hover:bg-muted/60 text-foreground border border-transparent"
                  )}
                >
                  <div className="flex items-start gap-1.5 pr-12">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{rule.label || "Unbenannte Regel"}</p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {filterSummary(rule.filter)} · {rule.operations.length} Op.
                      </p>
                    </div>
                  </div>

                  {/* enabled toggle + actions */}
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title={rule.enabled ? "Deaktivieren" : "Aktivieren"}
                      onClick={(e) => { e.stopPropagation(); updateRule(rule.id, { enabled: !rule.enabled }); }}
                      className={cn(
                        "p-1 rounded text-[10px] w-5 h-5 flex items-center justify-center font-bold transition-colors",
                        rule.enabled ? "text-green-400 hover:bg-green-500/20" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {rule.enabled ? "✓" : "○"}
                    </button>
                    <button
                      title="Duplizieren"
                      onClick={(e) => { e.stopPropagation(); duplicateRule(rule.id); }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      title="Löschen"
                      onClick={(e) => { e.stopPropagation(); removeRule(rule.id); }}
                      className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {/* enabled dot (always visible) */}
                  <div className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full group-hover:hidden",
                    rule.enabled ? "bg-green-400" : "bg-muted-foreground/40"
                  )} />
                </button>
              ))}
            </div>
          </div>

          {/* Right: rule editor */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedRule ? (
              <RuleEditor key={selectedRule.id} rule={selectedRule} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Sliders size={32} className="opacity-20" />
                <p className="text-sm">
                  {rules.length === 0
                    ? "Erstelle eine Regel mit \"+ Neue Regel\""
                    : "Wähle eine Regel aus der Liste"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
