import { useState } from "react";
import { ChevronRight, ChevronDown, Eye, EyeOff, Trash2, Focus, Layers } from "lucide-react";
import * as THREE from "three";
import { useModelStore } from "../store/modelStore";
import { cn } from "../lib/utils";
import { formatBytes, getSceneExtentKm } from "../utils/coordinateUtils";
import type { IFCModelEntry } from "../types/ifc";

interface Props {
  onFitTo: (id: string) => void;
  onRemove: (id: string) => void;
}

export function HierarchyPanel({ onFitTo, onRemove }: Props) {
  const models = useModelStore((s) => s.models);
  const updateModel = useModelStore((s) => s.updateModel);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const arr = Array.from(models.values());

  if (arr.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Modelle" icon={<Layers size={14} />} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
          <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center">
            <Layers size={24} className="opacity-30" />
          </div>
          <div>
            <p className="text-sm font-medium">Keine Modelle geladen</p>
            <p className="text-xs mt-1 opacity-60">IFC-Dateien über die Toolbar öffnen</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={`Modelle (${arr.length})`}
        icon={<Layers size={14} />}
        actions={
          arr.length > 1 ? (
            <button
              className="toolbar-button p-1"
              title="Alle Modelle anzeigen"
              onClick={() => arr.forEach(m => updateModel(m.id, { visible: true }))}
            >
              <Eye size={13} />
            </button>
          ) : null
        }
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {arr.map((model) => (
          <ModelTreeItem
            key={model.id}
            model={model}
            expanded={expanded.has(model.id)}
            onToggleExpand={() => setExpanded(prev => {
              const next = new Set(prev);
              next.has(model.id) ? next.delete(model.id) : next.add(model.id);
              return next;
            })}
            onToggleVisible={() => updateModel(model.id, { visible: !model.visible })}
            onFitTo={() => onFitTo(model.id)}
            onRemove={() => onRemove(model.id)}
            onOpacityChange={(v) => {
              updateModel(model.id, { opacity: v });
              model.mesh.traverse((obj) => {
                if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshLambertMaterial) {
                  obj.material.opacity = v;
                  obj.material.transparent = v < 1;
                  obj.material.needsUpdate = true;
                }
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ModelTreeItem({
  model, expanded, onToggleExpand, onToggleVisible, onFitTo, onRemove, onOpacityChange,
}: {
  model: IFCModelEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleVisible: () => void;
  onFitTo: () => void;
  onRemove: () => void;
  onOpacityChange: (v: number) => void;
}) {
  const extent = getSceneExtentKm(model.boundingBox);
  const isLoading = model.status === "loading";
  const isError = model.status === "error";

  return (
    <div className={cn(
      "border-b border-border/50 last:border-0",
      !model.visible && "opacity-50",
      isError && "border-l-2 border-l-destructive"
    )}>
      {/* Row */}
      <div className={cn(
        "tree-node hierarchy-item group",
        isLoading && "animate-pulse"
      )}>
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggleExpand}
        >
          {expanded
            ? <ChevronDown size={14} />
            : <ChevronRight size={14} />}
        </button>

        {/* Color dot */}
        <div
          className="shrink-0 w-2.5 h-2.5 rounded-full ring-1 ring-border"
          style={{ backgroundColor: model.color }}
        />

        <span className="flex-1 text-xs truncate text-foreground" title={model.name}>
          {model.name}
        </span>

        {/* Status */}
        {isLoading && (
          <div className="w-3 h-3 border border-primary/40 border-t-primary rounded-full animate-spin shrink-0" />
        )}
        {isError && (
          <span className="text-[10px] text-destructive shrink-0">Fehler</span>
        )}

        {/* Actions (hover) */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button className="toolbar-button p-0.5" onClick={onFitTo} title="Zu Modell zoomen">
            <Focus size={12} />
          </button>
          <button className="toolbar-button p-0.5" onClick={onToggleVisible} title={model.visible ? "Ausblenden" : "Einblenden"}>
            {model.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button className="toolbar-button p-0.5 hover:text-destructive" onClick={onRemove} title="Entfernen">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-6 py-2 bg-muted/30 text-xs space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <span>Größe</span>     <span className="text-foreground">{formatBytes(model.size)}</span>
            <span>Ausdehnung</span> <span className="text-foreground">{extent}</span>
            <span>Status</span>
            <span className={cn(
              model.status === "loaded" && "text-green-400",
              model.status === "loading" && "text-primary",
              model.status === "error" && "text-destructive",
            )}>
              {model.status === "loaded" ? "Geladen" : model.status === "loading" ? "Lädt…" : "Fehler"}
            </span>
            {model.originOffset.lengthSq() > 0 && (
              <>
                <span>Koordinaten-Offset</span>
                <span className="text-foreground font-mono text-[10px]">
                  {model.originOffset.x.toFixed(0)}, {model.originOffset.y.toFixed(0)}
                </span>
              </>
            )}
          </div>

          {/* Opacity */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Transparenz</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={model.opacity}
              onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              className="flex-1 accent-primary h-1"
            />
            <span className="text-foreground w-8 text-right">{Math.round(model.opacity * 100)}%</span>
          </div>

          {/* Color */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Farbe</span>
            <input
              type="color" value={model.color}
              onChange={(e) => useModelStore.getState().updateModel(model.id, { color: e.target.value })}
              className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PanelHeader({ title, icon, actions }: {
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-xs font-semibold text-foreground flex-1">{title}</span>
      {actions}
    </div>
  );
}
