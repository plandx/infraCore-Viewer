import { useRef, useState, useCallback } from "react";
import {
  FolderOpen, Plus, Sun, Moon, Maximize2,
  MousePointer2, Ruler, Scissors, Eye, EyeOff,
  Download, Info, Database, Camera, FileDown,
  Box, ChevronDown, LayoutGrid, Rotate3D,
  X, List, Glasses, AppWindow, Table2, ExternalLink, Loader2, BarChart2, Sliders,
  Target, Layers, RotateCcw, Navigation2,
} from "lucide-react";
import { openSecondaryWindow, openBillingWindow, PANEL_META } from "../utils/windowSync";
import type { PanelType } from "../utils/windowSync";
import { writeIFCWithOverrides, downloadFile } from "../utils/ifcWriter";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { useBillingStore } from "../billing/billingStore";
import { useAlignmentStore } from "../alignment/alignmentStore";
import * as XLSX from "xlsx";
import type { ActiveTool } from "../types/ifc";

interface Props {
  onOpenFiles: (files: File[]) => void;
  onFitAll: () => void;
  loading: boolean;
  onOpenBatch: () => void;
}

export function MainToolbar({ onOpenFiles, onFitAll, loading, onOpenBatch }: Props) {
  const inputRef    = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const theme             = useModelStore((s) => s.settings.theme);
  const sectionActive     = useModelStore((s) => s.sectionPlanes.length > 0 || s.activeTool === "section");
  const orthographic      = useModelStore((s) => s.settings.orthographic);
  const showSpaces        = useModelStore((s) => s.settings.showSpaces);
  const grid              = useModelStore((s) => s.settings.grid);
  const edges             = useModelStore((s) => s.settings.edges);
  const activeTool        = useModelStore((s) => s.activeTool);
  const updateSettings    = useModelStore((s) => s.updateSettings);
  const setActiveTool     = useModelStore((s) => s.setActiveTool);
  const setSqlPanelOpen   = useModelStore((s) => s.setSqlPanelOpen);
  const sqlPanelOpen      = useModelStore((s) => s.sqlPanelOpen);
  const setListPanelOpen  = useModelStore((s) => s.setListPanelOpen);
  const listPanelOpen     = useModelStore((s) => s.listPanelOpen);
  const setSmartViewsPanelOpen = useModelStore((s) => s.setSmartViewsPanelOpen);
  const smartViewsPanelOpen    = useModelStore((s) => s.smartViewsPanelOpen);
  const setQTOPanelOpen   = useModelStore((s) => s.setQTOPanelOpen);
  const qtoPanelOpen      = useModelStore((s) => s.qtoPanelOpen);
  const clearMeasurements = useModelStore((s) => s.clearMeasurements);
  const measurements      = useModelStore((s) => s.measurements);
  const models            = useModelStore((s) => s.models);
  const propertyOverrides = useModelStore((s) => s.propertyOverrides);

  // 5D state
  const billingModuleActive = useBillingStore((s) => s.moduleActive);
  const billing5DCount      = useBillingStore((s) => Object.keys(s.entries).length);

  // Alignment state
  const alignmentPanelOpen  = useAlignmentStore((s) => s.panelOpen);
  const alignmentFileCount  = useAlignmentStore((s) => s.files.length);
  const toggleAlignmentPanel = useAlignmentStore((s) => s.togglePanel);

  const [exportOpen, setExportOpen] = useState(false);
  const [ifcExporting, setIfcExporting] = useState(false);
  const [viewOpen, setViewOpen]     = useState(false);
  const [infoOpen, setInfoOpen]     = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);

  // ── IFC export ────────────────────────────────────────────────────────────
  const handleIFCExport = useCallback(async () => {
    if (ifcExporting) return;
    setIfcExporting(true);
    setExportOpen(false);
    try {
      for (const [modelId, model] of models.entries()) {
        if (!model.file) continue;
        const modelOvr = propertyOverrides.get(modelId);
        const overridesList = modelOvr
          ? Array.from(modelOvr.entries()).map(([expressId, ov]) => ({ expressId, overrides: ov }))
          : [];
        const data = await writeIFCWithOverrides(model.file, overridesList);
        downloadFile(data, model.name.replace(/\.ifc$/i, "") + "_export.ifc");
      }
    } catch (e) {
      console.error("[IFC Export]", e);
    } finally {
      setIfcExporting(false);
    }
  }, [models, propertyOverrides, ifcExporting]);

  // ── 5D JSON export ────────────────────────────────────────────────────────
  const handleExport5DJson = useCallback(() => {
    const data = useBillingStore.getState().exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `5d-abrechnung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setExportOpen(false);
  }, []);

  // ── Monthly XLSX export ───────────────────────────────────────────────────
  const handleExportMonthlyXLSX = useCallback(() => {
    const entries = useBillingStore.getState().entries;
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay  = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthLabel = firstDay.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    const fmt = (d: string) => { const [y,m,dd] = d.split("-"); return `${dd}.${m}.${y}`; };

    const dataRows: (string | number)[][] = [];
    for (const entry of Object.values(entries)) {
      const monthStages = entry.stages.filter(s => {
        const d = new Date(s.date + "T00:00:00");
        return d >= firstDay && d <= lastDay;
      });
      for (const stage of monthStages) {
        const idx   = entry.stages.indexOf(stage);
        const prev  = idx > 0 ? entry.stages[idx - 1] : null;
        const delta = prev !== null ? stage.degree - prev.degree : null;
        const docs  = entry.documents.map(d => d.docId ? `${d.docId}: ${d.title}` : d.title).join("; ");
        dataRows.push([
          entry.elementName, entry.ifcType.replace(/^Ifc/, ""), entry.guid || "–",
          idx + 1, stage.label, fmt(stage.date), stage.degree,
          delta !== null ? (delta >= 0 ? `+${delta}` : String(delta)) : "–",
          stage.note || "", docs || "–",
        ]);
      }
    }
    const cols = ["Element","Typ","GUID","Stand-Nr.","Bezeichnung","Datum",
                  "Fertigstellungsgrad (%)","Δ (%)","Anmerkung","Dokumente"];
    const aoa: (string|number)[][] = [
      [`Monatsbericht 5D-Abrechnung – ${monthLabel}`],
      [`Erstellt am: ${now.toLocaleDateString("de-DE")}`],
      [], cols,
      ...(dataRows.length ? dataRows : [["Keine Einträge für diesen Zeitraum."]]),
      [],
      [`Gesamt: ${dataRows.length} Abrechnung(en) | Zeitraum: ${firstDay.toLocaleDateString("de-DE")} – ${lastDay.toLocaleDateString("de-DE")}`],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [30,14,22,10,20,12,22,8,24,30].map(wch => ({ wch }));
    ws["!merges"] = [{ s:{r:0,c:0}, e:{r:0,c:9} }, { s:{r:1,c:0}, e:{r:1,c:9} }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel.slice(0, 31));
    XLSX.writeFile(wb, `5d-monatsbericht-${firstDay.toISOString().slice(0,7)}.xlsx`);
    setExportOpen(false);
  }, []);

  // ── 5D: isolate tracked elements ──────────────────────────────────────────
  const handleIsolate5D = useCallback(() => {
    const billingEntries = useBillingStore.getState().entries;
    const modelMap       = useModelStore.getState().models;
    if (Object.keys(billingEntries).length === 0) return;

    const toIsolate: Array<{ modelId: string; expressId: number }> = [];
    for (const key of Object.keys(billingEntries)) {
      const colonIdx = key.lastIndexOf(":");
      const filename  = key.slice(0, colonIdx);
      const expressId = parseInt(key.slice(colonIdx + 1), 10);
      for (const [modelId, model] of modelMap) {
        if (model.name === filename) { toIsolate.push({ modelId, expressId }); break; }
      }
    }
    if (toIsolate.length > 0) useModelStore.getState().isolateEntries(toIsolate);
  }, []);

  // ── 5D: toggle visualization overlay ─────────────────────────────────────
  const handleToggleVisualize5D = useCallback(() => {
    useBillingStore.getState().setModuleActive(!useBillingStore.getState().moduleActive);
  }, []);

  // ── App reset ─────────────────────────────────────────────────────────────
  const handleResetApp = useCallback(() => {
    if (!window.confirm("Alle geladenen Modelle entfernen und App zurücksetzen?\n\n5D-Abrechnungsdaten bleiben erhalten.")) return;
    const st = useModelStore.getState();
    for (const id of st.models.keys()) st.removeModel(id);
    st.showAll();
    st.setSelected(null);
    st.clearMeasurements();
    st.clearSectionPlanes();
    st.clearBasket();
    st.setActiveTool("select");
    st.setColorGroups(null);
    if (st.activeSmartViewId) st.deactivateSmartView();
    st.setSqlPanelOpen(false);
    st.setListPanelOpen(false);
    st.setSmartViewsPanelOpen(false);
    st.setQTOPanelOpen(false);
  }, []);

  // ── Misc ──────────────────────────────────────────────────────────────────
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
          <svg width="20" height="20" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[4px]">
            <rect width="32" height="32" rx="5" fill="#E8312A"/>
            <text x="16" y="23" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
          </svg>
          <span className="font-bold text-sm tracking-tight text-foreground">infraCore</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">IFC Viewer</span>
        </div>

        {/* ── File group: Öffnen · Hinzufügen · Batch ── */}
        <input ref={inputRef}    type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
        <input ref={addInputRef} type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
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
        <button
          className="toolbar-button"
          onClick={() => addInputRef.current?.click()}
          disabled={loading}
          title="Modell hinzufügen"
        >
          <Plus size={16} />
        </button>
        <button
          className="toolbar-button flex items-center gap-1 px-2 py-1 text-xs"
          onClick={onOpenBatch}
          title="Batch-Änderungen"
        >
          <Sliders size={14} />
          <span className="text-[11px]">Batch</span>
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* ── Camera ── */}
        <button className="toolbar-button" onClick={onFitAll} title="Auf alle Modelle zoomen [F]">
          <Maximize2 size={16} />
        </button>
        <button
          className={cn("toolbar-button", orthographic && "active text-primary")}
          title={orthographic ? "Perspektivisch" : "Orthogonal"}
          onClick={() => updateSettings({ orthographic: !orthographic })}
        >
          {orthographic ? <Box size={16} /> : <Rotate3D size={16} />}
        </button>
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
                { label: "Draufsicht",   preset: "top"    },
                { label: "Untersicht",   preset: "bottom" },
                { label: "Vorderansicht",preset: "front"  },
                { label: "Rückansicht",  preset: "back"   },
                { label: "Links",        preset: "left"   },
                { label: "Rechts",       preset: "right"  },
              ].map((v) => (
                <DropdownItem key={v.preset} onClick={() => { handlePreset(v.preset); setViewOpen(false); }}>
                  {v.label}
                </DropdownItem>
              ))}
            </DropdownMenu>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* ── Interaction tools ── */}
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
          className={cn("toolbar-button", sectionActive && "active text-primary")}
          title="Schnittebene [C] · Fläche anklicken zum Positionieren"
          onClick={() => {
            const st = useModelStore.getState();
            if (st.activeTool === "section" || st.sectionPlanes.length > 0) {
              st.clearSectionPlanes(); st.setActiveTool("select");
            } else {
              st.setActiveTool("section");
            }
          }}
        >
          <Scissors size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* ── Visibility ── */}
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
        <button
          className={cn("toolbar-button", !edges && "opacity-40")}
          title="Kanten ein/ausblenden"
          onClick={() => updateSettings({ edges: !edges })}
        >
          <Box size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* ── Analysis panels ── */}
        <PopoutPanelButton active={sqlPanelOpen} title="SQL-Abfrage [Q]" panel="sql"
          onClick={() => setSqlPanelOpen(!sqlPanelOpen)}>
          <Database size={16} />
        </PopoutPanelButton>
        <PopoutPanelButton active={listPanelOpen} title="Lens Rules [L]" panel="lists"
          onClick={() => setListPanelOpen(!listPanelOpen)}>
          <List size={16} />
        </PopoutPanelButton>
        <PopoutPanelButton active={smartViewsPanelOpen} title="SmartViews [V]" panel="smartviews"
          onClick={() => setSmartViewsPanelOpen(!smartViewsPanelOpen)}>
          <Glasses size={16} />
        </PopoutPanelButton>
        <PopoutPanelButton active={qtoPanelOpen} title="Listen / Mengen [T]" panel="qto"
          onClick={() => setQTOPanelOpen(!qtoPanelOpen)}>
          <Table2 size={16} />
        </PopoutPanelButton>

        <div className="w-px h-5 bg-border mx-1" />

        {/* ── Alignment / Trassen ── */}
        <button
          onClick={toggleAlignmentPanel}
          className={cn("toolbar-button flex items-center gap-1 px-2 py-1 text-xs", alignmentPanelOpen && "active text-primary")}
          title="Trassen-Viewer (LandXML)"
        >
          <Navigation2 size={14} />
          <span className="text-[11px]">Achsen</span>
          {alignmentFileCount > 0 && (
            <span className="bg-muted text-muted-foreground text-[8px] px-1 rounded-full">{alignmentFileCount}</span>
          )}
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* ── 5D-Abrechnung ── */}
        <button
          onClick={() => openBillingWindow()}
          className="toolbar-button flex items-center gap-1 px-2 py-1 text-xs"
          title="5D-Abrechnung öffnen"
        >
          <BarChart2 size={14} />
          <span className="text-[11px]">5D</span>
          {billing5DCount > 0 && (
            <span className="bg-muted text-muted-foreground text-[8px] px-1 rounded-full">
              {billing5DCount}
            </span>
          )}
        </button>
        <button
          onClick={handleIsolate5D}
          disabled={billing5DCount === 0}
          className={cn("toolbar-button", billing5DCount === 0 && "opacity-30 cursor-not-allowed")}
          title={billing5DCount > 0 ? `5D-Elemente isolieren (${billing5DCount} erfasst)` : "Keine 5D-Elemente erfasst"}
        >
          <Target size={15} />
        </button>
        <button
          onClick={handleToggleVisualize5D}
          disabled={billing5DCount === 0}
          className={cn(
            "toolbar-button",
            billingModuleActive && "active text-primary",
            billing5DCount === 0 && "opacity-30 cursor-not-allowed"
          )}
          title={billingModuleActive ? "5D-Visualisierung ausschalten" : "5D-Visualisierung einschalten"}
        >
          <Layers size={15} />
        </button>

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span>Lädt…</span>
          </div>
        )}

        {/* Window opener */}
        <div className="relative">
          <button
            className={cn("toolbar-button", windowOpen && "active text-primary")}
            title="Neues Fenster öffnen"
            onClick={() => { setWindowOpen((v) => !v); setExportOpen(false); setViewOpen(false); }}
          >
            <AppWindow size={16} />
          </button>
          {windowOpen && (
            <DropdownMenu onClose={() => setWindowOpen(false)} align="right">
              <div className="p-1 text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide">Fenster öffnen</div>
              {(Object.keys(PANEL_META) as PanelType[]).map((p) => (
                <DropdownItem key={p} icon={<AppWindow size={13} />}
                  onClick={() => { openSecondaryWindow(p); setWindowOpen(false); }}>
                  {PANEL_META[p].label}
                </DropdownItem>
              ))}
            </DropdownMenu>
          )}
        </div>

        {/* Export */}
        <div className="relative">
          <button
            className="toolbar-button"
            title="Exportieren"
            onClick={() => { setExportOpen((v) => !v); setViewOpen(false); setWindowOpen(false); }}
          >
            <Download size={16} />
          </button>
          {exportOpen && (
            <DropdownMenu onClose={() => setExportOpen(false)} align="right">
              <div className="p-1 text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide">Export</div>
              {(() => {
                const hasModels = models.size > 0;
                const totalOverrides = Array.from(propertyOverrides.values())
                  .reduce((s, m) => s + Array.from(m.values()).reduce((a, o) => a + Object.keys(o).length, 0), 0);
                return (
                  <DropdownItem
                    icon={ifcExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    onClick={hasModels && !ifcExporting ? handleIFCExport : undefined}
                    disabled={!hasModels || ifcExporting}
                  >
                    <span className="flex items-center gap-1.5">
                      IFC exportieren
                      {totalOverrides > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 text-[9px] px-1 rounded">
                          {totalOverrides} Änd.
                        </span>
                      )}
                    </span>
                  </DropdownItem>
                );
              })()}
              <div className="h-px bg-border/50 my-0.5 mx-2" />
              {(() => {
                const has5D = billing5DCount > 0;
                return (<>
                  <DropdownItem icon={<BarChart2 size={13} />}
                    onClick={has5D ? handleExport5DJson : undefined} disabled={!has5D}>
                    <span className="flex items-center gap-1.5">
                      5D-Daten als JSON
                      {has5D && <span className="bg-primary/20 text-primary text-[9px] px-1 rounded">{billing5DCount}</span>}
                    </span>
                  </DropdownItem>
                  <DropdownItem icon={<Table2 size={13} />}
                    onClick={has5D ? handleExportMonthlyXLSX : undefined} disabled={!has5D}>
                    Monatsbericht als XLSX
                  </DropdownItem>
                </>);
              })()}
              <div className="h-px bg-border/50 my-0.5 mx-2" />
              <DropdownItem icon={<Box size={13} />}
                onClick={() => { window.dispatchEvent(new Event("viewer:exportGLTF")); setExportOpen(false); }}>
                Modell als GLB
              </DropdownItem>
              <DropdownItem icon={<Camera size={13} />}
                onClick={() => { window.dispatchEvent(new Event("viewer:screenshot")); setExportOpen(false); }}>
                Screenshot (PNG)
              </DropdownItem>
              <DropdownItem icon={<FileDown size={13} />}
                onClick={() => { exportElementsCSV(); setExportOpen(false); }}>
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

        {/* Theme */}
        <button className="toolbar-button" onClick={toggleTheme} title="Hell/Dunkel">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* App reset */}
        <button
          className="toolbar-button text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          onClick={handleResetApp}
          title="App zurücksetzen — alle Modelle entfernen"
        >
          <RotateCcw size={15} />
        </button>

      </div>

      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}
    </>
  );
}

// ── Panel button with pop-out ─────────────────────────────────────────────────

function PopoutPanelButton({ children, active, title, panel, onClick }: {
  children: React.ReactNode;
  active: boolean;
  title: string;
  panel: PanelType;
  onClick: () => void;
}) {
  return (
    <div className="relative group/popout">
      <button
        className={cn("toolbar-button", active && "active text-primary")}
        title={title}
        onClick={onClick}
      >
        {children}
      </button>
      <button
        className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-card border border-border flex items-center justify-center opacity-0 group-hover/popout:opacity-100 hover:!opacity-100 hover:bg-primary hover:border-primary hover:text-primary-foreground text-muted-foreground transition-all z-10"
        title={`${PANEL_META[panel].label} in neuem Fenster öffnen`}
        onClick={(e) => { e.stopPropagation(); openSecondaryWindow(panel); }}
      >
        <ExternalLink size={8} />
      </button>
    </div>
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

function DropdownItem({ children, onClick, icon, disabled }: {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-foreground",
        disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/60"
      )}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
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
            <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[4px]">
              <rect width="32" height="32" rx="5" fill="#E8312A"/>
              <text x="16" y="23" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
            </svg>
            <span className="font-bold text-sm">infraCore IFC Viewer</span>
          </div>
          <button className="toolbar-button p-1" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="text-xs text-muted-foreground space-y-1 mb-4">
          <p className="font-medium text-foreground">IFC Viewer by iC consulenten ZT GmbH</p>
          <p className="text-[11px]">Kompetenzbereich VDC</p>
          <p className="pt-1">Basierend auf web-ifc 0.0.77 + Three.js</p>
          <p>Unterstützt Multi-Modell-Ansichten und große Koordinatensysteme (bis 20 km)</p>
        </div>
        <div className="border-t border-border pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tastenkürzel</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {[
              ["F","Alle einpassen"], ["S","Auswahl-Tool"], ["M","Mess-Tool"], ["C","Schnittebene"],
              ["Q","SQL-Panel"], ["L","Lens Rules"], ["V","SmartViews"], ["T","Listen / Mengen"],
              ["Esc","Abbrechen / Deselektieren"], ["Entf","Auswahl ausblenden"],
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
  const rows: string[][] = [["Modell","Typ","Name","ExpressID"]];
  models.forEach((model) => {
    for (const [typeName, els] of Object.entries(model.elementsByType)) {
      for (const el of els) rows.push([model.name, typeName, el.name, String(el.expressId)]);
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
