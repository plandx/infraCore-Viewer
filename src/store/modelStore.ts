import { create } from "zustand";
import * as THREE from "three";
import type { IFCModelEntry, SelectedElement, ViewerSettings } from "../types/ifc";

interface ModelStore {
  models: Map<string, IFCModelEntry>;
  worldOrigin: THREE.Vector3 | null;
  selectedElement: SelectedElement | null;
  hoveredModelId: string | null;
  settings: ViewerSettings;

  addModel: (model: IFCModelEntry) => void;
  removeModel: (id: string) => void;
  updateModel: (id: string, patch: Partial<IFCModelEntry>) => void;
  setWorldOrigin: (origin: THREE.Vector3) => void;
  setSelected: (element: SelectedElement | null) => void;
  setHovered: (id: string | null) => void;
  updateSettings: (patch: Partial<ViewerSettings>) => void;
  getVisibleModels: () => IFCModelEntry[];
}

export const useModelStore = create<ModelStore>((set, get) => ({
  models: new Map(),
  worldOrigin: null,
  selectedElement: null,
  hoveredModelId: null,
  settings: {
    background: "#1a1a2e",
    grid: true,
    axes: true,
    edges: false,
    shadows: false,
    fog: false,
    logDepthBuffer: true,
    clipPlanes: false,
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

  setHovered: (id) => set({ hoveredModelId: id }),

  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),

  getVisibleModels: () => {
    const { models } = get();
    return Array.from(models.values()).filter((m) => m.visible);
  },
}));
