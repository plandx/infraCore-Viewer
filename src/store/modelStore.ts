import { create } from "zustand";
import * as THREE from "three";
import type {
  IFCModelEntry, SelectedElement, ViewerSettings, ActiveTool, Measurement,
  ColorGroup, ColorGroupEntry, SmartView, SmartTier, FlatElementProps, SyncState, BasketMode, PropOverride, QTOList,
} from "../types/ifc";
import { evaluateTier, PALETTE } from "../utils/smartViewUtils";

interface PreSmartViewState {
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
  colorGroups: ColorGroup[] | null;
}

interface ModelStore {
  models: Map<string, IFCModelEntry>;
  worldOrigin: THREE.Vector3 | null;
  selectedElement: SelectedElement | null;
  settings: ViewerSettings;
  activeTool: ActiveTool;
  hiddenElements: Set<string>;
  isolatedElements: Set<string> | null;
  measurements: Measurement[];
  sqlPanelOpen: boolean;
  colorGroups: ColorGroup[] | null;
  listPanelOpen: boolean;
  smartViewsPanelOpen: boolean;

  // SmartViews
  smartViews: SmartView[];
  activeSmartViewId: string | null;
  stagedSmartViewId: string | null;       // highlighted in list, ready for dbl-click apply
  preSmartViewState: PreSmartViewState | null;

  // Shared loaded properties (for ListPanel and SmartViews)
  loadedProperties: Map<string, Map<number, FlatElementProps>> | null;
  loadedPropKeys: string[];

  // Selection basket
  selectionBasket: Set<string>;
  basketMode: BasketMode | null;

  addModel: (model: IFCModelEntry) => void;
  removeModel: (id: string) => void;
  updateModel: (id: string, patch: Partial<IFCModelEntry>) => void;
  setWorldOrigin: (origin: THREE.Vector3) => void;
  setSelected: (element: SelectedElement | null) => void;
  updateSettings: (patch: Partial<ViewerSettings>) => void;
  setActiveTool: (tool: ActiveTool) => void;
  hideElement: (modelId: string, expressId: number) => void;
  hideElements: (modelId: string, expressIds: number[]) => void;
  showElement: (modelId: string, expressId: number) => void;
  showElements: (modelId: string, expressIds: number[]) => void;
  isolateElement: (modelId: string, expressId: number) => void;
  isolateElements: (modelId: string, expressIds: number[]) => void;
  isolateEntries: (entries: Array<{ modelId: string; expressId: number }>) => void;
  showAll: () => void;
  addMeasurement: (m: Measurement) => void;
  clearMeasurements: () => void;
  setSqlPanelOpen: (open: boolean) => void;
  setColorGroups: (groups: ColorGroup[] | null) => void;
  setListPanelOpen: (open: boolean) => void;
  setSmartViewsPanelOpen: (open: boolean) => void;
  qtoPanelOpen: boolean;
  setQTOPanelOpen: (open: boolean) => void;
  qtoLists: QTOList[];
  addQTOList: (list: QTOList) => void;
  updateQTOList: (id: string, patch: Partial<QTOList>) => void;
  removeQTOList: (id: string) => void;

  // SmartView CRUD
  addSmartView: (view: SmartView) => void;
  updateSmartView: (id: string, patch: Partial<SmartView>) => void;
  removeSmartView: (id: string) => void;
  setStagedSmartViewId: (id: string | null) => void;
  applySmartView: (id: string) => void;
  deactivateSmartView: () => void;

  // Property cache
  setLoadedProperties: (
    props: Map<string, Map<number, FlatElementProps>> | null,
    keys: string[],
  ) => void;

  // Selection basket actions
  setBasket: (basket: Set<string>) => void;
  addToBasket: (modelId: string, expressId: number) => void;
  removeFromBasket: (modelId: string, expressId: number) => void;
  clearBasket: () => void;
  setBasketMode: (mode: BasketMode | null) => void;
  basketAutoAdd: boolean;
  setBasketAutoAdd: (v: boolean) => void;

  // In-session property overrides (not synced across windows)
  propertyOverrides: Map<string, Map<number, Record<string, PropOverride>>>;
  applyPropertyEdits: (edits: Array<{ modelId: string; expressId: number; key: string; value: string; ifcType?: number }>) => void;
  clearPropertyOverrides: () => void;

