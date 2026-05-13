import { useState, useMemo } from "react";
import {
  ChevronRight, ChevronDown, Eye, EyeOff,
  Trash2, Focus, Layers, LayoutList, Search, X,
  ScanEye, ScanLine,
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
  const hiddenElements = useModelStore((s) => s.hiddenElements);
  const isolatedElements = useModelStore((s) => s.isolatedElements);
  const hideElement = useModelStore((s) => s.hideElement);
  const hideElements = useModelStore((s) => s.hideElements);
  const showElement = useModelStore((s) => s.showElement);
  const showElements = useModelStore((s) => s.showElements);
  const isolateElement = useModelStore((s) => s.isolateElement);
  const isolateElements = useModelStore((s) => s.isolateElements);
  const showAll = useModelStore((s) => s.showAll);

  const [view, setView] = useState<View>("spatial");
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const arr = Array.from(models.values());

  const hasIsolation = isolatedElements !== null;
  const hasHidden = hiddenElements.size > 0;

  if (arr.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header view={view} onView={setView} search={search} onSearch={setSearch} />
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
      <Header view={view} onView={setView} search={search} onSearch={setSearch} />

      {/* Isolation / visibility bar */}
      {(hasIsolation || hasHidden) && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 bg-primary/10 border-b border-primary/20 text-[11px]">
          <ScanEye size={12} className="text-primary shrink-0" />
          <span className="flex-1 text-primary/80 truncate">
            {hasIsolation ? "Isolierung aktiv" : `${hiddenElements.size} ausgeblendet`}
          </span>
          <button
            className="text-primary/80 hover:text-primary font-medium"
            onClick={showAll}
          >
            Alles zeigen
          </button>
        </div>
      )}

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

              {isExpanded && (
                <div className="pl-3">
                  {view === "spatial"
                    ? <SpatialView
                        model={model} search={search}
                        selectedId={selectedElement?.modelId === model.id ? selectedElement?.expressId : undefined}
                        hiddenElements={hiddenElements}
                        isolatedElements={isolatedElements}
                        onSelect={(eid) => onSelectElement(model.id, eid)}
                        onHide={(eid) => {
                          const ids = model.spatialTree
                            ? collectSubtreeIds(model.spatialTree, eid)
                            : [eid];
                          hideElements(model.id, ids);
                        }}
                        onShow={(eid) => {
                          const ids = model.spatialTree
                            ? collectSubtreeIds(model.spatialTree, eid)
                            : [eid];
                          showElements(model.id, ids);
                        }}
                        onIsolate={(eid) => {
                          const ids = model.spatialTree
                            ? collectSubtreeIds(model.spatialTree, eid)
                            : [eid];
                          isolateElements(model.id, ids);
                        }}
                        onShowAll={showAll}
                      />
                    : <TypeView
                        model={model} search={search}
                        selectedId={selectedElement?.modelId === model.id ? selectedElement?.expressId : undefined}
                        hiddenElements={hiddenElements}
                        isolatedElements={isolatedElements}
                        onSelect={(eid) => onSelectElement(model.id, eid)}
                        onHide={(eid) => hideElement(model.id, eid)}
                        onShow={(eid) => showElement(model.id, eid)}
                        onIsolate={(eid) => isolateElement(model.id, eid)}
                        onShowAll={showAll}
                      />
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

interface VisibilityProps {
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
  onHide: (eid: number) => void;
  onShow: (eid: number) => void;
  onIsolate: (eid: number) => void;
  onShowAll: () => void;
}

function SpatialView({ model, search, selectedId, onSelect, ...vp }: {
  model: IFCModelEntry; search: string; selectedId?: number;
  onSelect: (eid: number) => void;
} & VisibilityProps) {
  if (!model.spatialTree) {
    return <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Raumstruktur verfügbar</p>;
  }

  const filtered = search
    ? filterSpatialNode(model.spatialTree, search.toLowerCase())
    : model.spatialTree;

  if (!filtered) {
    return <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Treffer für „{search}"</p>;
  }

  return (
    <SpatialTreeNode
      node={filtered} depth={0} modelId={model.id}
      selectedId={selectedId} onSelect={onSelect} forceOpen={!!search}
      {...vp}
    />
  );
}

function filterSpatialNode(node: SpatialNode, q: string): SpatialNode | null {
  const matches = node.name.toLowerCase().includes(q) || node.type.toLowerCase().includes(q);
  const filteredChildren = node.children
    .map((c) => filterSpatialNode(c, q))
    .filter((c): c is SpatialNode => c !== null);

  if (!matches && filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

function SpatialTreeNode({ node, depth, modelId, selectedId, onSelect, forceOpen, hiddenElements, isolatedElements, onHide, onShow, onIsolate, onShowAll }: {
  node: SpatialNode; depth: number; modelId: string; selectedId?: number;
  onSelect: (eid: number) => void; forceOpen?: boolean;
} & VisibilityProps) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.expressId;
  const key = `${modelId}:${node.expressId}`;
  const isHidden = hiddenElements.has(key);
  const isActivelyIsolated = isolatedElements !== null && isolatedElements.has(key);
  const isDimmedByIsolation = isolatedElements !== null && !isolatedElements.has(key);
  const isDimmed = isHidden || isDimmedByIsolation;

  const isOpen = forceOpen || open;

  const isSpatialContainer = [
    "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY",
    "IFCSPACE", "IFCBRIDGEPART", "IFCFACILITYPART",
  ].includes(node.type);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-[3px] pr-2 cursor-pointer rounded-sm group",
          "hover:bg-muted/40 hierarchy-item",
          isSelected && "selected bg-primary/10 border-l-2 border-l-primary",
          isDimmed && "opacity-40"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => {
          if (hasChildren && !forceOpen) setOpen((o) => !o);
          onSelect(node.expressId);
        }}
      >
        <span className="shrink-0 text-muted-foreground w-3.5">
          {hasChildren
            ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
            : null}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-muted-foreground/60 w-5 text-center">
          {typeIcon(node.type)}
        </span>
        <span className={cn(
          "flex-1 truncate",
          isSpatialContainer ? "text-foreground font-medium" : "text-foreground/80"
        )}>
          {node.name}
        </span>
        {hasChildren && (
          <span className="text-[9px] text-muted-foreground/50 shrink-0 mr-1">
            {countLeaves(node)}
          </span>
        )}
        {/* Visibility actions - always visible */}
        <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            className={cn("toolbar-button p-0.5", isActivelyIsolated ? "text-primary" : "text-muted-foreground/40 hover:text-foreground")}
            title={isActivelyIsolated ? "Isolierung aufheben" : "Isolieren"}
            onClick={() => isActivelyIsolated ? onShowAll() : onIsolate(node.expressId)}
          >
            <ScanLine size={10} />
          </button>
          <button
            className={cn("toolbar-button p-0.5", isHidden ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/40 hover:text-foreground")}
            title={isHidden ? "Einblenden" : "Ausblenden"}
            onClick={() => isHidden ? onShow(node.expressId) : onHide(node.expressId)}
          >
            {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
        </div>
      </div>

      {isOpen && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SpatialTreeNode
              key={child.expressId}
              node={child} depth={depth + 1} modelId={modelId}
              selectedId={selectedId} onSelect={onSelect}
              forceOpen={forceOpen}
              hiddenElements={hiddenElements} isolatedElements={isolatedElements}
              onHide={onHide} onShow={onShow} onIsolate={onIsolate} onShowAll={onShowAll}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── By-Type View ──────────────────────────────────────────────────────────────

function TypeView({ model, search, selectedId, onSelect, ...vp }: {
  model: IFCModelEntry; search: string; selectedId?: number;
  onSelect: (eid: number) => void;
} & VisibilityProps) {
  const groups = useMemo(() => {
    const raw = Object.entries(model.elementsByType);
    if (!search) return raw;
    const q = search.toLowerCase();
    return raw
      .map(([type, els]): [string, ElementNode[]] => [
        type,
        els.filter((el) => el.name.toLowerCase().includes(q) || type.toLowerCase().includes(q)),
      ])
      .filter(([, els]) => els.length > 0);
  }, [model.elementsByType, search]);

  if (groups.length === 0) {
    return search
      ? <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Treffer für „{search}"</p>
      : <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Elemente gefunden</p>;
  }

  return (
    <div>
      {groups.sort(([a], [b]) => a.localeCompare(b)).map(([typeName, elements]) => (
        <TypeGroup
          key={typeName} typeName={typeName} elements={elements}
          modelId={model.id} selectedId={selectedId}
          onSelect={onSelect} forceOpen={!!search} {...vp}
        />
      ))}
    </div>
  );
}

function TypeGroup({ typeName, elements, modelId, selectedId, onSelect, forceOpen, hiddenElements, isolatedElements, onHide, onShow, onIsolate, onShowAll }: {
  typeName: string; elements: ElementNode[]; modelId: string; selectedId?: number;
  onSelect: (eid: number) => void; forceOpen?: boolean;
} & VisibilityProps) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer hover:bg-muted/40 select-none"
        onClick={() => !forceOpen && setOpen((o) => !o)}
      >
        <span className="text-muted-foreground shrink-0">
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="flex-1 text-foreground font-medium">{typeName}</span>
        <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 rounded shrink-0">
          {elements.length}
        </span>
      </div>

      {isOpen && (
        <div>
          {elements.map((el) => {
            const isSelected = selectedId === el.expressId;
            const key = `${modelId}:${el.expressId}`;
            const isHidden = hiddenElements.has(key);
            const isActivelyIsolated = isolatedElements !== null && isolatedElements.has(key);
            const isDimmedByIsolation = isolatedElements !== null && !isolatedElements.has(key);
            return (
              <div
                key={el.expressId}
                className={cn(
                  "flex items-center gap-1.5 pl-7 pr-2 py-[3px] cursor-pointer group",
                  "hover:bg-muted/40 hierarchy-item",
                  isSelected && "selected bg-primary/10 border-l-2 border-l-primary",
                  (isHidden || isDimmedByIsolation) && "opacity-40"
                )}
                onClick={() => onSelect(el.expressId)}
              >
                <span className="flex-1 truncate text-foreground/80" title={el.name}>
                  {el.name}
                </span>
                <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">
                  #{el.expressId}
                </span>
                <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={cn("toolbar-button p-0.5", isActivelyIsolated ? "text-primary" : "text-muted-foreground/40 hover:text-foreground")}
                    title={isActivelyIsolated ? "Isolierung aufheben" : "Isolieren"}
                    onClick={() => isActivelyIsolated ? onShowAll() : onIsolate(el.expressId)}
                  >
                    <ScanLine size={10} />
                  </button>
                  <button
                    className={cn("toolbar-button p-0.5", isHidden ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/40 hover:text-foreground")}
                    title={isHidden ? "Einblenden" : "Ausblenden"}
                    onClick={() => isHidden ? onShow(el.expressId) : onHide(el.expressId)}
                  >
                    {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ view, onView, search, onSearch }: {
  view: View; onView: (v: View) => void;
  search: string; onSearch: (s: string) => void;
}) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Layers size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground flex-1">Projektstruktur</span>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border/60">
        <div className="flex items-center gap-1.5 bg-muted/40 rounded px-2 py-1">
          <Search size={11} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Suchen…"
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40 text-foreground"
          />
          {search && (
            <button className="text-muted-foreground hover:text-foreground" onClick={() => onSearch("")}>
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex border-b border-border bg-[var(--tabs-bg)]">
        {([
          { id: "spatial" as View, label: "Räumlich",  icon: <Layers size={11} /> },
          { id: "type"    as View, label: "Nach Typ",  icon: <LayoutList size={11} /> },
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
    IFCSITE: "⬡", IFCBUILDING: "⬜", IFCBUILDINGSTOREY: "▬",
    IFCSPACE: "□", IFCBRIDGEPART: "⌒", IFCFACILITYPART: "◈",
  };
  return icons[type] ?? "·";
}

function countLeaves(node: SpatialNode): number {
  if (node.children.length === 0) return 0;
  return node.children.reduce((sum, c) => sum + Math.max(1, countLeaves(c)), 0);
}

function collectSubtreeIds(root: SpatialNode, targetExpressId: number): number[] {
  function findNode(node: SpatialNode): SpatialNode | null {
    if (node.expressId === targetExpressId) return node;
    for (const child of node.children) {
      const found = findNode(child);
      if (found) return found;
    }
    return null;
  }

  function collectAll(node: SpatialNode, out: number[]) {
    out.push(node.expressId);
    for (const child of node.children) collectAll(child, out);
  }

  const target = findNode(root);
  if (!target) return [targetExpressId];
  const ids: number[] = [];
  collectAll(target, ids);
  return ids;
}
