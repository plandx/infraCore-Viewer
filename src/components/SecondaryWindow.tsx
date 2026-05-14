import { useEffect, useRef, useCallback } from "react";
import { useModelStore } from "../store/modelStore";
import { loadIFCProperties } from "../utils/ifcLoader";
import { SYNC_CHANNEL, serializeState } from "../utils/windowSync";
import type { SyncMsg, PanelType } from "../utils/windowSync";

import { HierarchyPanel } from "./HierarchyPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { LensRulesPanel } from "./LensRulesPanel";
import { SmartViewsPanel } from "./SmartViewsPanel";
import { SQLPanel } from "./SQLPanel";

// ── sync hook for secondary windows ──────────────────────────────────────────
// Bidirectional: receives state from main, broadcasts own state changes back.
// applyingRef prevents echo: when we're applying incoming state the subscription
// fires synchronously (Zustand is sync), so we can guard with a simple flag.

function useSecondarySync() {
  const applyRemoteState = useModelStore((s) => s.applyRemoteState);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = ch;

    ch.onmessage = (e: MessageEvent<SyncMsg>) => {
      if (e.data.t === "state") {
        applyingRef.current = true;
        applyRemoteState(e.data.s);
        applyingRef.current = false;
      }
    };

    // Broadcast every local store change back to main (skip echo-induced changes)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useModelStore.subscribe(() => {
      if (applyingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        ch.postMessage({ t: "state", s: serializeState(useModelStore.getState()) } satisfies SyncMsg);
      }, 80);
    });

    ch.postMessage({ t: "req" } satisfies SyncMsg);

    return () => {
      ch.close();
      channelRef.current = null;
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [applyRemoteState]);
}

// ── panel wrapper ─────────────────────────────────────────────────────────────

export function SecondaryWindow({ panel }: { panel: string }) {
  useSecondarySync();

  const theme = useModelStore((s) => s.settings.theme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Load properties locally so the secondary's own PropertiesPanel works.
  // The state sync broadcasts the selection (including properties) to main.
  const handleElementClick = useCallback(async (modelId: string, expressId: number) => {
    const store = useModelStore.getState();
    store.setSelected({ modelId, expressId, properties: {}, psets: [] });
    const model = store.models.get(modelId);
    if (model?.file) {
      try {
        const { properties, psets } = await loadIFCProperties(model.file, expressId);
        useModelStore.getState().setSelected({ modelId, expressId, properties, psets });
      } catch { /* keep empty */ }
    }
  }, []);

  // No 3D viewport in secondary — fit-to is a no-op
  const handleFitTo = useCallback(() => { /* no viewport */ }, []);

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
          {{ hierarchy: "Hierarchiebaum", properties: "Eigenschaften", lists: "Lens Rules", smartviews: "SmartViews", sql: "SQL-Abfrage" }[panelType] ?? panel}
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
          />
        )}
        {panelType === "properties" && <PropertiesPanel />}
        {panelType === "lists" && <LensRulesPanel />}
        {panelType === "smartviews" && <SmartViewsPanel />}
        {panelType === "sql" && <SQLPanel />}
        {!["hierarchy", "properties", "lists", "smartviews", "sql"].includes(panelType) && (
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
