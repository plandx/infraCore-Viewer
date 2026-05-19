import { useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { X, Play, Loader2, AlertTriangle, ChevronDown, ChevronRight, Download } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import type { IFCModelEntry } from "../types/ifc";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CollisionPair {
  modelIdA: string;
  expressIdA: number;
  nameA: string;
  typeA: string;
  modelIdB: string;
  expressIdB: number;
  nameB: string;
  typeB: string;
  overlapVol: number;  // approximate overlap volume (m³)
  distance: number;    // negative = penetration depth
}

interface MatrixCell {
  typeA: string;
  typeB: string;
  count: number;
  pairs: CollisionPair[];
}

// ── AABB overlap check ─────────────────────────────────────────────────────────

function aabbOverlapVolume(a: THREE.Box3, b: THREE.Box3): number {
  const minX = Math.max(a.min.x, b.min.x), maxX = Math.min(a.max.x, b.max.x);
  const minY = Math.max(a.min.y, b.min.y), maxY = Math.min(a.max.y, b.max.y);
  const minZ = Math.max(a.min.z, b.min.z), maxZ = Math.min(a.max.z, b.max.z);
  if (maxX < minX || maxY < minY || maxZ < minZ) return 0;
  return (maxX - minX) * (maxY - minY) * (maxZ - minZ);
}

function aabbPenetration(a: THREE.Box3, b: THREE.Box3): number {
  const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return -Math.min(ox, oy, oz);
}

// ── Collect element meshes from scene ─────────────────────────────────────────

function collectElements(models: Map<string, IFCModelEntry>): Array<{
  modelId: string; expressId: number; name: string; type: string;
  box: THREE.Box3;
}> {
  const result: Array<{ modelId: string; expressId: number; name: string; type: string; box: THREE.Box3 }> = [];
  for (const [modelId, model] of models) {
    if (!model.visible || model.status !== "loaded") continue;
    // Build index from elementsByType
    const typeByExpr = new Map<number, string>();
    const nameByExpr = new Map<number, string>();
    for (const [type, els] of Object.entries(model.elementsByType)) {
      for (const el of els) {
        typeByExpr.set(el.expressId, type);
        nameByExpr.set(el.expressId, el.name || type);
      }
    }
    model.mesh.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const eid = mesh.userData?.expressId as number | undefined;
      if (!eid) return;
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) return;
      result.push({
        modelId,
        expressId: eid,
        name: nameByExpr.get(eid) ?? `Element ${eid}`,
        type: typeByExpr.get(eid) ?? "Unknown",
        box,
      });
    });
  }
  return result;
}

// ── Collision detection ────────────────────────────────────────────────────────

const MAX_PAIRS = 2000;

function runCollisionDetection(
  models: Map<string, IFCModelEntry>,
  tolerance: number,
  sameModelCheck: boolean,
  ignoreTypes: Set<string>,
  onProgress: (pct: number) => void,
): Promise<CollisionPair[]> {
  return new Promise(resolve => {
    const elements = collectElements(models).filter(e => !ignoreTypes.has(e.type));
    const pairs: CollisionPair[] = [];
    const n = elements.length;
    let i = 0;

    const step = () => {
      const batchEnd = Math.min(i + 50, n);
      for (; i < batchEnd && pairs.length < MAX_PAIRS; i++) {
        const a = elements[i];
        for (let j = i + 1; j < n && pairs.length < MAX_PAIRS; j++) {
          const b = elements[j];
          if (!sameModelCheck && a.modelId === b.modelId) continue;
          const vol = aabbOverlapVolume(a.box, b.box);
          if (vol <= tolerance) continue;
          const pen = aabbPenetration(a.box, b.box);
          pairs.push({
            modelIdA: a.modelId, expressIdA: a.expressId, nameA: a.name, typeA: a.type,
            modelIdB: b.modelId, expressIdB: b.expressId, nameB: b.name, typeB: b.type,
            overlapVol: Math.round(vol * 1000) / 1000,
            distance: Math.round(pen * 1000) / 1000,
          });
        }
      }
      onProgress(Math.round((i / n) * 100));
      if (i < n && pairs.length < MAX_PAIRS) {
        setTimeout(step, 0);
      } else {
        resolve(pairs);
      }
    };
    setTimeout(step, 0);
  });
}

