import { create } from "zustand";
import { parseLandXmlText } from "./landXmlParser";
import type { Alignment } from "./types";
import type { SectionLine, SectionPolygon } from "./crossSectionUtils";
import { buildSectionPolygons } from "./crossSectionUtils";
import type { XSSyncObjectLabel } from "../utils/windowSync";

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

export interface PlacedLabel {
  id: string;
  alignmentId: number;
  alignmentName: string;
  station: number;
  easting: number;   // real-world Easting (LandXML x)
  northing: number;  // real-world Northing (LandXML y)
  elevation: number | null; // real-world Elevation (LandXML z)
  worldX: number;    // Three.js scene X
  worldY: number;    // Three.js scene Y
  worldZ: number;    // Three.js scene Z
}

export interface OffsetMeasurement {
  id: string;
  alignmentId: number;
  alignmentName: string;
  station: number;
  offset: number;          // signed horizontal offset (+ = right, - = left)
  clickWorldX: number;     // Three.js scene coords of click point
  clickWorldY: number;
  clickWorldZ: number;
  footWorldX: number;      // Three.js scene coords of foot on alignment
  footWorldY: number;
  footWorldZ: number;
}

interface AlignmentStore {
  files: AlignFile[];
  selectedId: number | null;
  visibleIds: Set<number>;
  colors: Record<number, string>;
  geoOrigin: { x: number; y: number; z: number } | null;
  panelOpen: boolean;
  sampleInterval: number;
  stationToolActive: boolean;
  hoveredStation: { alignmentId: number; station: number; name: string } | null;

  profileHoverStation: number | null;
  profileHoverAlignmentId: number | null;

  // Cross-section state
  crossSectionOpen: boolean;
  crossSectionStation: number | null;
  crossSectionAlignmentId: number | null;
  crossSectionMode: "vertical" | "normal";
  crossSectionLines: SectionLine[];
  crossSectionPolygons: SectionPolygon[];
  crossSectionBasis: { origin: [number,number,number]; right: [number,number,number]; up: [number,number,number]; normal: [number,number,number] } | null;
  crossSectionComputing: boolean;
  showSectionSurface: boolean;
  crossSectionObjectLabels: XSSyncObjectLabel[];

  // Annotation state
  stationLabelVisible: boolean;
  stationLabelInterval: number;
  labelToolActive: boolean;
  offsetToolActive: boolean;
  placedLabels: PlacedLabel[];
  offsetMeasurements: OffsetMeasurement[];

  loadFile(file: File): Promise<void>;
  removeFile(fileId: string): void;
  toggleVisible(id: number): void;
  selectAlignment(id: number | null): void;
  togglePanel(): void;
  setSampleInterval(n: number): void;
  toggleStationTool(): void;
  setHoveredStation(info: { alignmentId: number; station: number; name: string } | null): void;
  setProfileHover(alignmentId: number | null, station: number | null): void;

  // Cross-section actions
  openCrossSection(alignmentId: number, station: number): void;
  closeCrossSection(): void;
  setCrossSectionStation(alignmentId: number, station: number): void;
  setCrossSectionMode(mode: "vertical" | "normal"): void;
  setCrossSectionResult(lines: SectionLine[], basis?: AlignmentStore["crossSectionBasis"]): void;
  setCrossSectionObjectLabels(labels: XSSyncObjectLabel[]): void;
  setShowSectionSurface(v: boolean): void;

  // Annotation actions
  toggleStationLabels(): void;
  setStationLabelInterval(n: number): void;
  toggleLabelTool(): void;
  toggleOffsetTool(): void;
  addPlacedLabel(l: PlacedLabel): void;
  removePlacedLabel(id: string): void;
  addOffsetMeasurement(m: OffsetMeasurement): void;
  removeOffsetMeasurement(id: string): void;
  clearAllAnnotations(): void;
}