  /** Apply a serialised state snapshot from the main window (secondary windows only). */
  applyRemoteState: (state: SyncState) => void;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  models: new Map(),
  worldOrigin: null,
  selectedElement: null,
  activeTool: "select",
  hiddenElements: new Set(),
  isolatedElements: null,
  measurements: [],
  sqlPanelOpen: false,
  colorGroups: null,
  listPanelOpen: false,
  smartViewsPanelOpen: false,
  qtoPanelOpen: false,
  qtoLists: (() => {
    try {
      const raw = localStorage.getItem("infracore-qto-lists");
      return raw ? (JSON.parse(raw) as QTOList[]) : [];
    } catch { return []; }
  })(),
  smartViews: (() => {
    try {
      const raw = localStorage.getItem("infracore-smartviews");
      return raw ? (JSON.parse(raw) as SmartView[]) : [];
    } catch { return []; }
  })(),
  activeSmartViewId: null,
  stagedSmartViewId: null,
  preSmartViewState: null,
  loadedProperties: null,
  loadedPropKeys: [],
  selectionBasket: new Set<string>(),
  basketMode: null,
  basketAutoAdd: false,
  propertyOverrides: new Map(),
  settings: {
    background: "#1a1b26",
    grid: true,
    axes: true,
    edges: true,
    shadows: false,
    fog: false,
    logDepthBuffer: true,
    clipPlanes: false,
    clipNormal: [0, -1, 0],
    clipPoint: [0, 0, 0],
    theme: "dark",
    showSpaces: false,
    orthographic: false,
  },

  addModel: (model) =>
    set((state) => {
      const next = new Map(state.models);
      next.set(model.id, model);
      return { models: next };
    }),

  removeModel: (id) =>
    set((state) => {
      const next = new Map(state.models);
      next.delete(id);
      return { models: next };
    }),

  updateModel: (id, patch) =>
    set((state) => {
      const existing = state.models.get(id);
      if (!existing) return state;
      const next = new Map(state.models);
      next.set(id, { ...existing, ...patch });
      return { models: next };
    }),

  setWorldOrigin: (origin) => set({ worldOrigin: origin }),
  setSelected: (element) => set({ selectedElement: element }),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  setActiveTool: (tool) => set({ activeTool: tool }),

  hideElement: (modelId, expressId) =>
    set((state) => {
      const key = `${modelId}:${expressId}`;
      if (state.hiddenElements.has(key)) return state;
      const next = new Set(state.hiddenElements);
      next.add(key);
      return { hiddenElements: next };
    }),

  hideElements: (modelId, expressIds) =>
    set((state) => {
      const toAdd = expressIds.filter((eid) => !state.hiddenElements.has(`${modelId}:${eid}`));
      if (toAdd.length === 0) return state;
      const next = new Set(state.hiddenElements);
      for (const eid of toAdd) next.add(`${modelId}:${eid}`);
      return { hiddenElements: next };
    }),

  showElement: (modelId, expressId) =>
    set((state) => {
      const key = `${modelId}:${expressId}`;
      if (!state.hiddenElements.has(key)) return state;
      const next = new Set(state.hiddenElements);
      next.delete(key);
      return { hiddenElements: next };
    }),

  showElements: (modelId, expressIds) =>
    set((state) => {
      const toRemove = expressIds.filter((eid) => state.hiddenElements.has(`${modelId}:${eid}`));
      if (toRemove.length === 0) return state;
      const next = new Set(state.hiddenElements);
      for (const eid of toRemove) next.delete(`${modelId}:${eid}`);
      return { hiddenElements: next };
    }),

  isolateElement: (modelId, expressId) =>
    set({ isolatedElements: new Set([`${modelId}:${expressId}`]) }),

  isolateElements: (modelId, expressIds) =>
    set({ isolatedElements: new Set(expressIds.map((eid) => `${modelId}:${eid}`)) }),

  isolateEntries: (entries) =>
    set({ isolatedElements: new Set(entries.map(({ modelId, expressId }) => `${modelId}:${expressId}`)) }),

  showAll: () => set({ hiddenElements: new Set(), isolatedElements: null }),

  addMeasurement: (m) =>
    set((state) => ({ measurements: [...state.measurements, m] })),

  clearMeasurements: () => set({ measurements: [] }),

  setSqlPanelOpen: (open) => set({ sqlPanelOpen: open }),
  setColorGroups: (groups) => set({ colorGroups: groups }),
  setListPanelOpen: (open) => set({ listPanelOpen: open }),
  setSmartViewsPanelOpen: (open) => set({ smartViewsPanelOpen: open }),

  setQTOPanelOpen: (open) => set({ qtoPanelOpen: open }),

  addQTOList: (list) =>
    set((state) => {
      const qtoLists = [...state.qtoLists, list];
      localStorage.setItem("infracore-qto-lists", JSON.stringify(qtoLists));
      return { qtoLists };
    }),

  updateQTOList: (id, patch) =>
    set((state) => {
      const qtoLists = state.qtoLists.map((l) => l.id === id ? { ...l, ...patch } : l);
      localStorage.setItem("infracore-qto-lists", JSON.stringify(qtoLists));
      return { qtoLists };
    }),

