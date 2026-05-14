import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import * as THREE from "three";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";

import { MainToolbar } from "./components/MainToolbar";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { ViewportContainer } from "./components/ViewportContainer";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { StatusBar } from "./components/StatusBar";
import { LandingOverlay } from "./components/LandingOverlay";
import { ClipPlaneControl } from "./components/ClipPlaneControl";
import { SQLPanel } from "./components/SQLPanel";
import { LensRulesPanel } from "./components/LensRulesPanel";
import { SmartViewsPanel } from "./components/SmartViewsPanel";
import { SelectionBasket } from "./components/SelectionBasket";
import { BasketEditor } from "./components/BasketEditor";

import { SecondaryWindow } from "./components/SecondaryWindow";
import { useModelStore } from "./store/modelStore";
import { loadIFCFile, loadIFCProperties } from "./utils/ifcLoader";
import { SYNC_CHANNEL, serializeState, openSecondaryWindow } from "./utils/windowSync";
import type { SyncMsg } from "./utils/windowSync";
import type { IFCModelEntry } from "./types/ifc";

// ── detect secondary window ───────────────────────────────────────────────────

const _params = new URLSearchParams(window.location.search);
const IS_SECONDARY = _params.has("secondary");
const SECONDARY_PANEL = _params.get("panel") ?? "hierarchy";

// ── root export (secondary windows skip the full app) ─────────────────────────

export default function App() {
  useEffect(() => { document.documentElement.classList.add("dark"); }, []);
  if (IS_SECONDARY) return <SecondaryWindow panel={SECONDARY_PANEL} />;
  return <MainApp />;
}

// ── main-window sync hook ─────────────────────────────────────────────────────

