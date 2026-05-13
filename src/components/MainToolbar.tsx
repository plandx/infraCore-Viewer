import { useRef, useState } from "react";
import {
  FolderOpen, Plus, Sun, Moon, Maximize2,
  MousePointer2, Ruler, Scissors, Eye, EyeOff,
  Download, Info, Database, Camera, FileDown,
  Box, ChevronDown, LayoutGrid, Rotate3D,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import type { ActiveTool } from "../types/ifc";

interface Props {
  onOpenFiles: (files: File[]) => void;
  onFitAll: () => void;
  loading: boolean;
}

export function MainToolbar({ onOpenFiles, onFitAll, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const theme = useModelStore((s) => s.settings.theme);
  const clipPlanes = useModelStore((s) => s.settings.clipPlanes);
  const orthographic = useModelStore((s) => s.settings.orthographic);
  const showSpaces = useModelStore((s) => s.settings.showSpaces);
  const grid = useModelStore((s) => s.settings.grid);
  const activeTool = useModelStore((s) => s.activeTool);
  const updateSettings = useModelStore((s) => s.updateSettings);
  const setActiveTool = useModelStore((s) => s.setActiveTool);
  const setSqlPanelOpen = useModelStore((s) => s.setSqlPanelOpen);
  const sqlPanelOpen = useModelStore((s) => s.sqlPanelOpen);
  const clearMeasurements = useModelStore((s) => s.clearMeasurements);
  const measurements = useModelStore((s) => s.measurements);

  const [exportOpen, setExportOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.name.toLowerCase().endsWith(".ifc"));
    if (files.length) onOpenFiles(files);
    e.target.value = "";
  };

  const toggleTheme = () => {
    updateSettings({ theme: theme === "dark" ? "light" : "dark" });
    document.documentElement.classList.toggle("dark", theme !== "dark");
  };

  const handleToolClick = (tool: ActiveTool) => {
    if (tool === activeTool && tool === "measure") {
      window.dispatchEvent(new Event("viewer:clearMeasure"));
      clearMeasurements();
      setActiveTool("select");
    } else {
      if (activeTool === "measure") {
        window.dispatchEvent(new Event("viewer:clearMeasure"));
        clearMeasurements();
      }
      // Leaving section mode → keep clip planes but stop face-picking
      setActiveTool(tool);
    }
  };

  const handlePreset = (preset: string) =>
    window.dispatchEvent(new CustomEvent("viewer:preset", { detail: preset }));

  return (
    <>
      <div className="flex items-center h-11 px-3 gap-1 border-b bg-card text-card-foreground shrink-0 select-none">
        {/* Logo */}
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-primary">
            <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="currentColor" opacity="0.3"/>
          </svg>
          <span className="font-bold text-sm tracking-tight text-foreground">infraCore</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">IFC Viewer</span>
        </div>

        {/* Open file */}
        <input ref={inputRef} type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
        <button
          className={cn("toolbar-button flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded",
            "bg-primary text-primary-foreground hover:opacity-90")}
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          title="IFC-Datei öffnen"
        >
          <FolderOpen size={14} />
          <span>Öffnen</span>
        </button>

        {/* Add model */}
        <input ref={addInputRef} type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
        <button
          className="toolbar-button"
          onClick={() => addInputRef.current?.click()}
          disabled={loading}
          title="Modell hinzufügen"
        >
          <Plus size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Camera tools */}
        <button className="toolbar-button" onClick={onFitAll} title="Auf alle Modelle zoomen [F]">
          <Maximize2 size={16} />
        </button>

        {/* Ortho / Perspective toggle */}
        <button
          className={cn("toolbar-button", orthographic && "active text-primary")}
          title={orthographic ? "Perspektivisch" : "Orthogonal"}
          onClick={() => updateSettings({ orthographic: !orthographic })}
        >
          {orthographic ? <Box size={16} /> : <Rotate3D size={16} />}
        </button>

        {/* View presets dropdown */}
        <div className="relative">
          <button
            className={cn("toolbar-button flex items-center gap-0.5", viewOpen && "active text-primary")}
            title="Ansicht wählen"
            onClick={() => { setViewOpen((v) => !v); setExportOpen(false); }}
          >
            <LayoutGrid size={15} />
            <ChevronDown size={10} />
          </button>
          {viewOpen && (
            <DropdownMenu onClose={() => setViewOpen(false)}>
              <div className="p-1 text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide">Ansicht</div>
              {[
                { label: "Draufsicht", preset: "top" },
                { label: "Untersicht", preset: "bottom" },
                { label: "Vorderansicht", preset: "front" },
                { label: "Rückansicht", preset: "back" },
                { label: "Links", preset: "left" },
                { label: "Rechts", preset: "right" },
              ].map((v) => (
                <DropdownItem key={v.preset} onClick={() => { handlePreset(v.preset); setViewOpen(false); }}>
                  {v.label}
                </DropdownItem>
              ))}
            </DropdownMenu>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Interaction tools */}
        <button
          className={cn("toolbar-button", activeTool === "select" && "active text-primary")}
          title="Auswahl [S]"
          onClick={() => handleToolClick("select")}
        >
          <MousePointer2 size={16} />
        </button>
        <button
          className={cn("toolbar-button", activeTool === "measure" && "active text-primary")}
          title="Messen [M] · erneut klicken zum Löschen"
          onClick={() => handleToolClick("measure")}
        >
          <Ruler size={16} />
          {measurements.length > 0 && activeTool === "measure" && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[8px] flex items-center justify-center font-bold">
              {measurements.length}
            </span>
          )}
        </button>
        <button
          className={cn("toolbar-button", (clipPlanes || activeTool === "section") && "active text-primary")}
          title="Schnittebene [C] · Fläche anklicken zum Positionieren"
          onClick={() => {
            if (activeTool === "section" || clipPlanes) {
              // Exit: turn off clip and return to select
              updateSettings({ clipPlanes: false });
              setActiveTool("select");
            } else {
              // Activate: just switch tool, plane appears on first face click
              setActiveTool("section");
            }
          }}
        >
          <Scissors size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Visibility toggles */}
        <button
          className={cn("toolbar-button", !showSpaces && "opacity-50")}
          title="Räume ein/ausblenden"
          onClick={() => updateSettings({ showSpaces: !showSpaces })}
        >
          {showSpaces ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button
          className={cn("toolbar-button text-[9px] font-bold", !grid && "opacity-40")}
          title="Raster ein/ausblenden"
          onClick={() => updateSettings({ grid: !grid })}
        >
          <span style={{ fontFamily: "monospace", fontSize: 12 }}>#</span>
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* SQL Panel */}
        <button
          className={cn("toolbar-button", sqlPanelOpen && "active text-primary")}
          title="SQL-Abfrage [Q]"
          onClick={() => setSqlPanelOpen(!sqlPanelOpen)}
        >
          <Database size={16} />
        </button>

        <div className="flex-1" />

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span>Lädt…</span>
          </div>
        )}

        {/* Export dropdown */}
        <div className="relative">
          <button
            className="toolbar-button"
            title="Exportieren"
            onClick={() => { setExportOpen((v) => !v); setViewOpen(false); }}
          >
            <Download size={16} />
          </button>
          {exportOpen && (
            <DropdownMenu onClose={() => setExportOpen(false)} align="right">
              <div className="p-1 text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide">Export</div>
              <DropdownItem
                icon={<Box size={13} />}
                onClick={() => { window.dispatchEvent(new Event("viewer:exportGLTF")); setExportOpen(false); }}
              >
                Modell als GLB
              </DropdownItem>
              <DropdownItem
                icon={<Camera size={13} />}
                onClick={() => { window.dispatchEvent(new Event("viewer:screenshot")); setExportOpen(false); }}
              >
                Screenshot (PNG)
              </DropdownItem>
              <DropdownItem
                icon={<FileDown size={13} />}
                onClick={() => { exportElementsCSV(); setExportOpen(false); }}
              >
                Elemente als CSV
              </DropdownItem>
            </DropdownMenu>
          )}
        </div>

        {/* Info */}
        <button className="toolbar-button" title="Info" onClick={() => setInfoOpen(true)}>
          <Info size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Theme toggle */}
        <button className="toolbar-button" onClick={toggleTheme} title="Hell/Dunkel">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Info modal */}
      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}
    </>
  );
}

