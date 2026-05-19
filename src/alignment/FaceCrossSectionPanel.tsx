import { X, Eye, EyeOff, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { useAlignmentStore } from "./alignmentStore";

export function FaceCrossSectionPanel() {
  const {
    faceCrossSectionActive,
    faceCrossSectionOffset,
    showSectionSurface,
    closeFaceCrossSection,
    setFaceCrossSectionOffset,
    setShowSectionSurface,
  } = useAlignmentStore();

  if (!faceCrossSectionActive) return null;

  const step = 0.1;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
      <div className="bg-card/95 backdrop-blur border border-border rounded-xl shadow-xl px-4 py-2.5 flex items-center gap-3">
        <span className="text-xs font-semibold text-primary whitespace-nowrap">Flächen-QS</span>

        <div className="w-px h-4 bg-border" />

        {/* Offset control */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFaceCrossSectionOffset(faceCrossSectionOffset - step)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Versatz</span>
            <input
              type="number"
              step={step}
              value={faceCrossSectionOffset.toFixed(2)}
              onChange={e => setFaceCrossSectionOffset(parseFloat(e.target.value) || 0)}
              className="w-16 text-center text-xs font-mono px-1.5 py-0.5 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">m</span>
          </div>
          <button
            onClick={() => setFaceCrossSectionOffset(faceCrossSectionOffset + step)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Surface toggle */}
        <button
          onClick={() => setShowSectionSurface(!showSectionSurface)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
            showSectionSurface ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
          title="Schnittebene im 3D anzeigen"
        >
          {showSectionSurface ? <Eye size={13} /> : <EyeOff size={13} />}
          Fläche
        </button>

        <div className="w-px h-4 bg-border" />

        {/* Close */}
        <button
          onClick={() => closeFaceCrossSection()}
          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