// ── CollisionPanel component ───────────────────────────────────────────────────

interface Props {
  onClose(): void;
}

export function CollisionPanel({ onClose }: Props) {
  const models   = useModelStore(s => s.models);
  const setSelected = useModelStore(s => s.setSelected);

  const [running,      setRunning]      = useState(false);
  const [progress,     setProgress]     = useState(0);
  const [pairs,        setPairs]        = useState<CollisionPair[]>([]);
  const [hasRun,       setHasRun]       = useState(false);
  const [tolerance,    setTolerance]    = useState(0.001);
  const [sameModel,    setSameModel]    = useState(true);
  const [selectedCell, setSelectedCell] = useState<MatrixCell | null>(null);
  const [expandedPair, setExpandedPair] = useState<string | null>(null);

  const IGNORE_DEFAULTS = new Set(["IFCSPACE", "IFCOPENINGELEMENT"]);
  const [ignoreTypes, setIgnoreTypes] = useState<Set<string>>(new Set(IGNORE_DEFAULTS));

  const run = useCallback(async () => {
    setRunning(true);
    setHasRun(false);
    setPairs([]);
    setSelectedCell(null);
    const result = await runCollisionDetection(models, tolerance, sameModel, ignoreTypes, setProgress);
    setPairs(result);
    setRunning(false);
    setHasRun(true);
  }, [models, tolerance, sameModel, ignoreTypes]);

  // Build matrix: type A × type B
  const matrix = useMemo((): MatrixCell[] => {
    const map = new Map<string, MatrixCell>();
    for (const pair of pairs) {
      const key = [pair.typeA, pair.typeB].sort().join("||");
      let cell = map.get(key);
      if (!cell) {
        cell = { typeA: pair.typeA, typeB: pair.typeB, count: 0, pairs: [] };
        map.set(key, cell);
      }
      cell.count++;
      cell.pairs.push(pair);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [pairs]);

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const [, model] of models) {
      for (const t of Object.keys(model.elementsByType)) s.add(t);
    }
    return [...s].sort();
  }, [models]);

  const exportCSV = () => {
    const rows = [
      ["TypeA","NameA","ModelA","TypeB","NameB","ModelB","Overlap (m³)","Penetration (m)"],
      ...pairs.map(p => [p.typeA, p.nameA, p.modelIdA, p.typeB, p.nameB, p.modelIdB, p.overlapVol, p.distance]),
    ];
    const csv = rows.map(r => r.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `collisions-${Date.now()}.csv`;
    a.click();
  };

  const displayPairs = selectedCell ? selectedCell.pairs : pairs.slice(0, 200);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[800px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-foreground">Kollisionsprüfung</h2>
            {hasRun && <span className="text-xs text-muted-foreground">· {pairs.length} Kollisionen</span>}
          </div>
          <div className="flex items-center gap-2">
            {hasRun && pairs.length > 0 && (
              <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">
                <Download size={12} /> CSV
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Settings sidebar */}
          <div className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-4 overflow-y-auto scrollbar-thin">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1.5">
                Toleranz (m³)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={tolerance}
                onChange={e => setTolerance(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sameModel}
                onChange={e => setSameModel(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-foreground">Gleiches Modell prüfen</span>
            </label>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Typen ignorieren
              </p>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto scrollbar-thin">
                {allTypes.map(t => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ignoreTypes.has(t)}
                      onChange={e => {
                        const next = new Set(ignoreTypes);
                        if (e.target.checked) next.add(t); else next.delete(t);
                        setIgnoreTypes(next);
                      }}
                      className="rounded shrink-0"
                    />
                    <span className="text-[10px] text-foreground truncate">{t}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={run}
              disabled={running || models.size === 0}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity mt-auto"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? `${progress}%` : "Prüfung starten"}
            </button>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {!hasRun && !running && (
              <div className="flex-1 flex items-center justify-center text-center text-muted-foreground p-8">
                <div>
                  <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Starte die Kollisionsprüfung mit dem Button links.</p>
                  <p className="text-xs mt-1 opacity-60">Analysiert AABB-Überschneidungen aller sichtbaren Elemente.</p>
                </div>
              </div>
            )}

            {running && (
              <div className="flex-1 flex items-center justify-center flex-col gap-3">
                <Loader2 size={24} className="animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Berechne Kollisionen… {progress}%</p>
                <div className="w-48 h-1 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {hasRun && !running && (
              <div className="flex flex-col min-h-0 overflow-hidden flex-1">
                {/* Matrix */}
                <div className="border-b border-border p-3 shrink-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Kollisionsmatrix {selectedCell && "· Gefiltert"}
                    {selectedCell && (
                      <button onClick={() => setSelectedCell(null)} className="ml-2 text-primary hover:underline">Alle zeigen</button>
                    )}
                  </p>
                  {matrix.length === 0 ? (
                    <p className="text-xs text-green-400 flex items-center gap-1.5">
                      <span>✓</span> Keine Kollisionen gefunden
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto scrollbar-thin">
                      {matrix.map(cell => {
                        const isSelected = selectedCell?.typeA === cell.typeA && selectedCell?.typeB === cell.typeB;
                        return (
                          <button
                            key={`${cell.typeA}||${cell.typeB}`}
                            onClick={() => setSelectedCell(isSelected ? null : cell)}
                            className={cn(
                              "flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-all",
                              isSelected
                                ? "border-amber-400 bg-amber-400/10 text-amber-300"
                                : "border-border text-muted-foreground hover:border-amber-400/50 hover:text-foreground"
                            )}
                          >
                            <span className="opacity-70">{cell.typeA.replace("IFC", "")}</span>
                            <span className="opacity-40">×</span>
                            <span className="opacity-70">{cell.typeB.replace("IFC", "")}</span>
                            <span className={cn(
                              "font-bold ml-0.5",
                              cell.count > 10 ? "text-red-400" : cell.count > 3 ? "text-amber-400" : "text-green-400"
                            )}>
                              {cell.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Pair list */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {displayPairs.map((pair, idx) => {
                    const key = `${pair.modelIdA}:${pair.expressIdA}:${pair.modelIdB}:${pair.expressIdB}`;
                    const expanded = expandedPair === key;
                    return (
                      <div key={idx} className="border-b border-border/50 last:border-0">
                        <button
                          onClick={() => setExpandedPair(expanded ? null : key)}
                          className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/30 text-left transition-colors"
                        >
                          {expanded ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                          <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
                            <div className="min-w-0">
                              <span className="text-[9px] text-amber-400 font-mono">{pair.typeA.replace("IFC","")}</span>
                              <p className="text-xs text-foreground truncate">{pair.nameA}</p>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] text-blue-400 font-mono">{pair.typeB.replace("IFC","")}</span>
                              <p className="text-xs text-foreground truncate">{pair.nameB}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-red-400 font-mono">{pair.overlapVol} m³</p>
                            <p className="text-[9px] text-muted-foreground">{pair.distance} m</p>
                          </div>
                        </button>
                        {expanded && (
                          <div className="px-8 pb-2 text-[10px] text-muted-foreground flex gap-4">
                            <button
                              onClick={() => setSelected({ modelId: pair.modelIdA, expressId: pair.expressIdA, properties: {}, psets: [] })}
                              className="hover:text-primary transition-colors"
                            >
                              → A auswählen
                            </button>
                            <button
                              onClick={() => setSelected({ modelId: pair.modelIdB, expressId: pair.expressIdB, properties: {}, psets: [] })}
                              className="hover:text-primary transition-colors"
                            >
                              → B auswählen
                            </button>
                            <span>Überlapp: {pair.overlapVol} m³</span>
                            <span>Penetration: {Math.abs(pair.distance)} m</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {pairs.length >= MAX_PAIRS && (
                    <p className="text-[10px] text-amber-400/70 text-center py-2 px-4">
                      Ausgabe auf {MAX_PAIRS} Kollisionen begrenzt. Erhöhe die Toleranz oder reduziere die Elemente.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_PAIRS_EXPORT = MAX_PAIRS;
export { MAX_PAIRS_EXPORT as MAX_COLLISION_PAIRS };
