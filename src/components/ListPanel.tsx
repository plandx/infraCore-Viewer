import { useState, useMemo, useEffect, useRef } from "react";
import { Download, Eye, EyeOff, Play, RotateCcw, RefreshCw, ChevronDown, Search } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { loadAllElementProperties, type FlatElementProps } from "../utils/ifcLoader";
import type { ColorGroup, IFCModelEntry, SpatialNode } from "../types/ifc";

// ── types ─────────────────────────────────────────────────────────────────────

type GroupBy = "type" | "storey" | "model" | "property";

// ── constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  "#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7",
  "#73daca", "#ff9e64", "#2ac3de", "#b4f9f8", "#cfc9c2",
  "#1abc9c", "#e056fd", "#fd9644", "#45aaf2", "#a55eea",
];

// ── helpers ───────────────────────────────────────────────────────────────────

function stripIfc(name: string) {
  return name.startsWith("IFC") ? name.slice(3) : name;
}

function valueLabel(v: unknown): string {
  if (v === null || v === undefined) return "Nicht definiert";
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  const s = String(v).trim();
  return s === "" ? "Nicht definiert" : s;
}

function collectAllElements(node: SpatialNode, modelId: string, out: { modelId: string; expressId: number }[]) {
  if (node.elements) {
    for (const el of node.elements) out.push({ modelId, expressId: el.expressId });
  }
  for (const child of node.children) collectAllElements(child, modelId, out);
}

function collectStoreys(
  node: SpatialNode,
  modelId: string,
  groups: Map<string, { label: string; entries: { modelId: string; expressId: number }[] }>,
) {
  if (node.type === "IFCBUILDINGSTOREY") {
    const label = node.name || `Geschoss ${node.expressId}`;
    if (!groups.has(label)) groups.set(label, { label, entries: [] });
    collectAllElements(node, modelId, groups.get(label)!.entries);
  } else {
    for (const child of node.children) collectStoreys(child, modelId, groups);
  }
}

type RawGroup = { label: string; entries: { modelId: string; expressId: number }[] };

function buildGroupsFromModels(
  groupBy: GroupBy,
  models: Map<string, IFCModelEntry>,
  allProps: Map<string, Map<number, FlatElementProps>> | null,
  propKey: string,
): ColorGroup[] {
  const raw = new Map<string, RawGroup>();

  if (groupBy === "type") {
    models.forEach((model) => {
      for (const [typeName, elements] of Object.entries(model.elementsByType)) {
        const label = stripIfc(typeName);
        if (!raw.has(label)) raw.set(label, { label, entries: [] });
        for (const el of elements) raw.get(label)!.entries.push({ modelId: model.id, expressId: el.expressId });
      }
    });

  } else if (groupBy === "storey") {
    models.forEach((model) => {
      if (model.spatialTree) collectStoreys(model.spatialTree, model.id, raw);
    });
    // Uncaptured elements
    models.forEach((model) => {
      const captured = new Set<number>();
      raw.forEach((g) => g.entries.forEach((e) => { if (e.modelId === model.id) captured.add(e.expressId); }));
      const rest: { modelId: string; expressId: number }[] = [];
      for (const elements of Object.values(model.elementsByType)) {
        for (const el of elements) {
          if (!captured.has(el.expressId)) rest.push({ modelId: model.id, expressId: el.expressId });
        }
      }
      if (rest.length > 0) {
        const key = `__rest_${model.id}`;
        raw.set(key, { label: `${model.name} (ohne Geschoss)`, entries: rest });
      }
    });

  } else if (groupBy === "model") {
    models.forEach((model) => {
      const entries: { modelId: string; expressId: number }[] = [];
      for (const elements of Object.values(model.elementsByType)) {
        for (const el of elements) entries.push({ modelId: model.id, expressId: el.expressId });
      }
      if (entries.length > 0) raw.set(model.id, { label: model.name, entries });
    });

  } else if (groupBy === "property" && allProps && propKey) {
    models.forEach((model) => {
      const modelProps = allProps.get(model.id);
      for (const elements of Object.values(model.elementsByType)) {
        for (const el of elements) {
          const props = modelProps?.get(el.expressId);
          const raw_val = props?.[propKey];
          const label = valueLabel(raw_val);
          if (!raw.has(label)) raw.set(label, { label, entries: [] });
          raw.get(label)!.entries.push({ modelId: model.id, expressId: el.expressId });
        }
      }
    });
  }

  let idx = 0;
  return Array.from(raw.values())
    .sort((a, b) => b.entries.length - a.entries.length)
    .map((g) => ({
      id: uuidv4(),
      label: g.label,
      color: PALETTE[idx++ % PALETTE.length],
      entries: g.entries,
      visible: true,
    }));
}

// ── component ─────────────────────────────────────────────────────────────────

