import { Archive, Plus, Minus, X, Sparkles, Ghost, ScanEye, Table2, MousePointerClick } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import type { BasketMode } from "../types/ifc";

export function SelectionBasket({ onOpenEditor }: { onOpenEditor?: () => void }) {
  const selectionBasket = useModelStore((s) => s.selectionBasket);
  const basketMode = useModelStore((s) => s.basketMode);
  const selectedElement = useModelStore((s) => s.selectedElement);
  const setBasket = useModelStore((s) => s.setBasket);
  const addToBasket = useModelStore((s) => s.addToBasket);
  const removeFromBasket = useModelStore((s) => s.removeFromBasket);
  const clearBasket = useModelStore((s) => s.clearBasket);
  const setBasketMode = useModelStore((s) => s.setBasketMode);

  const basketAutoAdd = useModelStore((s) => s.basketAutoAdd);
  const setBasketAutoAdd = useModelStore((s) => s.setBasketAutoAdd);

  const count = selectionBasket.size;
  const key = selectedElement ? `${selectedElement.modelId}:${selectedElement.expressId}` : null;
  const hasSelection = key !== null;
  const inBasket = key ? selectionBasket.has(key) : false;

  const handleSet = () => {
    if (!selectedElement) return;
    setBasket(new Set([`${selectedElement.modelId}:${selectedElement.expressId}`]));
  };

  const toggleMode = (mode: BasketMode) => {
    setBasketMode(basketMode === mode ? null : mode);
  };

  return (
    <div
      className="flex items-center gap-1 bg-card/95 backdrop-blur border border-border rounded-lg shadow-xl px-2 py-1.5 select-none text-xs"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Archive size={12} className="text-muted-foreground shrink-0" />
      <span className="text-muted-foreground font-medium">Auswahlkorb</span>
      {count > 0 && (
        <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] font-bold min-w-[18px] text-center">
          {count}
        </span>
      )}

      <div className="w-px h-4 bg-border mx-0.5" />

      <button
        onClick={() => setBasketAutoAdd(!basketAutoAdd)}
        title={basketAutoAdd ? "Auto-Hinzufügen aktiv (klicken zum Deaktivieren)" : "Auto-Hinzufügen: jeder Klick fügt zum Korb hinzu"}
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
          basketAutoAdd
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
            : "hover:bg-muted/60 text-muted-foreground"
        )}
      >
        <MousePointerClick size={11} />
        <span>Auto</span>
      </button>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Operators */}
      <button
        onClick={handleSet}
        disabled={!hasSelection}
        title="Auswahl setzen (=)"
        className="px-2 py-0.5 rounded hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-foreground"
      >=</button>
      <button
        onClick={() => selectedElement && addToBasket(selectedElement.modelId, selectedElement.expressId)}
        disabled={!hasSelection || inBasket}
        title="Zur Auswahl hinzufügen (+)"
        className="px-2 py-0.5 rounded hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-foreground"
      >+</button>
      <button
        onClick={() => selectedElement && removeFromBasket(selectedElement.modelId, selectedElement.expressId)}
        disabled={!hasSelection || !inBasket}
        title="Von Auswahl entfernen (−)"
        className="px-2 py-0.5 rounded hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-foreground"
      >−</button>
      <button
        onClick={() => { clearBasket(); setBasketMode(null); }}
        disabled={count === 0}
        title="Auswahlkorb leeren"
        className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <X size={10} />
      </button>

      {count > 0 && (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Open editor */}
          <button
            onClick={onOpenEditor}
            title="Eigenschaften bearbeiten"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            <Table2 size={11} />
            <span>Bearbeiten</span>
          </button>

          <div className="w-px h-4 bg-border mx-0.5" />
          <button
            onClick={() => toggleMode("highlight")}
            title="Hervorheben"
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
              basketMode === "highlight"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                : "hover:bg-muted/60 text-muted-foreground"
            )}
          >
            <Sparkles size={10} />
            <span>HV</span>
          </button>
          <button
            onClick={() => toggleMode("ghost")}
            title="Invertiert durchsichtig"
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
              basketMode === "ghost"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                : "hover:bg-muted/60 text-muted-foreground"
            )}
          >
            <Ghost size={10} />
            <span>Geist</span>
          </button>
          <button
            onClick={() => toggleMode("isolate")}
            title="Isolieren"
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
              basketMode === "isolate"
                ? "bg-primary/20 text-primary border border-primary/40"
                : "hover:bg-muted/60 text-muted-foreground"
            )}
          >
            <ScanEye size={10} />
            <span>ISO</span>
          </button>
        </>
      )}
    </div>
  );
}