function useMainWindowSync(handleElementClick: (modelId: string, expressId: number) => Promise<void>) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = ch;

    ch.onmessage = async (e: MessageEvent<SyncMsg>) => {
      const msg = e.data;
      if (msg.t === "req") {
        ch.postMessage({ t: "state", s: serializeState(useModelStore.getState()) } satisfies SyncMsg);
      } else if (msg.t === "state") {
        // State broadcast from a secondary window — apply it and skip echoing
        applyingRef.current = true;
        useModelStore.getState().applyRemoteState(msg.s);
        applyingRef.current = false;
      } else if (msg.t === "act") {
        const store = useModelStore.getState();
        const a = msg.a;
        switch (a.k) {
          case "select":     await handleElementClick(a.modelId, a.expressId); break;
          case "hide":       store.hideElement(a.modelId, a.expressId); break;
          case "showAll":    store.showAll(); break;
          case "isolate":    store.isolateElement(a.modelId, a.expressId); break;
          case "colorGroups":       store.setColorGroups(a.groups); break;
          case "applySmartView":    store.applySmartView(a.id); break;
          case "deactivateSmartView": store.deactivateSmartView(); break;
          case "settings":   store.updateSettings(a.patch); break;
          case "fitAll":     window.dispatchEvent(new Event("viewer:fitAll")); break;
        }
      }
    };

    // Broadcast state on every store change (debounced); skip echo-induced changes
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useModelStore.subscribe(() => {
      if (applyingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (channelRef.current) {
          channelRef.current.postMessage({
            t: "state",
            s: serializeState(useModelStore.getState()),
          } satisfies SyncMsg);
        }
      }, 80);
    });

    return () => {
      ch.close();
      channelRef.current = null;
      unsub();
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface LoadState { phase: string; progress: number; fileName: string }

function MainApp() {
  const [loadStates, setLoadStates]           = useState<Map<string, LoadState>>(new Map());
  const [basketEditorOpen, setBasketEditorOpen] = useState(false);
  const {
    addModel, removeModel, updateModel, setWorldOrigin, setSelected,
    models, settings, activeTool, setActiveTool, sqlPanelOpen, setSqlPanelOpen,
    hideElement, showAll, selectedElement, clearMeasurements,
    listPanelOpen, setListPanelOpen,
    smartViewsPanelOpen, setSmartViewsPanelOpen,
  } = useModelStore();

  const activeLoads = loadStates.size;
  const hasModels = models.size > 0;

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Always handle Escape
      if (e.key === "Escape") {
        if (activeTool === "measure") {
          window.dispatchEvent(new Event("viewer:clearMeasure"));
          clearMeasurements();
          setActiveTool("select");
        } else {
          setSelected(null);
        }
        return;
      }

      if (isInput) return; // don't intercept typing in inputs

      switch (e.key.toLowerCase()) {
        case "f":
          e.preventDefault();
          window.dispatchEvent(new Event("viewer:fitAll"));
          break;
        case "s":
          setActiveTool("select");
          break;
        case "m":
          if (activeTool === "measure") {
            window.dispatchEvent(new Event("viewer:clearMeasure"));
            clearMeasurements();
            setActiveTool("select");
          } else {
            setActiveTool("measure");
          }
          break;
        case "c": {
          const st = useModelStore.getState();
          if (st.activeTool === "section" || st.settings.clipPlanes) {
            st.updateSettings({ clipPlanes: false });
            setActiveTool("select");
          } else {
            setActiveTool("section");
          }
          break;
        }
        case "q":
          setSqlPanelOpen(!sqlPanelOpen);
          break;
        case "l":
          setListPanelOpen(!listPanelOpen);
          break;
        case "v":
          setSmartViewsPanelOpen(!smartViewsPanelOpen);
          break;
        case "delete":
        case "backspace":
          if (selectedElement) {
            hideElement(selectedElement.modelId, selectedElement.expressId);
          }
          break;
        case "h":
          if (selectedElement) hideElement(selectedElement.modelId, selectedElement.expressId);
          break;
        case "a":
          if (e.shiftKey) showAll();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTool, selectedElement, sqlPanelOpen, listPanelOpen, smartViewsPanelOpen,
      setActiveTool, setSelected, clearMeasurements, setSqlPanelOpen, setListPanelOpen,
      setSmartViewsPanelOpen, hideElement, showAll]);

  // ── File loading ──────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = uuidv4();
      const placeholder: IFCModelEntry = {
        id, name: file.name, file,
        mesh: new THREE.Group(),
        visible: true, color: "#7aa2f7", opacity: 1,
        boundingBox: new THREE.Box3(),
        originOffset: new THREE.Vector3(),
        properties: {}, loadedAt: new Date(),
        size: file.size, status: "loading",
        spatialTree: null, elementsByType: {},
      };
      addModel(placeholder);
      setLoadStates(p => new Map(p).set(id, { phase: "Initialisieren", progress: 0, fileName: file.name }));

      try {
        const currentOrigin = useModelStore.getState().worldOrigin;
        const modelIndex = useModelStore.getState().models.size;

        const { entry, newWorldOrigin } = await loadIFCFile(
          file, modelIndex, currentOrigin,
          (p) => setLoadStates(prev => new Map(prev).set(id, { ...p, fileName: file.name }))
        );

        if (!currentOrigin) setWorldOrigin(newWorldOrigin);
        updateModel(id, { ...entry, id, status: "loaded" });
      } catch (err) {
        console.error("[IFC Loader] Fehler beim Laden:", file.name, err);
        updateModel(id, { status: "error", error: String(err) });
      } finally {
        setLoadStates(p => { const n = new Map(p); n.delete(id); return n; });
      }
    }
  }, [addModel, updateModel, setWorldOrigin]);

  const handleRemove = useCallback((id: string) => removeModel(id), [removeModel]);

  const handleFitTo = useCallback((id: string) => {
    const model = useModelStore.getState().models.get(id);
    if (!model) return;
    window.dispatchEvent(new CustomEvent("viewer:fitTo", { detail: model.boundingBox }));
  }, []);

  const handleElementClick = useCallback(async (modelId: string, expressId: number) => {
    const model = useModelStore.getState().models.get(modelId);
    if (!model) return;

    setSelected({ modelId, expressId, properties: {}, psets: [] });

    try {
      const { properties, psets } = await loadIFCProperties(model.file, expressId);
      setSelected({ modelId, expressId, properties, psets });
    } catch {
      // keep empty properties
    }
  }, [setSelected]);

  useMainWindowSync(handleElementClick);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Toolbar */}
      <MainToolbar
        onOpenFiles={handleFiles}
        onFitAll={() => window.dispatchEvent(new Event("viewer:fitAll"))}
        loading={activeLoads > 0}
      />

      {/* Loading bars */}
      {activeLoads > 0 && (
        <div className="flex flex-col gap-px shrink-0">
          {Array.from(loadStates.entries()).map(([id, s]) => (
            <div key={id} className="relative h-0.5 bg-border">
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-all duration-200"
                style={{ width: `${s.progress}%` }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Main 3-column layout */}
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" className="h-full">

          <Panel defaultSize={20} minSize={12} collapsible>
            <div className="h-full overflow-hidden border-r border-border">
              {(listPanelOpen || smartViewsPanelOpen) ? (
                <PanelGroup orientation="vertical" className="h-full">
                  <Panel defaultSize={50} minSize={15}>
                    <div className="h-full overflow-hidden">
                      <HierarchyPanel
                        onFitTo={handleFitTo}
                        onRemove={handleRemove}
                        onSelectElement={handleElementClick}
                      />
                    </div>
                  </Panel>
                  <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-row-resize" />
                  {listPanelOpen && smartViewsPanelOpen ? (
                    <Panel defaultSize={50} minSize={20}>
                      <PanelGroup orientation="vertical" className="h-full">
                        <Panel defaultSize={50} minSize={15}>
                          <div className="h-full overflow-hidden">
                            <LensRulesPanel />
                          </div>
                        </Panel>
                        <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-row-resize" />
                        <Panel defaultSize={50} minSize={15}>
                          <div className="h-full overflow-hidden">
                            <SmartViewsPanel />
                          </div>
                        </Panel>
                      </PanelGroup>
                    </Panel>
                  ) : listPanelOpen ? (
                    <Panel defaultSize={50} minSize={15}>
                      <div className="h-full overflow-hidden">
                        <LensRulesPanel />
                      </div>
                    </Panel>
                  ) : (
                    <Panel defaultSize={50} minSize={15}>
                      <div className="h-full overflow-hidden">
                        <SmartViewsPanel />
                      </div>
                    </Panel>
                  )}
                </PanelGroup>
              ) : (
                <HierarchyPanel
                  onFitTo={handleFitTo}
                  onRemove={handleRemove}
                  onSelectElement={handleElementClick}
                />
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

          <Panel defaultSize={58} minSize={30}>
            <div className="h-full relative overflow-hidden flex flex-col">
              {/* 3D Viewport */}
              <div className="flex-1 relative overflow-hidden min-h-0">
                <ViewportContainer onElementClick={handleElementClick} />
                <ClipPlaneControl />

                {/* Selection basket — floating top-left */}
                <div className="absolute top-3 left-3 z-30 pointer-events-auto">
                  <SelectionBasket onOpenEditor={() => setBasketEditorOpen(true)} />
                </div>

                {!hasModels && activeLoads === 0 && (
                  <LandingOverlay onOpenFiles={handleFiles} loading={false} />
                )}

                {activeLoads > 0 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-none">
                    {Array.from(loadStates.entries()).map(([id, s]) => (
                      <div key={id} className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2.5 shadow-xl text-xs min-w-[280px]">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
                          <span className="text-foreground font-medium truncate">{s.fileName}</span>
                          <span className="text-muted-foreground ml-auto shrink-0">{s.progress}%</span>
                        </div>
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${s.progress}%` }} />
                        </div>
                        <p className="text-muted-foreground mt-1">{s.phase}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SQL Panel (bottom of viewport column) */}
              {sqlPanelOpen && (
                <div className="h-64 shrink-0 border-t border-border">
                  <SQLPanel />
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

          <Panel defaultSize={22} minSize={14} collapsible>
            <div className="h-full overflow-hidden border-l border-border panel-container">
              <PropertiesPanel />
            </div>
          </Panel>

        </PanelGroup>
      </div>

      <StatusBar />

      {basketEditorOpen && (
        <BasketEditor onClose={() => setBasketEditorOpen(false)} />
      )}
    </div>
  );
}
