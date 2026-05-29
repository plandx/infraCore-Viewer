import * as THREE from "three";
import { useEffect, useRef, useState } from "react";
import { Triangle, Cpu, Layers } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";

export function StatusBar() {
  const [fps, setFps] = useState(60);
  const [memory, setMemory] = useState<number | null>(null);
  const models = useModelStore((s) => s.models);
  const frameRef = useRef(0);
  const lastRef = useRef(performance.now());
  const countRef = useRef(0);

  // FPS counter
  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      frameRef.current = requestAnimationFrame(tick);
      countRef.current++;
      const now = performance.now();
      const delta = now - lastRef.current;
      if (delta >= 1000) {
        setFps(Math.round((countRef.current * 1000) / delta));
        countRef.current = 0;
        lastRef.current = now;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, []);

  // Memory
  useEffect(() => {
    const update = () => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      if (perf.memory) setMemory(Math.round(perf.memory.usedJSHeapSize / 1024 / 1024));
    };
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, []);

  const loadedModels = Array.from(models.values()).filter(m => m.status === "loaded");
  const totalTriangles = loadedModels.reduce((acc, m) => {
    let tris = 0;
    m.mesh.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const g = obj.geometry;
      if (g?.index) tris += g.index.count / 3;
    });
    return acc + tris;
  }, 0);

  return (
    <div
      className="flex items-center h-6 px-3 gap-4 border-t border-border text-[11px] text-muted-foreground shrink-0 select-none"
      style={{ background: 'var(--ic-surface-2)' }}
    >
      {/* Left */}
      <div className="flex items-center gap-1.5">
        <Layers size={11} />
        <span>
          {loadedModels.length} Modell{loadedModels.length !== 1 ? "e" : ""}
        </span>
      </div>

      {totalTriangles > 0 && (
        <div className="flex items-center gap-1.5">
          <Triangle size={11} />
          <span>{formatNum(totalTriangles)} Dreiecke</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Right */}
      {memory != null && (
        <div className="flex items-center gap-1">
          <Cpu size={11} />
          <span>{memory} MB</span>
        </div>
      )}

      <div className="flex items-center gap-1 font-mono tabular-nums text-muted-foreground">
        <span>{fps}</span>
        <span className="text-muted-foreground">fps</span>
      </div>

      <span className="text-muted-foreground/50">v1.0.0</span>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
