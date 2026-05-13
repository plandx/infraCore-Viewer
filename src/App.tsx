import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import * as THREE from "three";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";

import { MainToolbar } from "./components/MainToolbar";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { ViewportContainer } from "./components/ViewportContainer";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { StatusBar } from "./components/StatusBar";
import { LandingOverlay } from "./components/LandingOverlay";

import { useModelStore } from "./store/modelStore";
import { loadIFCFile, loadIFCProperties } from "./utils/ifcLoader";
import type { IFCModelEntry } from "./types/ifc";

interface LoadState { phase: string; progress: number; fileName: string }

export default function App() {
  const [loadStates, setLoadStates] = useState<Map<string, LoadState>>(new Map());
  const { addModel, removeModel, updateModel, setWorldOrigin, setSelected, models, settings } = useModelStore();

  const activeLoads = loadStates.size;
  const hasModels = models.size > 0;

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  // Init dark mode on mount
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

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

  const handleRemove = useCallback((id: string) => {
    removeModel(id);
  }, [removeModel]);

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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Toolbar */}
      <MainToolbar
        onOpenFiles={handleFiles}
        onFitAll={() => window.dispatchEvent(new Event("viewer:fitAll"))}
        loading={activeLoads > 0}
      />

      {/* Loading progress bars */}
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

      {/* Main: 3-column resizable layout */}
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" className="h-full">

          {/* Left: Hierarchy */}
          <Panel defaultSize={20} minSize={12} collapsible>
            <div className="h-full overflow-hidden border-r border-border">
              <HierarchyPanel onFitTo={handleFitTo} onRemove={handleRemove} onSelectElement={handleElementClick} />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

          {/* Center: Viewport */}
          <Panel defaultSize={58} minSize={30}>
            <div className="h-full relative overflow-hidden">
              <ViewportContainer onElementClick={handleElementClick} />

              {/* Landing overlay when no models */}
              {!hasModels && activeLoads === 0 && (
                <LandingOverlay onOpenFiles={handleFiles} loading={false} />
              )}

              {/* Per-file loading info overlay */}
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
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

          {/* Right: Properties */}
          <Panel defaultSize={22} minSize={14} collapsible>
            <div className="h-full overflow-hidden border-l border-border panel-container">
              <PropertiesPanel />
            </div>
          </Panel>

        </PanelGroup>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}
