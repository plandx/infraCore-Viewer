import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ChevronRight, ChevronDown, Eye, EyeOff,
  Trash2, Focus, Layers, LayoutList, Search, X,
  ScanEye, ScanLine, RefreshCw,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { formatBytes } from "../utils/coordinateUtils";
import type { IFCModelEntry, SpatialNode, ElementNode } from "../types/ifc";

type View = "spatial" | "type" | "visible";

interface VisibleEntry {
  modelId: string; modelName: string; modelColor: string;
  expressId: number; name: string; typeName: string;
}

interface Props {
  onFitTo: (id: string) => void;
  onRemove: (id: string) => void;
  onSelectElement: (modelId: string, expressId: number) => void;
  onHideOverride?: (modelId: string, expressId: number) => void;
  onShowAllOverride?: () => void;
  onIsolateOverride?: (modelId: string, expressId: number) => void;
}

export function HierarchyPanel({ onFitTo, onRemove, onSelectElement, onHideOverride, onShowAllOverride, onIsolateOverride }: Props) {
  const models = useModelStore((s) => s.models);
  const updateModel = useModelStore((s) => s.updateModel);
  const selectedElement = useModelStore((s) => s.selectedElement);
  const hiddenElements = useModelStore((s) => s.hiddenElements);
  const isolatedElements = useModelStore((s) => s.isolatedElements);
  const hideElement_ = useModelStore((s) => s.hideElement);
  const hideElements_ = useModelStore((s) => s.hideElements);
  const showElement = useModelStore((s) => s.showElement);
  const showElements = useModelStore((s) => s.showElements);
  const isolateElement_ = useModelStore((s) => s.isolateElement);
  const isolateElements_ = useModelStore((s) => s.isolateElements);
  const showAll_ = useModelStore((s) => s.showAll);
  const setBasket = useModelStore((s) => s.setBasket);
  const selectionBasket = useModelStore((s) => s.selectionBasket);

  const hideElement = onHideOverride ?? hideElement_;
  const isolateElement = onIsolateOverride ?? isolateElement_;
  const showAll = onShowAllOverride ?? showAll_;
  const hideElements = onHideOverride
    ? (modelId: string, eids: number[]) => eids.forEach((eid) => onHideOverride(modelId, eid))
    : hideElements_;
  const isolateElements = onIsolateOverride
    ? (modelId: string, eids: number[]) => eids.forEach((eid) => onIsolateOverride(modelId, eid))
    : isolateElements_;

  const [view, setView] = useState<View>("spatial");
  const [visibleSnapshot, setVisibleSnapshot] = useState<VisibleEntry[] | null>(null);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((val: string) => {
    setInputValue(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (val === "") {
      setSearch("");
    } else {
      searchDebounceRef.current = setTimeout(() => setSearch(val), 150);
    }
  }, []);

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  // Multi-selection
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  // Lifted expand state — spatial tree and type groups, needed for range-select flat list
  const [expandedSpatial, setExpandedSpatial] = useState<Set<string>>(new Set());
  const [expandedTypeGroups, setExpandedTypeGroups] = useState<Set<string>>(new Set());

  // Scroll container ref for auto-scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Guard: track key we triggered ourselves so the selectedElement effect doesn't clear it
  const lastPanelClickRef = useRef<string | null>(null);

  const arr = useMemo(() => Array.from(models.values()), [models]);

  // Auto-expand depth 0–1 for newly loaded models
  useEffect(() => {
    setExpandedSpatial((prev) => {
      const next = new Set(prev);
      arr.forEach((model) => {
        if (model.spatialTree) collectDefaultExpanded(model.spatialTree, model.id, 0, next);
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arr.map((m) => m.id).join(",")]);

  // ── React to external selection (viewport click, SQL panel, etc.) ───────────
  useEffect(() => {
    if (!selectedElement) return;
    const key = `${selectedElement.modelId}:${selectedElement.expressId}`;

    if (lastPanelClickRef.current === key) {
      // We triggered this ourselves — only scroll, don't clear multi-select
      lastPanelClickRef.current = null;
    } else {
      // External change → clear multi-selection so the store selection shows
      setMultiSelected(new Set());
      setAnchorKey(null);
    }

    // Auto-expand model
    setExpandedModels((prev) => {
      if (prev.has(selectedElement.modelId)) return prev;
      return new Set([...prev, selectedElement.modelId]);
    });

    const model = models.get(selectedElement.modelId);

    // Auto-expand spatial ancestors
    if (model?.spatialTree) {
      const path = findPathToNode(model.spatialTree, selectedElement.expressId);
      if (path.length > 1) {
        setExpandedSpatial((prev) => {
          const next = new Set(prev);
          // Expand all ancestors (all nodes on path except the leaf itself)
          path.slice(0, -1).forEach((eid) => next.add(`${selectedElement.modelId}:${eid}`));
          return next;
        });
      }
    }

    // Auto-expand the type group
    if (model) {
      for (const [typeName, elements] of Object.entries(model.elementsByType)) {
        if (elements.some((el) => el.expressId === selectedElement.expressId)) {
          setExpandedTypeGroups((prev) => {
            const gk = `${selectedElement.modelId}:${typeName}`;
            if (prev.has(gk)) return prev;
            return new Set([...prev, gk]);
          });
          break;
        }
      }
    }

    // Scroll into view after expansion settles
    setTimeout(() => {
      scrollContainerRef.current
        ?.querySelector(`[data-mid="${selectedElement.modelId}"][data-eid="${selectedElement.expressId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement?.modelId, selectedElement?.expressId]);

  // activeKey: store's single selection, used when multiSelected is empty
  const activeKey = multiSelected.size === 0 && selectedElement
    ? `${selectedElement.modelId}:${selectedElement.expressId}`
    : null;

  const hasIsolation = isolatedElements !== null;
  const hasHidden = hiddenElements.size > 0;

  // Flat ordered list of visible items (for range selection)
  const flatVisibleKeys = useMemo(() => {
    const list: string[] = [];
    arr.forEach((model) => {
      if (!expandedModels.has(model.id)) return;
      if (view === "spatial" && model.spatialTree) {
        const filtered = search
          ? filterSpatialNode(model.spatialTree, search.toLowerCase())
          : model.spatialTree;
        if (filtered) flattenSpatialVisible(filtered, model.id, expandedSpatial, !!search, list);
      } else if (view === "type") {
        const raw = Object.entries(model.elementsByType);
        const q = search.toLowerCase();
        const groups = search
          ? raw.map(([t, els]): [string, ElementNode[]] => [
              t, els.filter((el) => el.name.toLowerCase().includes(q) || t.toLowerCase().includes(q)),
            ]).filter(([, els]) => els.length > 0)
          : raw;
        groups.sort(([a], [b]) => a.localeCompare(b)).forEach(([, elements]) => {
          elements.forEach((el) => list.push(`${model.id}:${el.expressId}`));
        });
      }
    });
    return list;
  }, [arr, view, expandedModels, expandedSpatial, search]);

  // Click handler with Shift-support
  // childKeys: all leaf element keys beneath a parent node — triggers group selection
  const handleItemClick = useCallback((modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => {
    const key = `${modelId}:${expressId}`;

    // Clicking a parent node: select all children
    if (childKeys && childKeys.length > 0 && !e.shiftKey) {
      setMultiSelected(new Set(childKeys));
      setAnchorKey(childKeys[0]);
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      if (anchorKey && anchorKey !== key && flatVisibleKeys.length > 0) {
        const aIdx = flatVisibleKeys.indexOf(anchorKey);
        const bIdx = flatVisibleKeys.indexOf(key);
        if (aIdx !== -1 && bIdx !== -1) {
          const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
          setMultiSelected(new Set(flatVisibleKeys.slice(lo, hi + 1)));
          return;
        }
      }
      setMultiSelected((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
      if (!anchorKey) setAnchorKey(key);
    } else {
      // Mark as our own click before calling onSelectElement
      lastPanelClickRef.current = key;
      setMultiSelected(new Set([key]));
      setAnchorKey(key);
      onSelectElement(modelId, expressId);
    }
  }, [anchorKey, flatVisibleKeys, onSelectElement]);

  // Multi-selection actions
  const parseKeys = (keys: Set<string>) =>
    Array.from(keys).map((k) => {
      const sep = k.indexOf(":");
      return { modelId: k.slice(0, sep), expressId: parseInt(k.slice(sep + 1)) };
    });

  const handleMultiHide = () => {
    const byModel = new Map<string, number[]>();
    parseKeys(multiSelected).forEach(({ modelId, expressId }) => {
      if (!byModel.has(modelId)) byModel.set(modelId, []);
      byModel.get(modelId)!.push(expressId);
    });
    byModel.forEach((ids, modelId) => hideElements(modelId, ids));
    setMultiSelected(new Set());
  };

  const handleMultiIsolate = () => {
    const byModel = new Map<string, number[]>();
    parseKeys(multiSelected).forEach(({ modelId, expressId }) => {
      if (!byModel.has(modelId)) byModel.set(modelId, []);
      byModel.get(modelId)!.push(expressId);
    });
    byModel.forEach((ids, modelId) => isolateElements(modelId, ids));
    setMultiSelected(new Set());
  };

  const handleAddToBasket = () => {
    const next = new Set(selectionBasket);
    multiSelected.forEach((k) => next.add(k));
    setBasket(next);
  };

  const handleSetBasket = () => {
    setBasket(new Set(multiSelected));
  };

  const captureVisibleSnapshot = useCallback(() => {
    const { hiddenElements: he, isolatedElements: ie, models: ms } = useModelStore.getState();
    const entries: VisibleEntry[] = [];
    ms.forEach((model) => {
      if (!model.visible) return;
      for (const [typeName, elements] of Object.entries(model.elementsByType)) {
        for (const el of elements) {
          const key = `${model.id}:${el.expressId}`;
          if (he.has(key)) continue;
          if (ie !== null && !ie.has(key)) continue;
          entries.push({ modelId: model.id, modelName: model.name, modelColor: model.color, expressId: el.expressId, name: el.name, typeName });
        }
      }
    });
    entries.sort((a, b) => a.modelName.localeCompare(b.modelName) || a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
    setVisibleSnapshot(entries);
  }, []);

  const handleSetView = useCallback((v: View) => {
    setView(v);
    if (v === "visible") captureVisibleSnapshot();
  }, [captureVisibleSnapshot]);

  const toggleModelExpand = (id: string) =>
    setExpandedModels((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSpatialNode = (key: string) =>
    setExpandedSpatial((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleTypeGroup = (key: string) =>
    setExpandedTypeGroups((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  if (arr.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header view={view} onView={handleSetView} search={inputValue} onSearch={handleSearch} />
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

  return (
    <div className="flex flex-col h-full">
      <Header view={view} onView={setView} search={inputValue} onSearch={handleSearch} />

      {(hasIsolation || hasHidden) && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 bg-primary/10 border-b border-primary/20 text-[11px]">
          <ScanEye size={12} className="text-primary shrink-0" />
          <span className="flex-1 text-primary/80 truncate">
            {hasIsolation ? "Isolierung aktiv" : `${hiddenElements.size} ausgeblendet`}
          </span>
          <button className="text-primary/80 hover:text-primary font-medium" onClick={showAll}>Alles zeigen</button>
        </div>
      )}

      {multiSelected.size > 1 && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 bg-amber-500/10 border-b border-amber-500/20 text-[11px]">
          <span className="text-amber-400 font-medium flex-1">{multiSelected.size} ausgewählt</span>
          <button className="px-1.5 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Alle ausblenden" onClick={handleMultiHide}><EyeOff size={11} /></button>
          <button className="px-1.5 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Alle isolieren" onClick={handleMultiIsolate}><ScanLine size={11} /></button>
          <button className="px-1.5 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground text-[10px] font-mono" title="Zur Auswahl hinzufügen" onClick={handleAddToBasket}>+Korb</button>
          <button className="px-1.5 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground text-[10px] font-mono" title="Auswahlkorb ersetzen" onClick={handleSetBasket}>=Korb</button>
          <button className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Auswahl aufheben" onClick={() => { setMultiSelected(new Set()); setAnchorKey(null); }}><X size={11} /></button>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin text-[12px]">
        {view === "visible" && (
          <VisibleView
            snapshot={visibleSnapshot}
            onRefresh={captureVisibleSnapshot}
            activeKey={activeKey}
            multiSelected={multiSelected}
            onItemClick={handleItemClick}
          />
        )}
        {view !== "visible" && arr.map((model) => {
          const isExpanded = expandedModels.has(model.id);
          return (
            <div key={model.id} className="border-b border-border/40">
              <div
                className={cn("flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none", "hover:bg-muted/40 group")}
                onClick={() => toggleModelExpand(model.id)}
              >
                <span className="text-muted-foreground shrink-0">
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20" style={{ backgroundColor: model.color }} />
                <span className="flex-1 truncate font-semibold text-foreground" title={model.name}>{model.name}</span>
                <span className="text-muted-foreground/60 text-[10px] shrink-0">{formatBytes(model.size)}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button className="toolbar-button p-0.5" title="Zu Modell zoomen" onClick={() => onFitTo(model.id)}><Focus size={11} /></button>
                  <button className="toolbar-button p-0.5" title={model.visible ? "Ausblenden" : "Einblenden"} onClick={() => updateModel(model.id, { visible: !model.visible })}>
                    {model.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                  <button className="toolbar-button p-0.5 hover:text-destructive" title="Entfernen" onClick={() => onRemove(model.id)}><Trash2 size={11} /></button>
                </div>
              </div>

              {isExpanded && (
                <div className="pl-3">
                  {view === "spatial"
                    ? <SpatialView
                        model={model} search={search}
                        multiSelected={multiSelected} activeKey={activeKey}
                        expandedSpatial={expandedSpatial}
                        onToggleExpand={toggleSpatialNode}
                        hiddenElements={hiddenElements} isolatedElements={isolatedElements}
                        onItemClick={handleItemClick}
                        onHide={(eid) => {
                          const ids = model.spatialTree ? collectSubtreeIds(model.spatialTree, eid) : [eid];
                          hideElements(model.id, ids);
                        }}
                        onShow={(eid) => {
                          const ids = model.spatialTree ? collectSubtreeIds(model.spatialTree, eid) : [eid];
                          showElements(model.id, ids);
                        }}
                        onIsolate={(eid) => {
                          const ids = model.spatialTree ? collectSubtreeIds(model.spatialTree, eid) : [eid];
                          isolateElements(model.id, ids);
                        }}
                        onShowAll={showAll}
                      />
                    : <TypeView
                        model={model} search={search}
                        multiSelected={multiSelected} activeKey={activeKey}
                        expandedTypeGroups={expandedTypeGroups}
                        onToggleTypeGroup={toggleTypeGroup}
                        hiddenElements={hiddenElements} isolatedElements={isolatedElements}
                        onItemClick={handleItemClick}
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

// ── Visible Elements View ─────────────────────────────────────────────────────

function VisibleView({ snapshot, onRefresh, activeKey, multiSelected, onItemClick }: {
  snapshot: VisibleEntry[] | null;
  onRefresh: () => void;
  activeKey: string | null;
  multiSelected: Set<string>;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent) => void;
}) {
  useEffect(() => { onRefresh(); }, []);

  if (!snapshot) return (
    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-[11px] gap-2">
      <p>Wird geladen…</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/60 bg-muted/20 sticky top-0 z-10">
        <span className="text-[11px] text-muted-foreground">{snapshot.length} sichtbare Elemente</span>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
          title="Aktualisieren"
        >
          <RefreshCw size={11} /> Aktualisieren
        </button>
      </div>
      {snapshot.length === 0 && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-[11px]">
          Keine sichtbaren Elemente
        </div>
      )}
      {snapshot.map((entry) => {
        const key = `${entry.modelId}:${entry.expressId}`;
        const isActive = activeKey === key || multiSelected.has(key);
        return (
          <div
            key={key}
            data-mid={entry.modelId}
            data-eid={entry.expressId}
            onClick={(e) => onItemClick(entry.modelId, entry.expressId, e)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent("viewer:zoomToElement", { detail: { modelId: entry.modelId, expressIds: [entry.expressId] } }));
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 cursor-pointer border-b border-border/30 hover:bg-muted/40 select-none",
              isActive && "bg-primary/10 text-primary"
            )}
          >
            <span className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/20" style={{ backgroundColor: entry.modelColor }} />
            <span className="flex-1 truncate text-[11px]">{entry.name || entry.typeName}</span>
            <span className="text-[10px] text-muted-foreground/60 shrink-0 truncate max-w-[80px]">{entry.typeName}</span>
          </div>
        );
      })}
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

function SpatialView({ model, search, multiSelected, activeKey, expandedSpatial, onToggleExpand, onItemClick, ...vp }: {
  model: IFCModelEntry; search: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedSpatial: Set<string>; onToggleExpand: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
} & VisibilityProps) {
  if (!model.spatialTree) {
    return <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Raumstruktur verfügbar</p>;
  }
  const filtered = search ? filterSpatialNode(model.spatialTree, search.toLowerCase()) : model.spatialTree;
  if (!filtered) {
    return <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Treffer für „{search}"</p>;
  }
  return (
    <SpatialTreeNode
      node={filtered} depth={0} modelId={model.id}
      multiSelected={multiSelected} activeKey={activeKey}
      expandedSpatial={expandedSpatial} onToggleExpand={onToggleExpand}
      onItemClick={onItemClick} forceOpen={!!search}
      {...vp}
    />
  );
}

function filterSpatialNode(node: SpatialNode, q: string): SpatialNode | null {
  const matches = node.name.toLowerCase().includes(q) || node.type.toLowerCase().includes(q);
  const filteredChildren = node.children.map((c) => filterSpatialNode(c, q)).filter((c): c is SpatialNode => c !== null);
  if (!matches && filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

function SpatialTreeNode({ node, depth, modelId, multiSelected, activeKey, expandedSpatial, onToggleExpand, onItemClick, forceOpen, hiddenElements, isolatedElements, onHide, onShow, onIsolate, onShowAll }: {
  node: SpatialNode; depth: number; modelId: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedSpatial: Set<string>; onToggleExpand: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
  forceOpen?: boolean;
} & VisibilityProps) {
  const hasChildren = node.children.length > 0;
  const key = `${modelId}:${node.expressId}`;
  const isOpen = forceOpen || expandedSpatial.has(key);
  const isSelected = multiSelected.has(key) || key === activeKey;
  const isHidden = hiddenElements.has(key);
  const isActivelyIsolated = isolatedElements !== null && isolatedElements.has(key);
  const isDimmedByIsolation = isolatedElements !== null && !isolatedElements.has(key);
  const isDimmed = isHidden || isDimmedByIsolation;
  const isSpatialContainer = ["IFCSITE","IFCBUILDING","IFCBUILDINGSTOREY","IFCSPACE","IFCBRIDGEPART","IFCFACILITYPART"].includes(node.type);

  return (
    <div>
      <div
        data-mid={modelId}
        data-eid={node.expressId}
        className={cn(
          "flex items-center gap-1 py-[3px] pr-2 cursor-pointer rounded-sm group select-none",
          "hover:bg-muted/40 hierarchy-item",
          isSelected && "bg-primary/15 border-l-2 border-l-primary",
          isDimmed && "opacity-40"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={(e) => {
          if (hasChildren && !forceOpen && !e.shiftKey) onToggleExpand(key);
          const childKeys = hasChildren ? collectSpatialElementKeys(node, modelId) : undefined;
          onItemClick(modelId, node.expressId, e, childKeys);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const expressIds = hasChildren
            ? collectSpatialElementKeys(node, modelId).map((k) => parseInt(k.split(":")[1]))
            : [node.expressId];
          window.dispatchEvent(new CustomEvent("viewer:zoomToElement", { detail: { modelId, expressIds } }));
        }}
      >
        <span className="shrink-0 text-muted-foreground w-3.5">
          {hasChildren ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-muted-foreground/60 w-5 text-center">{typeIcon(node.type)}</span>
        <span className={cn("flex-1 truncate", isSpatialContainer ? "text-foreground font-medium" : "text-foreground/80")}>{node.name}</span>
        {hasChildren && <span className="text-[9px] text-muted-foreground/50 shrink-0 mr-1">{countLeaves(node)}</span>}
        <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            className={cn("toolbar-button p-0.5", isActivelyIsolated ? "text-primary" : "text-muted-foreground/40 hover:text-foreground")}
            title={isActivelyIsolated ? "Isolierung aufheben" : "Isolieren"}
            onClick={() => isActivelyIsolated ? onShowAll() : onIsolate(node.expressId)}
          ><ScanLine size={10} /></button>
          <button
            className={cn("toolbar-button p-0.5", isHidden ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/40 hover:text-foreground")}
            title={isHidden ? "Einblenden" : "Ausblenden"}
            onClick={() => isHidden ? onShow(node.expressId) : onHide(node.expressId)}
          >{isHidden ? <EyeOff size={10} /> : <Eye size={10} />}</button>
        </div>
      </div>

      {isOpen && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SpatialTreeNode
              key={child.expressId}
              node={child} depth={depth + 1} modelId={modelId}
              multiSelected={multiSelected} activeKey={activeKey}
              expandedSpatial={expandedSpatial} onToggleExpand={onToggleExpand}
              onItemClick={onItemClick} forceOpen={forceOpen}
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

function TypeView({ model, search, multiSelected, activeKey, expandedTypeGroups, onToggleTypeGroup, onItemClick, ...vp }: {
  model: IFCModelEntry; search: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedTypeGroups: Set<string>; onToggleTypeGroup: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
} & VisibilityProps) {
  const groups = useMemo(() => {
    const raw = Object.entries(model.elementsByType);
    if (!search) return raw;
    const q = search.toLowerCase();
    return raw
      .map(([type, els]): [string, ElementNode[]] => [
        type, els.filter((el) => el.name.toLowerCase().includes(q) || type.toLowerCase().includes(q)),
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
          modelId={model.id}
          multiSelected={multiSelected} activeKey={activeKey}
          expandedTypeGroups={expandedTypeGroups} onToggleTypeGroup={onToggleTypeGroup}
          onItemClick={onItemClick} forceOpen={!!search} {...vp}
        />
      ))}
    </div>
  );
}

function TypeGroup({ typeName, elements, modelId, multiSelected, activeKey, expandedTypeGroups, onToggleTypeGroup, onItemClick, forceOpen, hiddenElements, isolatedElements, onHide, onShow, onIsolate, onShowAll }: {
  typeName: string; elements: ElementNode[]; modelId: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedTypeGroups: Set<string>; onToggleTypeGroup: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
  forceOpen?: boolean;
} & VisibilityProps) {
  const groupKey = `${modelId}:${typeName}`;
  const isOpen = forceOpen || expandedTypeGroups.has(groupKey);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer hover:bg-muted/40 select-none"
        onClick={(e) => {
          if (!forceOpen) onToggleTypeGroup(groupKey);
          const childKeys = elements.map((el) => `${modelId}:${el.expressId}`);
          onItemClick(modelId, 0, e, childKeys);
        }}
      >
        <span className="text-muted-foreground shrink-0">
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="flex-1 text-foreground font-medium">{typeName}</span>
        <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 rounded shrink-0">{elements.length}</span>
      </div>

      {isOpen && (
        <div>
          {elements.map((el) => {
            const key = `${modelId}:${el.expressId}`;
            const isSelected = multiSelected.has(key) || key === activeKey;
            const isHidden = hiddenElements.has(key);
            const isActivelyIsolated = isolatedElements !== null && isolatedElements.has(key);
            const isDimmedByIsolation = isolatedElements !== null && !isolatedElements.has(key);
            return (
              <div
                key={el.expressId}
                data-mid={modelId}
                data-eid={el.expressId}
                className={cn(
                  "flex items-center gap-1.5 pl-7 pr-2 py-[3px] cursor-pointer group select-none",
                  "hover:bg-muted/40 hierarchy-item",
                  isSelected && "bg-primary/15 border-l-2 border-l-primary",
                  (isHidden || isDimmedByIsolation) && "opacity-40"
                )}
                onClick={(e) => onItemClick(modelId, el.expressId, e)}
                onDoubleClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("viewer:zoomToElement", { detail: { modelId, expressIds: [el.expressId] } })); }}
              >
                <span className="flex-1 truncate text-foreground/80" title={el.name}>{el.name}</span>
                <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">#{el.expressId}</span>
                <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={cn("toolbar-button p-0.5", isActivelyIsolated ? "text-primary" : "text-muted-foreground/40 hover:text-foreground")}
                    title={isActivelyIsolated ? "Isolierung aufheben" : "Isolieren"}
                    onClick={() => isActivelyIsolated ? onShowAll() : onIsolate(el.expressId)}
                  ><ScanLine size={10} /></button>
                  <button
                    className={cn("toolbar-button p-0.5", isHidden ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/40 hover:text-foreground")}
                    title={isHidden ? "Einblenden" : "Ausblenden"}
                    onClick={() => isHidden ? onShow(el.expressId) : onHide(el.expressId)}
                  >{isHidden ? <EyeOff size={10} /> : <Eye size={10} />}</button>
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
  view: View; onView: (v: View) => void; search: string; onSearch: (s: string) => void;
}) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Layers size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground flex-1">Projektstruktur</span>
      </div>
      <div className="px-2 py-1.5 border-b border-border/60">
        <div className="flex items-center gap-1.5 bg-muted/40 rounded px-2 py-1">
          <Search size={11} className="text-muted-foreground shrink-0" />
          <input
            type="text" value={search} onChange={(e) => onSearch(e.target.value)}
            placeholder="Suchen…"
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40 text-foreground"
          />
          {search && (
            <button className="text-muted-foreground hover:text-foreground" onClick={() => onSearch("")}><X size={11} /></button>
          )}
        </div>
      </div>
      <div className="flex border-b border-border bg-[var(--tabs-bg)]">
        {([
          { id: "spatial" as View, label: "Räumlich",   icon: <Layers size={11} /> },
          { id: "type"    as View, label: "Nach Typ",   icon: <LayoutList size={11} /> },
          { id: "visible" as View, label: "Sichtbar",   icon: <Eye size={11} /> },
        ]).map((t) => (
          <button
            key={t.id} onClick={() => onView(t.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium transition-colors border-t-2",
              view === t.id
                ? "border-t-primary bg-[var(--tab-active-bg)] text-[var(--tab-active-text)]"
                : "border-t-transparent text-[var(--tab-text)] hover:text-foreground"
            )}
          >
            {t.icon}{t.label}
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
    for (const child of node.children) { const f = findNode(child); if (f) return f; }
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

function collectSpatialElementKeys(node: SpatialNode, modelId: string): string[] {
  if (node.children.length === 0) return [`${modelId}:${node.expressId}`];
  const keys: string[] = [];
  for (const child of node.children) keys.push(...collectSpatialElementKeys(child, modelId));
  return keys;
}

function collectDefaultExpanded(node: SpatialNode, modelId: string, depth: number, out: Set<string>) {
  if (depth < 2) {
    out.add(`${modelId}:${node.expressId}`);
    node.children.forEach((c) => collectDefaultExpanded(c, modelId, depth + 1, out));
  }
}

function flattenSpatialVisible(node: SpatialNode, modelId: string, expandedSpatial: Set<string>, forceOpen: boolean, out: string[]) {
  const key = `${modelId}:${node.expressId}`;
  out.push(key);
  if ((forceOpen || expandedSpatial.has(key)) && node.children.length > 0) {
    node.children.forEach((c) => flattenSpatialVisible(c, modelId, expandedSpatial, forceOpen, out));
  }
}

// Returns the full path (list of expressIds) from root down to targetId, inclusive
function findPathToNode(root: SpatialNode, targetId: number): number[] {
  function search(node: SpatialNode, path: number[]): number[] | null {
    const current = [...path, node.expressId];
    if (node.expressId === targetId) return current;
    for (const child of node.children) { const f = search(child, current); if (f) return f; }
    return null;
  }
  return search(root, []) ?? [];
}
