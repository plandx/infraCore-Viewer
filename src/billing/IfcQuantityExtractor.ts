import type { PropertySet } from "../types/ifc";
import type { QuantityItem, QuantityType, QuantityUnit } from "./quantityTypes";
import { QUANTITY_META, qid } from "./quantityTypes";

// ── IFC property name → QuantityType mapping ─────────────────────────────────

const NAME_MAP: Record<string, QuantityType> = {
  // Areas
  GrossArea: "area", NetArea: "area", GrossFloorArea: "area",
  GrossSideArea: "area", NetSideArea: "area", GrossRoofArea: "area",
  GrossProjectedArea: "area", NetProjectedArea: "area",
  // Volumes
  GrossVolume: "volume", NetVolume: "volume", GrossWeight: "volume",
  // Lengths
  Length: "length", GrossLength: "length", NetLength: "length",
  OverallLength: "length", GrossCarpetArea: "length",
  // Perimeter
  Perimeter: "perimeter", GrossPerimeter: "perimeter",
  // Heights
  Height: "height", GrossHeight: "height", NetHeight: "height",
  OverallHeight: "height", ClearHeight: "height", EavesHeight: "height",
  // Widths
  Width: "width", GrossWidth: "width", NetWidth: "width",
  OverallWidth: "width", ClearWidth: "width",
  // Thickness
  Thickness: "thickness", WallThickness: "thickness", SlabThickness: "thickness",
  LayerThickness: "thickness", CoreThickness: "thickness",
  // Slope
  Pitch: "slope", Slope: "slope", RoofAngle: "slope",
  // Count
  NumberOfItems: "count", NumberOfPanels: "count", NumberOfCourses: "count",
  NumberOfRisers: "count", NumberOfTreads: "count",
  // Weight
  MassPerUnitLength: "weight", MassPerUnitArea: "weight",
};

// Qto_ psets have priority over PSet_ for the same type
function psetPriority(name: string): number {
  if (name.startsWith("Qto_")) return 3;
  if (name.startsWith("BaseQuantities")) return 2;
  if (name.startsWith("PSet_") || name.startsWith("Pset_")) return 1;
  return 0;
}

export function extractQuantitiesFromPsets(
  psets: PropertySet[],
): QuantityItem[] {
  // Collect candidates: { type → { item, priority } }
  const candidates = new Map<string, { item: QuantityItem; priority: number }>();

  for (const pset of psets) {
    const priority = psetPriority(pset.name);
    for (const prop of pset.properties) {
      const type = NAME_MAP[prop.name];
      if (!type || prop.value === null || prop.value === undefined) continue;
      const v = Number(prop.value);
      if (isNaN(v) || v === 0) continue;

      const key = `${type}:${prop.name}`;
      const existing = candidates.get(key);
      if (existing && existing.priority >= priority) continue;

      const unit = QUANTITY_META[type].unit as QuantityUnit;
      candidates.set(key, {
        priority,
        item: {
          id: qid(),
          type,
          label: prop.name,
          value: v,
          unit,
          source: "ifc",
          note: pset.name,
        },
      });
    }
  }

  // Deduplicate: one item per (type, name) combination; prefer highest priority
  return [...candidates.values()].map(c => c.item);
}

// ── Type-based labels for common IFC property names (German) ─────────────────

export const IFC_PROP_LABEL: Record<string, string> = {
  GrossArea:          "Bruttofläche",
  NetArea:            "Nettofläche",
  GrossFloorArea:     "Brutto-Grundfläche",
  GrossSideArea:      "Brutto-Seitenfläche",
  GrossVolume:        "Bruttovolumen",
  NetVolume:          "Nettovolumen",
  Length:             "Länge",
  GrossLength:        "Bruttolänge",
  Height:             "Höhe",
  GrossHeight:        "Bruttohöhe",
  Width:              "Breite",
  Thickness:          "Dicke",
  WallThickness:      "Wandstärke",
  Perimeter:          "Umfang",
  GrossPerimeter:     "Brutto-Umfang",
  NumberOfItems:      "Stückzahl",
  Slope:              "Neigung",
  Pitch:              "Dachneigung",
};
