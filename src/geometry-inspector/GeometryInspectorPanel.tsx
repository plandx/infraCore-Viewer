import { useState } from "react";
import { X, Calculator, Save, Square, Minus, Eye, EyeOff, ScanEye, Trash2, ExternalLink } from "lucide-react";
import { cn } from "../lib/utils";
import { useBillingStore } from "../billing/billingStore";
import { qid, QUANTITY_META, fmtQty } from "../billing/quantityTypes";
import type { QuantityItem, QuantityType, QuantitySource } from "../billing/quantityTypes";
import type { InspFace, InspFaceBoundary, InspEdge, PickMode } from "./types";

interface Props {
  elementName:         string;
  billingKey:          string | null;
  expressId:           number;
  modelId:             string;
  ifcType:             string;
  faces:               InspFace[];
  boundaries:          InspFaceBoundary[];
  edges:               InspEdge[];
  selectedFaceIds:     Set<number>;
  selectedBoundaryIds: Set<number>;
  selectedEdgeIds:     Set<number>;
  pickMode:            PickMode;
  onPickModeChange:    (m: PickMode) => void;
  showMesh:            boolean;
  onToggleShowMesh:    () => void;
  onClose:             () => void;
  onClearSelection:    () => void;
  onOpen5D?:           () => void;
}

// Which stored QuantityTypes belong to each tab
const AREA_TYPES_SET      = new Set<QuantityType>(["area", "openingArea", "netArea"]);
const PERIMETER_TYPES_SET = new Set<QuantityType>(["perimeter"]);
const LENGTH_TYPES_SET    = new Set<QuantityType>(["length", "height", "width", "thickness", "axisLength"]);

// Dropdown options per measurement kind
const AREA_OPTIONS: { type: QuantityType; label: string }[] = [
  { type: "area",        label: "Fläche (m²)" },
  { type: "openingArea", label: "Öffnung / Abzug (m²)" },
];

const LENGTH_OPTIONS: { type: QuantityType; label: string }[] = [
  { type: "length",     label: "Länge / lfm (m)" },
  { type: "perimeter",  label: "Umfang / Perimeter (m)" },
  { type: "height",     label: "Höhe (m)" },
  { type: "width",      label: "Breite (m)" },
  { type: "thickness",  label: "Dicke / Schichtstärke (m)" },
  { type: "axisLength", label: "Achslänge (m)" },
];

// Preset label suggestions per QuantityType
const LABEL_PRESETS: Partial<Record<QuantityType, string[]>> = {
  area:        ["Wandfläche", "Bodenfläche", "Deckenfläche", "Dachfläche", "Fassadenfläche", "Schalfläche", "Belagsfläche"],
  openingArea: ["Fensteröffnung", "Türöffnung", "Durchbruch", "Aussparung", "Schacht"],
  length:      ["Leitung", "Profil", "Fuge", "Kante", "Geländer", "Anschlusslinie"],
  perimeter:   ["Randabschluss", "Sockelleiste", "Anschlussbereich"],
  height:      ["Wandhöhe", "Einbauhöhe", "lichte Höhe"],
  width:       ["Elementbreite", "lichte Weite"],
  thickness:   ["Wandstärke", "Schichtstärke", "Einbaustärke"],
  axisLength:  ["Trassenlänge", "Achsmaß"],
};

const SOURCE_COLOR: Record<QuantitySource, string> = {
  ifc:      "text-sky-400 bg-sky-400/10 border-sky-400/30",
  geometry: "text-violet-400 bg-violet-400/10 border-violet-400/30",
  measured: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  manual:   "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
};
const SOURCE_LABEL: Record<QuantitySource, string> = { ifc: "IFC", geometry: "GEO", measured: "MESS", manual: "MAN" };

const fmt = (n: number, d = 3) => n.toFixed(d).replace(".", ",");

// ── Saved item row ─────────────────────────────────────────────────────────────

