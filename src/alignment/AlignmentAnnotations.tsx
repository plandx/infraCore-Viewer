import { MapPin, Crosshair, Tag, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import { useAlignmentStore } from "./alignmentStore";

function formatStation(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m  = sta - km * 1000;
  return `${km}+${m.toFixed(0).padStart(3, "0")}`;
}

export function AlignmentAnnotations() {
  const files                = useAlignmentStore(s => s.files);
  const stationLabelVisible  = useAlignmentStore(s => s.stationLabelVisible);
  const stationLabelInterval = useAlignmentStore(s => s.stationLabelInterval);
  const labelToolActive      = useAlignmentStore(s => s.labelToolActive);
  const offsetToolActive     = useAlignmentStore(s => s.offsetToolActive);
  const placedLabels         = useAlignmentStore(s => s.placedLabels);
  const offsetMeasurements   = useAlignmentStore(s => s.offsetMeasurements);

  const toggleStationLabels    = useAlignmentStore(s => s.toggleStationLabels);
  const setStationLabelInterval = useAlignmentStore(s => s.setStationLabelInterval);
  const toggleLabelTool        = useAlignmentStore(s => s.toggleLabelTool);
  const toggleOffsetTool       = useAlignmentStore(s => s.toggleOffsetTool);
  const removePlacedLabel      = useAlignmentStore(s => s.removePlacedLabel);
  const removeOffsetMeasurement = useAlignmentStore(s => s.removeOffsetMeasurement);
  const clearAllAnnotations    = useAlignmentStore(s => s.clearAllAnnotations);

  if (files.length === 0) return null;

  const hasAnnotations = placedLabels.length > 0 || offsetMeasurements.length > 0;

  return (
    <div className="border-t border-border pt-2 pb-3 px-2 flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Beschriftungen
        </span>
        {hasAnnotations && (
          <button
            onClick={clearAllAnnotations}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-red-400 transition-colors"
          >
            <Trash2 size={10} />
            Alle löschen
          </button>
        )}
      </div>

      {/* ── Stationierungsintervalle ─────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={toggleStationLabels}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors",
            stationLabelVisible
              ? "bg-sky-600 text-white"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          <Tag size={11} />
          Stationierung beschriften
        </button>
        {stationLabelVisible && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Intervall:</span>
            <select
              value={stationLabelInterval}
              onChange={e => setStationLabelInterval(Number(e.target.value))}
              className="flex-1 bg-muted border border-border text-foreground text-xs rounded px-1 py-0.5"
            >
              {[10, 25, 50, 100, 250, 500, 1000].map(v => (
                <option key={v} value={v}>{v} m</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Punkt setzen (XYZ + Station) ─────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={toggleLabelTool}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors",
            labelToolActive
              ? "bg-amber-500 text-white"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          <MapPin size={11} />
          Punkt setzen (X / Y / Z + Station)
        </button>
        {labelToolActive && (
          <p className="text-[10px] text-amber-400 italic px-0.5">
            Auf Achse klicken — setzt Beschriftung mit Koordinaten und Stationierung
          </p>
        )}

        {placedLabels.length > 0 && (
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {placedLabels.map(lbl => (
              <div
                key={lbl.id}
                className="flex items-start gap-1.5 bg-muted/40 rounded px-1.5 py-1.5 text-[10px] border border-border/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold text-sky-400 mb-0.5">
                    {formatStation(lbl.station)}
                  </div>
                  <div className="text-muted-foreground text-[9px] truncate mb-0.5">
                    {lbl.alignmentName}
                  </div>
                  <div className="font-mono text-[9px] leading-snug text-foreground/80">
                    <span className="text-muted-foreground">X </span>{lbl.easting.toFixed(3)}<br />
                    <span className="text-muted-foreground">Y </span>{lbl.northing.toFixed(3)}<br />
                    {lbl.elevation !== null && (
                      <><span className="text-muted-foreground">Z </span>{lbl.elevation.toFixed(3)}</>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removePlacedLabel(lbl.id)}
                  className="text-muted-foreground hover:text-red-400 shrink-0 mt-0.5 transition-colors"
                  aria-label="Label entfernen"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Absetzmass messen ────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={toggleOffsetTool}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors",
            offsetToolActive
              ? "bg-green-600 text-white"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          <Crosshair size={11} />
          Absetzmass messen
        </button>
        {offsetToolActive && (
          <p className="text-[10px] text-green-400 italic px-0.5">
            Auf Modell klicken — misst Station und Querabstand zur Achse
          </p>
        )}

        {offsetMeasurements.length > 0 && (
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {offsetMeasurements.map(m => (
              <div
                key={m.id}
                className="flex items-start gap-1.5 bg-muted/40 rounded px-1.5 py-1.5 text-[10px] border border-border/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold text-green-400 mb-0.5">
                    {formatStation(m.station)}
                  </div>
                  <div className="text-muted-foreground text-[9px] truncate mb-0.5">
                    {m.alignmentName}
                  </div>
                  <div className="font-mono text-[9px]">
                    <span className={m.offset >= 0 ? "text-blue-400" : "text-orange-400"}>
                      {m.offset >= 0 ? "R" : "L"}&nbsp;{Math.abs(m.offset).toFixed(3)} m
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => removeOffsetMeasurement(m.id)}
                  className="text-muted-foreground hover:text-red-400 shrink-0 mt-0.5 transition-colors"
                  aria-label="Messung entfernen"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