  removeQTOList: (id) =>
    set((state) => {
      const qtoLists = state.qtoLists.filter((l) => l.id !== id);
      localStorage.setItem("infracore-qto-lists", JSON.stringify(qtoLists));
      return { qtoLists };
    }),

  // ── SmartView CRUD ──────────────────────────────────────────────────────────

  addSmartView: (view) =>
    set((state) => {
      const smartViews = [...state.smartViews, view];
      localStorage.setItem("infracore-smartviews", JSON.stringify(smartViews));
      return { smartViews };
    }),

  updateSmartView: (id, patch) =>
    set((state) => {
      const smartViews = state.smartViews.map((v) => v.id === id ? { ...v, ...patch } : v);
      localStorage.setItem("infracore-smartviews", JSON.stringify(smartViews));
      return { smartViews };
    }),

  removeSmartView: (id) =>
    set((state) => {
      const next = state.smartViews.filter((v) => v.id !== id);
      localStorage.setItem("infracore-smartviews", JSON.stringify(next));
      const wasActive = state.activeSmartViewId === id;
      const wasStaged = state.stagedSmartViewId === id;
      return {
        smartViews: next,
        activeSmartViewId: wasActive ? null : state.activeSmartViewId,
        stagedSmartViewId: wasStaged ? null : state.stagedSmartViewId,
        ...(wasActive && state.preSmartViewState ? {
          hiddenElements: state.preSmartViewState.hiddenElements,
          isolatedElements: state.preSmartViewState.isolatedElements,
          colorGroups: state.preSmartViewState.colorGroups,
          preSmartViewState: null,
        } : {}),
      };
    }),

  setStagedSmartViewId: (id) => set({ stagedSmartViewId: id }),

  applySmartView: (id: string) => {
    const state = get();
    const view = state.smartViews.find((v) => v.id === id);
    if (!view) return;

    const pre: PreSmartViewState = {
      hiddenElements: new Set(state.hiddenElements),
      isolatedElements: state.isolatedElements ? new Set(state.isolatedElements) : null,
      colorGroups: state.colorGroups ? [...state.colorGroups] : null,
    };

    const newHidden = new Set(state.hiddenElements);
    const allColorGroups: ColorGroup[] = [];

    const getAllKeys = () => {
      const all = new Set<string>();
      state.models.forEach((model) => {
        for (const elements of Object.values(model.elementsByType))
          for (const el of elements) all.add(`${model.id}:${el.expressId}`);
      });
      return all;
    };

    const toEntries = (keys: Set<string>): ColorGroupEntry[] =>
      Array.from(keys).map((k) => {
        const sep = k.indexOf(":");
        return { modelId: k.slice(0, sep), expressId: parseInt(k.slice(sep + 1)) };
      });

    const pushAutoColorGroups = (tierId: string, matchedProps: Map<string, FlatElementProps>, colorByKey: string) => {
      const groups = new Map<string, ColorGroupEntry[]>();
      for (const [k, props] of matchedProps.entries()) {
        const sep = k.indexOf(":");
        const entry: ColorGroupEntry = { modelId: k.slice(0, sep), expressId: parseInt(k.slice(sep + 1)) };
        const val = String(props[colorByKey] ?? "–");
        if (!groups.has(val)) groups.set(val, []);
        groups.get(val)!.push(entry);
      }
      const sorted = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
      let palIdx = allColorGroups.length;
      for (const [val, entries] of sorted)
        allColorGroups.push({ id: `${tierId}--${val}`, label: val, color: PALETTE[palIdx++ % PALETTE.length], entries, visible: true });
    };

    for (const tier of view.tiers) {
      const matchedKeys = new Set<string>();
      const matchedProps = new Map<string, FlatElementProps>();

      state.models.forEach((model) => {
        const modelProps = state.loadedProperties?.get(model.id);
        for (const [typeName, elements] of Object.entries(model.elementsByType)) {
          for (const el of elements) {
            const props: FlatElementProps = {
              _type: typeName,
              _name: el.name,
              _model: model.name,
              ...(modelProps?.get(el.expressId) ?? {}),
            };
            if (evaluateTier(tier as SmartTier, props)) {
              const key = `${model.id}:${el.expressId}`;
              matchedKeys.add(key);
              matchedProps.set(key, props);
            }
          }
        }
      });

      const entries = toEntries(matchedKeys);

      switch (tier.action) {
        case "add":
          for (const k of matchedKeys) newHidden.delete(k);
          break;
        case "remove":
          for (const k of matchedKeys) newHidden.add(k);
          break;
        case "removeOthers": {
          for (const k of getAllKeys()) if (!matchedKeys.has(k)) newHidden.add(k);
          break;
        }
        case "color":
          if (entries.length > 0)
            allColorGroups.push({ id: tier.id, label: tier.name, color: tier.color, entries, visible: true });
          break;
        case "transparent":
          if (entries.length > 0)
            allColorGroups.push({ id: tier.id, label: tier.name, color: tier.color, entries, visible: true, opacity: tier.opacity });
          break;
        case "opaque":
          if (entries.length > 0)
            allColorGroups.push({ id: tier.id, label: tier.name, color: tier.color, entries, visible: true, opacity: 1 });
          break;
        case "autoColor":
          pushAutoColorGroups(tier.id, matchedProps, tier.colorByKey);
          break;
        case "addAndColor":
          for (const k of matchedKeys) newHidden.delete(k);
          if (entries.length > 0)
            allColorGroups.push({ id: tier.id, label: tier.name, color: tier.color, entries, visible: true });
          break;
        case "addAndTransparent":
          for (const k of matchedKeys) newHidden.delete(k);
          if (entries.length > 0)
            allColorGroups.push({ id: tier.id, label: tier.name, color: tier.color, entries, visible: true, opacity: tier.opacity });
          break;
        case "addAndAutoColor":
          for (const k of matchedKeys) newHidden.delete(k);
          pushAutoColorGroups(tier.id, matchedProps, tier.colorByKey);
          break;
      }
    }

    set({
      activeSmartViewId: id,
      stagedSmartViewId: id,
      preSmartViewState: pre,
      hiddenElements: newHidden,
      isolatedElements: state.isolatedElements,
      colorGroups: allColorGroups.length > 0 ? allColorGroups : null,
    });
  },

