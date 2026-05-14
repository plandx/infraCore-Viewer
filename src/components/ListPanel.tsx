import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Download, Eye, EyeOff, Play, RotateCcw, RefreshCw,
  ChevronDown, ChevronUp, Search, Plus, Pencil, Trash2, X, Check, Layers,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { loadAllElementProperties } from "../utils/ifcLoader";
import {
  CONDITION_LABELS, CONDITIONS_WITHOUT_VALUE, PALETTE,
} from "../utils/smartViewUtils";
import type {
  ColorGroup, IFCModelEntry, SpatialNode, FlatElementProps,
  SmartView, SmartTier, SmartRule, SmartCondition, TierAction,
} from "../types/ifc";

// ── built-in "virtual" property keys (no load required) ───────────────────────

const BUILTIN_KEYS = [
  { key: "_type",  label: "IFC-Typ" },
  { key: "_name",  label: "Name" },
  { key: "_model", label: "Modell" },
];

// ── helpers ───────────────────────────────────────────────────────────────────

type GroupBy = "type" | "storey" | "model" | "property";

function stripIfc(s: string) { return s.startsWith("IFC") ? s.slice(3) : s; }
function valueLabel(v: unknown) {
  if (v === null || v === undefined) return "Nicht definiert";
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  const s = String(v).trim();
  return s === "" ? "Nicht definiert" : s;
}

function collectAllEls(node: SpatialNode, modelId: string, out: { modelId: string; expressId: number }[]) {
  if (node.elements) for (const el of node.elements) out.push({ modelId, expressId: el.expressId });
  for (const c of node.children) collectAllEls(c, modelId, out);
}
function collectStoreys(
  node: SpatialNode, modelId: string,
  groups: Map<string, { label: string; entries: { modelId: string; expressId: number }[] }>,
) {
  if (node.type === "IFCBUILDINGSTOREY") {
    const label = node.name || `Geschoss ${node.expressId}`;
    if (!groups.has(label)) groups.set(label, { label, entries: [] });
    collectAllEls(node, modelId, groups.get(label)!.entries);
  } else for (const c of node.children) collectStoreys(c, modelId, groups);
}

function buildGroups(
  groupBy: GroupBy,
  models: Map<string, IFCModelEntry>,
  allProps: Map<string, Map<number, FlatElementProps>> | null,
  propKey: string,
): ColorGroup[] {
  const raw = new Map<string, { label: string; entries: { modelId: string; expressId: number }[] }>();

  if (groupBy === "type") {
    models.forEach((m) => {
      for (const [tn, els] of Object.entries(m.elementsByType)) {
        const lbl = stripIfc(tn);
        if (!raw.has(lbl)) raw.set(lbl, { label: lbl, entries: [] });
        for (const el of els) raw.get(lbl)!.entries.push({ modelId: m.id, expressId: el.expressId });
      }
    });
  } else if (groupBy === "storey") {
    models.forEach((m) => { if (m.spatialTree) collectStoreys(m.spatialTree, m.id, raw); });
    models.forEach((m) => {
      const captured = new Set<number>();
      raw.forEach((g) => g.entries.forEach((e) => { if (e.modelId === m.id) captured.add(e.expressId); }));
      const rest: { modelId: string; expressId: number }[] = [];
      for (const els of Object.values(m.elementsByType))
        for (const el of els) if (!captured.has(el.expressId)) rest.push({ modelId: m.id, expressId: el.expressId });
      if (rest.length > 0) raw.set(`__rest_${m.id}`, { label: `${m.name} (ohne Geschoss)`, entries: rest });
    });
  } else if (groupBy === "model") {
    models.forEach((m) => {
      const entries: { modelId: string; expressId: number }[] = [];
      for (const els of Object.values(m.elementsByType)) for (const el of els) entries.push({ modelId: m.id, expressId: el.expressId });
      if (entries.length > 0) raw.set(m.id, { label: m.name, entries });
    });
  } else if (groupBy === "property" && allProps && propKey) {
    models.forEach((m) => {
      const mp = allProps.get(m.id);
      for (const els of Object.values(m.elementsByType)) {
        for (const el of els) {
          const lbl = valueLabel(mp?.get(el.expressId)?.[propKey]);
          if (!raw.has(lbl)) raw.set(lbl, { label: lbl, entries: [] });
          raw.get(lbl)!.entries.push({ modelId: m.id, expressId: el.expressId });
        }
      }
    });
  }

  let idx = 0;
  return Array.from(raw.values())
    .sort((a, b) => b.entries.length - a.entries.length)
    .map((g) => ({ id: uuidv4(), label: g.label, color: PALETTE[idx++ % PALETTE.length], entries: g.entries, visible: true }));
}

