// ── Quantity types, units, and metadata for LB-VI / ÖNORM quantity takeoff ───

export type QuantityType =
  | "length"       // Länge [m / lfm]
  | "area"         // Fläche [m²]
  | "volume"       // Volumen [m³]
  | "perimeter"    // Umfang [m]
  | "count"        // Stückzahl [Stk]
  | "weight"       // Gewicht [kg]
  | "height"       // Höhe [m]
  | "width"        // Breite [m]
  | "thickness"    // Dicke / Schichtstärke [m]
  | "slope"        // Neigung [%]
  | "openingArea"  // Öffnungs-/Aussparungsfläche [m²] (Abzug)
  | "netArea"      // Nettofläche [m²] (nach Abzügen)
  | "netVolume"    // Nettovolumen [m³] (nach Abzügen)
  | "axisLength";  // Achslänge / Trassenlänge [m]

export type QuantityUnit = "m" | "m²" | "m³" | "Stk" | "kg" | "t" | "%";

export type QuantitySource = "ifc" | "geometry" | "measured" | "manual";

export interface QuantityItem {
  id: string;
  type: QuantityType;
  label: string;
  value: number;
  unit: QuantityUnit;
  source: QuantitySource;
  note?: string;
  isDeduction?: boolean;
  /** Set by GeometryInspector to track which geometric selection created this item. */
  inspectorGeom?: "face" | "boundary" | "edge";
}

export interface QuantitySet {
  items: QuantityItem[];
  updatedAt: string;
}

// ── Metadata per type ────────────────────────────────────────────────────────

interface QuantityMeta {
  label: string;
  unit: QuantityUnit;
  description: string;
}

export const QUANTITY_META: Record<QuantityType, QuantityMeta> = {
  length:      { label: "Länge",          unit: "m",   description: "Leitungen, Profile, Fugen, Kanten, Geländer" },
  area:        { label: "Fläche",         unit: "m²",  description: "Wand, Boden, Decke, Dach, Fassade, Schalung" },
  volume:      { label: "Volumen",        unit: "m³",  description: "Beton, Aushub, Hinterfüllung, Dämmung, Schüttung" },
  perimeter:   { label: "Umfang",         unit: "m",   description: "Randabschlüsse, Sockelleisten, Anschlussbereiche" },
  count:       { label: "Stückzahl",      unit: "Stk", description: "Türen, Fenster, Geräte, Armaturen, Einbauteile" },
  weight:      { label: "Gewicht",        unit: "kg",  description: "Stahlbau, Bewehrung, metallische Konstruktionen" },
  height:      { label: "Höhe",           unit: "m",   description: "Wandhöhen, Einbauhöhen, lichte Höhe" },
  width:       { label: "Breite",         unit: "m",   description: "Elementbreiten, lichte Weite" },
  thickness:   { label: "Dicke",          unit: "m",   description: "Schichtstärken, Wandstärken, Einbaustärken" },
  slope:       { label: "Neigung",        unit: "%",   description: "Dächer, Leitungsführungen, Trassenverläufe" },
  openingArea: { label: "Öffnungen (Abzug)", unit: "m²", description: "Durchbrüche, Schächte, Aussparungen" },
  netArea:     { label: "Nettofläche",    unit: "m²",  description: "Fläche nach Abzug der Öffnungen" },
  netVolume:   { label: "Nettovolumen",   unit: "m³",  description: "Volumen nach Abzügen" },
  axisLength:  { label: "Achslänge",      unit: "m",   description: "Trassenverläufe, Leitungsführungen, Achsmaße" },
};

export const SOURCE_LABEL: Record<QuantitySource, string> = {
  ifc:      "IFC",
  geometry: "GEO",
  measured: "MESS",
  manual:   "MAN",
};

export const SOURCE_COLOR: Record<QuantitySource, string> = {
  ifc:      "text-sky-400 bg-sky-400/10 border-sky-400/30",
  geometry: "text-violet-400 bg-violet-400/10 border-violet-400/30",
  measured: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  manual:   "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
};

// ── Derived computations ─────────────────────────────────────────────────────

export function computeDerivedQuantities(items: QuantityItem[]): QuantityItem[] {
  const derived: QuantityItem[] = [];

  const totalArea      = items.filter(i => i.type === "area"     && !i.isDeduction).reduce((s, i) => s + i.value, 0);
  const totalOpenings  = items.filter(i => i.type === "openingArea").reduce((s, i) => s + i.value, 0);
  const totalVolume    = items.filter(i => i.type === "volume"   && !i.isDeduction).reduce((s, i) => s + i.value, 0);

  if (totalArea > 0 && totalOpenings > 0) {
    derived.push({
      id: "__netArea",
      type: "netArea",
      label: "Nettofläche",
      value: Math.max(0, totalArea - totalOpenings),
      unit: "m²",
      source: "geometry",
    });
  }
  if (totalVolume > 0 && totalOpenings > 0) {
    derived.push({
      id: "__netVolume",
      type: "netVolume",
      label: "Nettovolumen",
      value: Math.max(0, totalVolume),
      unit: "m³",
      source: "geometry",
    });
  }

  return derived;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function qid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function fmtQty(value: number, unit: QuantityUnit): string {
  const d = unit === "Stk" ? 0 : unit === "%" ? 1 : 3;
  return value.toFixed(d).replace(".", ",") + " " + unit;
}

// Groups items by type (aggregated sum per type for the same source)
export function groupByType(items: QuantityItem[]): Map<QuantityType, QuantityItem[]> {
  const map = new Map<QuantityType, QuantityItem[]>();
  for (const item of items) {
    const arr = map.get(item.type) ?? [];
    arr.push(item);
    map.set(item.type, arr);
  }
  return map;
}
