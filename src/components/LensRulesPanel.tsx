import { useState, useMemo, useEffect, useRef } from "react";
import { Download, Eye, EyeOff, Play, RotateCcw, ChevronDown, Search } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { PALETTE, evaluateTier } from "../utils/smartViewUtils";
import type { ColorGroup, IFCModelEntry, SpatialNode, FlatElementProps, SmartView } from "../types/ifc";

// ── helpers ───────────────────────────────────────────────────────────────────

type GroupBy = "type" | "storey" | "model" | "property";

const BUILTIN_KEYS = [
  { key: "_type",  label: "IFC-Typ" },
  { key: "_name",  label: "Name" },
  { key: "_model", label: "Modell" },
];

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

// ── property key picker ────────────────────────────────────────────────────────

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

// ── main panel ─────────────────────────────────────────────────────────────────

export function LensRulesPanel() {
  const models = useModelStore((s) => s.models);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const setColorGroups = useModelStore((s) => s.setColorGroups);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const isolateEntries = useModelStore((s) => s.isolateEntries);
  const showAll = useModelStore((s) => s.showAll);
  const smartViews = useModelStore((s) => s.smartViews);

  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [propKey, setPropKey] = useState("");
  const [localGroups, setLocalGroups] = useState<ColorGroup[]>([]);
  const [isolatedGroupId, setIsolatedGroupId] = useState<string | null>(null);
  const [smartViewFilterId, setSmartViewFilterId] = useState<string | null>(null);
  const colorInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const isApplied = colorGroups !== null;

  const namedSmartViews = useMemo(
    () => (smartViews as SmartView[]).filter((v) => v.id !== "__quick_filter__"),
    [smartViews],
  );

  const visibleModels = useMemo(() => {
    const m = new Map<string, IFCModelEntry>();
    models.forEach((entry, id) => { if (entry.visible) m.set(id, entry); });
    return m;
  }, [models]);

  const builtGroups = useMemo(
    () => buildGroups(groupBy, visibleModels, loadedProperties, propKey),
    [groupBy, visibleModels, loadedProperties, propKey],
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

  const elementBasePropsMap = useMemo(() => {
    const map = new Map<string, { _type: string; _name: string; _model: string }>();
    visibleModels.forEach((m) => {
      for (const [type, els] of Object.entries(m.elementsByType)) {
        for (const el of els as Array<{ expressId: number; name: string }>) {
          map.set(`${m.id}:${el.expressId}`, { _type: type, _name: el.name ?? "", _model: m.name });
        }
      }
    });
    return map;
  }, [visibleModels]);

  const filteredLocalGroups = useMemo(() => {
    if (!smartViewFilterId) return localGroups;
    const sv = namedSmartViews.find((v) => v.id === smartViewFilterId);
    if (!sv || sv.tiers.length === 0) return localGroups;
    return localGroups.map((g) => ({
      ...g,
      entries: g.entries.filter(({ modelId, expressId }) => {
        const base = elementBasePropsMap.get(`${modelId}:${expressId}`) ?? { _type: "", _name: "", _model: "" };
        const loaded = (loadedProperties?.get(modelId)?.get(expressId) as Record<string, unknown>) ?? {};
        const props: FlatElementProps = { ...loaded, ...base };
        return sv.tiers.some((tier) => evaluateTier(tier, props));
      }),
    })).filter((g) => g.entries.length > 0);
  }, [localGroups, smartViewFilterId, namedSmartViews, elementBasePropsMap, loadedProperties]);

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
    filteredLocalGroups.forEach((g) => g.entries.forEach(({ modelId, expressId }) =>
      rows.push([g.label, g.color, models.get(modelId)?.name ?? modelId, String(expressId)])
    ));
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "lens-rules-export.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const canBuild = groupBy !== "property" || (loadedProperties !== null && propKey !== "");
  const total = filteredLocalGroups.reduce((s, g) => s + g.entries.length, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs select-none">
      {/* Toolbar */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-border shrink-0 bg-card/40">
        <div className="flex items-center gap-1.5">
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
            onClick={() => setColorGroups(filteredLocalGroups)}
            disabled={filteredLocalGroups.length === 0 || !canBuild}
          ><Play size={11} /><span>Einfärben</span></button>
          {isApplied && (
            <button className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground" title="Zurücksetzen" onClick={() => setColorGroups(null)}>
              <RotateCcw size={12} />
            </button>
          )}
          <button className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground" title="CSV Export" onClick={exportCSV} disabled={filteredLocalGroups.length === 0}>
            <Download size={12} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">Filter:</span>
          <select
            className="flex-1 bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none"
            value={smartViewFilterId ?? ""}
            onChange={(e) => setSmartViewFilterId(e.target.value || null)}
          >
            <option value="">{namedSmartViews.length === 0 ? "— Keine SmartViews —" : "Kein SmartView-Filter"}</option>
            {namedSmartViews.map((sv) => (
              <option key={sv.id} value={sv.id}>{sv.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Property mode controls */}
      {groupBy === "property" && (
        <div className="px-3 py-2 border-b border-border shrink-0 bg-card/20">
          <PropKeyPicker value={propKey} onChange={setPropKey} />
        </div>
      )}

      {/* Stats */}
      {localGroups.length > 0 && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-border shrink-0">
          {filteredLocalGroups.length} Gruppen · {total.toLocaleString()} Elemente
          {smartViewFilterId && <span className="ml-2 text-amber-400 font-medium">● gefiltert</span>}
          {isApplied && <span className="ml-2 text-primary font-medium">● aktiv</span>}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {localGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px]">
            {groupBy === "property" && !propKey ? "Attribut auswählen" : "Kein Modell geladen"}
          </div>
        ) : filteredLocalGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px] px-6 text-center leading-relaxed">
            Keine Elemente entsprechen dem gewählten SmartView-Filter
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filteredLocalGroups.map((g) => {
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