function SavedItemRow({ item, onDelete }: { item: QuantityItem; onDelete: () => void }) {
  const typeMeta = QUANTITY_META[item.type];
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 group hover:bg-muted/20 transition-colors">
      <span className={cn("text-[8px] font-bold px-1 py-0.5 rounded border shrink-0 leading-tight", SOURCE_COLOR[item.source])}>
        {SOURCE_LABEL[item.source]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-foreground truncate">{item.label}</p>
        <p className="text-[9px] text-muted-foreground/60">{typeMeta.label}</p>
      </div>
      <span className="font-mono text-[10px] tabular-nums shrink-0 text-muted-foreground">
        {fmtQty(item.value, item.unit)}
      </span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all shrink-0"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

// ── Saved section divider + list ──────────────────────────────────────────────

function SavedSection({ items, onDelete }: { items: QuantityItem[]; onDelete: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="px-3 py-1 bg-muted/30 border-y border-border/40 flex items-center gap-1.5 sticky top-0 z-10">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Im 5D-Eintrag
        </span>
        <span className="text-[9px] text-muted-foreground/50 ml-auto">{items.length} Position{items.length !== 1 ? "en" : ""}</span>
      </div>
      {items.map(item => (
        <SavedItemRow key={item.id} item={item} onDelete={() => onDelete(item.id)} />
      ))}
    </>
  );
}

// ── Measure card (type assignment + presets + label) ──────────────────────────

function MeasureCard({
  value, unit, defaultLabel, accentColor, options, type, onTypeChange, label, onLabelChange,
}: {
  value: number;
  unit: string;
  defaultLabel: string;
  accentColor: string;
  options: { type: QuantityType; label: string }[];
  type: QuantityType;
  onTypeChange: (t: QuantityType) => void;
  label: string;
  onLabelChange: (s: string) => void;
}) {
  const presets = LABEL_PRESETS[type] ?? [];

  return (
    <div className={cn("rounded-lg p-2 space-y-1.5 border bg-muted/20", accentColor)}>
      <div className="flex items-center gap-1.5">
        <select
          value={type}
          onChange={e => { onTypeChange(e.target.value as QuantityType); onLabelChange(""); }}
          className="flex-1 min-w-0 text-[10px] px-1.5 py-0.5 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {options.map(o => <option key={o.type} value={o.type}>{o.label}</option>)}
        </select>
        <span className="font-mono text-xs font-semibold shrink-0 tabular-nums">
          {fmt(value)} {unit}
        </span>
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map(p => (
            <button
              key={p}
              onClick={() => onLabelChange(label === p ? "" : p)}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded border transition-colors",
                label === p
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder={defaultLabel}
        value={label}
        onChange={e => onLabelChange(e.target.value)}
        className="w-full text-[10px] px-1.5 py-0.5 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

const EMPTY_ITEMS: QuantityItem[] = [];

// ── Main panel ────────────────────────────────────────────────────────────────

export function GeometryInspectorPanel({
  elementName, billingKey, expressId, modelId, ifcType,
  faces, boundaries, edges,
  selectedFaceIds, selectedBoundaryIds, selectedEdgeIds,
  pickMode, onPickModeChange,
  showMesh, onToggleShowMesh, onClose, onClearSelection, onOpen5D,
}: Props) {
  const [saved, setSaved] = useState(false);

  const [faceType,  setFaceType]  = useState<QuantityType>("area");
  const [faceLabel, setFaceLabel] = useState("");
  const [boundaryTypes,  setBoundaryTypes]  = useState<Record<number, QuantityType>>({});
  const [boundaryLabels, setBoundaryLabels] = useState<Record<number, string>>({});
  const [edgeType,  setEdgeType]  = useState<QuantityType>("length");
  const [edgeLabel, setEdgeLabel] = useState("");

  // Live-read stored items for this element
  const storedItems = useBillingStore(s =>
    billingKey ? (s.entries[billingKey]?.quantitySet?.items ?? EMPTY_ITEMS) : EMPTY_ITEMS
  );
  const savedAreaItems      = storedItems.filter(i => AREA_TYPES_SET.has(i.type));
  const savedPerimeterItems = storedItems.filter(i => PERIMETER_TYPES_SET.has(i.type));
  const savedLengthItems    = storedItems.filter(i => LENGTH_TYPES_SET.has(i.type));

  const handleDeleteItem = (id: string) => {
    if (!billingKey) return;
    useBillingStore.getState().removeQuantityItem(billingKey, id);
  };

  const selFaces      = faces.filter(f => selectedFaceIds.has(f.id));
  const selBoundaries = boundaries.filter(b => selectedBoundaryIds.has(b.id));
  const selEdges      = edges.filter(e => selectedEdgeIds.has(e.id));
  const totalArea       = selFaces.reduce((s, f) => s + f.area, 0);
  const totalEdgeLength = selEdges.reduce((s, e) => s + e.length, 0);

  const canSave = billingKey && (selFaces.length > 0 || selBoundaries.length > 0 || selEdges.length > 0);

  const handleSave = () => {
    if (!billingKey) return;
    useBillingStore.getState().addEntry({ key: billingKey, guid: billingKey, expressId, modelId, elementName, ifcType });

    if (selFaces.length > 0) {
      const type = faceType;
      useBillingStore.getState().addQuantityItem(billingKey, {
        type, source: "measured",
        label: faceLabel.trim() || `${selFaces.length} Fläche${selFaces.length !== 1 ? "n" : ""} (Inspektor)`,
        value: totalArea,
        unit: QUANTITY_META[type].unit,
        isDeduction: type === "openingArea",
      });
    }

    selBoundaries.forEach((b, i) => {
      const type = boundaryTypes[b.id] ?? "perimeter";
      useBillingStore.getState().addQuantityItem(billingKey, {
        type, source: "measured",
        label: (boundaryLabels[b.id] ?? "").trim() || `Umrandung ${i + 1} (Inspektor)`,
        value: b.totalLength,
        unit: QUANTITY_META[type].unit,
      });
    });

    if (selEdges.length > 0) {
      const type = edgeType;
      useBillingStore.getState().addQuantityItem(billingKey, {
        type, source: "measured",
        label: edgeLabel.trim() || (selEdges.length === 1 ? "Kante (Inspektor)" : `${selEdges.length} Kanten (Inspektor)`),
        value: totalEdgeLength,
        unit: QUANTITY_META[type].unit,
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Tab badge: saved count per tab
  const tabSavedCount: Record<PickMode, number> = {
    face:     savedAreaItems.length,
    boundary: savedPerimeterItems.length,
    edge:     savedLengthItems.length,
  };

  const tabs: { mode: PickMode; label: string; count: number }[] = [
    { mode: "face",     label: "Flächen",     count: faces.length },
    { mode: "boundary", label: "Umrandungen", count: boundaries.length },
    { mode: "edge",     label: "Kanten",      count: edges.length },
  ];

  return (
    <div className="absolute top-4 right-4 z-40 w-72 flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden max-h-[calc(100%-2rem)]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-card border-b border-border shrink-0">
        <Calculator size={14} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{elementName}</p>
          <p className="text-[10px] text-muted-foreground">Geometrie-Inspektor</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Mesh visibility toggle */}
      <button
        onClick={onToggleShowMesh}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors border-b border-border shrink-0",
          showMesh
            ? "bg-primary/10 text-primary hover:bg-primary/20"
            : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
      >
        {showMesh ? <Eye size={12} /> : <EyeOff size={12} />}
        <span className="flex-1 text-left">
          {showMesh ? "Objekt eingeblendet" : "Objekt ausgeblendet"}
        </span>
        <ScanEye size={11} className="opacity-50" />
      </button>

      {/* Mode tabs */}
      <div className="flex shrink-0 border-b border-border">
        {tabs.map(({ mode, label, count }) => (
          <button
            key={mode}
            onClick={() => onPickModeChange(mode)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] transition-colors relative",
              pickMode === mode
                ? "bg-primary/15 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:bg-muted/40"
            )}
          >
            {mode === "face" ? <Square size={10} /> : <Minus size={10} />}
            {label} ({count})
            {tabSavedCount[mode] > 0 && (
              <span className="absolute top-0.5 right-1 text-[8px] font-bold text-amber-400">
                {tabSavedCount[mode]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Hint */}
      <div className="px-3 py-1 bg-primary/5 border-b border-border/50 shrink-0">
        <p className="text-[10px] text-primary/80">
          {pickMode === "boundary"
            ? "Klick auf Fläche oder Kante = Umrandung wählen"
            : pickMode === "edge"
            ? "Klick = auswählen · Doppelklick = verbundene Kanten"
            : "Klick = auswählen"
          }
          {" · "}
          <kbd className="font-mono bg-primary/10 px-0.5 rounded text-[9px]">Strg</kbd>
          {" "}+ Mehrfachauswahl
        </p>
      </div>

      {/* Element list + saved section */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {pickMode === "face" && (
          <>
            {faces.length === 0
              ? <p className="text-xs text-muted-foreground text-center p-4">Keine Flächen erkannt</p>
              : faces.map(f => (
                <div key={f.id} className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-xs",
                  selectedFaceIds.has(f.id) ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/30"
                )}>
                  <span className={cn("w-3 h-3 rounded shrink-0 border",
                    selectedFaceIds.has(f.id) ? "bg-[#22cc88] border-[#22cc88]" : "border-border")} />
                  <span className="flex-1 text-muted-foreground font-mono text-[10px]">Fläche {f.id + 1}</span>
                  <span className="font-mono tabular-nums">{fmt(f.area)} m²</span>
                </div>
              ))
            }
            {billingKey && (
              <SavedSection items={savedAreaItems} onDelete={handleDeleteItem} />
            )}
          </>
        )}

        {pickMode === "boundary" && (
          <>
            {boundaries.length === 0
              ? <p className="text-xs text-muted-foreground text-center p-4">Keine Umrandungen erkannt</p>
              : boundaries.map(b => (
                <div key={b.id} className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-xs",
                  selectedBoundaryIds.has(b.id) ? "bg-orange-500/10 border-l-2 border-l-orange-400" : "hover:bg-muted/30"
                )}>
                  <span className={cn("w-3 h-3 rounded shrink-0 border",
                    selectedBoundaryIds.has(b.id) ? "bg-[#ff8800] border-[#ff8800]" : "border-border")} />
                  <span className="flex-1 text-muted-foreground font-mono text-[10px]">Umrandung {b.id + 1}</span>
                  <span className="font-mono tabular-nums">{fmt(b.totalLength)} m</span>
                </div>
              ))
            }
            {billingKey && (
              <SavedSection items={savedPerimeterItems} onDelete={handleDeleteItem} />
            )}
          </>
        )}

        {pickMode === "edge" && (
          <>
            {edges.length === 0
              ? <p className="text-xs text-muted-foreground text-center p-4">Keine Kanten erkannt</p>
              : edges.map(e => (
                <div key={e.id} className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-xs",
                  selectedEdgeIds.has(e.id) ? "bg-orange-500/10 border-l-2 border-l-orange-400" : "hover:bg-muted/30"
                )}>
                  <span className={cn("w-3 h-3 rounded shrink-0 border",
                    selectedEdgeIds.has(e.id) ? "bg-[#ff8800] border-[#ff8800]" : "border-border")} />
                  <span className="flex-1 text-muted-foreground font-mono text-[10px]">Kante {e.id + 1}</span>
                  <span className="font-mono tabular-nums">{fmt(e.length)} m</span>
                </div>
              ))
            }
            {billingKey && (
              <SavedSection items={savedLengthItems} onDelete={handleDeleteItem} />
            )}
          </>
        )}
      </div>

      {/* Type-assignment + Save */}
      <div className="px-3 pt-2.5 pb-3 border-t border-border bg-card/90 shrink-0">
        {!canSave ? (
          <p className="text-[10px] text-muted-foreground text-center py-1">
            Auf Fläche, Umrandung oder Kante klicken
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              LV-Grundgröße zuordnen &amp; hinzufügen
            </p>

            {selFaces.length > 0 && (
              <MeasureCard
                value={totalArea}
                unit="m²"
                defaultLabel={`${selFaces.length} Fläche${selFaces.length !== 1 ? "n" : ""} (Inspektor)`}
                accentColor="border-[#22cc88]/25"
                options={AREA_OPTIONS}
                type={faceType}
                onTypeChange={setFaceType}
                label={faceLabel}
                onLabelChange={setFaceLabel}
              />
            )}

            {selBoundaries.map((b, i) => (
              <MeasureCard
                key={b.id}
                value={b.totalLength}
                unit="m"
                defaultLabel={`Umrandung ${i + 1} (Inspektor)`}
                accentColor="border-[#ff8800]/25"
                options={LENGTH_OPTIONS}
                type={boundaryTypes[b.id] ?? "perimeter"}
                onTypeChange={t => setBoundaryTypes(prev => ({ ...prev, [b.id]: t }))}
                label={boundaryLabels[b.id] ?? ""}
                onLabelChange={s => setBoundaryLabels(prev => ({ ...prev, [b.id]: s }))}
              />
            ))}

            {selEdges.length > 0 && (
              <MeasureCard
                value={totalEdgeLength}
                unit="m"
                defaultLabel={selEdges.length === 1 ? "Kante (Inspektor)" : `${selEdges.length} Kanten (Inspektor)`}
                accentColor="border-[#ff8800]/25"
                options={LENGTH_OPTIONS}
                type={edgeType}
                onTypeChange={setEdgeType}
                label={edgeLabel}
                onLabelChange={setEdgeLabel}
              />
            )}

            <button
              onClick={handleSave}
              className={cn(
                "w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-all",
                saved
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              )}
            >
              <Save size={11} />
              {saved ? "Hinzugefügt ✓" : "In 5D-Eintrag hinzufügen"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
