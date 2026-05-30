import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";

function useSimpleVirtualizer(
  count: number,
  itemHeight: number,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  overscan = 12,
) {
  const [range, setRange] = useState({ start: 0, end: 30 });
  const viewHeightRef = useRef(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    viewHeightRef.current = el.clientHeight;

    const calc = (scrollTop: number) => ({
      start: Math.max(0, Math.floor(scrollTop / itemHeight) - overscan),
      end:   Math.min(count - 1, Math.ceil((scrollTop + viewHeightRef.current) / itemHeight) + overscan),
    });

    // Only call setState when the rendered slice actually changes — avoids
    // a re-render on every scroll pixel (items are 26px, so re-render every ~26px instead).
    const onScroll = () => {
      const next = calc(el.scrollTop);
      setRange(prev => prev.start === next.start && prev.end === next.end ? prev : next);
    };
    const ro = new ResizeObserver(() => {
      viewHeightRef.current = el.clientHeight;
      onScroll();
    });

    setRange(calc(el.scrollTop));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, count, itemHeight]);

  const items = [];
  for (let i = range.start; i <= range.end; i++) items.push({ index: i, start: i * itemHeight, size: itemHeight });
  return { items, totalSize: count * itemHeight };
}
import {
  ChevronRight, ChevronDown, ChevronLeft, Eye, EyeOff,
  Trash2, Focus, Layers, LayoutList, Search, X,
  ScanEye, ScanLine, RefreshCw, ExternalLink, Settings2, Sparkles,
  ArrowUp, ArrowDown,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { useShallow } from "zustand/react/shallow";
import { formatBytes } from "../utils/coordinateUtils";
import type { IFCModelEntry, SpatialNode, ElementNode, SmartSpatialConfig, SmartSpatialLevel, FlatElementProps } from "../types/ifc";
import { v4 as uuidv4 } from "uuid";

type View = "spatial" | "type" | "visible" | "smartspatial";

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
  onToggleCollapse?: () => void;
  onPopout?: () => void;
}

