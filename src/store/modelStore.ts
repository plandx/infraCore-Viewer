import { create } from "zustand";
import * as THREE from "three";
import type {
  IFCModelEntry, SelectedElement, ViewerSettings, ActiveTool, Measurement,
  ColorGroup, SmartView, FlatElementProps,
} from "../types/ifc";
import { evaluateSmartView } from "../utils/smartViewUtils";

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

  // SmartViews
  smartViews: SmartView[];
  activeSmartViewId: string | null;
  stagedSmartViewId: string | null;       // highlighted in list, ready for dbl-click apply
  preSmartViewState: PreSmartViewState | null;

  // Shared loaded properties (for ListPanel and SmartViews)
  loadedProperties: Map<string, Map<number, FlatElementProps>> | null;
  loadedPropKeys: string[];

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
  showAll: () => void;
  addMeasurement: (m: Measurement) => void;
  clearMeasurements: () => void;
  setSqlPanelOpen: (open: boolean) => void;
  setColorGroups: (groups: ColorGroup[] | null) => void;
  setListPanelOpen: (open: boolean) => void;

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
  smartViews: [],
  activeSmartViewId: null,
  stagedSmartViewId: null,
  preSmartViewState: null,
  loadedProperties: null,
  loadedPropKeys: [],
  settings: {
    background: "#1a1b26",
    grid: true,
    axes: true,
    edges: false,
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
      const next = new Set(state.hiddenElements);
      next.add(`${modelId}:${expressId}`);
      return { hiddenElements: next };
    }),

  hideElements: (modelId, expressIds) =>
    set((state) => {
      const next = new Set(state.hiddenElements);
      for (const eid of expressIds) next.add(`${modelId}:${eid}`);
      return { hiddenElements: next };
    }),

  showElement: (modelId, expressId) =>
    set((state) => {
      const next = new Set(state.hiddenElements);
      next.delete(`${modelId}:${expressId}`);
      return { hiddenElements: next };
    }),

  showElements: (modelId, expressIds) =>
    set((state) => {
      const next = new Set(state.hiddenElements);
      for (const eid of expressIds) next.delete(`${modelId}:${eid}`);
      return { hiddenElements: next };
    }),

  isolateElement: (modelId, expressId) =>
    set({ isolatedElements: new Set([`${modelId}:${expressId}`]) }),

  isolateElements: (modelId, expressIds) =>
    set({ isolatedElements: new Set(expressIds.map((eid) => `${modelId}:${eid}`)) }),

  showAll: () => set({ hiddenElements: new Set(), isolatedElements: null }),

  addMeasurement: (m) =>
    set((state) => ({ measurements: [...state.measurements, m] })),

  clearMeasurements: () => set({ measurements: [] }),

  setSqlPanelOpen: (open) => set({ sqlPanelOpen: open }),
  setColorGroups: (groups) => set({ colorGroups: groups }),
  setListPanelOpen: (open) => set({ listPanelOpen: open }),

  // ── SmartView CRUD ──────────────────────────────────────────────────────────

  addSmartView: (view) =>
    set((state) => ({ smartViews: [...state.smartViews, view] })),

  updateSmartView: (id, patch) =>
    set((state) => ({
      smartViews: state.smartViews.map((v) => v.id === id ? { ...v, ...patch } : v),
    })),

  removeSmartView: (id) =>
    set((state) => {
      const next = state.smartViews.filter((v) => v.id !== id);
      const wasActive = state.activeSmartViewId === id;
      const wasStaged = state.stagedSmartViewId === id;
      return {
        smartViews: next,
        activeSmartViewId: wasActive ? null : state.activeSmartViewId,
        stagedSmartViewId: wasStaged ? null : state.stagedSmartViewId,
        // Restore visibility state if the deleted view was active
        ...(wasActive && state.preSmartViewState ? {
          hiddenElements: state.preSmartViewState.hiddenElements,
          isolatedElements: state.preSmartViewState.isolatedElements,
          colorGroups: state.preSmartViewState.colorGroups,
          preSmartViewState: null,
        } : {}),
      };
    }),

  setStagedSmartViewId: (id) => set({ stagedSmartViewId: id }),

  applySmartView: (id) => {
    const state = get();
    const view = state.smartViews.find((v) => v.id === id);
    if (!view) return;

    // Save current visibility/color state so we can restore on deactivate
    const preState: PreSmartViewState = {
      hiddenElements: new Set(state.hiddenElements),
      isolatedElements: state.isolatedElements ? new Set(state.isolatedElements) : null,
      colorGroups: state.colorGroups ? [...state.colorGroups] : null,
    };

    // Evaluate rules for every element in every model
    const matches = new Set<string>();
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
          if (evaluateSmartView(view, props)) {
            matches.add(`${model.id}:${el.expressId}`);
          }
        }
      }
    });

    let newHidden = new Set(state.hiddenElements);
    let newIsolated: Set<string> | null = state.isolatedElements;
    let newColorGroups = state.colorGroups;

    if (view.action === "hide") {
      newHidden = new Set([...state.hiddenElements, ...matches]);
    } else if (view.action === "show") {
      newIsolated = matches;
    } else if (view.action === "color") {
      const entries = Array.from(matches).map((k) => {
        const sep = k.indexOf(":");
        return { modelId: k.slice(0, sep), expressId: parseInt(k.slice(sep + 1)) };
      });
      newColorGroups = [{
        id: view.id, label: view.name, color: view.color, entries, visible: true,
      }];
    }

    set({
      activeSmartViewId: id,
      stagedSmartViewId: id,
      preSmartViewState: preState,
      hiddenElements: newHidden,
      isolatedElements: newIsolated,
      colorGroups: newColorGroups,
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
}));
