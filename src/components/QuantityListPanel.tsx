import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import * as XLSX from "xlsx";
import { Plus, Trash2, Download, Play, ChevronUp, ChevronDown, X, Table2, RefreshCw } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { evaluateRule, CONDITION_LABELS, CONDITIONS_WITHOUT_VALUE } from "../utils/smartViewUtils";
import { loadAllElementProperties } from "../utils/ifcLoader";
import type { QTOList, QTOFilter, QTOColumn, SmartCondition, FlatElementProps } from "../types/ifc";
import { cn } from "../lib/utils";

const BUILTIN_KEYS = ["_type", "_name", "_model"];
const BUILTIN_LABELS: Record<string, string> = { _type: "IFC-Typ", _name: "Name", _model: "Modell" };

const ALL_CONDITIONS: SmartCondition[] = [
  "eq", "neq", "contains", "not_contains",
  "starts_with", "ends_with",
  "gt", "lt", "gte", "lte",
  "is_true", "is_false", "exists", "not_exists",
];

interface ResultRow { modelId: string; expressId: number; data: Record<string, string> }

const MAX_VISIBLE = 500;

// ── Property loader ───────────────────────────────────────────────────────────

function PropertyLoader() {
  const models = useModelStore((s) => s.models);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const setLoadedProperties = useModelStore((s) => s.setLoadedProperties);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleLoad() {
    setLoading(true);
    setProgress(0);
    const result = new Map<string, Map<number, FlatElementProps>>();
    const keySet = new Set<string>();
    let total = 0;
    models.forEach((m) => { for (const els of Object.values(m.elementsByType)) total += els.length; });
    let base = 0;
    for (const [modelId, model] of models.entries()) {
      if (model.status !== "loaded") continue;
      const ids: number[] = [];
      for (const els of Object.values(model.elementsByType)) for (const el of els) ids.push(el.expressId);
      const map = await loadAllElementProperties(model.file, ids, (done) =>
        setProgress(Math.round(((base + done) / total) * 100))
      );
      base += ids.length;
      map.forEach((p) => Object.keys(p).forEach((k) => keySet.add(k)));
      result.set(modelId, map);
    }
    const sorted = Array.from(keySet).sort((a, b) => {
      const ad = a.includes("."), bd = b.includes(".");
      if (ad !== bd) return ad ? 1 : -1;
      return a.localeCompare(b);
    });
    setLoadedProperties(result, sorted);
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
      <button
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
        onClick={handleLoad}
        disabled={loading || models.size === 0}
      >
        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        {loadedProperties ? "Properties neu laden" : "Properties laden"}
      </button>
      {loading && <span className="text-[11px] text-muted-foreground">{progress}%</span>}
      {!loading && loadedProperties && (
        <span className="text-[11px] text-emerald-500/80">
          {useModelStore.getState().loadedPropKeys.length} Schlüssel geladen
        </span>
      )}
      {!loadedProperties && !loading && models.size > 0 && (
        <span className="text-[11px] text-muted-foreground">← Laden für vollständige Eigenschafts-Auswahl</span>
      )}
    </div>
  );
}

// ── Prop key autocomplete input ───────────────────────────────────────────────