export function HierarchyPanel({ onFitTo, onRemove, onSelectElement, onHideOverride, onShowAllOverride, onIsolateOverride, onToggleCollapse, onPopout }: Props) {
  const models = useModelStore((s) => s.models);
  const hiddenElements = useModelStore((s) => s.hiddenElements);
  const isolatedElements = useModelStore((s) => s.isolatedElements);
  const selectionBasket = useModelStore((s) => s.selectionBasket);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const loadedPropKeys = useModelStore((s) => s.loadedPropKeys);

  // Actions — stable Zustand refs, grouped to reduce subscription count
  const {
    updateModel,
    hideElement: hideElement_, hideElements: hideElements_,
    showElement, showElements,
    isolateElement: isolateElement_, isolateElements: isolateElements_,
    showAll: showAll_, setBasket,
  } = useModelStore(useShallow((s) => ({
    updateModel: s.updateModel,
    hideElement: s.hideElement,
    hideElements: s.hideElements,
    showElement: s.showElement,
    showElements: s.showElements,
    isolateElement: s.isolateElement,
    isolateElements: s.isolateElements,
    showAll: s.showAll,
    setBasket: s.setBasket,
  })));

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
  const [smartSpatialConfig, setSmartSpatialConfig] = useState<SmartSpatialConfig>(() => {
    try {
      const raw = localStorage.getItem("infracore-smartspatial");
      if (raw) return JSON.parse(raw) as SmartSpatialConfig;
    } catch { /* ignore */ }
    return { levels: [
      { id: uuidv4(), label: "Modell", propertyKey: "_model" },
      { id: uuidv4(), label: "IFC-Typ", propertyKey: "_type" },
    ]};
  });
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


  const arr = useMemo(() => Array.from(models.values()), [models]);

  // Stable per-model callbacks — only recomputed when the model set changes or actions change.
  // During normal interaction (clicks, hide/show), `arr` is stable → callbacks stay stable,
  // making React.memo on SpatialTreeNode / TypeGroup actually effective.
  const spatialCallbackMap = useMemo(() => {
    const map = new Map<string, { onHide: (eid: number) => void; onShow: (eid: number) => void; onIsolate: (eid: number) => void }>();
    arr.forEach((model) => {
      map.set(model.id, {
        onHide: (eid) => { const ids = model.spatialTree ? collectSubtreeIds(model.spatialTree, eid) : [eid]; hideElements(model.id, ids); },
        onShow: (eid) => { const ids = model.spatialTree ? collectSubtreeIds(model.spatialTree, eid) : [eid]; showElements(model.id, ids); },
        onIsolate: (eid) => { const ids = model.spatialTree ? collectSubtreeIds(model.spatialTree, eid) : [eid]; isolateElements(model.id, ids); },
      });
    });
    return map;
  }, [arr, hideElements, showElements, isolateElements]);

  const typeCallbackMap = useMemo(() => {
    const map = new Map<string, { onHide: (eid: number) => void; onShow: (eid: number) => void; onIsolate: (eid: number) => void }>();
    arr.forEach((model) => {
      map.set(model.id, {
        onHide: (eid) => hideElement(model.id, eid),
        onShow: (eid) => showElement(model.id, eid),
        onIsolate: (eid) => isolateElement(model.id, eid),
      });
    });
    return map;
  }, [arr, hideElement, showElement, isolateElement]);


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


  // activeKey: highlights only elements explicitly clicked in this panel
  const activeKey: string | null = anchorKey;

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
      } else if (view === "smartspatial") {
        // no keyboard navigation for smartspatial
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

  // Refs so handleItemClick stays stable across anchorKey/flatVisibleKeys changes
  const anchorKeyRef = useRef(anchorKey);
  anchorKeyRef.current = anchorKey;
  const flatVisibleKeysRef = useRef(flatVisibleKeys);
  flatVisibleKeysRef.current = flatVisibleKeys;

  // Click handler with Shift-support — stable reference (deps only change on onSelectElement change)
  // childKeys: all leaf element keys beneath a parent node — triggers group selection
  const handleItemClick = useCallback((modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => {
    const key = `${modelId}:${expressId}`;
    const ak = anchorKeyRef.current;
    const fvk = flatVisibleKeysRef.current;

    // Clicking a parent node: select all children
    if (childKeys && childKeys.length > 0 && !e.shiftKey) {
      setMultiSelected(new Set(childKeys));
      setAnchorKey(childKeys[0]);
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      if (ak && ak !== key && fvk.length > 0) {
        const aIdx = fvk.indexOf(ak);
        const bIdx = fvk.indexOf(key);
        if (aIdx !== -1 && bIdx !== -1) {
          const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
          setMultiSelected(new Set(fvk.slice(lo, hi + 1)));
          return;
        }
      }
      setMultiSelected((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
      if (!ak) setAnchorKey(key);
    } else {
      setMultiSelected(new Set([key]));
      setAnchorKey(key);
      onSelectElement(modelId, expressId);
    }
  }, [onSelectElement]);

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

  const toggleModelExpand = useCallback((id: string) =>
    setExpandedModels((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  const toggleSpatialNode = useCallback((key: string) =>
    setExpandedSpatial((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; }), []);

  const toggleTypeGroup = useCallback((key: string) =>
    setExpandedTypeGroups((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; }), []);

  if (arr.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header view={view} onView={handleSetView} search={inputValue} onSearch={handleSearch} onToggleCollapse={onToggleCollapse} onPopout={onPopout} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
          <div className="w-14 h-14 rounded-[6px] border-2 border-dashed border-border flex items-center justify-center">
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
      <Header view={view} onView={setView} search={inputValue} onSearch={handleSearch} onToggleCollapse={onToggleCollapse} onPopout={onPopout} />

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
          <button className="px-1.5 py-0.5 rounded-[4px] hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Alle ausblenden" onClick={handleMultiHide}><EyeOff size={11} /></button>
          <button className="px-1.5 py-0.5 rounded-[4px] hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Alle isolieren" onClick={handleMultiIsolate}><ScanLine size={11} /></button>
          <button className="px-1.5 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground text-[10px] font-mono" title="Zur Auswahl hinzufügen" onClick={handleAddToBasket}>+Korb</button>
          <button className="px-1.5 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground text-[10px] font-mono" title="Auswahlkorb ersetzen" onClick={handleSetBasket}>=Korb</button>
          <button className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Auswahl aufheben" onClick={() => { setMultiSelected(new Set()); setAnchorKey(null); }}><X size={11} /></button>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin text-[12px]">
        {view === "visible" && (
          <VisibleView
            snapshot={visibleSnapshot}
            scrollContainerRef={scrollContainerRef}
            onRefresh={captureVisibleSnapshot}
            activeKey={activeKey}
            multiSelected={multiSelected}
            onItemClick={handleItemClick}
          />
        )}
        {view === "smartspatial" && (
          <SmartSpatialView
            models={arr}
            config={smartSpatialConfig}
            onConfigChange={(cfg) => {
              setSmartSpatialConfig(cfg);
              localStorage.setItem("infracore-smartspatial", JSON.stringify(cfg));
            }}
            loadedProperties={loadedProperties}
            loadedPropKeys={loadedPropKeys}
            search={search}
            multiSelected={multiSelected}
            activeKey={activeKey}
            onItemClick={handleItemClick}
            hiddenElements={hiddenElements}
            isolatedElements={isolatedElements}
          />
        )}
        {view !== "visible" && view !== "smartspatial" && arr.map((model) => {
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
                <span className="w-2.5 h-2.5 rounded-[3px] shrink-0 ring-1 ring-black/20" style={{ backgroundColor: model.color }} />
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

              {isExpanded && (() => {
                const sCbs = spatialCallbackMap.get(model.id)!;
                const tCbs = typeCallbackMap.get(model.id)!;
                return (
                  <div className="pl-3">
                    {view === "spatial"
                      ? <SpatialView
                          model={model} search={search}
                          multiSelected={multiSelected} activeKey={activeKey}
                          expandedSpatial={expandedSpatial}
                          onToggleExpand={toggleSpatialNode}
                          hiddenElements={hiddenElements} isolatedElements={isolatedElements}
                          onItemClick={handleItemClick}
                          onHide={sCbs.onHide} onShow={sCbs.onShow}
                          onIsolate={sCbs.onIsolate} onShowAll={showAll}
                        />
                      : <TypeView
                          model={model} search={search}
                          multiSelected={multiSelected} activeKey={activeKey}
                          expandedTypeGroups={expandedTypeGroups}
                          onToggleTypeGroup={toggleTypeGroup}
                          hiddenElements={hiddenElements} isolatedElements={isolatedElements}
                          onItemClick={handleItemClick}
                          onHide={tCbs.onHide} onShow={tCbs.onShow}
                          onIsolate={tCbs.onIsolate} onShowAll={showAll}
                        />
                    }
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Visible Elements View (virtualized) ──────────────────────────────────────

const VISIBLE_ROW_HEIGHT = 26;

function VisibleView({ snapshot, scrollContainerRef, onRefresh, activeKey, multiSelected, onItemClick }: {
  snapshot: VisibleEntry[] | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onRefresh: () => void;
  activeKey: string | null;
  multiSelected: Set<string>;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent) => void;
}) {
  useEffect(() => { onRefresh(); }, []);

  const { items, totalSize } = useSimpleVirtualizer(snapshot?.length ?? 0, VISIBLE_ROW_HEIGHT, scrollContainerRef);

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
      {snapshot.length > 0 && (
        <div style={{ height: `${totalSize}px`, position: "relative" }}>
          {items.map((vItem) => {
            const entry = snapshot[vItem.index];
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
                  "absolute w-full flex items-center gap-1.5 px-3 cursor-pointer border-b border-border/30 hover:bg-muted/40 select-none",
                  isActive && "bg-primary/10 text-primary"
                )}
                style={{ top: vItem.start, height: vItem.size }}
              >
                <span className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/20" style={{ backgroundColor: entry.modelColor }} />
                <span className="flex-1 truncate text-[11px]">{entry.name || entry.typeName}</span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 truncate max-w-[80px]">{entry.typeName}</span>
              </div>
            );
          })}
        </div>
      )}
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

type SpatialTreeNodeProps = {
  node: SpatialNode; depth: number; modelId: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedSpatial: Set<string>; onToggleExpand: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
  forceOpen?: boolean;
} & VisibilityProps;

function spatialNodeAreEqual(prev: SpatialTreeNodeProps, next: SpatialTreeNodeProps): boolean {
  // Structural / callback changes always trigger re-render
  if (prev.node !== next.node || prev.depth !== next.depth || prev.modelId !== next.modelId ||
      prev.forceOpen !== next.forceOpen || prev.expandedSpatial !== next.expandedSpatial ||
      prev.onToggleExpand !== next.onToggleExpand || prev.onItemClick !== next.onItemClick ||
      prev.onHide !== next.onHide || prev.onShow !== next.onShow ||
      prev.onIsolate !== next.onIsolate || prev.onShowAll !== next.onShowAll) return false;

  const key = `${next.modelId}:${next.node.expressId}`;

  // activeKey: only re-render if this node's selection state actually changes
  if (prev.activeKey !== next.activeKey &&
      (prev.activeKey === key || next.activeKey === key)) return false;

  // multiSelected: only re-render if this key's membership changed
  if (prev.multiSelected !== next.multiSelected &&
      prev.multiSelected.has(key) !== next.multiSelected.has(key)) return false;

  // hiddenElements: only re-render if this element's hide state changed
  if (prev.hiddenElements !== next.hiddenElements &&
      prev.hiddenElements.has(key) !== next.hiddenElements.has(key)) return false;

  // isolatedElements: only re-render if isolation mode or this element's isolation state changed
  if (prev.isolatedElements !== next.isolatedElements) {
    const prevIso = prev.isolatedElements === null ? null : prev.isolatedElements.has(key);
    const nextIso = next.isolatedElements === null ? null : next.isolatedElements.has(key);
    if (prevIso !== nextIso) return false;
  }

  return true;
}

const SpatialTreeNode = memo(function SpatialTreeNode({ node, depth, modelId, multiSelected, activeKey, expandedSpatial, onToggleExpand, onItemClick, forceOpen, hiddenElements, isolatedElements, onHide, onShow, onIsolate, onShowAll }: SpatialTreeNodeProps) {
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
}, spatialNodeAreEqual);

// ── By-Type View ──────────────────────────────────────────────────────────────

function TypeView({ model, search, multiSelected, activeKey, expandedTypeGroups, onToggleTypeGroup, onItemClick, ...vp }: {
  model: IFCModelEntry; search: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedTypeGroups: Set<string>; onToggleTypeGroup: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
} & VisibilityProps) {
  const groups = useMemo(() => {
    const raw = Object.entries(model.elementsByType);
    const filtered = search
      ? raw
          .map(([type, els]): [string, ElementNode[]] => [
            type, els.filter((el) => el.name.toLowerCase().includes(search.toLowerCase()) || type.toLowerCase().includes(search.toLowerCase())),
          ])
          .filter(([, els]) => els.length > 0)
      : raw;
    return filtered.sort(([a], [b]) => a.localeCompare(b));
  }, [model.elementsByType, search]);

  if (groups.length === 0) {
    return search
      ? <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Treffer für „{search}"</p>
      : <p className="px-3 py-3 text-muted-foreground text-[11px]">Keine Elemente gefunden</p>;
  }

  return (
    <div>
      {groups.map(([typeName, elements]) => (
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

type TypeGroupProps = {
  typeName: string; elements: ElementNode[]; modelId: string;
  multiSelected: Set<string>; activeKey: string | null;
  expandedTypeGroups: Set<string>; onToggleTypeGroup: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
  forceOpen?: boolean;
} & VisibilityProps;

function typeGroupAreEqual(prev: TypeGroupProps, next: TypeGroupProps): boolean {
  if (prev.typeName !== next.typeName || prev.elements !== next.elements ||
      prev.modelId !== next.modelId || prev.forceOpen !== next.forceOpen ||
      prev.onToggleTypeGroup !== next.onToggleTypeGroup || prev.onItemClick !== next.onItemClick ||
      prev.onHide !== next.onHide || prev.onShow !== next.onShow ||
      prev.onIsolate !== next.onIsolate || prev.onShowAll !== next.onShowAll) return false;

  const groupKey = `${next.modelId}:${next.typeName}`;

  // expandedTypeGroups: only re-render if THIS group's open state changed
  if (prev.expandedTypeGroups !== next.expandedTypeGroups &&
      prev.expandedTypeGroups.has(groupKey) !== next.expandedTypeGroups.has(groupKey)) return false;

  // For set-based props, check if any element in THIS group is affected
  const myKeys = next.elements.map((el) => `${next.modelId}:${el.expressId}`);

  if (prev.activeKey !== next.activeKey) {
    if (myKeys.some((k) => k === prev.activeKey || k === next.activeKey)) return false;
  }
  if (prev.multiSelected !== next.multiSelected) {
    if (myKeys.some((k) => prev.multiSelected.has(k) !== next.multiSelected.has(k))) return false;
  }
  if (prev.hiddenElements !== next.hiddenElements) {
    if (myKeys.some((k) => prev.hiddenElements.has(k) !== next.hiddenElements.has(k))) return false;
  }
  if (prev.isolatedElements !== next.isolatedElements) {
    const prevNull = prev.isolatedElements === null;
    const nextNull = next.isolatedElements === null;
    if (prevNull !== nextNull) return false;
    if (!prevNull && !nextNull &&
        myKeys.some((k) => prev.isolatedElements!.has(k) !== next.isolatedElements!.has(k))) return false;
  }

  return true;
}

const TYPE_GROUP_CAP = 150;

const TypeGroup = memo(function TypeGroup({ typeName, elements, modelId, multiSelected, activeKey, expandedTypeGroups, onToggleTypeGroup, onItemClick, forceOpen, hiddenElements, isolatedElements, onHide, onShow, onIsolate, onShowAll }: TypeGroupProps) {
  const groupKey = `${modelId}:${typeName}`;
  const isOpen = forceOpen || expandedTypeGroups.has(groupKey);
  const [showAll, setShowAll] = useState(false);
  const displayed = isOpen && !showAll && elements.length > TYPE_GROUP_CAP
    ? elements.slice(0, TYPE_GROUP_CAP)
    : elements;

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
        <span className="text-[10px] text-muted-foreground border border-border px-1.5 rounded-[4px] shrink-0">{elements.length}</span>
      </div>

      {isOpen && (
        <div>
          {displayed.map((el) => {
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
          {!showAll && elements.length > TYPE_GROUP_CAP && (
            <button
              className="w-full py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 text-center transition-colors"
              onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
            >
              + {elements.length - TYPE_GROUP_CAP} weitere anzeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}, typeGroupAreEqual);

// ── SmartSpatial View ─────────────────────────────────────────────────────────

interface SmartSpatialNode {
  key: string;
  label: string;
  level: number;
  children: SmartSpatialNode[];
  elementKeys: string[];
  elementNames: Map<string, string>;
}

function buildSmartSpatialTree(
  models: IFCModelEntry[],
  config: SmartSpatialConfig,
  loadedProperties: Map<string, Map<number, FlatElementProps>> | null
): SmartSpatialNode[] {
  const root: SmartSpatialNode[] = [];
  const nodeMap = new Map<string, SmartSpatialNode>();

  const getOrCreate = (pathParts: string[], level: number): SmartSpatialNode => {
    const key = pathParts.slice(0, level + 1).join("\0");
    if (nodeMap.has(key)) return nodeMap.get(key)!;
    const node: SmartSpatialNode = { key, label: pathParts[level], level, children: [], elementKeys: [], elementNames: new Map() };
    nodeMap.set(key, node);
    if (level === 0) {
      root.push(node);
    } else {
      const parent = getOrCreate(pathParts, level - 1);
      parent.children.push(node);
    }
    return node;
  };

  for (const model of models) {
    for (const [typeName, elements] of Object.entries(model.elementsByType)) {
      for (const el of elements) {
        const elKey = `${model.id}:${el.expressId}`;
        const path: string[] = config.levels.map((lvl) => {
          if (lvl.propertyKey === "_model") return model.name;
          if (lvl.propertyKey === "_type") return typeName;
          if (lvl.propertyKey === "_name") return el.name;
          const val = loadedProperties?.get(model.id)?.get(el.expressId)?.[lvl.propertyKey];
          return val !== undefined && val !== null ? String(val) : "—";
        });
        const leaf = getOrCreate(path, config.levels.length - 1);
        leaf.elementKeys.push(elKey);
        leaf.elementNames.set(elKey, el.name || el.type);
      }
    }
  }

  return root;
}

function filterSmartNodes(nodes: SmartSpatialNode[], q: string): SmartSpatialNode[] {
  return nodes
    .map((n): SmartSpatialNode | null => {
      const matches = n.label.toLowerCase().includes(q);
      const filteredChildren = filterSmartNodes(n.children, q);
      if (!matches && filteredChildren.length === 0 && n.elementKeys.length === 0) return null;
      return { ...n, children: filteredChildren, elementNames: n.elementNames };
    })
    .filter((n): n is SmartSpatialNode => n !== null);
}

const SmartSpatialTreeNode = memo(function SmartSpatialTreeNode({
  node, depth, expanded, onToggle, onItemClick, multiSelected, activeKey,
  hiddenElements, isolatedElements,
}: {
  node: SmartSpatialNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
  multiSelected: Set<string>;
  activeKey: string | null;
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
}) {
  const isLeaf = node.children.length === 0;
  const isOpen = expanded.has(node.key);
  const totalElements = node.elementKeys.length + node.children.reduce((s, c) => s + c.elementKeys.length, 0);

  if (isLeaf) {
    return (
      <div>
        <div
          className="flex items-center gap-1 py-[3px] pr-2 cursor-pointer hover:bg-muted/40 select-none"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={(e) => {
            onItemClick("", 0, e, node.elementKeys);
          }}
        >
          <span className="shrink-0 text-muted-foreground w-3.5"><ChevronRight size={11} className="opacity-30" /></span>
          <span className="flex-1 truncate text-foreground/80">{node.label}</span>
          <span className="text-[9px] text-muted-foreground border border-border px-1.5 rounded-[4px] shrink-0">{node.elementKeys.length}</span>
        </div>
        {node.elementKeys.map((k) => {
          const sep = k.indexOf(":");
          const modelId = k.slice(0, sep);
          const expressId = parseInt(k.slice(sep + 1));
          const isSelected = multiSelected.has(k) || k === activeKey;
          const isHidden = hiddenElements.has(k);
          const isDimmedByIsolation = isolatedElements !== null && !isolatedElements.has(k);
          return (
            <div
              key={k}
              data-mid={modelId}
              data-eid={expressId}
              className={cn(
                "flex items-center gap-1.5 pr-2 py-[3px] cursor-pointer group select-none hover:bg-muted/40 hierarchy-item",
                isSelected && "bg-primary/15 border-l-2 border-l-primary",
                (isHidden || isDimmedByIsolation) && "opacity-40"
              )}
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
              onClick={(e) => onItemClick(modelId, expressId, e)}
            >
              <span className="flex-1 truncate text-foreground/80 text-[11px]">{node.elementNames.get(k) || `#${expressId}`}</span>
              <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">#{expressId}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 py-[3px] pr-2 cursor-pointer hover:bg-muted/40 select-none"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={(e) => {
          onToggle(node.key);
          onItemClick("", 0, e, node.elementKeys);
        }}
      >
        <span className="shrink-0 text-muted-foreground w-3.5">
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="flex-1 truncate text-foreground font-medium">{node.label}</span>
        <span className="text-[9px] text-muted-foreground border border-border px-1.5 rounded-[4px] shrink-0">{totalElements}</span>
      </div>
      {isOpen && node.children.map((child) => (
        <SmartSpatialTreeNode
          key={child.key}
          node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          onItemClick={onItemClick}
          multiSelected={multiSelected} activeKey={activeKey}
          hiddenElements={hiddenElements} isolatedElements={isolatedElements}
        />
      ))}
    </div>
  );
});

function SmartSpatialView({
  models, config, onConfigChange, loadedProperties, loadedPropKeys,
  search, multiSelected, activeKey, onItemClick, hiddenElements, isolatedElements,
}: {
  models: IFCModelEntry[];
  config: SmartSpatialConfig;
  onConfigChange: (cfg: SmartSpatialConfig) => void;
  loadedProperties: Map<string, Map<number, FlatElementProps>> | null;
  loadedPropKeys: string[];
  search: string;
  multiSelected: Set<string>;
  activeKey: string | null;
  onItemClick: (modelId: string, expressId: number, e: React.MouseEvent, childKeys?: string[]) => void;
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildSmartSpatialTree(models, config, loadedProperties), [models, config, loadedProperties]);

  const filtered = useMemo(() => {
    if (!search) return tree;
    return filterSmartNodes(tree, search.toLowerCase());
  }, [tree, search]);

  const propKeyOptions = useMemo(() => {
    const base = ["_model", "_type", "_name"];
    return [...base, ...loadedPropKeys.filter((k) => !base.includes(k))];
  }, [loadedPropKeys]);

  const updateLevel = (idx: number, patch: Partial<SmartSpatialLevel>) => {
    const levels = config.levels.map((l, i) => i === idx ? { ...l, ...patch } : l);
    onConfigChange({ ...config, levels });
  };

  const moveLevel = (idx: number, dir: -1 | 1) => {
    const levels = [...config.levels];
    const target = idx + dir;
    if (target < 0 || target >= levels.length) return;
    [levels[idx], levels[target]] = [levels[target], levels[idx]];
    onConfigChange({ ...config, levels });
  };

  const removeLevel = (idx: number) => {
    onConfigChange({ ...config, levels: config.levels.filter((_, i) => i !== idx) });
  };

  const addLevel = () => {
    if (config.levels.length >= 5) return;
    onConfigChange({ ...config, levels: [...config.levels, { id: uuidv4(), label: "Ebene", propertyKey: "_type" }] });
  };

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/40">
        <span className="text-[10px] text-muted-foreground">Konfigurierbare Hierarchie</span>
        <button
          onClick={() => setShowConfig((p) => !p)}
          className={cn("p-0.5 rounded toolbar-button", showConfig && "text-primary")}
          title="Konfiguration"
        >
          <Settings2 size={11} />
        </button>
      </div>

      {showConfig && (
        <div className="px-2 py-2 border-b border-border/40 bg-muted/20 space-y-1.5">
          {config.levels.map((lvl, idx) => (
            <div key={lvl.id} className="flex items-center gap-1">
              <input
                type="text"
                value={lvl.label}
                onChange={(e) => updateLevel(idx, { label: e.target.value })}
                className="flex-1 min-w-0 bg-background border border-border rounded-[3px] px-1.5 py-0.5 text-[11px] outline-none text-foreground"
              />
              <select
                value={lvl.propertyKey}
                onChange={(e) => updateLevel(idx, { propertyKey: e.target.value })}
                className="flex-1 min-w-0 bg-background border border-border rounded-[3px] px-1 py-0.5 text-[11px] outline-none text-foreground"
              >
                {propKeyOptions.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <button className="toolbar-button p-0.5" onClick={() => moveLevel(idx, -1)} disabled={idx === 0}><ArrowUp size={10} /></button>
              <button className="toolbar-button p-0.5" onClick={() => moveLevel(idx, 1)} disabled={idx === config.levels.length - 1}><ArrowDown size={10} /></button>
              <button className="toolbar-button p-0.5 hover:text-destructive" onClick={() => removeLevel(idx)}><Trash2 size={10} /></button>
            </div>
          ))}
          <button
            onClick={addLevel}
            disabled={config.levels.length >= 5}
            className="w-full py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 text-center rounded transition-colors disabled:opacity-40"
          >
            + Level hinzufügen
          </button>
        </div>
      )}

      <div>
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-muted-foreground text-[11px]">
            {search ? `Keine Treffer für „${search}"` : "Keine Elemente"}
          </p>
        )}
        {filtered.map((node) => (
          <SmartSpatialTreeNode
            key={node.key}
            node={node} depth={0}
            expanded={expanded} onToggle={toggleExpand}
            onItemClick={onItemClick}
            multiSelected={multiSelected} activeKey={activeKey}
            hiddenElements={hiddenElements} isolatedElements={isolatedElements}
          />
        ))}
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ view, onView, search, onSearch, onToggleCollapse, onPopout }: {
  view: View; onView: (v: View) => void; search: string; onSearch: (s: string) => void;
  onToggleCollapse?: () => void;
  onPopout?: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Layers size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground flex-1">Projektstruktur</span>
        {onPopout && (
          <button
            onClick={onPopout}
            className="text-muted-foreground/50 hover:text-foreground p-0.5 rounded transition-colors shrink-0"
            title="In eigenem Fenster öffnen"
          >
            <ExternalLink size={12} />
          </button>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="text-muted-foreground/50 hover:text-foreground p-0.5 rounded transition-colors shrink-0"
            title="Leiste ausblenden"
          >
            <ChevronLeft size={12} />
          </button>
        )}
      </div>
      <div className="px-2 py-1.5 border-b border-border/60">
        <div className="flex items-center gap-1.5 bg-background border border-border rounded-[4px] px-2 py-1">
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
          { id: "spatial"       as View, label: "Räumlich",  icon: <Layers size={11} /> },
          { id: "type"          as View, label: "Nach Typ",  icon: <LayoutList size={11} /> },
          { id: "visible"       as View, label: "Sichtbar",  icon: <Eye size={11} /> },
          { id: "smartspatial"  as View, label: "Smart",     icon: <Sparkles size={11} /> },
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

