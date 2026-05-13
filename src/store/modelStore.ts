import { create } from "zustand";
import * as THREE from "three";
import type { IFCModelEntry, SelectedElement, ViewerSettings, ActiveTool, Measurement } from "../types/ifc";

interface ModelStore {
  models: Map<string, IFCModelEntry>;
  worldOrigin: THREE.Vector3 | null;
  selectedElement: SelectedElement | null;
  settings: ViewerSettings;
  activeTool: ActiveTool;
  hiddenElements: Set<string>;      // keys: `${modelId}:${expressId}`
  isolatedElements: Set<string> | null; // null = show all; set = only these
  measurements: Measurement[];
  sqlPanelOpen: boolean;

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
}

export const useModelStore = create<ModelStore>((set) => ({
  models: new Map(),
  worldOrigin: null,
  selectedElement: null,
  activeTool: "select",
  hiddenElements: new Set(),
  isolatedElements: null,
  measurements: [],
  sqlPanelOpen: false,
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

  showAll: () =>
    set({ hiddenElements: new Set(), isolatedElements: null }),

  addMeasurement: (m) =>
    set((state) => ({ measurements: [...state.measurements, m] })),

  clearMeasurements: () => set({ measurements: [] }),

  setSqlPanelOpen: (open) => set({ sqlPanelOpen: open }),
}));