export function ListPanel() {
  const models = useModelStore((s) => s.models);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const setColorGroups = useModelStore((s) => s.setColorGroups);

  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [localGroups, setLocalGroups] = useState<ColorGroup[]>([]);
  const colorInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Property mode state
  const [allProps, setAllProps] = useState<Map<string, Map<number, FlatElementProps>> | null>(null);
  const [availableKeys, setAvailableKeys] = useState<string[]>([]);
  const [propKey, setPropKey] = useState("");
  const [propKeySearch, setPropKeySearch] = useState("");
  const [propKeyOpen, setPropKeyOpen] = useState(false);
  const [propLoading, setPropLoading] = useState(false);
  const [propProgress, setPropProgress] = useState(0);

  // Reset property data when models change
  useEffect(() => {
    setAllProps(null);
    setAvailableKeys([]);
    setPropKey("");
  }, [models]);

  const builtGroups = useMemo(
    () => buildGroupsFromModels(groupBy, models, allProps, propKey),
    [groupBy, models, allProps, propKey],
  );

  // Sync local groups from built groups, preserving user-edited colors by label
  useEffect(() => {
    setLocalGroups((prev) => {
      const prevColors = new Map(prev.map((g) => [g.label, g.color]));
      return builtGroups.map((g) => ({ ...g, color: prevColors.get(g.label) ?? g.color }));
    });
  }, [builtGroups]);

  const isApplied = colorGroups !== null;
  const totalElements = localGroups.reduce((s, g) => s + g.entries.length, 0);
  const canBuild = groupBy !== "property" || (allProps !== null && propKey !== "");

  // ── batch property load ─────────────────────────────────────────────────────

  async function handleLoadProperties() {
    setPropLoading(true);
    setPropProgress(0);

    const result = new Map<string, Map<number, FlatElementProps>>();
    const keySet = new Set<string>();

    // Count total elements
    let total = 0;
    models.forEach((m) => {
      for (const els of Object.values(m.elementsByType)) total += els.length;
    });
    let baseOffset = 0;

    for (const [modelId, model] of models.entries()) {
      const ids: number[] = [];
      for (const els of Object.values(model.elementsByType)) {
        for (const el of els) ids.push(el.expressId);
      }

      const modelMap = await loadAllElementProperties(model.file, ids, (done) => {
        setPropProgress(Math.round(((baseOffset + done) / total) * 100));
      });

      baseOffset += ids.length;
      setPropProgress(Math.round((baseOffset / total) * 100));

      modelMap.forEach((props) => {
        Object.keys(props).forEach((k) => keySet.add(k));
      });
      result.set(modelId, modelMap);
    }

    // Sort keys: short (direct) first, then namespaced pset keys
    const sorted = Array.from(keySet).sort((a, b) => {
      const aHasDot = a.includes(".");
      const bHasDot = b.includes(".");
      if (aHasDot !== bHasDot) return aHasDot ? 1 : -1;
      return a.localeCompare(b);
    });

    setAllProps(result);
    setAvailableKeys(sorted);
    setPropKey((prev) => (sorted.includes(prev) ? prev : ""));
    setPropLoading(false);
  }

  // ── handlers ────────────────────────────────────────────────────────────────

  function handleApply() { setColorGroups(localGroups); }
  function handleReset() { setColorGroups(null); }

  function toggleVisible(id: string) {
    setLocalGroups((prev) => prev.map((g) => g.id === id ? { ...g, visible: !g.visible } : g));
  }

  function setColor(id: string, color: string) {
    setLocalGroups((prev) => prev.map((g) => g.id === id ? { ...g, color } : g));
  }

  function exportCSV() {
    const rows: string[][] = [["Gruppe", "Farbe", "Modell", "ExpressID"]];
    localGroups.forEach((group) => {
      group.entries.forEach(({ modelId, expressId }) => {
        const m = models.get(modelId);
        rows.push([group.label, group.color, m?.name ?? modelId, String(expressId)]);
      });
    });
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "listen-export.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const filteredKeys = propKeySearch
    ? availableKeys.filter((k) => k.toLowerCase().includes(propKeySearch.toLowerCase()))
    : availableKeys;

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs select-none">

      {/* ── Main toolbar ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 bg-card/60">
        <select
          className="flex-1 bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        >
          <option value="type">Nach Typ</option>
          <option value="storey">Nach Geschoss</option>
          <option value="model">Nach Modell</option>
          <option value="property">Nach Attribut / Property</option>
        </select>

        <button
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors shrink-0",
            isApplied
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted hover:bg-muted/80 text-foreground",
          )}
          title="Einfärbung anwenden"
          onClick={handleApply}
          disabled={localGroups.length === 0 || !canBuild}
        >
          <Play size={11} />
          <span>Einfärben</span>
        </button>

        {isApplied && (
          <button
            className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground transition-colors"
            title="Einfärbung zurücksetzen"
            onClick={handleReset}
          >
            <RotateCcw size={12} />
          </button>
        )}

        <button
          className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground transition-colors"
          title="Als CSV exportieren"
          onClick={exportCSV}
          disabled={localGroups.length === 0}
        >
          <Download size={12} />
        </button>
      </div>

      {/* ── Property mode controls ── */}
      {groupBy === "property" && (
        <div className="px-3 py-2 border-b border-border shrink-0 space-y-1.5 bg-card/30">
          {/* Load button / progress */}
          <div className="flex items-center gap-2">
            <button
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
                allProps
                  ? "bg-muted text-muted-foreground hover:bg-muted/80"
                  : "bg-muted text-foreground hover:bg-muted/80",
              )}
              onClick={handleLoadProperties}
              disabled={propLoading || models.size === 0}
            >
              <RefreshCw size={11} className={propLoading ? "animate-spin" : ""} />
              <span>{allProps ? "Neu laden" : "Properties laden"}</span>
            </button>

            {propLoading && (
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-150"
                    style={{ width: `${propProgress}%` }}
                  />
                </div>
                <span className="text-muted-foreground shrink-0">{propProgress}%</span>
              </div>
            )}

            {allProps && !propLoading && (
              <span className="text-muted-foreground text-[10px]">
                {availableKeys.length} Attribute verfügbar
              </span>
            )}
          </div>

          {/* Key selector */}
          {allProps && !propLoading && (
            <div className="relative">
              <button
                className="w-full flex items-center justify-between bg-background border border-border rounded px-2 py-1 text-left focus:outline-none hover:border-primary/50"
                onClick={() => setPropKeyOpen((v) => !v)}
              >
                <span className={cn("truncate", !propKey && "text-muted-foreground")}>
                  {propKey || "Attribut wählen…"}
                </span>
                <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
              </button>

              {propKeyOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPropKeyOpen(false)} />
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-md shadow-xl max-h-56 flex flex-col">
                    <div className="p-1.5 border-b border-border shrink-0 flex items-center gap-1.5">
                      <Search size={11} className="text-muted-foreground shrink-0" />
                      <input
                        autoFocus
                        className="flex-1 bg-transparent text-xs focus:outline-none text-foreground placeholder:text-muted-foreground"
                        placeholder="Suchen…"
                        value={propKeySearch}
                        onChange={(e) => setPropKeySearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {filteredKeys.length === 0 ? (
                        <div className="px-3 py-2 text-muted-foreground text-[11px]">Keine Treffer</div>
                      ) : (
                        filteredKeys.map((k) => (
                          <button
                            key={k}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-xs hover:bg-muted/60 truncate",
                              k === propKey && "text-primary font-medium",
                            )}
                            onClick={() => { setPropKey(k); setPropKeyOpen(false); setPropKeySearch(""); }}
                          >
                            {k}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Stats ── */}
      {localGroups.length > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border shrink-0">
          {localGroups.length} Gruppen · {totalElements.toLocaleString()} Elemente
          {isApplied && (
            <span className="ml-2 text-primary font-medium">● aktiv</span>
          )}
        </div>
      )}

      {/* ── Group list ── */}
      <div className="flex-1 overflow-y-auto">
        {groupBy === "property" && !allProps && !propLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px] px-6 text-center leading-relaxed">
            Properties laden, um Elemente nach IFC-Attributen zu gruppieren
          </div>
        ) : groupBy === "property" && allProps && !propKey ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px] px-6 text-center">
            Attribut auswählen, um Gruppen zu bilden
          </div>
        ) : localGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px] px-4 text-center">
            Kein Modell geladen
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {localGroups.map((group) => (
              <div
                key={group.id}
                className={cn("flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20", !group.visible && "opacity-60")}
              >
                {/* Color swatch */}
                <button
                  className="w-3.5 h-3.5 rounded-sm shrink-0 ring-1 ring-black/20 hover:ring-2 hover:ring-primary transition-all"
                  style={{ background: group.color }}
                  title="Farbe ändern"
                  onClick={() => colorInputRefs.current.get(group.id)?.click()}
                />
                <input
                  ref={(el) => {
                    if (el) colorInputRefs.current.set(group.id, el);
                    else colorInputRefs.current.delete(group.id);
                  }}
                  type="color"
                  className="sr-only"
                  value={group.color}
                  onChange={(e) => setColor(group.id, e.target.value)}
                />

                {/* Label */}
                <span className="flex-1 truncate text-[11px]" title={group.label}>
                  {group.label}
                </span>

                {/* Count */}
                <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                  {group.entries.length.toLocaleString()}
                </span>

                {/* Visibility */}
                <button
                  className={cn(
                    "shrink-0 p-0.5 rounded transition-colors",
                    group.visible
                      ? "text-muted-foreground/50 hover:text-foreground"
                      : "text-amber-400 hover:text-amber-300",
                  )}
                  title={group.visible ? "Gruppe ausblenden" : "Gruppe einblenden"}
                  onClick={() => toggleVisible(group.id)}
                >
                  {group.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
