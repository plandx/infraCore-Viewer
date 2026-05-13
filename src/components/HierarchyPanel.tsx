import { useState } from "react";
import {
  ChevronRight, ChevronDown, Eye, EyeOff,
  Trash2, Focus, Layers, LayoutList,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { formatBytes } from "../utils/coordinateUtils";
import type { IFCModelEntry, SpatialNode, ElementNode } from "../types/ifc";

type View = "spatial" | "type";

interface Props {
  onFitTo: (id: string) => void;
  onRemove: (id: string) => void;
  onSelectElement: (modelId: string, expressId: number) => void;
}

export function HierarchyPanel({ onFitTo, onRemove, onSelectElement }: Props) {
  const models = useModelStore((s) => s.models);
  const updateModel = useModelStore((s) => s.updateModel);
  const selectedElement = useModelStore((s) => s.selectedElement);
  const [view, setView] = useState<View>("spatial");
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  const arr = Array.from(models.values());

  if (arr.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header view={view} onView={setView} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
          <div className="w-14 h-14 rounded-xl border-2 border-dashed border-border flex items-center justify-center">
            <Layers size={22} className="opacity-30" />
          </div>
          <div>
            <p className="text-sm font-medium">Keine Modelle geladen</p>
            <p className="text-xs mt-1 opacity-60">Öffne eine IFC-Datei über die Toolbar</p>
          </div>
        </div>
      </div>
    );
  }

  const toggleModelExpand = (id: string) =>
    setExpandedModels((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col h-full">
      <Header view={view} onView={setView} />

      <div className="flex-1 overflow-y-auto scrollbar-thin text-[12px]">
        {arr.map((model) => {
          const isExpanded = expandedModels.has(model.id);
          return (
            <div key={model.id} className="border-b border-border/40">
              {/* Model row */}
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none",
                  "hover:bg-muted/40 group"
                )}
                onClick={() => toggleModelExpand(model.id)}
              >
                <span className="text-muted-foreground shrink-0">
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20"
                  style={{ backgroundColor: model.color }}
                />
                <span className="flex-1 truncate font-semibold text-foreground" title={model.name}>
                  {model.name}
                </span>
                <span className="text-muted-foreground/60 text-[10px] shrink-0">
                  {formatBytes(model.size)}
                </span>

                {/* Hover actions */}
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => e.stopPropagation()}>
                  <button className="toolbar-button p-0.5" title="Zu Modell zoomen"
                    onClick={() => onFitTo(model.id)}>
                    <Focus size={11} />
                  </button>
                  <button className="toolbar-button p-0.5" title={model.visible ? "Ausblenden" : "Einblenden"}
                    onClick={() => updateModel(model.id, { visible: !model.visible })}>
                    {model.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                  <button className="toolbar-button p-0.5 hover:text-destructive" title="Entfernen"
                    onClick={() => onRemove(model.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Model content */}
              {isExpanded && (
                <div className="pl-3">
                  {view === "spatial"
                    ? <SpatialView model={model} selectedId={selectedElement?.expressId} onSelect={(eid) => onSelectElement(model.id, eid)} />
                    : <TypeView model={model} selectedId={selectedElement?.expressId} onSelect={(eid) => onSelectElement(model.id, eid)} />
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Spatial Tree View ─────────────────────────────────────────────────────────

function SpatialView({ model, selectedId, onSelect }: {
  model: IFCModelEntry;
  selectedId?: number;
  onSelect: (eid: number) => void;
}) {
  if (!model.spatialTree) {
    return <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Raumstruktur verfügbar</p>;
  }
  return (
    <SpatialTreeNode node={model.spatialTree} depth={0} selectedId={selectedId} onSelect={onSelect} />
  );
}

function SpatialTreeNode({ node, depth, selectedId, onSelect }: {
  node: SpatialNode;
  depth: number;
  selectedId?: number;
  onSelect: (eid: number) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.expressId;

  const isSpatialContainer = [
    "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY",
    "IFCSPACE", "IFCBRIDGEPART", "IFCFACILITYPART",
  ].includes(node.type);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-[3px] pr-2 cursor-pointer rounded-sm",
          "hover:bg-muted/40 hierarchy-item",
          isSelected && "selected bg-primary/10 border-l-2 border-l-primary"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o);
          onSelect(node.expressId);
        }}
      >
        {/* Expand icon */}
        <span className="shrink-0 text-muted-foreground w-3.5">
          {hasChildren
            ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
            : null}
        </span>

        {/* Type icon */}
        <span className="shrink-0 text-[10px] font-mono text-muted-foreground/60 w-5 text-center">
          {typeIcon(node.type)}
        </span>

        <span className={cn(
          "flex-1 truncate",
          isSpatialContainer ? "text-foreground font-medium" : "text-foreground/80"
        )}>
          {node.name}
        </span>

        {/* Element count badge */}
        {hasChildren && (
          <span className="text-[9px] text-muted-foreground/50 shrink-0">
            {countLeaves(node)}
          </span>
        )}
      </div>

      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SpatialTreeNode
              key={child.expressId}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── By-Type View ──────────────────────────────────────────────────────────────

function TypeView({ model, selectedId, onSelect }: {
  model: IFCModelEntry;
  selectedId?: number;
  onSelect: (eid: number) => void;
}) {
  const groups = Object.entries(model.elementsByType).sort(([a], [b]) => a.localeCompare(b));
  if (groups.length === 0) {
    return <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Elemente gefunden</p>;
  }
  return (
    <div>
      {groups.map(([typeName, elements]) => (
        <TypeGroup
          key={typeName}
          typeName={typeName}
          elements={elements}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TypeGroup({ typeName, elements, selectedId, onSelect }: {
  typeName: string;
  elements: ElementNode[];
  selectedId?: number;
  onSelect: (eid: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer hover:bg-muted/40 select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-muted-foreground shrink-0">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="flex-1 text-foreground font-medium">{typeName}</span>
        <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 rounded shrink-0">
          {elements.length}
        </span>
      </div>

      {open && (
        <div>
          {elements.map((el) => {
            const isSelected = selectedId === el.expressId;
            return (
              <div
                key={el.expressId}
                className={cn(
                  "flex items-center gap-1.5 pl-7 pr-2 py-[3px] cursor-pointer",
                  "hover:bg-muted/40 hierarchy-item",
                  isSelected && "selected bg-primary/10 border-l-2 border-l-primary"
                )}
                onClick={() => onSelect(el.expressId)}
              >
                <span className="flex-1 truncate text-foreground/80" title={el.name}>
                  {el.name}
                </span>
                <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">
                  #{el.expressId}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Layers size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground flex-1">Projektstruktur</span>
      </div>
      <div className="flex border-b border-border bg-[var(--tabs-bg)]">
        {([
          { id: "spatial" as View, label: "Räumlich",   icon: <Layers size={11} /> },
          { id: "type"    as View, label: "Nach Typ",   icon: <LayoutList size={11} /> },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => onView(t.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium transition-colors",
              "border-t-2",
              view === t.id
                ? "border-t-primary bg-[var(--tab-active-bg)] text-[var(--tab-active-text)]"
                : "border-t-transparent text-[var(--tab-text)] hover:text-foreground"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    IFCSITE: "⬡",
    IFCBUILDING: "⬜",
    IFCBUILDINGSTOREY: "▬",
    IFCSPACE: "□",
    IFCBRIDGEPART: "⌒",
    IFCFACILITYPART: "◈",
  };
  return icons[type] ?? "·";
}

function countLeaves(node: SpatialNode): number {
  if (node.children.length === 0) return 0;
  return node.children.reduce((sum, c) => sum + Math.max(1, countLeaves(c)), 0);
}
