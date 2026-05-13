import { useState, useMemo, useEffect, useRef } from "react";
import { Download, Eye, EyeOff, Play, RotateCcw } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import type { ColorGroup, IFCModelEntry, SpatialNode } from "../types/ifc";

type GroupBy = "type" | "storey" | "model";

const PALETTE = [
  "#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7",
  "#73daca", "#ff9e64", "#2ac3de", "#b4f9f8", "#cfc9c2",
  "#1abc9c", "#e056fd", "#fd9644", "#45aaf2", "#a55eea",
];

function stripIfc(name: string) {
  return name.startsWith("IFC") ? name.slice(3) : name;
}

function collectAllElements(
  node: SpatialNode,
  modelId: string,
  out: { modelId: string; expressId: number }[],
) {
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
  if (node.type === "IFCBUILDINGSTOREY" || node.type === "IFCSPACE") {
    const label = node.name || `${stripIfc(node.type)} ${node.expressId}`;
    if (!groups.has(label)) groups.set(label, { label, entries: [] });
    collectAllElements(node, modelId, groups.get(label)!.entries);
  } else {
    for (const child of node.children) collectStoreys(child, modelId, groups);
  }
}

function buildGroups(groupBy: GroupBy, models: Map<string, IFCModelEntry>): ColorGroup[] {
  const raw = new Map<string, { label: string; entries: { modelId: string; expressId: number }[] }>();

  if (groupBy === "type") {
    models.forEach((model) => {
      for (const [typeName, elements] of Object.entries(model.elementsByType)) {
        if (!raw.has(typeName)) raw.set(typeName, { label: stripIfc(typeName), entries: [] });
        for (const el of elements) raw.get(typeName)!.entries.push({ modelId: model.id, expressId: el.expressId });
      }
    });
  } else if (groupBy === "storey") {
    models.forEach((model) => {
      if (model.spatialTree) collectStoreys(model.spatialTree, model.id, raw);
    });
    // Fallback: elements not captured in any storey → group under model name
    models.forEach((model) => {
      const captured = new Set<number>();
      raw.forEach((g) => g.entries.forEach((e) => { if (e.modelId === model.id) captured.add(e.expressId); }));
      const uncaptured: { modelId: string; expressId: number }[] = [];
      for (const elements of Object.values(model.elementsByType)) {
        for (const el of elements) {
          if (!captured.has(el.expressId)) uncaptured.push({ modelId: model.id, expressId: el.expressId });
        }
      }
      if (uncaptured.length > 0) {
        const key = `__rest_${model.id}`;
        raw.set(key, { label: `${model.name} (ohne Geschoss)`, entries: uncaptured });
      }
    });
  } else {
    models.forEach((model) => {
      const entries: { modelId: string; expressId: number }[] = [];
      for (const elements of Object.values(model.elementsByType)) {
        for (const el of elements) entries.push({ modelId: model.id, expressId: el.expressId });
      }
      if (entries.length > 0) raw.set(model.id, { label: model.name, entries });
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

export function ListPanel() {
  const models = useModelStore((s) => s.models);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const setColorGroups = useModelStore((s) => s.setColorGroups);

  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [localGroups, setLocalGroups] = useState<ColorGroup[]>([]);
  const colorInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const builtGroups = useMemo(() => buildGroups(groupBy, models), [groupBy, models]);

  // Sync local groups when built groups change, preserving user-set colors
  useEffect(() => {
    setLocalGroups((prev) => {
      const prevColors = new Map(prev.map((g) => [g.label, g.color]));
      return builtGroups.map((g) => ({
        ...g,
        color: prevColors.get(g.label) ?? g.color,
      }));
    });
  }, [builtGroups]);

  const isApplied = colorGroups !== null;
  const totalElements = localGroups.reduce((s, g) => s + g.entries.length, 0);

  function handleApply() {
    setColorGroups(localGroups);
  }

  function handleReset() {
    setColorGroups(null);
  }

  function toggleVisible(id: string) {
    setLocalGroups((prev) => prev.map((g) => g.id === id ? { ...g, visible: !g.visible } : g));
  }

  function setColor(id: string, color: string) {
    setLocalGroups((prev) => prev.map((g) => g.id === id ? { ...g, color } : g));
  }

  function exportCSV() {
    const rows: string[][] = [["Gruppe", "Modell", "ExpressID"]];
    localGroups.forEach((group) => {
      const model = models;
      group.entries.forEach(({ modelId, expressId }) => {
        const m = model.get(modelId);
        rows.push([group.label, m?.name ?? modelId, String(expressId)]);
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

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 bg-card/60">
        <select
          className="flex-1 bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        >
          <option value="type">Nach Typ</option>
          <option value="storey">Nach Geschoss</option>
          <option value="model">Nach Modell</option>
        </select>

        <button
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors",
            isApplied
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted hover:bg-muted/80 text-foreground",
          )}
          title={isApplied ? "Einfärbung aktualisieren" : "Einfärbung anwenden"}
          onClick={handleApply}
          disabled={localGroups.length === 0}
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

      {/* Stats */}
      {localGroups.length > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border shrink-0">
          {localGroups.length} Gruppen · {totalElements.toLocaleString()} Elemente
        </div>
      )}

      {/* Group list */}
      <div className="flex-1 overflow-y-auto">
        {localGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-[11px] px-4 text-center">
            Kein Modell geladen
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {localGroups.map((group) => (
              <div key={group.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30">
                {/* Color swatch — click to open color picker */}
                <button
                  className="w-4 h-4 rounded-sm shrink-0 ring-1 ring-black/20 hover:ring-2 hover:ring-primary transition-all"
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
                <span className={cn("flex-1 truncate", !group.visible && "text-muted-foreground/50")}>
                  {group.label}
                </span>

                {/* Count */}
                <span className="text-muted-foreground/60 shrink-0">
                  {group.entries.length.toLocaleString()}
                </span>

                {/* Visibility toggle */}
                <button
                  className={cn(
                    "shrink-0 p-0.5 rounded transition-colors",
                    group.visible ? "text-muted-foreground/60 hover:text-foreground" : "text-amber-400 hover:text-amber-300",
                  )}
                  title={group.visible ? "Gruppe ausblenden" : "Gruppe einblenden"}
                  onClick={() => toggleVisible(group.id)}
                >
                  {group.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