export const useAlignmentStore = create<AlignmentStore>((set, get) => ({
  files: [],
  selectedId: null,
  visibleIds: new Set<number>(),
  colors: {},
  geoOrigin: null,
  panelOpen: false,
  sampleInterval: 5,
  stationToolActive: false,
  hoveredStation: null,
  profileHoverStation: null,
  profileHoverAlignmentId: null,
  crossSectionOpen: false,
  crossSectionStation: null,
  crossSectionAlignmentId: null,
  crossSectionMode: "vertical",
  crossSectionLines: [],
  crossSectionPolygons: [],
  crossSectionBasis: null,
  crossSectionComputing: false,
  showSectionSurface: false,
  crossSectionObjectLabels: [],

  stationLabelVisible: false,
  stationLabelInterval: 100,
  labelToolActive: false,
  offsetToolActive: false,
  placedLabels: [],
  offsetMeasurements: [],

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

    set(state => {
      let geoOrigin = state.geoOrigin;
      if (!geoOrigin) {
        const firstAlign = parsed.alignments[0];
        const firstSeg = firstAlign.segments[0];
        if (firstSeg) {
          geoOrigin = {
            x: firstSeg.start.x,
            y: firstSeg.start.y,
            z: firstSeg.start.z ?? firstAlign.profileGeom.vertices[0]?.elev ?? 0,
          };
        }
      }

      const newFile: AlignFile = {
        id: crypto.randomUUID(),
        fileName: file.name,
        alignments: parsed.alignments,
      };

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

      return {
        files: newFiles,
        colors: newColors,
        visibleIds: newVisibleIds,
        selectedId:
          state.selectedId !== null && removedIds.has(state.selectedId)
            ? null
            : state.selectedId,
        geoOrigin: newFiles.length === 0 ? null : state.geoOrigin,
        placedLabels: state.placedLabels.filter(l => !removedIds.has(l.alignmentId)),
        offsetMeasurements: state.offsetMeasurements.filter(m => !removedIds.has(m.alignmentId)),
      };
    });
  },

  toggleVisible: (id: number) => {
    set(state => {
      const next = new Set(state.visibleIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { visibleIds: next };
    });
  },

  selectAlignment: (id: number | null) => set({ selectedId: id }),

  togglePanel: () => set(state => ({ panelOpen: !state.panelOpen })),

  setSampleInterval: (n) => set({ sampleInterval: n }),
  toggleStationTool: () => set(state => ({ stationToolActive: !state.stationToolActive })),
  setHoveredStation: (info) => set({ hoveredStation: info }),
  setProfileHover: (alignmentId, station) => set({ profileHoverAlignmentId: alignmentId, profileHoverStation: station }),

  openCrossSection: (alignmentId, station) => set({ crossSectionOpen: true, crossSectionStation: station, crossSectionAlignmentId: alignmentId, crossSectionComputing: true, crossSectionLines: [], crossSectionPolygons: [], crossSectionBasis: null, crossSectionObjectLabels: [] }),
  closeCrossSection: () => set({ crossSectionOpen: false }),
  setCrossSectionStation: (alignmentId, station) => set({ crossSectionStation: station, crossSectionAlignmentId: alignmentId, crossSectionComputing: true, crossSectionLines: [], crossSectionPolygons: [], crossSectionBasis: null, crossSectionObjectLabels: [] }),
  setCrossSectionMode: (mode) => set({ crossSectionMode: mode, crossSectionComputing: true, crossSectionLines: [], crossSectionPolygons: [], crossSectionBasis: null, crossSectionObjectLabels: [] }),
  setCrossSectionResult: (lines, basis) => set({ crossSectionLines: lines, crossSectionPolygons: buildSectionPolygons(lines), crossSectionBasis: basis ?? null, crossSectionComputing: false }),
  setCrossSectionObjectLabels: (labels) => set({ crossSectionObjectLabels: labels }),
  setShowSectionSurface: (v) => set({ showSectionSurface: v }),

  toggleStationLabels: () => set(state => ({ stationLabelVisible: !state.stationLabelVisible })),
  setStationLabelInterval: (n) => set({ stationLabelInterval: n }),
  toggleLabelTool: () => set(state => ({
    labelToolActive: !state.labelToolActive,
    offsetToolActive: false,
    stationToolActive: false,
  })),
  toggleOffsetTool: () => set(state => ({
    offsetToolActive: !state.offsetToolActive,
    labelToolActive: false,
    stationToolActive: false,
  })),
  addPlacedLabel: (l) => set(state => ({ placedLabels: [...state.placedLabels, l] })),
  removePlacedLabel: (id) => set(state => ({ placedLabels: state.placedLabels.filter(l => l.id !== id) })),
  addOffsetMeasurement: (m) => set(state => ({ offsetMeasurements: [...state.offsetMeasurements, m] })),
  removeOffsetMeasurement: (id) => set(state => ({ offsetMeasurements: state.offsetMeasurements.filter(m => m.id !== id) })),
  clearAllAnnotations: () => set({ placedLabels: [], offsetMeasurements: [] }),
}));
