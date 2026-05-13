import { useEffect, useMemo } from "react";
import { X, FlipHorizontal2 } from "lucide-react";
import * as THREE from "three";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";

export function ClipPlaneControl() {
  const settings = useModelStore((s) => s.settings);
  const updateSettings = useModelStore((s) => s.updateSettings);
  const models = useModelStore((s) => s.models);

  const sceneBbox = useMemo(() => {
    const box = new THREE.Box3();
    models.forEach((m) => {
      if (m.status === "loaded" && !m.boundingBox.isEmpty()) box.union(m.boundingBox);
    });
    return box;
  }, [models]);

  const [axisMin, axisMax] = useMemo(() => {
    if (sceneBbox.isEmpty()) return [-50, 50];
    switch (settings.clipAxis) {
      case "x": return [sceneBbox.min.x, sceneBbox.max.x];
      case "y": return [sceneBbox.min.y, sceneBbox.max.y];
      case "z": return [sceneBbox.min.z, sceneBbox.max.z];
    }
  }, [sceneBbox, settings.clipAxis]);

  // When clip plane is first enabled or axis changes, set position to midpoint
  useEffect(() => {
    if (!settings.clipPlanes) return;
    const mid = (axisMin + axisMax) / 2;
    updateSettings({ clipPosition: mid });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.clipPlanes, settings.clipAxis]);

  if (!settings.clipPlanes) return null;

  const axes: Array<{ id: "x" | "y" | "z"; label: string; color: string }> = [
    { id: "x", label: "X", color: "text-red-400" },
    { id: "y", label: "Y", color: "text-green-400" },
    { id: "z", label: "Z", color: "text-blue-400" },
  ];

  const range = axisMax - axisMin;
  const step = range > 0 ? range / 1000 : 0.1;

  const posPercent = range > 0
    ? Math.round(((settings.clipPosition - axisMin) / range) * 100)
    : 50;

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="bg-card/95 backdrop-blur border border-border rounded-xl shadow-2xl px-4 py-3 flex flex-col gap-2.5 min-w-[280px]">

        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground flex-1">Schnittebene</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            {settings.clipPosition.toFixed(1)} m
          </span>
          <button
            className="toolbar-button p-1 hover:text-destructive"
            onClick={() => updateSettings({ clipPlanes: false })}
            title="Schnitt deaktivieren"
          >
            <X size={13} />
          </button>
        </div>

        {/* Axis selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground w-10 shrink-0">Achse</span>
          <div className="flex gap-1">
            {axes.map((a) => (
              <button
                key={a.id}
                onClick={() => updateSettings({ clipAxis: a.id })}
                className={cn(
                  "w-8 h-6 rounded text-[11px] font-bold transition-colors",
                  settings.clipAxis === a.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                  settings.clipAxis === a.id && a.color
                )}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Flip direction */}
          <button
            className={cn(
              "ml-auto toolbar-button p-1 text-[11px] gap-1 flex items-center",
              settings.clipFlip && "text-primary"
            )}
            onClick={() => updateSettings({ clipFlip: !settings.clipFlip })}
            title="Schnittrichtung umkehren"
          >
            <FlipHorizontal2 size={13} />
            <span className="text-[10px]">{settings.clipFlip ? "↑" : "↓"}</span>
          </button>
        </div>

        {/* Position slider */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground w-10 shrink-0">
            {posPercent}%
          </span>
          <input
            type="range"
            min={axisMin}
            max={axisMax}
            step={step}
            value={settings.clipPosition}
            onChange={(e) => updateSettings({ clipPosition: parseFloat(e.target.value) })}
            className="flex-1 accent-primary h-1.5 cursor-pointer"
          />
        </div>

        {/* Bounds labels */}
        <div className="flex justify-between text-[9px] text-muted-foreground/50 font-mono -mt-1">
          <span>{axisMin.toFixed(1)}</span>
          <span>{axisMax.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}
