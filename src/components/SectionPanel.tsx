import { useMemo, useState, useEffect } from "react";
import * as THREE from "three";
import { X, FlipHorizontal2, Eye, EyeOff, Camera, Trash2, Box, Crosshair } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useModelStore } from "../store/modelStore";
import { useShallow } from "zustand/react/shallow";
import type { SectionPlane } from "../types/ifc";
import { cn } from "../lib/utils";

const SECTION_COLORS = ["#1f77d8", "#cf3f37", "#198754", "#ea7a1d", "#6e59cf", "#0891b2"];

function getSceneBox(models: Map<string, { boundingBox: THREE.Box3 }>): THREE.Box3 {
  const box = new THREE.Box3();
  models.forEach((m) => { if (!m.boundingBox.isEmpty()) box.union(m.boundingBox); });
  return box;
}

function nextColor(planes: SectionPlane[]): string {
  return SECTION_COLORS[planes.length % SECTION_COLORS.length];
}

export const SECTION_COLORS_EXPORT = SECTION_COLORS;

export function SectionPanel() {
  const models = useModelStore((s) => s.models);
  const sectionPlanes = useModelStore((s) => s.sectionPlanes);
  const activeTool = useModelStore((s) => s.activeTool);
  const selectedElement = useModelStore((s) => s.selectedElement);
  const { addSectionPlane, updateSectionPlane, removeSectionPlane, clearSectionPlanes, setActiveTool } =
    useModelStore(useShallow((s) => ({
      addSectionPlane: s.addSectionPlane,
      updateSectionPlane: s.updateSectionPlane,
      removeSectionPlane: s.removeSectionPlane,
      clearSectionPlanes: s.clearSectionPlanes,
      setActiveTool: s.setActiveTool,
    })));

  const { sceneCenter, sceneRadius } = useMemo(() => {
    const box = getSceneBox(models);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 50 : box.getSize(new THREE.Vector3()).length() / 2;
    return { sceneCenter: center, sceneRadius: Math.max(radius, 5) };
  }, [models]);

  const [visualsHidden, setVisualsHidden] = useState(false);

  // Sync hidden state to ViewportContainer via event; reset when panel unmounts
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("viewer:sectionVisualsHidden", { detail: false }));
    return () => {
      window.dispatchEvent(new CustomEvent("viewer:sectionVisualsHidden", { detail: false }));
    };
  }, []);

  const toggleVisuals = () => {
    const next = !visualsHidden;
    setVisualsHidden(next);
    window.dispatchEvent(new CustomEvent("viewer:sectionVisualsHidden", { detail: next }));
  };

  const isActive = sectionPlanes.length > 0 || activeTool === "section";
  if (!isActive) return null;

  const addAxisPreset = (normal: [number, number, number], label: string) => {
    const planes = useModelStore.getState().sectionPlanes;
    addSectionPlane({
      id: uuidv4(),
      name: `Schnitt ${label}`,
      normal,
      point: [sceneCenter.x, sceneCenter.y, sceneCenter.z],
      enabled: true,
      color: nextColor(planes),
    });
  };

  const addBoxSection = () => {
    let box = new THREE.Box3();

    // Prefer bounding box of the selected element, fall back to entire scene
    if (selectedElement) {
      const model = models.get(selectedElement.modelId);
      if (model) {
        model.mesh.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.userData.expressId === selectedElement.expressId) {
            box.expandByObject(obj);
          }
        });
      }
    }
    if (box.isEmpty()) box = getSceneBox(models);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));

    // Small padding so the element fits snugly inside the box
    const sz = box.getSize(new THREE.Vector3());
    box.expandByScalar(Math.max(sz.length() * 0.04, 0.1));

    const mn = box.min, mx = box.max;
    const cx = (mn.x + mx.x) / 2, cy = (mn.y + mx.y) / 2, cz = (mn.z + mx.z) / 2;
    const boxId = uuidv4();
    const COL = "#1f77d8";
    clearSectionPlanes();
    const boxPlanes: SectionPlane[] = [
      { id: uuidv4(), boxId, name: "Box +X", normal: [1, 0, 0],  point: [mx.x, cy, cz], enabled: true, color: COL },
      { id: uuidv4(), boxId, name: "Box −X", normal: [-1, 0, 0], point: [mn.x, cy, cz], enabled: true, color: COL },
      { id: uuidv4(), boxId, name: "Box +Y", normal: [0, 1, 0],  point: [cx, mx.y, cz], enabled: true, color: COL },
      { id: uuidv4(), boxId, name: "Box −Y", normal: [0, -1, 0], point: [cx, mn.y, cz], enabled: true, color: COL },
      { id: uuidv4(), boxId, name: "Box +Z", normal: [0, 0, 1],  point: [cx, cy, mx.z], enabled: true, color: COL },
      { id: uuidv4(), boxId, name: "Box −Z", normal: [0, 0, -1], point: [cx, cy, mn.z], enabled: true, color: COL },
    ];
    boxPlanes.forEach((p) => addSectionPlane(p));
  };

  const getOffset = (plane: SectionPlane): number => {
    const P = new THREE.Vector3(...plane.point);
    const N = new THREE.Vector3(...plane.normal);
    return P.clone().sub(sceneCenter).dot(N);
  };

  const setOffset = (plane: SectionPlane, offset: number) => {
    const N = new THREE.Vector3(...plane.normal);
    const newP = sceneCenter.clone().addScaledVector(N, offset);
    updateSectionPlane(plane.id, { point: [newP.x, newP.y, newP.z] });
  };

  const flipPlane = (plane: SectionPlane) => {
    const N: [number, number, number] = [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
    updateSectionPlane(plane.id, { normal: N });
  };

  const alignCamera = (plane: SectionPlane) => {
    window.dispatchEvent(new CustomEvent("viewer:alignToPlane", {
      detail: { normal: plane.normal, point: plane.point },
    }));
  };

  const sliderRange = sceneRadius * 1.5;

  return (
    <div
      className="absolute top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-auto select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-background border border-border rounded-[6px] shadow-[0_2px_8px_rgba(0,0,0,0.12)] overflow-hidden min-w-[460px] max-w-[640px]" style={{ fontFamily: '"Segoe UI Variable","Segoe UI",system-ui,sans-serif' }}>
        {/* Top bar */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-muted/10">
          <span className="text-[12px] font-semibold text-foreground pr-2 border-r border-border mr-1">
            Schnitt
          </span>

          {/* Section-from-face tool toggle */}
          <button
            onClick={() => setActiveTool(activeTool === "section" ? "select" : "section")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] border transition-colors",
              activeTool === "section"
                ? "bg-primary/10 text-primary border-primary/40"
                : "border-border text-muted-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] hover:text-foreground"
            )}
            title={activeTool === "section" ? "Schnitt-Werkzeug deaktivieren" : "Schnitt auf Fläche klicken"}
          >
            <Crosshair size={10} />
            <span>Fläche</span>
          </button>

          <div className="w-px h-3.5 bg-border mx-0.5" />

          {/* Axis presets */}
          {([ ["+X",[1,0,0]], ["−X",[-1,0,0]], ["+Y",[0,1,0]], ["−Y",[0,-1,0]], ["+Z",[0,0,1]], ["−Z",[0,0,-1]] ] as [string,[number,number,number]][]).map(([lbl, n]) => (
            <button
              key={lbl}
              onClick={() => addAxisPreset(n as [number,number,number], lbl)}
              className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono border border-border text-muted-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] hover:text-foreground transition-colors"
              title={`Schnittebene ${lbl}-Achse hinzufügen`}
            >
              {lbl}
            </button>
          ))}

          <div className="w-px h-3.5 bg-border mx-0.5" />

          <button
            onClick={addBoxSection}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] border border-border text-muted-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] hover:text-foreground transition-colors",
              selectedElement && "border-primary/40 text-primary/80"
            )}
            title={selectedElement ? "Box-Schnitt um ausgewähltes Element" : "Box-Schnitt aus Modell-BoundingBox"}
          >
            <Box size={10} />
            <span>Box</span>
          </button>

          <div className="flex-1" />

          {/* Hide / show all 3D section visuals */}
          {sectionPlanes.length > 0 && (
            <button
              onClick={toggleVisuals}
              className={cn(
                "p-1 rounded-[4px] text-muted-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] hover:text-foreground transition-colors",
                visualsHidden && "text-primary bg-primary/10"
              )}
              title={visualsHidden ? "Schnittflächen einblenden" : "Schnittflächen ausblenden"}
            >
              {visualsHidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          )}

          {sectionPlanes.length > 0 && (
            <button
              onClick={() => { clearSectionPlanes(); useModelStore.getState().setActiveTool("select"); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors"
              title="Alle Schnittebenen entfernen"
            >
              <Trash2 size={10} />
              <span>Alle</span>
            </button>
          )}
        </div>

        {/* Hint when in section-from-face tool mode */}
        {activeTool === "section" && (
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground text-center bg-muted/10 border-b border-border">
            Fläche im 3D-Viewer anklicken
          </div>
        )}

        {/* Plane list — box groups first, then solo planes */}
        {sectionPlanes.length > 0 && (() => {
          const boxGroupMap = new Map<string, SectionPlane[]>();
          const soloList: SectionPlane[] = [];
          for (const p of sectionPlanes) {
            if (p.boxId) {
              const g = boxGroupMap.get(p.boxId) ?? [];
              g.push(p);
              boxGroupMap.set(p.boxId, g);
            } else {
              soloList.push(p);
            }
          }

          return (
            <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
              {/* Box groups */}
              {Array.from(boxGroupMap.entries()).map(([boxId, bPlanes]) => {
                const allEnabled = bPlanes.every(p => p.enabled);
                const color = bPlanes[0]?.color ?? "#1f77d8";
                return (
                  <div key={boxId}>
                    {/* Box group header */}
                    <div className="flex items-center gap-2 px-2.5 py-1 bg-muted/20 border-b border-border/30">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-black/20" style={{ backgroundColor: color }} />
                      <Box size={9} className="text-muted-foreground shrink-0" />
                      <span className="text-[10px] font-medium text-foreground flex-1">Box-Schnitt</span>
                      <button
                        onClick={() => bPlanes.forEach(p => updateSectionPlane(p.id, { enabled: !allEnabled }))}
                        className="p-0.5 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-muted-foreground hover:text-foreground transition-colors"
                        title={allEnabled ? "Box deaktivieren" : "Box aktivieren"}
                      >
                        {allEnabled ? <Eye size={10} /> : <EyeOff size={10} />}
                      </button>
                      <button
                        onClick={() => bPlanes.forEach(p => removeSectionPlane(p.id))}
                        className="p-0.5 rounded-[4px] hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                        title="Box-Schnitt entfernen"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Solo planes */}
              {soloList.map((plane) => {
                const offset = getOffset(plane);
                return (
                  <div key={plane.id} className={cn("flex items-center gap-2 px-2.5 py-1.5", !plane.enabled && "opacity-50")}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20" style={{ backgroundColor: plane.color }} />
                    <span className="text-[11px] text-foreground w-20 shrink-0 truncate">{plane.name}</span>
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] text-muted-foreground/60 w-10 text-right shrink-0">
                        {offset.toFixed(1)}m
                      </span>
                      <input
                        type="range"
                        min={-sliderRange}
                        max={sliderRange}
                        step={sliderRange / 200}
                        value={offset}
                        onChange={(e) => setOffset(plane, parseFloat(e.target.value))}
                        className="flex-1 h-1 accent-primary cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => flipPlane(plane)} className="p-1 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-muted-foreground hover:text-foreground transition-colors" title="Normale umkehren">
                        <FlipHorizontal2 size={11} />
                      </button>
                      <button onClick={() => alignCamera(plane)} className="p-1 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-muted-foreground hover:text-foreground transition-colors" title="Kamera zur Schnittebene ausrichten">
                        <Camera size={11} />
                      </button>
                      <button onClick={() => updateSectionPlane(plane.id, { enabled: !plane.enabled })} className="p-1 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-muted-foreground hover:text-foreground transition-colors" title={plane.enabled ? "Ebene deaktivieren" : "Ebene aktivieren"}>
                        {plane.enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <button onClick={() => removeSectionPlane(plane.id)} className="p-1 rounded-[4px] hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors" title="Schnittebene löschen">
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
