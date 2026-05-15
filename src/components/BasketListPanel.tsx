import { X, Trash2, Focus } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { cn } from "../lib/utils";

export function BasketListPanel({ onSelectElement }: { onSelectElement?: (modelId: string, expressId: number) => void }) {
  const selectionBasket = useModelStore((s) => s.selectionBasket);
  const models = useModelStore((s) => s.models);
  const removeFromBasket = useModelStore((s) => s.removeFromBasket);
  const clearBasket = useModelStore((s) => s.clearBasket);
  const setBasketMode = useModelStore((s) => s.setBasketMode);
  const selectedElement = useModelStore((s) => s.selectedElement);

  const entries = Array.from(selectionBasket).map((key) => {
    const [modelId, expressIdStr] = key.split(":");
    const expressId = parseInt(expressIdStr);
    const model = models.get(modelId);
    if (!model) return null;
    let name = "";
    let typeName = "";
    for (const [type, els] of Object.entries(model.elementsByType)) {
      const el = els.find((e) => e.expressId === expressId);
      if (el) { name = el.name; typeName = type; break; }
    }
    return { key, modelId, expressId, modelName: model.name, modelColor: model.color, name, typeName };
  }).filter(Boolean) as Array<{ key: string; modelId: string; expressId: number; modelName: string; modelColor: string; name: string; typeName: string }>;

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50 shrink-0">
        <span className="font-semibold text-sm text-foreground">Auswahlkorb</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[11px]">{entries.length} Elemente</span>
          {entries.length > 0 && (
            <button
              onClick={() => { clearBasket(); setBasketMode(null); }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
              title="Alle entfernen"
            >
              <Trash2 size={12} /> Alle entfernen
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-[11px] flex-col gap-2 p-6 text-center">
          <p>Der Auswahlkorb ist leer.</p>
          <p className="text-[10px] opacity-60">Elemente über den Auswahlkorb in der Toolbar hinzufügen.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {entries.map((entry) => {
            const isSelected = selectedElement?.modelId === entry.modelId && selectedElement?.expressId === entry.expressId;
            return (
              <div
                key={entry.key}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border/40 hover:bg-muted/30 cursor-pointer group",
                  isSelected && "bg-primary/10"
                )}
                onClick={() => onSelectElement?.(entry.modelId, entry.expressId)}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20"
                  style={{ backgroundColor: entry.modelColor }}
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[11px] text-foreground">{entry.name || entry.typeName}</p>
                  <p className="truncate text-[10px] text-muted-foreground/70">{entry.typeName} · {entry.modelName}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent("viewer:zoomToElement", { detail: { modelId: entry.modelId, expressIds: [entry.expressId] } }));
                    }}
                    className="p-0.5 toolbar-button text-muted-foreground"
                    title="Zoom auf Element"
                  >
                    <Focus size={11} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFromBasket(entry.modelId, entry.expressId); }}
                    className="p-0.5 toolbar-button text-muted-foreground hover:text-destructive"
                    title="Aus Korb entfernen"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
