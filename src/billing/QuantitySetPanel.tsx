import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import type { BillingEntry } from "./types";
import type { QuantityItem, QuantityType } from "./quantityTypes";
import {
  QUANTITY_META, SOURCE_LABEL, SOURCE_COLOR,
  computeDerivedQuantities, fmtQty, qid,
} from "./quantityTypes";

interface Props {
  entry: BillingEntry;
  onAddItem(item: Omit<QuantityItem, "id">): void;
  onUpdateItem(id: string, patch: Partial<QuantityItem>): void;
  onRemoveItem(id: string): void;
}

const ALL_TYPES = Object.keys(QUANTITY_META) as QuantityType[];
const EDITABLE_TYPES = ALL_TYPES.filter(t => t !== "netArea" && t !== "netVolume");

// ── Inline edit row ───────────────────────────────────────────────────────────

function ItemRow({ item, onUpdate, onRemove }: {
  item: QuantityItem;
  onUpdate(patch: Partial<QuantityItem>): void;
  onRemove(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(item.value));
  const [labelDraft, setLabelDraft] = useState(item.label);

  const commit = () => {
    const v = parseFloat(draft.replace(",", "."));
    if (!isNaN(v)) onUpdate({ value: v, label: labelDraft });
    setEditing(false);
  };

  const meta = QUANTITY_META[item.type];
  const isDerived = item.id.startsWith("__");

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 group rounded",
      isDerived ? "bg-primary/5 border border-primary/20" : "hover:bg-muted/30"
    )}>
      {/* Type + Label */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0 w-16 truncate">{meta.label}</span>
          {editing ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              className="text-xs px-1 py-0.5 bg-background border border-primary rounded flex-1 min-w-0 focus:outline-none"
              onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            />
          ) : (
            <span className="text-xs text-foreground truncate">{item.label}</span>
          )}
        </div>
        {item.note && <span className="text-[10px] text-muted-foreground/60 pl-[4.25rem]">{item.note}</span>}
      </div>

      {/* Value */}
      <div className="flex items-center gap-1 shrink-0">
        {editing ? (
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-20 text-right text-xs px-1.5 py-0.5 bg-background border border-primary rounded font-mono focus:outline-none"
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          />
        ) : (
          <span className="font-mono text-xs tabular-nums text-right w-24">{fmtQty(item.value, item.unit)}</span>
        )}
      </div>

      {/* Source badge */}
      {!isDerived && (
        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0", SOURCE_COLOR[item.source])}>
          {SOURCE_LABEL[item.source]}
        </span>
      )}

      {/* Actions */}
      {!isDerived && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {editing ? (
            <>
              <button onClick={commit} className="p-0.5 text-green-400 hover:text-green-300"><Check size={12} /></button>
              <button onClick={() => setEditing(false)} className="p-0.5 text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </>
          ) : (
            <>
              {item.source === "manual" && (
                <button onClick={() => setEditing(true)} className="p-0.5 text-muted-foreground hover:text-foreground"><Pencil size={11} /></button>
              )}
              <button onClick={onRemove} className="p-0.5 text-muted-foreground hover:text-destructive"><Trash2 size={11} /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Source group ──────────────────────────────────────────────────────────────

function SourceGroup({ label, color, items, onUpdate, onRemove }: {
  label: string;
  color: string;
  items: QuantityItem[];
  onUpdate(id: string, patch: Partial<QuantityItem>): void;
  onRemove(id: string): void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className={cn("px-1.5 py-0.5 rounded border text-[9px] font-bold", color)}>{label}</span>
        <span>{items.length} {items.length === 1 ? "Position" : "Positionen"}</span>
      </button>
      {open && (
        <div className="ml-2">
          {items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onUpdate={p => onUpdate(item.id, p)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add manual item form ──────────────────────────────────────────────────────

function AddManualForm({ onAdd, onClose }: {
  onAdd(item: Omit<QuantityItem, "id">): void;
  onClose(): void;
}) {
  const [type, setType] = useState<QuantityType>("length");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const meta = QUANTITY_META[type];

  const submit = () => {
    const v = parseFloat(value.replace(",", "."));
    if (isNaN(v) || !label.trim()) return;
    onAdd({ type, label: label.trim(), value: v, unit: meta.unit, source: "manual", note: note.trim() || undefined });
    onClose();
  };

  return (
    <div className="mx-3 mb-3 p-3 bg-muted/30 border border-border rounded-lg flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Manuelle Position</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={e => setType(e.target.value as QuantityType)}
          className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {EDITABLE_TYPES.map(t => (
            <option key={t} value={t}>{QUANTITY_META[t].label} [{QUANTITY_META[t].unit}]</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Bezeichnung"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Wert"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
          />
          <span className="text-xs text-muted-foreground shrink-0">{meta.unit}</span>
        </div>
        <input
          type="text"
          placeholder="Notiz (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <button
        onClick={submit}
        disabled={!label.trim() || !value.trim()}
        className="self-end flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        <Plus size={11} />
        Hinzufügen
      </button>
    </div>
  );
}

// ── Summary footer ─────────────────────────────────────────────────────────────

function SummaryBar({ items }: { items: QuantityItem[] }) {
  const totalArea     = items.filter(i => i.type === "area"     && !i.isDeduction).reduce((s, i) => s + i.value, 0);
  const totalOpenings = items.filter(i => i.type === "openingArea").reduce((s, i) => s + i.value, 0);
  const totalVolume   = items.filter(i => i.type === "volume"   && !i.isDeduction).reduce((s, i) => s + i.value, 0);
  const totalLength   = items.filter(i => i.type === "length").reduce((s, i) => s + i.value, 0);
  const totalCount    = items.filter(i => i.type === "count").reduce((s, i) => s + i.value, 0);

  const rows: { label: string; value: string; emphasis?: boolean }[] = [];
  if (totalArea > 0)     rows.push({ label: "∑ Fläche",       value: fmtQty(totalArea, "m²"),    emphasis: !totalOpenings });
  if (totalOpenings > 0) rows.push({ label: "− Öffnungen",    value: fmtQty(totalOpenings, "m²") });
  if (totalArea > 0 && totalOpenings > 0)
                         rows.push({ label: "∑ Nettofläche",  value: fmtQty(Math.max(0, totalArea - totalOpenings), "m²"), emphasis: true });
  if (totalVolume > 0)   rows.push({ label: "∑ Volumen",      value: fmtQty(totalVolume, "m³"),  emphasis: true });
  if (totalLength > 0)   rows.push({ label: "∑ Länge",        value: fmtQty(totalLength, "m"),   emphasis: true });
  if (totalCount > 0)    rows.push({ label: "∑ Stückzahl",    value: fmtQty(totalCount, "Stk"),  emphasis: true });

  if (rows.length === 0) return null;

  return (
    <div className="border-t border-border bg-card/60 px-3 py-2.5 shrink-0">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {rows.map((r, i) => (
          <>
            <span key={`l${i}`} className={cn("text-xs", r.emphasis ? "text-foreground font-medium" : "text-muted-foreground")}>{r.label}</span>
            <span key={`v${i}`} className={cn("text-xs font-mono text-right tabular-nums", r.emphasis ? "text-foreground font-semibold" : "text-muted-foreground")}>{r.value}</span>
          </>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function QuantitySetPanel({ entry, onAddItem, onUpdateItem, onRemoveItem }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const items = entry.quantitySet?.items ?? [];

  const derived = useMemo(() => computeDerivedQuantities(items), [items]);
  // allItems is used only for downstream logic — keep reference stable
  const allItems = useMemo(() => [...items, ...derived], [items, derived]);

  const bySource = useMemo(() => ({
    ifc:      items.filter(i => i.source === "ifc"),
    geometry: items.filter(i => i.source === "geometry"),
    measured: items.filter(i => i.source === "measured"),
    manual:   items.filter(i => i.source === "manual"),
  }), [items]);

  const totalCount = items.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">
        {totalCount === 0 && !showAddForm ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6 gap-2">
            <p className="text-xs leading-relaxed">
              Noch keine Mengen erfasst.<br />
              Verwende die Buttons oben um Mengen aus dem IFC-Modell zu extrahieren,
              aus der Geometrie zu berechnen, manuell zu messen oder einzugeben.
            </p>
          </div>
        ) : (
          <div className="py-1">
            <SourceGroup
              label="IFC"
              color={SOURCE_COLOR.ifc}
              items={bySource.ifc}
              onUpdate={onUpdateItem}
              onRemove={onRemoveItem}
            />
            <SourceGroup
              label="GEO"
              color={SOURCE_COLOR.geometry}
              items={bySource.geometry}
              onUpdate={onUpdateItem}
              onRemove={onRemoveItem}
            />
            <SourceGroup
              label="MESS"
              color={SOURCE_COLOR.measured}
              items={bySource.measured}
              onUpdate={onUpdateItem}
              onRemove={onRemoveItem}
            />
            <SourceGroup
              label="MAN"
              color={SOURCE_COLOR.manual}
              items={bySource.manual}
              onUpdate={onUpdateItem}
              onRemove={onRemoveItem}
            />
            {derived.length > 0 && (
              <div className="mt-1 px-3 pb-1">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-semibold mb-1">Abgeleitet</p>
                {derived.map(item => (
                  <ItemRow key={item.id} item={item} onUpdate={() => {}} onRemove={() => {}} />
                ))}
              </div>
            )}
          </div>
        )}

        {showAddForm && (
          <AddManualForm
            onAdd={item => { onAddItem(item); setShowAddForm(false); }}
            onClose={() => setShowAddForm(false)}
          />
        )}
      </div>

      <SummaryBar items={allItems} />
    </div>
  );
}

// Export helper so BillingPanel can toggle the form
export { AddManualForm };

// Extra export so BillingPanel can use qid for preview items
export { qid };