// ── shared property loader ─────────────────────────────────────────────────────

function PropertyLoader() {
  const models = useModelStore((s) => s.models);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const loadedPropKeys = useModelStore((s) => s.loadedPropKeys);
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
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
        onClick={handleLoad}
        disabled={loading || models.size === 0}
      >
        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        <span>{loadedProperties ? "Neu laden" : "Properties laden"}</span>
      </button>
      {loading && (
        <>
          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden min-w-[60px]">
            <div className="h-full bg-primary rounded-full transition-all duration-150" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-muted-foreground text-[10px]">{progress}%</span>
        </>
      )}
      {loadedProperties && !loading && (
        <span className="text-muted-foreground text-[10px]">{loadedPropKeys.length} Attribute</span>
      )}
    </div>
  );
}

// ── property key picker (dropdown with search) ────────────────────────────────

function PropKeyPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const loadedPropKeys = useModelStore((s) => s.loadedPropKeys);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allKeys = useMemo(() => [
    ...BUILTIN_KEYS.map((b) => b.key),
    ...loadedPropKeys,
  ], [loadedPropKeys]);

  const filtered = search
    ? allKeys.filter((k) => k.toLowerCase().includes(search.toLowerCase()))
    : allKeys;

  const displayLabel = (k: string) => BUILTIN_KEYS.find((b) => b.key === k)?.label ?? k;

  return (
    <div className="relative flex-1">
      <button
        className="w-full flex items-center justify-between bg-background border border-border rounded px-2 py-1 text-left hover:border-primary/50 focus:outline-none text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? displayLabel(value) : "Attribut…"}</span>
        <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-md shadow-xl max-h-52 flex flex-col">
            <div className="p-1.5 border-b border-border shrink-0 flex items-center gap-1.5">
              <Search size={10} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-xs focus:outline-none text-foreground placeholder:text-muted-foreground"
                placeholder="Suchen…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {loadedPropKeys.length === 0 && (
              <div className="px-3 py-1.5 text-muted-foreground text-[10px] border-b border-border">
                Properties noch nicht geladen
              </div>
            )}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0
                ? <div className="px-3 py-2 text-muted-foreground text-[11px]">Keine Treffer</div>
                : filtered.map((k) => (
                  <button key={k}
                    className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-muted/60 truncate", k === value && "text-primary font-medium")}
                    onClick={() => { onChange(k); setOpen(false); setSearch(""); }}
                  >
                    {displayLabel(k)}
                  </button>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LISTEN TAB
// ══════════════════════════════════════════════════════════════════════════════

function ListenTab() {
  const models = useModelStore((s) => s.models);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const setColorGroups = useModelStore((s) => s.setColorGroups);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const isolateEntries = useModelStore((s) => s.isolateEntries);
  const showAll = useModelStore((s) => s.showAll);

  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [propKey, setPropKey] = useState("");
  const [localGroups, setLocalGroups] = useState<ColorGroup[]>([]);
  const [isolatedGroupId, setIsolatedGroupId] = useState<string | null>(null);
  const colorInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const isApplied = colorGroups !== null;

  const builtGroups = useMemo(
    () => buildGroups(groupBy, models, loadedProperties, propKey),
    [groupBy, models, loadedProperties, propKey],
  );
  useEffect(() => {
    setLocalGroups((prev) => {
      const prevColors = new Map(prev.map((g) => [g.label, g.color]));
      return builtGroups.map((g) => ({ ...g, color: prevColors.get(g.label) ?? g.color }));
    });
  }, [builtGroups]);

  useEffect(() => {
    if (!isolatedGroupId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { showAll(); setIsolatedGroupId(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isolatedGroupId, showAll]);

  function handleGroupClick(g: ColorGroup) {
    if (isolatedGroupId === g.id) {
      showAll();
      setIsolatedGroupId(null);
    } else {
      isolateEntries(g.entries);
      setIsolatedGroupId(g.id);
    }
  }

  function exportCSV() {
    const rows: string[][] = [["Gruppe", "Farbe", "Modell", "ExpressID"]];
    localGroups.forEach((g) => g.entries.forEach(({ modelId, expressId }) =>
      rows.push([g.label, g.color, models.get(modelId)?.name ?? modelId, String(expressId)])
    ));
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "listen-export.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const canBuild = groupBy !== "property" || (loadedProperties !== null && propKey !== "");
  const total = localGroups.reduce((s, g) => s + g.entries.length, 0);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 bg-card/40">
        <select
          className="flex-1 bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        >
          <option value="type">Nach Typ</option>
          <option value="storey">Nach Geschoss</option>
          <option value="model">Nach Modell</option>
          <option value="property">Nach Attribut</option>
        </select>
        <button
          className={cn("flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors shrink-0",
            isApplied ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-muted hover:bg-muted/80 text-foreground")}
          onClick={() => setColorGroups(localGroups)}
          disabled={localGroups.length === 0 || !canBuild}
        ><Play size={11} /><span>Einfärben</span></button>
        {isApplied && (
          <button className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground" title="Zurücksetzen" onClick={() => setColorGroups(null)}>
            <RotateCcw size={12} />
          </button>
        )}
        <button className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground" title="CSV Export" onClick={exportCSV} disabled={localGroups.length === 0}>
          <Download size={12} />
        </button>
      </div>

      {/* Property mode controls */}
      {groupBy === "property" && (
        <div className="px-3 py-2 border-b border-border shrink-0 space-y-1.5 bg-card/20">
          <PropertyLoader />
          {(loadedProperties || BUILTIN_KEYS.length > 0) && (
            <PropKeyPicker value={propKey} onChange={setPropKey} />
          )}
        </div>
      )}

      {/* Stats */}
      {localGroups.length > 0 && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-border shrink-0">
          {localGroups.length} Gruppen · {total.toLocaleString()} Elemente
          {isApplied && <span className="ml-2 text-primary font-medium">● aktiv</span>}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {groupBy === "property" && !loadedProperties && !propKey ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px] px-6 text-center leading-relaxed">
            Properties laden oder Typ/Name/Modell direkt wählen
          </div>
        ) : localGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px]">
            Kein Modell geladen
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {localGroups.map((g) => {
              const isIsolated = isolatedGroupId === g.id;
              return (
                <div
                  key={g.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors",
                    isIsolated ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/20",
                    !g.visible && "opacity-60",
                  )}
                  title={isIsolated ? "Klicken zum Zurücksetzen (oder Esc)" : "Klicken zum Isolieren"}
                  onClick={() => handleGroupClick(g)}
                >
                  <button
                    className="w-3.5 h-3.5 rounded-sm shrink-0 ring-1 ring-black/20 hover:ring-2 hover:ring-primary"
                    style={{ background: g.color }}
                    onClick={(e) => { e.stopPropagation(); colorInputRefs.current.get(g.id)?.click(); }}
                  />
                  <input ref={(el) => { if (el) colorInputRefs.current.set(g.id, el); else colorInputRefs.current.delete(g.id); }}
                    type="color" className="sr-only" value={g.color}
                    onChange={(e) => setLocalGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, color: e.target.value } : x))}
                  />
                  <span className={cn("flex-1 truncate text-[11px]", isIsolated && "text-primary font-semibold")} title={g.label}>{g.label}</span>
                  {isIsolated && <span className="text-[9px] text-primary font-medium shrink-0 uppercase tracking-wide">ISO</span>}
                  <span className="text-muted-foreground/60 shrink-0 tabular-nums">{g.entries.length.toLocaleString()}</span>
                  <button
                    className={cn("shrink-0 p-0.5 rounded transition-colors", g.visible ? "text-muted-foreground/50 hover:text-foreground" : "text-amber-400")}
                    onClick={(e) => { e.stopPropagation(); setLocalGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, visible: !x.visible } : x)); }}
                  >{g.visible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SMARTVIEWS TAB
// ══════════════════════════════════════════════════════════════════════════════

const CONDITION_OPTIONS = Object.entries(CONDITION_LABELS) as [SmartCondition, string][];

const TIER_ACTION_LABELS: Record<TierAction, string> = {
  hide:      "Ausblenden",
  color:     "Einfärben",
  autoColor: "Auto-Farbe",
};

const TIER_BADGE_CLASSES: Record<TierAction, string> = {
  hide:      "bg-red-500/20 text-red-400",
  color:     "bg-blue-500/20 text-blue-400",
  autoColor: "bg-violet-500/20 text-violet-400",
};

function emptyRule(): SmartRule {
  return { id: uuidv4(), property: "_type", condition: "eq", value: "" };
}

function emptyTier(index: number): SmartTier {
  return {
    id: uuidv4(),
    name: `Ebene ${index + 1}`,
    rules: [],
    logic: "AND",
    action: "color",
    color: PALETTE[index % PALETTE.length],
    colorByKey: "_type",
  };
}

function emptyView(): SmartView {
  return { id: uuidv4(), name: "Neue SmartView", tiers: [emptyTier(0)] };
}

// ── TierEditor ────────────────────────────────────────────────────────────────

function TierEditor({
  tier, index, total, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  tier: SmartTier;
  index: number;
  total: number;
  onChange: (patch: Partial<SmartTier>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const colorRef = useRef<HTMLInputElement>(null);
  const noValueNeeded = (cond: SmartCondition) => CONDITIONS_WITHOUT_VALUE.includes(cond);

  const updRule = (id: string, patch: Partial<SmartRule>) =>
    onChange({ rules: tier.rules.map((r) => r.id === id ? { ...r, ...patch } : r) });

  return (
    <div className="border border-border rounded-md bg-card/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card/40 border-b border-border">
        <Layers size={11} className="text-muted-foreground shrink-0" />
        <input
          className="flex-1 bg-transparent text-xs font-medium text-foreground focus:outline-none placeholder:text-muted-foreground min-w-0"
          placeholder={`Ebene ${index + 1}`}
          value={tier.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title="Nach oben"
            disabled={index === 0}
            onClick={onMoveUp}
          ><ChevronUp size={12} /></button>
          <button
            className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title="Nach unten"
            disabled={index === total - 1}
            onClick={onMoveDown}
          ><ChevronDown size={12} /></button>
          <button
            className="p-0.5 rounded text-muted-foreground/60 hover:text-destructive"
            title="Ebene löschen"
            onClick={onDelete}
          ><X size={12} /></button>
        </div>
      </div>

      <div className="p-2 space-y-2">
        {/* Rules */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Regeln</span>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ rules: [...tier.rules, emptyRule()] })}
            ><Plus size={10} />Hinzufügen</button>
          </div>

          {tier.rules.length === 0 && (
            <div className="text-[11px] text-muted-foreground/60 py-0.5">
              Keine Regeln — alle Elemente werden erfasst
            </div>
          )}

          {tier.rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-1">
              <div className="flex-1 min-w-0">
                <PropKeyPicker value={rule.property} onChange={(k) => updRule(rule.id, { property: k })} />
              </div>
              <select
                className="bg-background border border-border rounded px-1 py-1 text-xs text-foreground focus:outline-none shrink-0"
                value={rule.condition}
                onChange={(e) => updRule(rule.id, { condition: e.target.value as SmartCondition })}
              >
                {CONDITION_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
              {!noValueNeeded(rule.condition) && (
                <input
                  className="w-20 bg-background border border-border rounded px-1.5 py-1 text-xs focus:outline-none shrink-0"
                  placeholder="Wert"
                  value={rule.value}
                  onChange={(e) => updRule(rule.id, { value: e.target.value })}
                />
              )}
              <button
                className="p-0.5 text-muted-foreground/60 hover:text-destructive shrink-0"
                onClick={() => onChange({ rules: tier.rules.filter((r) => r.id !== rule.id) })}
              ><X size={11} /></button>
            </div>
          ))}
        </div>

        {/* Logic toggle */}
        {tier.rules.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Verknüpfung:</span>
            {(["AND", "OR"] as const).map((l) => (
              <button
                key={l}
                className={cn("px-2 py-0.5 rounded text-[11px] border transition-colors",
                  tier.logic === l ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}
                onClick={() => onChange({ logic: l })}
              >{l === "AND" ? "Alle (UND)" : "Eine (ODER)"}</button>
            ))}
          </div>
        )}

        {/* Action */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Aktion</span>
          <div className="flex gap-1 flex-wrap">
            {(["hide", "color", "autoColor"] as TierAction[]).map((a) => (
              <button
                key={a}
                className={cn("px-2 py-0.5 rounded text-[11px] border transition-colors",
                  tier.action === a ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}
                onClick={() => onChange({ action: a })}
              >{TIER_ACTION_LABELS[a]}</button>
            ))}
          </div>
          {tier.action === "color" && (
            <div className="flex items-center gap-2">
              <button
                className="w-5 h-5 rounded ring-1 ring-black/20 hover:ring-2 hover:ring-primary shrink-0"
                style={{ background: tier.color }}
                onClick={() => colorRef.current?.click()}
              />
              <input ref={colorRef} type="color" className="sr-only" value={tier.color}
                onChange={(e) => onChange({ color: e.target.value })} />
              <span className="text-[11px] text-muted-foreground">{tier.color}</span>
            </div>
          )}
          {tier.action === "autoColor" && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground shrink-0">Nach:</span>
              <PropKeyPicker value={tier.colorByKey} onChange={(k) => onChange({ colorByKey: k })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SmartView editor ──────────────────────────────────────────────────────────

function SmartViewEditor({
  initial, onSave, onCancel,
}: {
  initial: SmartView;
  onSave: (view: SmartView) => void;
  onCancel: () => void;
}) {
  const [view, setView] = useState<SmartView>(() => ({
    ...initial,
    tiers: initial.tiers.map((t) => ({ ...t, rules: t.rules.map((r) => ({ ...r })) })),
  }));

  const updTier = (tierId: string, patch: Partial<SmartTier>) =>
    setView((v) => ({ ...v, tiers: v.tiers.map((t) => t.id === tierId ? { ...t, ...patch } : t) }));

  const deleteTier = (tierId: string) =>
    setView((v) => ({ ...v, tiers: v.tiers.filter((t) => t.id !== tierId) }));

  const moveTier = (index: number, dir: -1 | 1) =>
    setView((v) => {
      const tiers = [...v.tiers];
      const target = index + dir;
      if (target < 0 || target >= tiers.length) return v;
      [tiers[index], tiers[target]] = [tiers[target], tiers[index]];
      return { ...v, tiers };
    });

  const addTier = () =>
    setView((v) => ({ ...v, tiers: [...v.tiers, emptyTier(v.tiers.length)] }));

  const canSave = view.name.trim() !== "" && view.tiers.length > 0;

  return (
    <div className="flex flex-col gap-3 p-3 bg-card/30 border-b border-border">
      {/* Name */}
      <input
        className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60"
        placeholder="Name"
        value={view.name}
        onChange={(e) => setView((v) => ({ ...v, name: e.target.value }))}
      />

      {/* Tiers */}
      <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-0.5">
        {view.tiers.map((tier, i) => (
          <TierEditor
            key={tier.id}
            tier={tier}
            index={i}
            total={view.tiers.length}
            onChange={(patch) => updTier(tier.id, patch)}
            onDelete={() => deleteTier(tier.id)}
            onMoveUp={() => moveTier(i, -1)}
            onMoveDown={() => moveTier(i, 1)}
          />
        ))}
      </div>

      {/* Add tier */}
      <button
        className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        onClick={addTier}
      ><Plus size={11} />Ebene hinzufügen</button>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={!canSave}
          onClick={() => onSave(view)}
        ><Check size={12} />Speichern</button>
        <button
          className="px-3 py-1.5 rounded text-[11px] border border-border text-muted-foreground hover:bg-muted/60"
          onClick={onCancel}
        >Abbrechen</button>
      </div>
    </div>
  );
}

// ── SmartViews tab ────────────────────────────────────────────────────────────

function SmartViewsTab() {
  const smartViews = useModelStore((s) => s.smartViews);
  const activeSmartViewId = useModelStore((s) => s.activeSmartViewId);
  const stagedSmartViewId = useModelStore((s) => s.stagedSmartViewId);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const addSmartView = useModelStore((s) => s.addSmartView);
  const updateSmartView = useModelStore((s) => s.updateSmartView);
  const removeSmartView = useModelStore((s) => s.removeSmartView);
  const setStagedSmartViewId = useModelStore((s) => s.setStagedSmartViewId);
  const applySmartView = useModelStore((s) => s.applySmartView);
  const deactivateSmartView = useModelStore((s) => s.deactivateSmartView);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftView, setDraftView] = useState<SmartView | null>(null);

  const startCreate = () => {
    const v = emptyView();
    setDraftView(v);
    setEditingId("new");
  };

  const startEdit = (id: string) => {
    const v = smartViews.find((s) => s.id === id);
    if (v) {
      setDraftView({ ...v, tiers: v.tiers.map((t) => ({ ...t, rules: t.rules.map((r) => ({ ...r })) })) });
      setEditingId(id);
    }
  };

  const handleSave = (view: SmartView) => {
    if (editingId === "new") addSmartView(view);
    else updateSmartView(view.id, view);
    setEditingId(null); setDraftView(null);
  };

  const handleCancel = () => { setEditingId(null); setDraftView(null); };

  const handleApply = useCallback((id: string) => {
    if (activeSmartViewId === id) deactivateSmartView();
    else applySmartView(id);
  }, [activeSmartViewId, applySmartView, deactivateSmartView]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 bg-card/40">
        <div className="space-y-1 w-full">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">SmartViews</span>
            <button
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={startCreate}
              disabled={editingId !== null}
            ><Plus size={12} />Neu</button>
          </div>
          <PropertyLoader />
        </div>
      </div>

      {/* Active hint */}
      {activeSmartViewId && (
        <div className="px-3 py-1.5 text-[10px] bg-primary/10 border-b border-primary/20 flex items-center justify-between shrink-0">
          <span className="text-primary font-medium">● SmartView aktiv</span>
          <button className="text-muted-foreground hover:text-foreground" onClick={deactivateSmartView}>
            <X size={11} />
          </button>
        </div>
      )}

      {/* Color legend */}
      {activeSmartViewId && colorGroups && colorGroups.length > 0 && (
        <div className="px-3 py-2 border-b border-border shrink-0 bg-muted/10">
          <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Farblegende</div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {colorGroups.map((g) => (
              <div key={g.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-black/20" style={{ background: g.color }} />
                <span className="text-[10px] text-foreground truncate flex-1" title={g.label}>{g.label}</span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{g.entries.length}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor (new) */}
      {editingId === "new" && draftView && (
        <SmartViewEditor initial={draftView} onSave={handleSave} onCancel={handleCancel} />
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {smartViews.length === 0 && editingId === null ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <span className="text-[11px] text-center px-6 leading-relaxed">
              Noch keine SmartViews. Erstelle eine regelbasierte Ansicht.
            </span>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] border border-border hover:bg-muted/60 text-foreground"
              onClick={startCreate}
            ><Plus size={12} />SmartView erstellen</button>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {smartViews.map((sv) => (
              <div key={sv.id}>
                {/* Row */}
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/20 transition-colors",
                    stagedSmartViewId === sv.id && "bg-primary/5",
                  )}
                  onClick={() => setStagedSmartViewId(stagedSmartViewId === sv.id ? null : sv.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-[11px] font-medium truncate", activeSmartViewId === sv.id && "text-primary")}>
                        {sv.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {sv.tiers.length} Ebene{sv.tiers.length !== 1 ? "n" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {sv.tiers.map((tier) => (
                        <span key={tier.id} className={cn("flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-medium", TIER_BADGE_CLASSES[tier.action])}>
                          {tier.name}
                          {tier.action === "color" && (
                            <span className="w-2 h-2 rounded-full inline-block ml-0.5 ring-1 ring-black/10" style={{ background: tier.color }} />
                          )}
                          {tier.action === "autoColor" && tier.colorByKey && (
                            <span className="text-[8px] opacity-70 ml-0.5">/{tier.colorByKey.split(".").pop()}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      className={cn(
                        "p-1 rounded text-[10px] transition-colors",
                        activeSmartViewId === sv.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-primary hover:bg-primary/10",
                      )}
                      title={activeSmartViewId === sv.id ? "Deaktivieren" : "Anwenden"}
                      onClick={(e) => { e.stopPropagation(); handleApply(sv.id); }}
                    ><Play size={11} /></button>
                    <button
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30"
                      title="Bearbeiten"
                      disabled={editingId !== null}
                      onClick={(e) => { e.stopPropagation(); startEdit(sv.id); }}
                    ><Pencil size={10} /></button>
                    <button
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Löschen"
                      onClick={(e) => { e.stopPropagation(); removeSmartView(sv.id); }}
                    ><Trash2 size={10} /></button>
                  </div>
                </div>

                {/* Inline editor for existing view */}
                {editingId === sv.id && draftView && (
                  <SmartViewEditor initial={draftView} onSave={handleSave} onCancel={handleCancel} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Double-click hint */}
      {stagedSmartViewId && stagedSmartViewId !== activeSmartViewId && (
        <div className="px-3 py-2 border-t border-border shrink-0 bg-primary/5">
          <p className="text-[10px] text-primary/80 text-center">
            Doppelklick im 3D-Viewer zum Anwenden
          </p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL (tabs)
// ══════════════════════════════════════════════════════════════════════════════

export function ListPanel() {
  const [tab, setTab] = useState<"listen" | "smartviews">("listen");

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs select-none">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 bg-card/60">
        {(["listen", "smartviews"] as const).map((t) => (
          <button
            key={t}
            className={cn(
              "flex-1 py-2 text-[11px] font-medium transition-colors",
              tab === t
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(t)}
          >{t === "listen" ? "Lens Rules" : "SmartViews"}</button>
        ))}
      </div>

      {tab === "listen" ? <ListenTab /> : <SmartViewsTab />}
    </div>
  );
}
