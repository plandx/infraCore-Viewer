import { useEffect, useRef, useCallback } from "react";
import { useModelStore } from "../store/modelStore";
import { loadIFCProperties } from "../utils/ifcLoader";
import { SYNC_CHANNEL, serializeState } from "../utils/windowSync";
import type { SyncMsg, SyncAction, PanelType } from "../utils/windowSync";

import { HierarchyPanel } from "./HierarchyPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { ListPanel } from "./ListPanel";
import { SQLPanel } from "./SQLPanel";

// ── sync hook for secondary windows ──────────────────────────────────────────

function useSecondarySync() {
  const applyRemoteState = useModelStore((s) => s.applyRemoteState);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = ch;

    ch.onmessage = (e: MessageEvent<SyncMsg>) => {
      if (e.data.t === "state") applyRemoteState(e.data.s);
    };

    // Ask main window for current state
    ch.postMessage({ t: "req" } satisfies SyncMsg);

    return () => { ch.close(); channelRef.current = null; };
  }, [applyRemoteState]);

  const sendAction = useCallback((a: SyncAction) => {
    channelRef.current?.postMessage({ t: "act", a } satisfies SyncMsg);
  }, []);

  return { sendAction };
}

// ── panel wrapper ─────────────────────────────────────────────────────────────

export function SecondaryWindow({ panel }: { panel: string }) {
  const { sendAction } = useSecondarySync();

  // Element click: load properties locally + notify main
  const handleElementClick = useCallback(async (modelId: string, expressId: number) => {
    const store = useModelStore.getState();
    const model = store.models.get(modelId);
    store.setSelected({ modelId, expressId, properties: {}, psets: [] });
    sendAction({ k: "select", modelId, expressId });
    if (model?.file) {
      try {
        const { properties, psets } = await loadIFCProperties(model.file, expressId);
        useModelStore.getState().setSelected({ modelId, expressId, properties, psets });
      } catch { /* keep empty */ }
    }
  }, [sendAction]);

  const handleHide = useCallback((modelId: string, expressId: number) => {
    useModelStore.getState().hideElement(modelId, expressId);
    sendAction({ k: "hide", modelId, expressId });
  }, [sendAction]);

  const handleShowAll = useCallback(() => {
    useModelStore.getState().showAll();
    sendAction({ k: "showAll" });
  }, [sendAction]);

  const handleIsolate = useCallback((modelId: string, expressId: number) => {
    useModelStore.getState().isolateElement(modelId, expressId);
    sendAction({ k: "isolate", modelId, expressId });
  }, [sendAction]);

  const handleFitTo = useCallback((id: string) => {
    const model = useModelStore.getState().models.get(id);
    if (model) window.dispatchEvent(new CustomEvent("viewer:fitTo", { detail: model.boundingBox }));
  }, []);

  const panelType = panel as PanelType;

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden text-xs">
      {/* Slim title bar */}
      <div className="flex items-center gap-2 h-8 px-3 shrink-0 border-b border-border bg-card/80 select-none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-primary shrink-0">
          <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="currentColor" opacity="0.3"/>
        </svg>
        <span className="font-semibold text-[11px] text-foreground">infraCore</span>
        <span className="text-muted-foreground text-[10px]">·</span>
        <span className="text-muted-foreground text-[10px]">
          {{ hierarchy: "Hierarchiebaum", properties: "Eigenschaften", lists: "Listen & SmartViews", sql: "SQL-Abfrage" }[panelType] ?? panel}
        </span>
        <div className="flex-1" />
        <SyncIndicator />
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {panelType === "hierarchy" && (
          <HierarchyPanel
            onFitTo={handleFitTo}
            onRemove={() => { /* not supported in secondary */ }}
            onSelectElement={handleElementClick}
            onHideOverride={handleHide}
            onShowAllOverride={handleShowAll}
            onIsolateOverride={handleIsolate}
          />
        )}
        {panelType === "properties" && <PropertiesPanel />}
        {panelType === "lists" && <ListPanel />}
        {panelType === "sql" && <SQLPanel />}
        {!["hierarchy", "properties", "lists", "sql"].includes(panelType) && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Unbekanntes Panel: {panel}
          </div>
        )}
      </div>
    </div>
  );
}

// ── sync indicator ────────────────────────────────────────────────────────────

function SyncIndicator() {
  const models = useModelStore((s) => s.models);
  const hasModels = models.size > 0;
  return (
    <div className="flex items-center gap-1 text-[10px]">
      <div className={`w-1.5 h-1.5 rounded-full ${hasModels ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
      <span className="text-muted-foreground">{hasModels ? "Verbunden" : "Warte auf Hauptfenster…"}</span>
    </div>
  );
}