// ── Dropdown helpers ──────────────────────────────────────────────────────────

function DropdownMenu({ children, onClose, align = "left" }: {
  children: React.ReactNode; onClose: () => void; align?: "left" | "right";
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={cn(
        "absolute top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-xl min-w-[180px]",
        align === "right" ? "right-0" : "left-0"
      )}>
        {children}
      </div>
    </>
  );
}

function DropdownItem({ children, onClick, icon }: {
  children: React.ReactNode; onClick: () => void; icon?: React.ReactNode;
}) {
  return (
    <button
      className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs hover:bg-muted/60 text-foreground"
      onClick={onClick}
    >
      {icon && <span className="text-muted-foreground">{icon}</span>}
      {children}
    </button>
  );
}

// ── Info modal ────────────────────────────────────────────────────────────────

function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl p-6 w-[400px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-primary">
              <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="currentColor" opacity="0.3"/>
            </svg>
            <span className="font-bold text-sm">infraCore IFC Viewer</span>
          </div>
          <button className="toolbar-button p-1" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 mb-4">
          <p>Basierend auf web-ifc 0.0.77 + Three.js</p>
          <p>Unterstützt Multi-Modell-Ansichten und große Koordinatensysteme (bis 20 km)</p>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tastenkürzel</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {[
              ["F", "Alle einpassen"],
              ["S", "Auswahl-Tool"],
              ["M", "Mess-Tool"],
              ["C", "Schnittebene"],
              ["Q", "SQL-Panel"],
              ["Esc", "Abbrechen / Deselektieren"],
              ["Entf", "Auswahl ausblenden"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-2">
                <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px] font-mono shrink-0">{key}</kbd>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportElementsCSV() {
  const { models } = useModelStore.getState();
  const rows: string[][] = [["Modell", "Typ", "Name", "ExpressID"]];
  models.forEach((model) => {
    for (const [typeName, els] of Object.entries(model.elementsByType)) {
      for (const el of els) {
        rows.push([model.name, typeName, el.name, String(el.expressId)]);
      }
    }
  });
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "elemente.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
