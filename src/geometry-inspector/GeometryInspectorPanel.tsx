import { useState } from "react";
import { X, Calculator, Save, Square, Minus } from "lucide-react";
import { cn } from "../lib/utils";
import { useBillingStore } from "../billing/billingStore";
import type { InspFace, InspEdge, PickMode } from "./types";

interface Props {
  elementName:     string;
  billingKey:      string | null;
  faces:           InspFace[];
  edges:           InspEdge[];
  selectedFaceIds: Set<number>;
  selectedEdgeIds: Set<number>;
  pickMode:        PickMode;
  onPickModeChange:(m: PickMode) => void;
  onClose:         () => void;
}

const fmt = (n: number, d = 3) => n.toFixed(d).replace(".", ",");

export function GeometryInspectorPanel({
  elementName, billingKey, faces, edges,
  selectedFaceIds, selectedEdgeIds,
  pickMode, onPickModeChange, onClose,
}: Props) {
  const setQuantities = useBillingStore((s) => s.setQuantities);
  const [saved, setSaved] = useState(false);

  const selFaces = faces.filter(f => selectedFaceIds.has(f.id));
  const selEdges = edges.filter(e => selectedEdgeIds.has(e.id));
  const totalArea   = selFaces.reduce((s, f) => s + f.area, 0);

  const handleSave = () => {
    if (!billingKey) return;
    const existing = useBillingStore.getState().entries[billingKey]?.quantities;
    setQuantities(billingKey, {
      volume:      existing?.volume      ?? 0,
      surfaceArea: totalArea > 0 ? totalArea : (existing?.surfaceArea ?? 0),
      bboxX:       selEdges[0]?.length   ?? existing?.bboxX ?? 0,
      bboxY:       selEdges[1]?.length   ?? existing?.bboxY ?? 0,
      bboxZ:       selEdges[2]?.length   ?? existing?.bboxZ ?? 0,
      computedAt:  new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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

      {/* Mode tabs */}
      <div className="flex shrink-0 border-b border-border">
        {(["face", "edge"] as PickMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onPickModeChange(m)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs transition-colors",
              pickMode === m
                ? "bg-primary/15 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:bg-muted/40"
            )}
          >
            {m === "face" ? <Square size={11} /> : <Minus size={11} />}
            {m === "face" ? `Flächen (${faces.length})` : `Kanten (${edges.length})`}
          </button>
        ))}
      </div>

      {/* Hint */}
      <div className="px-3 py-1 bg-primary/5 border-b border-border/50 shrink-0">
        <p className="text-[10px] text-primary/80">
          Klick = wählen ·{" "}
          <kbd className="font-mono bg-primary/10 px-0.5 rounded text-[9px]">Strg</kbd>
          {" "}+ Klick = Mehrfachauswahl
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {pickMode === "face" ? (
          faces.length === 0
            ? <p className="text-xs text-muted-foreground text-center p-4">Keine Flächen erkannt</p>
            : faces.map(f => (
              <div
                key={f.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-xs",
                  selectedFaceIds.has(f.id)
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/30"
                )}
              >
                <span className={cn(
                  "w-3.5 h-3.5 rounded shrink-0 border",
                  selectedFaceIds.has(f.id) ? "bg-[#22cc88] border-[#22cc88]" : "border-border"
                )} />
                <span className="flex-1 text-muted-foreground font-mono text-[10px]">
                  Fläche {f.id + 1}
                </span>
                <span className="font-mono tabular-nums">{fmt(f.area)} m²</span>
              </div>
            ))
        ) : (
          edges.length === 0
            ? <p className="text-xs text-muted-foreground text-center p-4">Keine Kanten erkannt</p>
            : edges.map(e => (
              <div
                key={e.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-xs",
                  selectedEdgeIds.has(e.id)
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/30"
                )}
              >
                <span className={cn(
                  "w-3.5 h-3.5 rounded shrink-0 border",
                  selectedEdgeIds.has(e.id) ? "bg-[#44ff88] border-[#44ff88]" : "border-border"
                )} />
                <span className="flex-1 text-muted-foreground font-mono text-[10px]">
                  Kante {e.id + 1}
                </span>
                <span className="font-mono tabular-nums">{fmt(e.length)} m</span>
              </div>
            ))
        )}
      </div>

      {/* Summary + Save */}
      <div className="px-3 py-2.5 border-t border-border bg-card/90 shrink-0 space-y-1.5">
        {selFaces.length > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              {selFaces.length} Fläche{selFaces.length !== 1 ? "n" : ""}
            </span>
            <span className="font-mono font-semibold text-[#22cc88]">{fmt(totalArea)} m²</span>
          </div>
        )}
        {selEdges.map((e, i) => (
          <div key={e.id} className="flex justify-between text-xs">
            <span className="text-muted-foreground">Kante {i + 1}</span>
            <span className="font-mono font-semibold text-[#44ff88]">{fmt(e.length)} m</span>
          </div>
        ))}
        {selFaces.length === 0 && selEdges.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center">
            Auf Fläche oder Kante klicken
          </p>
        )}
        {billingKey && (selFaces.length > 0 || selEdges.length > 0) && (
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
            {saved ? "Gespeichert ✓" : "In 5D-Eintrag speichern"}
          </button>
        )}
      </div>
    </div>
  );
}