  deactivateSmartView: () =>
    set((state) => {
      const pre = state.preSmartViewState;
      return {
        activeSmartViewId: null,
        stagedSmartViewId: null,
        preSmartViewState: null,
        hiddenElements: pre?.hiddenElements ?? new Set(),
        isolatedElements: pre?.isolatedElements ?? null,
        colorGroups: pre?.colorGroups ?? null,
      };
    }),

  // ── Property cache ──────────────────────────────────────────────────────────

  setLoadedProperties: (props, keys) =>
    set({ loadedProperties: props, loadedPropKeys: keys }),

  // ── Selection basket ────────────────────────────────────────────────────────

  setBasket: (basket) => set({ selectionBasket: basket }),

  addToBasket: (modelId, expressId) =>
    set((state) => {
      const next = new Set(state.selectionBasket);
      next.add(`${modelId}:${expressId}`);
      return { selectionBasket: next };
    }),

  removeFromBasket: (modelId, expressId) =>
    set((state) => {
      const next = new Set(state.selectionBasket);
      next.delete(`${modelId}:${expressId}`);
      return { selectionBasket: next };
    }),

  clearBasket: () => set({ selectionBasket: new Set() }),

  setBasketMode: (mode) => set({ basketMode: mode }),
  setBasketAutoAdd: (v) => set({ basketAutoAdd: v }),

  // ── Property overrides ──────────────────────────────────────────────────────

  applyPropertyEdits: (edits) =>
    set((state) => {
      const next = new Map(state.propertyOverrides);
      for (const { modelId, expressId, key, value, ifcType } of edits) {
        const modelMap = new Map(next.get(modelId) ?? []);
        modelMap.set(expressId, { ...(modelMap.get(expressId) ?? {}), [key]: { value, ifcType } });
        next.set(modelId, modelMap);
      }
      return { propertyOverrides: next };
    }),

  clearPropertyOverrides: () => set({ propertyOverrides: new Map() }),

  // ── Remote state sync (secondary windows) ──────────────────────────────────

  applyRemoteState: (state) =>
    set((s) => {
      const models = new Map<string, IFCModelEntry>();
      state.models.forEach((sm) => {
        const existing = s.models.get(sm.id);
        models.set(sm.id, {
          id: sm.id,
          name: sm.name,
          file: sm.file,
          mesh: existing?.mesh ?? new THREE.Group(),
          visible: sm.visible,
          color: sm.color,
          opacity: sm.opacity,
          boundingBox: existing?.boundingBox ?? new THREE.Box3(),
          originOffset: existing?.originOffset ?? new THREE.Vector3(),
          properties: existing?.properties ?? {},
          loadedAt: new Date(),
          size: sm.size,
          status: existing?.status ?? "loaded",
          spatialTree: sm.spatialTree,
          elementsByType: sm.elementsByType,
        });
      });
      return {
        models,
        selectedElement: state.selectedElement,
        settings: state.settings,
        hiddenElements: new Set(state.hiddenElements),
        isolatedElements: state.isolatedElements ? new Set(state.isolatedElements) : null,
        colorGroups: state.colorGroups,
        smartViews: state.smartViews,
        activeSmartViewId: state.activeSmartViewId,
        loadedPropKeys: state.loadedPropKeys,
        selectionBasket: new Set(state.selectionBasket),
        basketMode: state.basketMode,
      };
    }),
}));
