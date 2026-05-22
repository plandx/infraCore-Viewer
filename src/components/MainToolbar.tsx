import { useRef, useState, useCallback } from "react";
import {
  FolderOpen, Plus, Sun, Moon, Maximize2,
  MousePointer2, Ruler, Scissors, Eye, EyeOff,
  Download, Info, Database, Camera, FileDown,
  Box, ChevronDown, LayoutGrid, Rotate3D,
  X, List, Glasses, AppWindow, Table2, ExternalLink, Loader2, BarChart2, Sliders,
  Target, Layers, RotateCcw, Navigation2, TrendingUp, Tag, Crosshair,
  Settings, AlertTriangle, Gamepad2, Grid3x3, BoxSelect,
} from "lucide-react";
import { openSecondaryWindow, openBillingWindow, PANEL_META } from "../utils/windowSync";
import { HelpPanel } from "./HelpPanel";
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

type RibbonTab = "start" | "analyse" | "achsen" | "billing5d" | "extras";

// ── Main component ────────────────────────────────────────────────────────────

export function MainToolbar({ onOpenFiles, onFitAll, loading, onOpenBatch }: Props) {
  const inputRef    = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const loadedProperties          = useModelStore((s) => s.loadedProperties);
  const loadingPropertiesProgress = useModelStore((s) => s.loadingPropertiesProgress);
  const loadAllProperties         = useModelStore((s) => s.loadAllProperties);
  const loadedPropKeys            = useModelStore((s) => s.loadedPropKeys);

  const theme             = useModelStore((s) => s.settings.theme);
  const sectionActive     = useModelStore((s) => s.sectionPlanes.length > 0 || s.activeTool === "section");
  const orthographic      = useModelStore((s) => s.settings.orthographic);
  const showSpaces        = useModelStore((s) => s.settings.showSpaces);
  const grid              = useModelStore((s) => s.settings.grid);
  const edges             = useModelStore((s) => s.settings.edges);
  const activeTool        = useModelStore((s) => s.activeTool);
  const updateSettings    = useModelStore((s) => s.updateSettings);
  const setActiveTool     = useModelStore((s) => s.setActiveTool);
  const setSettingsPanelOpen  = useModelStore((s) => s.setSettingsPanelOpen);
  const setCollisionPanelOpen = useModelStore((s) => s.setCollisionPanelOpen);
  const setSqlPanelOpen      = useModelStore((s) => s.setSqlPanelOpen);
  const sqlPanelOpen         = useModelStore((s) => s.sqlPanelOpen);
  const setProfilePanelOpen  = useModelStore((s) => s.setProfilePanelOpen);
  const profilePanelOpen     = useModelStore((s) => s.profilePanelOpen);
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

  const billingModuleActive = useBillingStore((s) => s.moduleActive);
  const billing5DCount      = useBillingStore((s) => Object.keys(s.entries).length);

  const alignmentPanelOpen   = useAlignmentStore((s) => s.panelOpen);
  const alignmentFileCount   = useAlignmentStore((s) => s.files.length);
  const alignmentVisibleIds  = useAlignmentStore((s) => s.visibleIds);
  const toggleAlignmentPanel = useAlignmentStore((s) => s.togglePanel);
  const alignmentFiles       = useAlignmentStore((s) => s.files);
  const toggleVisible        = useAlignmentStore((s) => s.toggleVisible);
  const stationLabelVisible   = useAlignmentStore((s) => s.stationLabelVisible);
  const stationLabelInterval  = useAlignmentStore((s) => s.stationLabelInterval);
  const offsetToolActive      = useAlignmentStore((s) => s.offsetToolActive);
  const toggleStationLabels   = useAlignmentStore((s) => s.toggleStationLabels);
  const setStationLabelInterval = useAlignmentStore((s) => s.setStationLabelInterval);
  const toggleOffsetTool      = useAlignmentStore((s) => s.toggleOffsetTool);

  const allAlignmentsVisible = alignmentFiles.length > 0 &&
    alignmentFiles.every(f => f.alignments.every(a => alignmentVisibleIds.has(a.id)));
  const toggleAllAlignments  = () => {
    const allIds = alignmentFiles.flatMap(f => f.alignments.map(a => a.id));
    if (allAlignmentsVisible) {
      allIds.forEach(id => { if (alignmentVisibleIds.has(id)) toggleVisible(id); });
    } else {
      allIds.forEach(id => { if (!alignmentVisibleIds.has(id)) toggleVisible(id); });
    }
  };

  const [activeTab, setActiveTab] = useState<RibbonTab>("start");
  const [exportOpen, setExportOpen]         = useState(false);
  const [ifcExporting, setIfcExporting]     = useState(false);
  const [viewOpen, setViewOpen]             = useState(false);
  const [infoOpen, setInfoOpen]             = useState(false);
  const [windowOpen, setWindowOpen]         = useState(false);
  const [labelIntervalOpen, setLabelIntervalOpen] = useState(false);

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

  const handleToggleVisualize5D = useCallback(() => {
    useBillingStore.getState().setModuleActive(!useBillingStore.getState().moduleActive);
  }, []);

  const handleResetApp = useCallback(() => {
    if (!window.confirm("Alle geladenen Modelle entfernen und App zurücksetzen?\n\nAuch alle 5D-Abrechnungsdaten werden gelöscht.")) return;
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
    useBillingStore.getState().clearAll();
  }, []);

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

  // ── Shared props bundles passed to tab content ────────────────────────────
  const toolProps = {
    activeTool, sectionActive, measurements,
    handleToolClick,
    onFitAll, orthographic, updateSettings, handlePreset,
    showSpaces, grid, edges,
    viewOpen, setViewOpen,
  };

  const analyseProps = {
    loadedProperties, loadingPropertiesProgress, loadAllProperties, loadedPropKeys,
    models, sqlPanelOpen, setSqlPanelOpen,
    listPanelOpen, setListPanelOpen,
    smartViewsPanelOpen, setSmartViewsPanelOpen,
    qtoPanelOpen, setQTOPanelOpen,
    setCollisionPanelOpen,
  };

  const achsenProps = {
    alignmentPanelOpen, alignmentFileCount, alignmentVisibleIds,
    toggleAlignmentPanel, allAlignmentsVisible, toggleAllAlignments,
    profilePanelOpen, setProfilePanelOpen,
    stationLabelVisible, stationLabelInterval, offsetToolActive,
    toggleStationLabels, setStationLabelInterval, toggleOffsetTool,
    labelIntervalOpen, setLabelIntervalOpen,
    activeTool, setActiveTool,
  };

  const billing5DProps = {
    billing5DCount, billingModuleActive,
    handleIsolate5D, handleToggleVisualize5D,
  };

  // ── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: RibbonTab; label: string; badge?: number }[] = [
    { id: "start",     label: "Start" },
    { id: "analyse",   label: "Analyse" },
    { id: "achsen",    label: "Achsen",  badge: alignmentFileCount > 0 ? alignmentFileCount : undefined },
    { id: "billing5d", label: "5D",      badge: billing5DCount > 0 ? billing5DCount : undefined },
    { id: "extras",    label: "Extras" },
  ];

  return (
    <>
      <input ref={inputRef}    type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
      <input ref={addInputRef} type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />

      <div className="flex flex-col shrink-0 border-b border-border bg-card text-card-foreground select-none relative z-[100]">

        {/* ── Row 1: Tab strip ──────────────────────────────────────────── */}
        <div className="flex items-stretch h-7 border-b border-border/60">

          {/* Logo */}
          <div className="flex items-center gap-1.5 px-3 border-r border-border mr-1">
            <svg width="16" height="16" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[3px]">
              <rect width="32" height="32" rx="5" fill="#E8312A"/>
              <text x="16" y="23" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
            </svg>
            <span className="font-bold text-[11px] tracking-tight text-foreground whitespace-nowrap">infraCore</span>
          </div>

          {/* Tab buttons */}
          <div className="flex items-stretch">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1 px-3 text-[11px] font-semibold tracking-wide transition-all border-b-2 whitespace-nowrap",
                  activeTab === tab.id
                    ? "text-primary border-primary bg-muted/40"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/30"
                )}
              >
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="text-[9px] bg-primary/20 text-primary px-1 rounded-full font-mono leading-none py-0.5">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right utility area */}
          <div className="flex items-center gap-0.5 px-2 border-l border-border/60">
            {loading && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mr-1">
                <Loader2 size={11} className="animate-spin" />
                <span>Lädt…</span>
              </div>
            )}

            {/* Window opener */}
            <div className="relative">
              <UtilBtn
                active={windowOpen}
                title="Panel in neuem Fenster öffnen"
                onClick={() => { setWindowOpen(v => !v); setExportOpen(false); setViewOpen(false); }}
              >
                <AppWindow size={13} />
              </UtilBtn>
              {windowOpen && (
                <DropdownMenu onClose={() => setWindowOpen(false)} align="right">
                  <div className="px-2 py-1.5 text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Fenster öffnen</div>
                  {(Object.keys(PANEL_META) as PanelType[]).map((p) => (
                    <DropdownItem key={p} icon={<ExternalLink size={12} />}
                      onClick={() => { openSecondaryWindow(p); setWindowOpen(false); }}>
                      {PANEL_META[p].label}
                    </DropdownItem>
                  ))}
                </DropdownMenu>
              )}
            </div>

            {/* Export */}
            <div className="relative">
              <UtilBtn
                active={exportOpen}
                title="Exportieren"
                onClick={() => { setExportOpen(v => !v); setViewOpen(false); setWindowOpen(false); }}
              >
                <Download size={13} />
              </UtilBtn>
              {exportOpen && (
                <DropdownMenu onClose={() => setExportOpen(false)} align="right">
                  <div className="px-2 py-1.5 text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Export</div>
                  {(() => {
                    const hasModels = models.size > 0;
                    const totalOverrides = Array.from(propertyOverrides.values())
                      .reduce((s, m) => s + Array.from(m.values()).reduce((a, o) => a + Object.keys(o).length, 0), 0);
                    return (
                      <DropdownItem
                        icon={ifcExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        onClick={hasModels && !ifcExporting ? handleIFCExport : undefined}
                        disabled={!hasModels || ifcExporting}
                      >
                        <span className="flex items-center gap-1.5">
                          IFC exportieren
                          {totalOverrides > 0 && (
                            <span className="bg-amber-500/20 text-amber-400 text-[9px] px-1 rounded">{totalOverrides} Änd.</span>
                          )}
                        </span>
                      </DropdownItem>
                    );
                  })()}
                  <div className="h-px bg-border/50 my-0.5 mx-2" />
                  <DropdownItem icon={<BarChart2 size={12} />}
                    onClick={billing5DCount > 0 ? handleExport5DJson : undefined} disabled={billing5DCount === 0}>
                    <span className="flex items-center gap-1.5">
                      5D-Daten als JSON
                      {billing5DCount > 0 && <span className="bg-primary/20 text-primary text-[9px] px-1 rounded">{billing5DCount}</span>}
                    </span>
                  </DropdownItem>
                  <DropdownItem icon={<Table2 size={12} />}
                    onClick={billing5DCount > 0 ? handleExportMonthlyXLSX : undefined} disabled={billing5DCount === 0}>
                    Monatsbericht als XLSX
                  </DropdownItem>
                  <div className="h-px bg-border/50 my-0.5 mx-2" />
                  <DropdownItem icon={<Box size={12} />}
                    onClick={() => { window.dispatchEvent(new Event("viewer:exportGLTF")); setExportOpen(false); }}>
                    Modell als GLB
                  </DropdownItem>
                  <DropdownItem icon={<Camera size={12} />}
                    onClick={() => { window.dispatchEvent(new Event("viewer:screenshot")); setExportOpen(false); }}>
                    Screenshot (PNG)
                  </DropdownItem>
                  <DropdownItem icon={<FileDown size={12} />}
                    onClick={() => { exportElementsCSV(); setExportOpen(false); }}>
                    Elemente als CSV
                  </DropdownItem>
                </DropdownMenu>
              )}
            </div>

            {/* Info */}
            <UtilBtn title="Tastenkürzel & Info" onClick={() => setInfoOpen(true)}>
              <Info size={13} />
            </UtilBtn>

            <div className="w-px h-4 bg-border/60 mx-0.5" />

            {/* Settings */}
            <UtilBtn title="Einstellungen" onClick={() => setSettingsPanelOpen(true)}>
              <Settings size={13} />
            </UtilBtn>

            {/* Theme */}
            <UtilBtn title="Hell/Dunkel" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
            </UtilBtn>

            {/* Reset */}
            <UtilBtn
              title="App zurücksetzen — alle Modelle entfernen"
              className="hover:text-destructive hover:bg-destructive/10"
              onClick={handleResetApp}
            >
              <RotateCcw size={13} />
            </UtilBtn>
          </div>
        </div>

        {/* ── Row 2: Ribbon tool strip ──────────────────────────────────── */}
        <div className="flex items-stretch h-[54px] overflow-visible">

          {activeTab === "start" && (
            <>
              {/* DATEI */}
              <RibbonGroup label="Datei">
                <RibbonLargeBtn
                  icon={<FolderOpen size={18} />}
                  label="Öffnen"
                  onClick={() => inputRef.current?.click()}
                  disabled={loading}
                  title="IFC-Datei öffnen"
                  primary
                />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={<Plus size={14} />}
                    label="Hinzufügen"
                    onClick={() => addInputRef.current?.click()}
                    disabled={loading}
                    title="Weiteres Modell hinzufügen"
                  />
                  <RibbonSmBtn
                    icon={<Sliders size={14} />}
                    label="Batch"
                    onClick={onOpenBatch}
                    title="Batch-Änderungen"
                  />
                </div>
              </RibbonGroup>

              {/* KAMERA */}
              <RibbonGroup label="Kamera">
                <RibbonLargeBtn
                  icon={<Maximize2 size={18} />}
                  label="Einpassen"
                  onClick={onFitAll}
                  title="Auf alle Modelle zoomen [F]"
                />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={orthographic ? <Box size={14} /> : <Rotate3D size={14} />}
                    label={orthographic ? "Ortho" : "Perspektive"}
                    onClick={() => updateSettings({ orthographic: !orthographic })}
                    active={orthographic}
                    title={orthographic ? "Perspektivisch umschalten" : "Orthogonal umschalten"}
                  />
                  <div className="relative">
                    <RibbonSmBtn
                      icon={<LayoutGrid size={14} />}
                      label="Ansicht ▾"
                      onClick={() => { setViewOpen(v => !v); }}
                      title="Kamera-Preset wählen"
                      active={viewOpen}
                    />
                    {viewOpen && (
                      <DropdownMenu onClose={() => setViewOpen(false)}>
                        <div className="px-2 py-1.5 text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Kameraansicht</div>
                        {[
                          { label: "Draufsicht",    preset: "top"    },
                          { label: "Untersicht",    preset: "bottom" },
                          { label: "Vorderansicht", preset: "front"  },
                          { label: "Rückansicht",   preset: "back"   },
                          { label: "Links",         preset: "left"   },
                          { label: "Rechts",        preset: "right"  },
                        ].map((v) => (
                          <DropdownItem key={v.preset} onClick={() => { handlePreset(v.preset); setViewOpen(false); }}>
                            {v.label}
                          </DropdownItem>
                        ))}
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </RibbonGroup>

              {/* WERKZEUGE */}
              <RibbonGroup label="Werkzeuge">
                <RibbonLargeBtn
                  icon={<MousePointer2 size={18} />}
                  label="Auswahl"
                  onClick={() => handleToolClick("select")}
                  active={activeTool === "select"}
                  title="Auswahl-Werkzeug [S]"
                  kbd="S"
                />
                <RibbonLargeBtn
                  icon={<Ruler size={18} />}
                  label={measurements.length > 0 && activeTool === "measure" ? `Messen (${measurements.length})` : "Messen"}
                  onClick={() => handleToolClick("measure")}
                  active={activeTool === "measure"}
                  title="Abstandsmessung [M]"
                  kbd="M"
                />
                <RibbonLargeBtn
                  icon={<Scissors size={18} />}
                  label="Schnitt"
                  onClick={() => {
                    const st = useModelStore.getState();
                    if (st.activeTool === "section" || st.sectionPlanes.length > 0) {
                      st.clearSectionPlanes(); st.setActiveTool("select");
                    } else {
                      st.setActiveTool("section");
                    }
                  }}
                  active={sectionActive}
                  title="Schnittebene [C]"
                  kbd="C"
                />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={<Navigation2 size={14} />}
                    label="Fly"
                    onClick={() => handleToolClick("fly")}
                    active={activeTool === "fly"}
                    title="Fly-Mode [N] · WASD + Maus"
                    kbd="N"
                  />
                  <RibbonSmBtn
                    icon={<BoxSelect size={14} />}
                    label="Flächen-QS"
                    onClick={() => setActiveTool(activeTool === "face-section" ? "select" : "face-section")}
                    active={activeTool === "face-section"}
                    title="Flächen-Querschnitt [X]"
                    kbd="X"
                  />
                </div>
              </RibbonGroup>

              {/* SICHTBARKEIT */}
              <RibbonGroup label="Sichtbarkeit">
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={showSpaces ? <Eye size={14} /> : <EyeOff size={14} />}
                    label="Räume"
                    onClick={() => updateSettings({ showSpaces: !showSpaces })}
                    active={showSpaces}
                    title="Räume ein-/ausblenden"
                  />
                  <RibbonSmBtn
                    icon={<Grid3x3 size={14} />}
                    label="Raster"
                    onClick={() => updateSettings({ grid: !grid })}
                    active={grid}
                    title="Raster ein-/ausblenden"
                  />
                </div>
                <RibbonSmBtn
                  icon={<Box size={14} />}
                  label="Kanten"
                  onClick={() => updateSettings({ edges: !edges })}
                  active={edges}
                  title="Kanten ein-/ausblenden"
                  className="self-center"
                />
              </RibbonGroup>
            </>
          )}

          {activeTab === "analyse" && (
            <>
              {/* PROPERTIES */}
              <RibbonGroup label="Properties">
                <button
                  onClick={() => loadAllProperties()}
                  disabled={loadingPropertiesProgress !== null || models.size === 0}
                  title={
                    loadedProperties
                      ? `Properties neu laden (${loadedPropKeys.length} Attribute geladen)`
                      : "Alle Properties aller Modelle laden"
                  }
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-3 h-full rounded text-center transition-all min-w-[72px]",
                    loadedProperties
                      ? "bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground",
                    (loadingPropertiesProgress !== null || models.size === 0) && "opacity-40 cursor-not-allowed",
                  )}
                >
                  {loadingPropertiesProgress !== null ? (
                    <>
                      <Loader2 size={18} className="animate-spin shrink-0" />
                      <span className="text-[10px] font-medium">{loadingPropertiesProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Database size={18} className="shrink-0" />
                      <span className="text-[10px] font-medium leading-tight">
                        {loadedProperties ? `${loadedPropKeys.length} Attr.` : "Properties\nladen"}
                      </span>
                    </>
                  )}
                </button>
              </RibbonGroup>

              {/* FILTER */}
              <RibbonGroup label="Filter & Analyse">
                <RibbonLargeBtn
                  icon={<Database size={18} />}
                  label="SQL"
                  onClick={() => setSqlPanelOpen(!sqlPanelOpen)}
                  active={sqlPanelOpen}
                  title="SQL-Abfragen [Q]"
                  kbd="Q"
                  popout={() => openSecondaryWindow("sql")}
                />
                <RibbonLargeBtn
                  icon={<List size={18} />}
                  label="Lens"
                  onClick={() => setListPanelOpen(!listPanelOpen)}
                  active={listPanelOpen}
                  title="Lens Rules [L]"
                  kbd="L"
                  popout={() => openSecondaryWindow("lists")}
                />
                <RibbonLargeBtn
                  icon={<Glasses size={18} />}
                  label="SmartViews"
                  onClick={() => setSmartViewsPanelOpen(!smartViewsPanelOpen)}
                  active={smartViewsPanelOpen}
                  title="SmartViews [V]"
                  kbd="V"
                  popout={() => openSecondaryWindow("smartviews")}
                />
                <RibbonLargeBtn
                  icon={<Table2 size={18} />}
                  label="Mengen"
                  onClick={() => setQTOPanelOpen(!qtoPanelOpen)}
                  active={qtoPanelOpen}
                  title="Mengenermittlung [T]"
                  kbd="T"
                  popout={() => openSecondaryWindow("qto")}
                />
              </RibbonGroup>

              {/* KOLLISION */}
              <RibbonGroup label="Prüfung">
                <RibbonLargeBtn
                  icon={<AlertTriangle size={18} />}
                  label="Kollision"
                  onClick={() => setCollisionPanelOpen(true)}
                  disabled={models.size === 0}
                  title="Kollisionsprüfung (Solibri-Style)"
                />
              </RibbonGroup>
            </>
          )}

          {activeTab === "achsen" && (
            <>
              {/* ACHSEN VERWALTUNG */}
              <RibbonGroup label="Achsen">
                <RibbonLargeBtn
                  icon={<Navigation2 size={18} />}
                  label={alignmentFileCount > 0 ? `Achsen (${alignmentFileCount})` : "Achsen"}
                  onClick={toggleAlignmentPanel}
                  active={alignmentPanelOpen}
                  title="Trassen-Panel (LandXML)"
                />
                {alignmentFileCount > 0 && (
                  <RibbonLargeBtn
                    icon={allAlignmentsVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                    label={allAlignmentsVisible ? "Sichtbar" : "Ausgeblendet"}
                    onClick={toggleAllAlignments}
                    active={allAlignmentsVisible}
                    title={allAlignmentsVisible ? "Achsen ausblenden" : "Achsen einblenden"}
                  />
                )}
              </RibbonGroup>

              {/* SCHNITTE */}
              {alignmentFileCount > 0 && (
                <RibbonGroup label="Schnitte">
                  <RibbonLargeBtn
                    icon={<TrendingUp size={18} />}
                    label="Längsschnitt"
                    onClick={() => setProfilePanelOpen(!profilePanelOpen)}
                    active={profilePanelOpen}
                    title="Längenschnitt / Profil [P]"
                    kbd="P"
                  />
                  <RibbonLargeBtn
                    icon={<BoxSelect size={18} />}
                    label="Querschnitt"
                    onClick={() => setActiveTool(activeTool === "face-section" ? "select" : "face-section")}
                    active={activeTool === "face-section"}
                    title="Flächen-Querschnitt — Fläche anklicken"
                  />
                </RibbonGroup>
              )}

              {/* BESCHRIFTUNG */}
              {alignmentFileCount > 0 && (
                <RibbonGroup label="Beschriftung">
                  <RibbonLargeBtn
                    icon={<Tag size={18} />}
                    label={stationLabelVisible ? `Station ${stationLabelInterval}m` : "Stationierung"}
                    onClick={toggleStationLabels}
                    active={stationLabelVisible}
                    title="Stationierungsbeschriftung ein-/ausblenden"
                  />
                  <div className="flex flex-col gap-0.5 justify-center">
                    <div className="relative">
                      <RibbonSmBtn
                        icon={<ChevronDown size={14} />}
                        label="Intervall"
                        onClick={() => setLabelIntervalOpen(v => !v)}
                        title="Stationsintervall wählen"
                      />
                      {labelIntervalOpen && (
                        <DropdownMenu onClose={() => setLabelIntervalOpen(false)}>
                          <div className="px-2 py-1.5 text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Stationsintervall</div>
                          {[10, 25, 50, 100, 250, 500, 1000].map(v => (
                            <DropdownItem
                              key={v}
                              onClick={() => { setStationLabelInterval(v); setLabelIntervalOpen(false); }}
                            >
                              <span className={cn(
                                "flex items-center gap-2 font-mono",
                                stationLabelInterval === v && "text-primary font-semibold",
                              )}>
                                {stationLabelInterval === v ? "✓" : <span className="w-3" />}
                                {v} m
                              </span>
                            </DropdownItem>
                          ))}
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </RibbonGroup>
              )}

              {/* MESSEN */}
              {alignmentFileCount > 0 && (
                <RibbonGroup label="Messen">
                  <RibbonLargeBtn
                    icon={<Crosshair size={18} />}
                    label="Absetzmass"
                    onClick={toggleOffsetTool}
                    active={offsetToolActive}
                    title="Absetzmass messen"
                  />
                </RibbonGroup>
              )}

              {alignmentFileCount === 0 && (
                <div className="flex items-center px-6 text-muted-foreground text-xs gap-2">
                  <Navigation2 size={15} className="opacity-40" />
                  <span className="opacity-60">Keine LandXML-Achsen geladen — Achsen-Panel öffnen um Dateien zu laden</span>
                </div>
              )}
            </>
          )}

          {activeTab === "billing5d" && (
            <>
              {/* ABRECHNUNG */}
              <RibbonGroup label="5D-Abrechnung">
                <RibbonLargeBtn
                  icon={<BarChart2 size={18} />}
                  label={billing5DCount > 0 ? `5D-Fenster (${billing5DCount})` : "5D-Fenster"}
                  onClick={() => openBillingWindow()}
                  title="5D-Abrechnungsfenster öffnen"
                  primary
                />
              </RibbonGroup>

              {/* VISUALISIERUNG */}
              <RibbonGroup label="Visualisierung">
                <RibbonLargeBtn
                  icon={<Target size={18} />}
                  label="Isolieren"
                  onClick={handleIsolate5D}
                  disabled={billing5DCount === 0}
                  title={billing5DCount > 0 ? `5D-Elemente isolieren (${billing5DCount} erfasst)` : "Keine 5D-Elemente erfasst"}
                />
                <RibbonLargeBtn
                  icon={<Layers size={18} />}
                  label={billingModuleActive ? "Overlay AN" : "Overlay AUS"}
                  onClick={handleToggleVisualize5D}
                  active={billingModuleActive}
                  disabled={billing5DCount === 0}
                  title={billingModuleActive ? "5D-Farbvisualisierung ausschalten" : "5D-Farbvisualisierung einschalten"}
                />
              </RibbonGroup>

              {billing5DCount === 0 && (
                <div className="flex items-center px-6 text-muted-foreground text-xs gap-2">
                  <BarChart2 size={15} className="opacity-40" />
                  <span className="opacity-60">Noch keine 5D-Elemente erfasst — 5D-Fenster öffnen und Elemente auswählen</span>
                </div>
              )}
            </>
          )}

          {activeTab === "extras" && (
            <>
              {/* NAVIGATION */}
              <RibbonGroup label="Navigation">
                <RibbonLargeBtn
                  icon={<Gamepad2 size={18} />}
                  label="Drohne"
                  onClick={() => setActiveTool(activeTool === "drone" ? "select" : "drone")}
                  active={activeTool === "drone"}
                  title="Drohnen-Kamera [B] · Gamepad oder WASD"
                  kbd="B"
                />
              </RibbonGroup>

              {/* MODELLE */}
              <RibbonGroup label="Modellverwaltung">
                <RibbonLargeBtn
                  icon={<Sliders size={18} />}
                  label="Batch"
                  onClick={onOpenBatch}
                  title="Batch-Änderungen an Eigenschaften"
                />
                <RibbonLargeBtn
                  icon={<AlertTriangle size={18} />}
                  label="Kollision"
                  onClick={() => setCollisionPanelOpen(true)}
                  disabled={models.size === 0}
                  title="Kollisionsprüfung (Solibri-Style)"
                />
              </RibbonGroup>
            </>
          )}
        </div>
      </div>

      {infoOpen && <HelpPanel onClose={() => setInfoOpen(false)} />}
    </>
  );
}

// ── Ribbon building blocks ────────────────────────────────────────────────────

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch border-r border-border/50 last:border-r-0">
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-0.5 px-1.5 pt-1.5 pb-0.5 flex-1">
          {children}
        </div>
        <div className="px-2 pb-1 text-[8.5px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-center leading-none whitespace-nowrap">
          {label}
        </div>
      </div>
    </div>
  );
}

function RibbonLargeBtn({
  icon, label, onClick, active, disabled, title, primary, kbd, popout, className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  kbd?: string;
  popout?: () => void;
  className?: string;
}) {
  return (
    <div className="relative group/lbtn flex flex-col items-center">
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
          "flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded transition-all min-w-[44px] h-full text-center",
          primary && !active && "bg-primary text-primary-foreground hover:bg-primary/90",
          !primary && active && "bg-primary/15 text-primary",
          !primary && !active && "text-foreground/80 hover:bg-muted hover:text-foreground",
          disabled && "opacity-35 cursor-not-allowed pointer-events-none",
          className,
        )}
      >
        <span className={cn("shrink-0", active && !primary && "text-primary")}>{icon}</span>
        <span className="text-[9.5px] font-medium leading-tight max-w-[60px] text-center whitespace-nowrap overflow-hidden text-ellipsis">
          {label}
        </span>
        {kbd && (
          <span className="text-[7px] opacity-0 group-hover/lbtn:opacity-60 transition-opacity text-muted-foreground font-mono leading-none">
            [{kbd}]
          </span>
        )}
      </button>
      {popout && (
        <button
          className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-card border border-border flex items-center justify-center opacity-0 group-hover/lbtn:opacity-100 hover:!opacity-100 hover:bg-primary hover:border-primary hover:text-primary-foreground text-muted-foreground transition-all z-10"
          title="In neuem Fenster öffnen"
          onClick={(e) => { e.stopPropagation(); popout(); }}
        >
          <ExternalLink size={7} />
        </button>
      )}
    </div>
  );
}

function RibbonSmBtn({
  icon, label, onClick, active, disabled, title, kbd, className,
}: {
  icon: React.ReactNode;
  label?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  kbd?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded transition-all text-left",
        active ? "bg-primary/15 text-primary" : "text-foreground/70 hover:bg-muted hover:text-foreground",
        disabled && "opacity-35 cursor-not-allowed pointer-events-none",
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label && <span className="text-[9.5px] font-medium whitespace-nowrap">{label}</span>}
      {kbd && <span className="text-[7px] opacity-40 font-mono">[{kbd}]</span>}
    </button>
  );
}

function UtilBtn({
  children, onClick, title, active, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center justify-center w-6 h-6 rounded transition-all",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
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
        "absolute top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-2xl min-w-[180px] py-1",
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
        "w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-foreground",
        disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/60"
      )}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
      {children}
    </button>
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