function PropKeyInput({ value, onChange, propKeys, placeholder = "Eigenschaft..." }: {
  value: string; onChange: (v: string) => void; propKeys: string[]; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const allKeys = [...BUILTIN_KEYS, ...propKeys.filter((k) => !BUILTIN_KEYS.includes(k))];
  const filtered = (search ? allKeys.filter((k) => k.toLowerCase().includes(search.toLowerCase())) : allKeys).slice(0, 60);

  return (
    <div className="relative min-w-0">
      <input
        className="w-full bg-muted/30 border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary/50 font-mono"
        value={search}
        placeholder={placeholder}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-64 max-h-48 overflow-y-auto bg-card border border-border rounded shadow-xl">
          {filtered.map((k) => (
            <button key={k} type="button"
              className="w-full text-left px-2 py-1 text-[11px] hover:bg-muted/60 truncate font-mono"
              onMouseDown={() => { onChange(k); setSearch(k); setOpen(false); }}>
              {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter section ────────────────────────────────────────────────────────────

function FilterSection({ filters, filterLogic, propKeys, onUpdate }: {
  filters: QTOFilter[]; filterLogic: "AND" | "OR"; propKeys: string[];
  onUpdate: (f: QTOFilter[], logic: "AND" | "OR") => void;
}) {
  const add = () => onUpdate([...filters, { id: uuidv4(), key: "_type", condition: "contains", value: "" }], filterLogic);
  const remove = (id: string) => onUpdate(filters.filter((f) => f.id !== id), filterLogic);
  const patchF = (id: string, p: Partial<QTOFilter>) => onUpdate(filters.map((f) => f.id === id ? { ...f, ...p } : f), filterLogic);

  return (
    <div className="px-3 py-2.5 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Filter</span>
        <div className="flex items-center gap-1.5">
          {filters.length >= 2 && (
            <button
              onClick={() => onUpdate(filters, filterLogic === "AND" ? "OR" : "AND")}
              className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 font-mono font-semibold"
              title="Logik umschalten">
              {filterLogic}
            </button>
          )}
          <button onClick={add} className="toolbar-button p-0.5 rounded" title="Filter hinzufügen"><Plus size={12} /></button>
        </div>
      </div>
      <div className="space-y-1">
        {filters.map((f) => (
          <div key={f.id} className="flex items-center gap-1">
            <div className="w-36 shrink-0">
              <PropKeyInput value={f.key} onChange={(v) => patchF(f.id, { key: v })} propKeys={propKeys} />
            </div>
            <select
              className="bg-muted/30 border border-border rounded px-1 py-1 text-[11px] outline-none shrink-0"
              value={f.condition}
              onChange={(e) => patchF(f.id, { condition: e.target.value as SmartCondition })}>
              {ALL_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
            </select>
            {!CONDITIONS_WITHOUT_VALUE.includes(f.condition) && (
              <input
                className="flex-1 min-w-0 bg-muted/30 border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary/50"
                value={f.value} placeholder="Wert…"
                onChange={(e) => patchF(f.id, { value: e.target.value })} />
            )}
            <button onClick={() => remove(f.id)} className="toolbar-button p-0.5 shrink-0 text-muted-foreground hover:text-destructive"><X size={12} /></button>
          </div>
        ))}
        {filters.length === 0 && <p className="text-[11px] text-muted-foreground italic">Kein Filter — alle Elemente werden angezeigt</p>}
      </div>
    </div>
  );
}

// ── Column section ────────────────────────────────────────────────────────────

function ColumnSection({ columns, propKeys, onUpdate }: {
  columns: QTOColumn[]; propKeys: string[]; onUpdate: (cols: QTOColumn[]) => void;
}) {
  const add = () => onUpdate([...columns, { id: uuidv4(), key: "", label: "" }]);
  const remove = (id: string) => onUpdate(columns.filter((c) => c.id !== id));
  const patchC = (id: string, p: Partial<QTOColumn>) => onUpdate(columns.map((c) => c.id === id ? { ...c, ...p } : c));
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...columns];
    const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t], next[idx]];
    onUpdate(next);
  };

  return (
    <div className="px-3 py-2.5 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Spalten</span>
        <button onClick={add} className="toolbar-button p-0.5 rounded" title="Spalte hinzufügen"><Plus size={12} /></button>
      </div>
      <div className="space-y-1">
        {columns.map((col, idx) => (
          <div key={col.id} className="flex items-center gap-1">
            <div className="w-36 shrink-0">
              <PropKeyInput
                value={col.key}
                onChange={(v) => patchC(col.id, { key: v, label: col.label || (BUILTIN_LABELS[v] ?? v) })}
                propKeys={propKeys} placeholder="Eigenschaft…" />
            </div>
            <input
              className="flex-1 min-w-0 bg-muted/30 border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary/50"
              value={col.label} placeholder="Spaltenname…"
              onChange={(e) => patchC(col.id, { label: e.target.value })} />
            <div className="flex flex-col shrink-0 gap-px">
              <button onClick={() => move(idx, -1)} disabled={idx === 0} className="toolbar-button p-px disabled:opacity-30"><ChevronUp size={10} /></button>
              <button onClick={() => move(idx, 1)} disabled={idx === columns.length - 1} className="toolbar-button p-px disabled:opacity-30"><ChevronDown size={10} /></button>
            </div>
            <button onClick={() => remove(col.id)} className="toolbar-button p-0.5 shrink-0 text-muted-foreground hover:text-destructive"><X size={12} /></button>
          </div>
        ))}
        {columns.length === 0 && <p className="text-[11px] text-muted-foreground italic">Keine Spalten definiert</p>}
      </div>
    </div>
  );
}

// ── Results table ─────────────────────────────────────────────────────────────

function ResultsTable({ columns, rows }: { columns: QTOColumn[]; rows: ResultRow[] }) {
  if (rows.length === 0) return (
    <div className="flex items-center justify-center py-10 text-muted-foreground text-[11px]">Keine Elemente gefunden</div>
  );
  return (
    <div className="flex-1 overflow-auto">
      {rows.length > MAX_VISIBLE && (
        <p className="text-[11px] text-amber-500/80 px-3 py-1 bg-amber-500/5 border-b border-border">
          Zeige {MAX_VISIBLE} von {rows.length} — XLSX-Export enthält alle Zeilen
        </p>
      )}
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 bg-card z-10">
          <tr>
            {columns.map((col) => (
              <th key={col.id} className="text-left px-3 py-1.5 font-semibold border-b border-border text-muted-foreground whitespace-nowrap">
                {col.label || col.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_VISIBLE).map((row, i) => (
            <tr key={i} className={cn("border-b border-border/40 hover:bg-muted/30", i % 2 === 0 && "bg-muted/10")}>
              {columns.map((col) => (
                <td key={col.id} className="px-3 py-1 text-foreground/80 max-w-[220px] truncate whitespace-nowrap">
                  {row.data[col.id] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function QuantityListPanel() {
  const qtoLists      = useModelStore((s) => s.qtoLists);
  const addQTOList    = useModelStore((s) => s.addQTOList);
  const updateQTOList = useModelStore((s) => s.updateQTOList);
  const removeQTOList = useModelStore((s) => s.removeQTOList);
  const models        = useModelStore((s) => s.models);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const loadedPropKeys   = useModelStore((s) => s.loadedPropKeys);

  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);

  const activeList = qtoLists.find((l) => l.id === activeListId) ?? null;

  const handleNew = () => {
    const list: QTOList = {
      id: uuidv4(),
      name: "Neue Liste",
      filters: [],
      filterLogic: "AND",
      columns: [
        { id: uuidv4(), key: "_type", label: "IFC-Typ" },
        { id: uuidv4(), key: "_name", label: "Name" },
        { id: uuidv4(), key: "_model", label: "Modell" },
      ],
    };
    addQTOList(list);
    setActiveListId(list.id);
    setResults(null);
  };

  const patch = (p: Partial<QTOList>) => {
    if (!activeList) return;
    updateQTOList(activeList.id, p);
    setResults(null);
  };

  const handleRun = useCallback(() => {
    if (!activeList) return;
    const rows: ResultRow[] = [];
    models.forEach((model) => {
      if (model.status !== "loaded") return;
      const modelProps = loadedProperties?.get(model.id);
      for (const [typeName, elements] of Object.entries(model.elementsByType)) {
        for (const el of elements) {
          const props: FlatElementProps = {
            _type: typeName,
            _name: el.name,
            _model: model.name,
            ...(modelProps?.get(el.expressId) ?? {}),
          };
          let match = true;
          if (activeList.filters.length > 0) {
            const hits = activeList.filters.map((f) =>
              evaluateRule({ id: f.id, property: f.key, condition: f.condition, value: f.value }, props)
            );
            match = activeList.filterLogic === "AND" ? hits.every(Boolean) : hits.some(Boolean);
          }
          if (match) {
            const data: Record<string, string> = {};
            for (const col of activeList.columns) {
              const val = props[col.key];
              data[col.id] = val === null || val === undefined ? "" : String(val);
            }
            rows.push({ modelId: model.id, expressId: el.expressId, data });
          }
        }
      }
    });
    setResults(rows);
  }, [activeList, models, loadedProperties]);

  const handleExport = () => {
    if (!activeList || !results) return;
    const header = activeList.columns.map((c) => c.label || c.key);
    const dataRows = results.map((r) => activeList.columns.map((c) => r.data[c.id] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
    ws["!cols"] = activeList.columns.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeList.name.slice(0, 31));
    XLSX.writeFile(wb, `${activeList.name}.xlsx`);
  };

  return (
    <div className="flex h-full overflow-hidden text-xs">
      {/* Left: saved lists */}
      <div className="w-44 shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-2.5 py-2 border-b border-border bg-card/50">
          <div className="flex items-center gap-1.5">
            <Table2 size={12} className="text-muted-foreground" />
            <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Listen</span>
          </div>
          <button onClick={handleNew} className="toolbar-button p-0.5 rounded" title="Neue Liste"><Plus size={13} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {qtoLists.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-muted-foreground text-[11px] mb-2">Noch keine Listen</p>
              <button onClick={handleNew} className="text-primary hover:underline text-[11px]">+ Neue Liste</button>
            </div>
          )}
          {qtoLists.map((list) => (
            <button
              key={list.id}
              onClick={() => { setActiveListId(list.id); setResults(null); }}
              className={cn(
                "w-full text-left px-3 py-2 text-[11px] border-b border-border/50 truncate hover:bg-muted/50 transition-colors",
                list.id === activeListId && "bg-primary/10 text-primary font-semibold"
              )}>
              {list.name}
            </button>
          ))}
        </div>
      </div>

      {/* Right: editor + results */}
      {!activeList ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground flex-col gap-3">
          <Table2 size={32} className="opacity-20" />
          <p className="text-[11px]">Liste auswählen oder neu erstellen</p>
          <button onClick={handleNew} className="text-primary hover:underline text-[11px]">+ Neue Liste</button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* List header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-card/30">
            <input
              className="flex-1 bg-transparent border-none outline-none font-semibold text-sm text-foreground"
              value={activeList.name}
              onChange={(e) => patch({ name: e.target.value })} />
            <button
              onClick={() => { removeQTOList(activeList.id); setActiveListId(null); setResults(null); }}
              className="toolbar-button p-1 text-muted-foreground hover:text-destructive"
              title="Liste löschen">
              <Trash2 size={13} />
            </button>
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            <PropertyLoader />
            <FilterSection
              filters={activeList.filters}
              filterLogic={activeList.filterLogic}
              propKeys={loadedPropKeys}
              onUpdate={(filters, filterLogic) => patch({ filters, filterLogic })} />

            <ColumnSection
              columns={activeList.columns}
              propKeys={loadedPropKeys}
              onUpdate={(columns) => patch({ columns })} />

            {/* Run bar */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0 bg-card/20">
              <button
                onClick={handleRun}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
                <Play size={11} />
                Ausführen
              </button>
              {results !== null && (
                <>
                  <span className="text-muted-foreground text-[11px]">
                    {results.length} {results.length === 1 ? "Element" : "Elemente"}
                  </span>
                  <button
                    onClick={handleExport}
                    disabled={results.length === 0}
                    className="flex items-center gap-1.5 ml-auto px-2.5 py-1.5 rounded border border-border text-xs hover:bg-muted/50 disabled:opacity-40 transition-colors">
                    <Download size={12} />
                    XLSX exportieren
                  </button>
                </>
              )}
            </div>

            {results !== null && (
              <ResultsTable columns={activeList.columns} rows={results} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
