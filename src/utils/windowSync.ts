import type { SyncState, ColorGroup, ViewerSettings, BasketMode } from "../types/ifc";

export const SYNC_CHANNEL = "infracore-sync";

// ── Message protocol ──────────────────────────────────────────────────────────

export type SyncAction =
  | { k: "select";             modelId: string; expressId: number }
  | { k: "hide";               modelId: string; expressId: number }
  | { k: "showAll" }
  | { k: "isolate";            modelId: string; expressId: number }
  | { k: "colorGroups";        groups: ColorGroup[] | null }
  | { k: "applySmartView";     id: string }
  | { k: "deactivateSmartView" }
  | { k: "settings";           patch: Partial<ViewerSettings> }
  | { k: "fitAll" };

export type SyncMsg =
  | { t: "state"; s: SyncState }  // main → secondaries: full state push
  | { t: "req" }                  // new secondary → main: request current state
  | { t: "act"; a: SyncAction };  // secondary → main: user action

// ── Serialisation ─────────────────────────────────────────────────────────────

/** Produce a structured-clone-safe snapshot of the store's mutable state. */
export function serializeState(store: {
  models: Map<string, {
    id: string; name: string; file: File; visible: boolean; color: string;
    opacity: number; size: number;
    elementsByType: Record<string, unknown>;
    spatialTree: unknown;
    status: string;
  }>;
  selectedElement: unknown;
  settings: unknown;
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
  colorGroups: unknown;
  smartViews: unknown;
  activeSmartViewId: string | null;
  loadedPropKeys: string[];
  selectionBasket: Set<string>;
  basketMode: unknown;
  sectionPlanes: unknown;
}): SyncState {
  const models: SyncState["models"] = [];
  store.models.forEach((m) => {
    if (m.status === "loaded") {
      models.push({
        id: m.id, name: m.name, file: m.file,
        visible: m.visible, color: m.color, opacity: m.opacity, size: m.size,
        elementsByType: m.elementsByType as SyncState["models"][0]["elementsByType"],
        spatialTree: m.spatialTree as SyncState["models"][0]["spatialTree"],
      });
    }
  });
  return {
    models,
    selectedElement: store.selectedElement as SyncState["selectedElement"],
    settings: store.settings as SyncState["settings"],
    hiddenElements: Array.from(store.hiddenElements),
    isolatedElements: store.isolatedElements ? Array.from(store.isolatedElements) : null,
    colorGroups: store.colorGroups as SyncState["colorGroups"],
    smartViews: store.smartViews as SyncState["smartViews"],
    activeSmartViewId: store.activeSmartViewId,
    loadedPropKeys: store.loadedPropKeys,
    selectionBasket: Array.from(store.selectionBasket),
    basketMode: store.basketMode as BasketMode | null,
    sectionPlanes: store.sectionPlanes as SyncState["sectionPlanes"],
  };
}

// ── Window-open helpers ───────────────────────────────────────────────────────

export type PanelType = "hierarchy" | "properties" | "lists" | "smartviews" | "sql" | "qto" | "basket";

export const PANEL_META: Record<PanelType, { label: string; w: number; h: number }> = {
  hierarchy:  { label: "Hierarchiebaum",      w: 380, h: 700 },
  properties: { label: "Eigenschaften",       w: 420, h: 600 },
  lists:      { label: "Lens Rules",          w: 480, h: 640 },
  smartviews: { label: "SmartViews",          w: 480, h: 680 },
  sql:        { label: "SQL-Abfrage",         w: 760, h: 480 },
  qto:        { label: "Listen / Mengen",     w: 900, h: 640 },
  basket:     { label: "Auswahlkorb",         w: 380, h: 600 },
};

export function openSecondaryWindow(panel: PanelType) {
  const { w, h } = PANEL_META[panel];
  const url = `${window.location.pathname}?secondary&panel=${panel}`;
  window.open(url, `infracore-${panel}`, `width=${w},height=${h},resizable=yes`);
}
