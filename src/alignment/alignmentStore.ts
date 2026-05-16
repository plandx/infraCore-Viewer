import { create } from "zustand";
import { parseLandXmlText } from "./landXmlParser";
import type { Alignment } from "./types";

const PALETTE = [
  "#ff7043",
  "#42a5f5",
  "#66bb6a",
  "#ffa726",
  "#ab47bc",
  "#26c6da",
  "#ec407a",
  "#ffca28",
];

let moduleNextId = 0;
let paletteIndex = 0;

interface AlignFile {
  id: string;
  fileName: string;
  alignments: Alignment[];
}

interface AlignmentStore {
  files: AlignFile[];
  selectedId: number | null;
  visibleIds: Set<number>;
  colors: Record<number, string>;
  geoOrigin: { x: number; y: number; z: number } | null;
  panelOpen: boolean;

  loadFile(file: File): Promise<void>;
  removeFile(fileId: string): void;
  toggleVisible(id: number): void;
  selectAlignment(id: number | null): void;
  togglePanel(): void;
}

export const useAlignmentStore = create<AlignmentStore>((set, get) => ({
  files: [],
  selectedId: null,
  visibleIds: new Set<number>(),
  colors: {},
  geoOrigin: null,
  panelOpen: false,

  loadFile: async (file: File) => {
    const text = await file.text();
    const parsed = parseLandXmlText(text, file.name, moduleNextId);
    moduleNextId = parsed.nextId;

    if (parsed.alignments.length === 0) return;

    const newColors: Record<number, string> = {};
    const newVisibleIds = new Set(get().visibleIds);

    for (const align of parsed.alignments) {
      newColors[align.id] = PALETTE[paletteIndex % PALETTE.length];
      paletteIndex++;
      newVisibleIds.add(align.id);
    }

    const newFile: AlignFile = {
      id: crypto.randomUUID(),
      fileName: file.name,
      alignments: parsed.alignments,
    };

    set(state => {
      let geoOrigin = state.geoOrigin;
      if (!geoOrigin) {
        const firstSeg = parsed.alignments[0].segments[0];
        if (firstSeg) {
          geoOrigin = {
            x: firstSeg.start.x,
            y: firstSeg.start.y,
            z: firstSeg.start.z ?? 0,
          };
        } else if (parsed.alignments[0].profileGeom.vertices.length > 0) {
          const v = parsed.alignments[0].profileGeom.vertices[0];
          geoOrigin = { x: 0, y: 0, z: v.elev };
        }
      }

      return {
        files: [...state.files, newFile],
        colors: { ...state.colors, ...newColors },
        visibleIds: newVisibleIds,
        geoOrigin,
      };
    });
  },

  removeFile: (fileId: string) => {
    set(state => {
      const fileToRemove = state.files.find(f => f.id === fileId);
      if (!fileToRemove) return state;

      const removedIds = new Set(fileToRemove.alignments.map(a => a.id));
      const newFiles = state.files.filter(f => f.id !== fileId);
      const newColors = { ...state.colors };
      const newVisibleIds = new Set(state.visibleIds);

      for (const id of removedIds) {
        delete newColors[id];
        newVisibleIds.delete(id);
      }

      const selectedId = state.selectedId !== null && removedIds.has(state.selectedId)
        ? null
        : state.selectedId;

      const geoOrigin = newFiles.length === 0 ? null : state.geoOrigin;

      return {
        files: newFiles,
        colors: newColors,
        visibleIds: newVisibleIds,
        selectedId,
        geoOrigin,
      };
    });
  },

  toggleVisible: (id: number) => {
    set(state => {
      const newVisibleIds = new Set(state.visibleIds);
      if (newVisibleIds.has(id)) {
        newVisibleIds.delete(id);
      } else {
        newVisibleIds.add(id);
      }
      return { visibleIds: newVisibleIds };
    });
  },

  selectAlignment: (id: number | null) => {
    set({ selectedId: id });
  },

  togglePanel: () => {
    set(state => ({ panelOpen: !state.panelOpen }));
  },
}));
