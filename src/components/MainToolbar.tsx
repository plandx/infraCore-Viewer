import { useRef, useState, useCallback } from "react";
import {
  FolderOpen, Plus, Sun, Moon, Maximize2,
  MousePointer2, Ruler, Scissors, Eye, EyeOff,
  Download, Info, Database, Camera, FileDown,
  Box, ChevronDown, LayoutGrid, Rotate3D,
  X, List, Glasses, AppWindow, Table2, ExternalLink, Loader2, BarChart2, Sliders,
  Target, Layers, RotateCcw, Navigation2, TrendingUp, Tag, Crosshair,
  Settings, AlertTriangle, PanelLeftClose, PanelLeftOpen, Grid3x3, BoxSelect, Terminal,
  FileCheck2, FilePlus, Play, Upload, Shield, MessageSquare,
  Save, FolderInput,
} from "lucide-react";
import { openSecondaryWindow, openBillingWindow, openCollisionWindow, openIdsResultsWindow, PANEL_META } from "../utils/windowSync";
import { useIdsStore } from "../ids/idsStore";
import { useBcfStore } from "../bcf/bcfStore";
import { importBcf } from "../bcf/bcfParser";
import { exportBcf } from "../bcf/bcfWriter";
import type { BcfVersion } from "../bcf/bcfTypes";
import { parseIdsXml } from "../ids/idsParser";
import { serializeIdsToXml } from "../ids/idsWriter";
import { validateIdsDocument } from "../ids/idsValidator";
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
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  onSaveProject?: () => void;
  onLoadProject?: () => void;
}

export type RibbonTab = "start" | "analyse" | "achsen" | "billing5d" | "extras" | "ids" | "bcf";

// ── Main component ────────────────────────────────────────────────────────────

export function MainToolbar({ onOpenFiles, onFitAll, loading, onOpenBatch, onToggleLeftPanel, onToggleRightPanel, leftPanelVisible, rightPanelVisible, onSaveProject, onLoadProject }: Props) {
  const inputRef        = useRef<HTMLInputElement>(null);
  const addInputRef     = useRef<HTMLInputElement>(null);
  const landXmlInputRef = useRef<HTMLInputElement>(null);

  const loadedProperties          = useModelStore((s) => s.loadedProperties);
  const loadingPropertiesProgress = useModelStore((s) => s.loadingPropertiesProgress);
  const loadAllProperties         = useModelStore((s) => s.loadAllProperties);
  const loadedPropKeys            = useModelStore((s) => s.loadedPropKeys);

  const theme             = useModelStore((s) => s.settings.theme);
  const sectionActive     = useModelStore((s) => s.sectionPlanes.length > 0 || s.activeTool === "section");
  const isolatedElements  = useModelStore((s) => s.isolatedElements);
  const showAll           = useModelStore((s) => s.showAll);
  const orthographic      = useModelStore((s) => s.settings.orthographic);
  const showSpaces        = useModelStore((s) => s.settings.showSpaces);
  const grid              = useModelStore((s) => s.settings.grid);
  const edges             = useModelStore((s) => s.settings.edges);
  const viewCube          = useModelStore((s) => s.settings.viewCube ?? true);
  const activeTool        = useModelStore((s) => s.activeTool);
  const updateSettings    = useModelStore((s) => s.updateSettings);
  const setActiveTool     = useModelStore((s) => s.setActiveTool);
  const setSettingsPanelOpen  = useModelStore((s) => s.setSettingsPanelOpen);
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
  const setPythonPanelOpen = useModelStore((s) => s.setPythonPanelOpen);
  const pythonPanelOpen    = useModelStore((s) => s.pythonPanelOpen);
  const clearMeasurements = useModelStore((s) => s.clearMeasurements);
  const measurements      = useModelStore((s) => s.measurements);
  const models            = useModelStore((s) => s.models);
  const propertyOverrides = useModelStore((s) => s.propertyOverrides);

  // 5D state
  const billingModuleActive  = useBillingStore((s) => s.moduleActive);
  const billing5DCount       = useBillingStore((s) => Object.keys(s.entries).length);
  const billing5DPanelOpen   = useModelStore((s) => s.billing5DPanelOpen);
  const setBilling5DPanelOpen = useModelStore((s) => s.setBilling5DPanelOpen);

  // Alignment state (sidebar panel no longer used — all inline in Achsen ribbon tab)
  const alignmentFileCount    = useAlignmentStore((s) => s.files.length);
  const alignmentVisibleIds   = useAlignmentStore((s) => s.visibleIds);
  const alignmentFiles        = useAlignmentStore((s) => s.files);
  const alignmentColors       = useAlignmentStore((s) => s.colors);
  const alignmentSelectedId   = useAlignmentStore((s) => s.selectedId);
  const toggleVisible         = useAlignmentStore((s) => s.toggleVisible);
  const selectAlignment       = useAlignmentStore((s) => s.selectAlignment);
  const loadAlignmentFile     = useAlignmentStore((s) => s.loadFile);
  const removeAlignmentFile   = useAlignmentStore((s) => s.removeFile);
  const sampleInterval        = useAlignmentStore((s) => s.sampleInterval);
  const stationToolActive     = useAlignmentStore((s) => s.stationToolActive);
  const setSampleInterval     = useAlignmentStore((s) => s.setSampleInterval);
  const toggleStationTool     = useAlignmentStore((s) => s.toggleStationTool);
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
  const idsFileInputRef = useRef<HTMLInputElement>(null);
  const {
    documents: idsDocs,
    activeDocumentId: idsActiveDocId,
    idsPanelOpen,
    createDocument: idsCreateDocument,
    loadDocument: idsLoadDocument,
    setIdsPanelOpen,
    addSpecification: idsAddSpecification,
    setValidationReport: idsSetValidationReport,
  } = useIdsStore();
  const bcfTopicCount = useBcfStore((s) => s.document.topics.length);
  const bcfPanelOpen = useBcfStore((s) => s.bcfPanelOpen);
  const setBcfPanelOpen = useBcfStore((s) => s.setBcfPanelOpen);
  const bcfDocument = useBcfStore((s) => s.document);
  const bcfAddTopic = useBcfStore((s) => s.addTopic);
  const [bcfExportVersion, setBcfExportVersion] = useState<BcfVersion>("2.1");
  const bcfFileInputRef = useRef<HTMLInputElement>(null);

  const [ifcExporting, setIfcExporting]     = useState(false);
  const [viewOpen, setViewOpen]             = useState(false);
  const [infoOpen, setInfoOpen]             = useState(false);
  const [windowOpen, setWindowOpen]         = useState(false);
  const [labelIntervalOpen, setLabelIntervalOpen] = useState(false);
  const [alignmentDragOver, setAlignmentDragOver] = useState(false);
  const [alignmentListOpen, setAlignmentListOpen] = useState(false);

  const handleLandXmlFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    for (const f of Array.from(fileList)) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".xml") || lower.endsWith(".landxml")) void loadAlignmentFile(f);
    }
  }, [loadAlignmentFile]);

  function formatStation(sta: number): string {
    const km = Math.floor(sta / 1000);
    const m  = sta - km * 1000;
    return `${km}+${m.toFixed(3).padStart(7, "0")}`;
  }
  function formatLength(len: number): string {
    return len.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
  }

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
    if (isolatedElements !== null) {
      showAll();
      return;
    }
    const entries = useBillingStore.getState().entries;
    const models  = useModelStore.getState().models;
    if (Object.keys(entries).length === 0) return;

    const toIsolate: Array<{ modelId: string; expressId: number }> = [];
    for (const entry of Object.values(entries)) {
      const guid = entry.guid;
      if (!guid) continue;
      models.forEach((m, modelId) => {
        for (const els of Object.values(m.elementsByType)) {
          const found = (els as Array<{ expressId: number; guid?: string }>).find(el => el.guid === guid);
          if (found) { toIsolate.push({ modelId, expressId: found.expressId }); break; }
        }
      });
    }
    if (toIsolate.length > 0) useModelStore.getState().isolateEntries(toIsolate);
  }, [isolatedElements, showAll]);

  const handleToggleVisualize5D = useCallback(() => {
    useBillingStore.getState().setModuleActive(!useBillingStore.getState().moduleActive);
  }, []);

  const handleResetApp = useCallback(() => {
    if (!window.confirm("App vollständig zurücksetzen?\n\nAlle Modelle, Messungen, SmartViews, QTO-Listen, Eigenschafts-Overrides und 5D-Abrechnungsdaten werden gelöscht.\n\nViewer-Einstellungen und Tastenkürzel bleiben erhalten.")) return;
    useModelStore.getState().resetAll();
    useBillingStore.getState().clearAll();
    const al = useAlignmentStore.getState();
    for (const f of al.files) al.removeFile(f.id);
    al.closeCrossSection();
    al.closeFaceCrossSection();
    al.setShowSectionSurface(false);
    al.clearAllAnnotations();
    useAlignmentStore.setState({ stationToolActive: false, labelToolActive: false, offsetToolActive: false });
    window.dispatchEvent(new Event("viewer:fitAll"));
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

  const tabs: { id: RibbonTab; label: string; badge?: number }[] = [
    { id: "start",     label: "Start" },
    { id: "analyse",   label: "Analyse" },
    { id: "achsen",    label: "Achsen",  badge: alignmentFileCount > 0 ? alignmentFileCount : undefined },
    { id: "billing5d", label: "5D",      badge: billing5DCount > 0 ? billing5DCount : undefined },
    { id: "extras",    label: "Extras" },
    { id: "ids",       label: "IDS" },
    { id: "bcf",       label: "BCF", badge: bcfTopicCount > 0 ? bcfTopicCount : undefined },
  ];

  return (
    <>
      <input ref={inputRef}        type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
      <input ref={addInputRef}     type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
      <input ref={landXmlInputRef} type="file" accept=".xml,.landxml" multiple className="hidden"
        onChange={e => { handleLandXmlFiles(e.target.files); e.target.value = ""; }} />

      <div
        className="flex flex-col shrink-0 select-none relative z-[100]"
        style={{
          fontSize: '13px',
          background: 'var(--ic-surface)',
          boxShadow: '0 1px 0 var(--ic-border)',
        }}
      >

        {/* ── Row 1: Tab strip + utilities ──────────────────────────────── */}
        <div className="flex items-stretch h-8 border-b border-border/40">

          {/* Logo */}
          <div className="flex items-center gap-2 px-3.5 border-r border-border/70">
            <svg width="18" height="18" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[3px]">
              <rect width="32" height="32" rx="5" fill="#E8312A"/>
              <text x="16" y="23" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
            </svg>
            <span className="font-bold text-[12px] tracking-tight text-foreground whitespace-nowrap">infraCore</span>
          </div>

          {/* Tab buttons */}
          <div className="flex items-stretch">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === "ids") { setIdsPanelOpen(true); setBcfPanelOpen(false); }
                  else if (tab.id === "bcf") { setBcfPanelOpen(true); setIdsPanelOpen(false); }
                  else { if (idsPanelOpen) setIdsPanelOpen(false); if (bcfPanelOpen) setBcfPanelOpen(false); }
                }}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 text-[12px] transition-colors border-b-2 whitespace-nowrap h-full",
                  activeTab === tab.id
                    ? "font-semibold text-foreground border-primary"
                    : "font-normal text-muted-foreground border-transparent hover:text-foreground hover:bg-[#F0F0F0] dark:hover:bg-[#383838]"
                )}
              >
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="text-[9px] bg-primary/15 text-primary px-1 rounded-[3px] font-mono leading-none py-0.5 border border-primary/20">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Right utility strip — always visible */}
          <div className="flex items-center gap-1 px-2.5 border-l border-border/60">
            {loading && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mr-1">
                <Loader2 size={11} className="animate-spin" />
                <span>Lädt…</span>
              </div>
            )}

            {/* Secondary windows */}
            <div className="relative">
              <UtilBtn active={windowOpen} title="Panel in neuem Fenster öffnen"
                onClick={() => { setWindowOpen(v => !v); setExportOpen(false); setViewOpen(false); }}>
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
              <UtilBtn active={exportOpen} title="Exportieren"
                onClick={() => { setExportOpen(v => !v); setViewOpen(false); setWindowOpen(false); }}>
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

            <UtilBtn title="Tastenkürzel & Info" onClick={() => setInfoOpen(true)}>
              <Info size={13} />
            </UtilBtn>

            <div className="w-px h-4 bg-border/60 mx-0.5" />

            <UtilBtn title="Einstellungen (Schriftgröße, Tastenkürzel, …)" onClick={() => setSettingsPanelOpen(true)}>
              <Settings size={13} />
            </UtilBtn>
            <UtilBtn title="Hell/Dunkel" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
            </UtilBtn>
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
        <div className="flex items-stretch h-[62px] overflow-visible">

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
                />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn icon={<Plus size={14} />} label="Hinzufügen"
                    onClick={() => addInputRef.current?.click()} disabled={loading}
                    title="Weiteres Modell hinzufügen" />
                  <RibbonSmBtn icon={<Sliders size={14} />} label="Batch"
                    onClick={onOpenBatch} title="Batch-Änderungen" />
                </div>
              </RibbonGroup>

              {/* PROJEKT */}
              <RibbonGroup label="Projekt">
                <RibbonLargeBtn
                  icon={<Save size={18} />}
                  label="Speichern"
                  onClick={onSaveProject}
                  disabled={!onSaveProject}
                  title="Projekt als .icproj speichern (Modelle + Einstellungen)"
                />
                <RibbonLargeBtn
                  icon={<FolderInput size={18} />}
                  label="Laden"
                  onClick={onLoadProject}
                  disabled={!onLoadProject}
                  title=".icproj Projektdatei öffnen"
                />
              </RibbonGroup>

              {/* KAMERA */}
              <RibbonGroup label="Kamera">
                <RibbonLargeBtn icon={<Maximize2 size={18} />} label="Einpassen"
                  onClick={onFitAll} title="Auf alle Modelle zoomen [F]" />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={orthographic ? <Box size={14} /> : <Rotate3D size={14} />}
                    label={orthographic ? "Ortho" : "Perspektive"}
                    onClick={() => updateSettings({ orthographic: !orthographic })}
                    active={orthographic}
                    title={orthographic ? "Perspektivisch umschalten" : "Orthogonal umschalten"} />
                  <div className="relative">
                    <RibbonSmBtn icon={<LayoutGrid size={14} />} label="Ansicht ▾"
                      onClick={() => setViewOpen(v => !v)} active={viewOpen}
                      title="Kamera-Preset wählen" />
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
                <RibbonLargeBtn icon={<MousePointer2 size={18} />} label="Auswahl"
                  onClick={() => handleToolClick("select")} active={activeTool === "select"}
                  title="Auswahl [S]" kbd="S" />
                <RibbonLargeBtn icon={<Ruler size={18} />}
                  label={measurements.length > 0 && activeTool === "measure" ? `Messen (${measurements.length})` : "Messen"}
                  onClick={() => handleToolClick("measure")} active={activeTool === "measure"}
                  title="Abstandsmessung [M] · erneut klicken zum Löschen" kbd="M" />
                <RibbonLargeBtn icon={<Scissors size={18} />} label="Schnitt"
                  onClick={() => {
                    const st = useModelStore.getState();
                    if (st.activeTool === "section" || st.sectionPlanes.length > 0) {
                      st.clearSectionPlanes(); st.setActiveTool("select");
                    } else {
                      st.setActiveTool("section");
                    }
                  }}
                  active={sectionActive} title="Schnittebene [C] · Fläche anklicken" kbd="C" />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn icon={<Navigation2 size={14} />} label="Fly"
                    onClick={() => handleToolClick("fly")} active={activeTool === "fly"}
                    title="Fly-Mode [N] · WASD + Maus · Scroll Geschwindigkeit" kbd="N" />
                  <RibbonSmBtn icon={<BoxSelect size={14} />} label="Flächen-QS"
                    onClick={() => setActiveTool(activeTool === "face-section" ? "select" : "face-section")}
                    active={activeTool === "face-section"}
                    title="Flächen-Querschnitt · Fläche anklicken für senkrechten QS" />
                </div>
              </RibbonGroup>

              {/* SICHTBARKEIT */}
              <RibbonGroup label="Sichtbarkeit">
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={leftPanelVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                    label="Hierarchie"
                    onClick={onToggleLeftPanel}
                    active={!leftPanelVisible}
                    title={leftPanelVisible ? "Projekthierarchie ausblenden" : "Projekthierarchie einblenden"} />
                  <RibbonSmBtn
                    icon={<span className="inline-flex scale-x-[-1]">{rightPanelVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}</span>}
                    label="Eigenschaften"
                    onClick={onToggleRightPanel}
                    active={!rightPanelVisible}
                    title={rightPanelVisible ? "Eigenschaften ausblenden" : "Eigenschaften einblenden"} />
                </div>
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={showSpaces ? <Eye size={14} /> : <EyeOff size={14} />}
                    label="Räume" onClick={() => updateSettings({ showSpaces: !showSpaces })}
                    active={showSpaces} title="Räume ein-/ausblenden" />
                  <RibbonSmBtn icon={<Grid3x3 size={14} />} label="Raster"
                    onClick={() => updateSettings({ grid: !grid })} active={grid}
                    title="Raster ein-/ausblenden" />
                </div>
                <RibbonSmBtn icon={<Box size={14} />} label="Kanten"
                  onClick={() => updateSettings({ edges: !edges })} active={edges}
                  title="Kanten ein-/ausblenden" className="self-center" />
                <RibbonSmBtn icon={<Rotate3D size={14} />} label="ViewCube"
                  onClick={() => updateSettings({ viewCube: !viewCube })} active={viewCube}
                  title="ViewCube ein-/ausblenden (CUBE)" className="self-center" />
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
                  title={loadedProperties
                    ? `Properties neu laden (${loadedPropKeys.length} Attribute geladen)`
                    : "Alle Properties aller Modelle laden"}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-3 h-full rounded text-center transition-all min-w-[72px]",
                    loadedProperties
                      ? "bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground",
                    (loadingPropertiesProgress !== null || models.size === 0) && "opacity-40 cursor-not-allowed",
                  )}
                >
                  {loadingPropertiesProgress !== null ? (
                    <><Loader2 size={18} className="animate-spin shrink-0" /><span className="text-[10px] font-medium">{loadingPropertiesProgress}%</span></>
                  ) : (
                    <><Database size={18} className="shrink-0" /><span className="text-[10px] font-medium leading-tight">{loadedProperties ? `${loadedPropKeys.length} Attr.` : "Properties\nladen"}</span></>
                  )}
                </button>
              </RibbonGroup>

              {/* FILTER & ANALYSE */}
              <RibbonGroup label="Filter & Analyse">
                <RibbonLargeBtn icon={<Database size={18} />} label="SQL"
                  onClick={() => setSqlPanelOpen(!sqlPanelOpen)} active={sqlPanelOpen}
                  title="SQL-Abfragen [Q]" kbd="Q" popout={() => openSecondaryWindow("sql")} />
                <RibbonLargeBtn icon={<List size={18} />} label="Lens"
                  onClick={() => setListPanelOpen(!listPanelOpen)} active={listPanelOpen}
                  title="Lens Rules [L]" kbd="L" popout={() => openSecondaryWindow("lists")} />
                <RibbonLargeBtn icon={<Glasses size={18} />} label="SmartViews"
                  onClick={() => setSmartViewsPanelOpen(!smartViewsPanelOpen)} active={smartViewsPanelOpen}
                  title="SmartViews [V]" kbd="V" popout={() => openSecondaryWindow("smartviews")} />
                <RibbonLargeBtn icon={<Table2 size={18} />} label="Mengen"
                  onClick={() => setQTOPanelOpen(!qtoPanelOpen)} active={qtoPanelOpen}
                  title="Mengenermittlung [T]" kbd="T" popout={() => openSecondaryWindow("qto")} />
                <RibbonLargeBtn icon={<Terminal size={18} />} label="Python"
                  onClick={() => setPythonPanelOpen(!pythonPanelOpen)} active={pythonPanelOpen}
                  title="Python / IfcOpenShell [Y]" kbd="Y" />
              </RibbonGroup>

              {/* PRÜFUNG */}
              <RibbonGroup label="Prüfung">
                <RibbonLargeBtn icon={<AlertTriangle size={18} />} label="Kollision"
                  onClick={() => openCollisionWindow()} disabled={models.size === 0}
                  title="Kollisionsprüfung (Solibri-Style)" />
              </RibbonGroup>
            </>
          )}

          {activeTab === "achsen" && (
            <>
              {/* LADEN */}
              <RibbonGroup label="Laden">
                <RibbonLargeBtn
                  icon={<Upload size={18} />}
                  label="LandXML"
                  onClick={() => landXmlInputRef.current?.click()}
                  title="LandXML-Datei laden (.xml / .landxml)"
                  primary={alignmentFileCount === 0}
                />
                {/* Achsen-Dropdown */}
                {alignmentFileCount > 0 && (
                  <div className="relative flex flex-col justify-center">
                    <button
                      onClick={() => setAlignmentListOpen(v => !v)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-[4px] text-[11px] font-medium transition-colors border",
                        alignmentListOpen
                          ? "bg-primary/10 border-primary/40 text-primary"
                          : "border-border text-foreground hover:bg-muted/40"
                      )}
                      title="Achsen-Liste"
                    >
                      <Navigation2 size={12} />
                      <span>Achsen ({alignmentFileCount > 0 ? alignmentFiles.flatMap(f => f.alignments).length : 0})</span>
                      <ChevronDown size={10} className={cn("transition-transform", alignmentListOpen && "rotate-180")} />
                    </button>
                    {alignmentListOpen && (
                      <DropdownMenu onClose={() => setAlignmentListOpen(false)} minWidth={280} maxHeight={320}>
                        {alignmentFiles.map(f => (
                          <div key={f.id}>
                            <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/30">
                              <span className="flex-1 truncate text-[10px] font-semibold text-foreground">{f.fileName}</span>
                              <button className="text-muted-foreground hover:text-red-400 p-0.5" onClick={() => removeAlignmentFile(f.id)} title="Datei entfernen">
                                <X size={11} />
                              </button>
                            </div>
                            {f.alignments.map(align => (
                              <DropdownItem
                                key={align.id}
                                onClick={() => selectAlignment(alignmentSelectedId === align.id ? null : align.id)}
                              >
                                <div className={cn("flex items-center gap-2 w-full", alignmentSelectedId === align.id && "text-primary")}>
                                  <button
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                    onClick={e => { e.stopPropagation(); toggleVisible(align.id); }}
                                  >
                                    {alignmentVisibleIds.has(align.id) ? <Eye size={11} /> : <EyeOff size={11} />}
                                  </button>
                                  <span className="shrink-0 w-2.5 h-2.5 rounded-[2px] border border-border/60" style={{ backgroundColor: alignmentColors[align.id] ?? "#888" }} />
                                  <span className="flex-1 truncate text-[11px]">{align.displayName}</span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">{formatLength(align.length)}</span>
                                  {align.zSource === "profile"   && <span className="text-sky-400 text-[9px] font-mono shrink-0">Z</span>}
                                  {align.zSource === "coordgeom" && <span className="text-yellow-400 text-[9px] font-mono shrink-0">Z?</span>}
                                </div>
                              </DropdownItem>
                            ))}
                          </div>
                        ))}
                        <div className="border-t border-border/30 px-2 py-1.5 flex items-center gap-2">
                          <button
                            onClick={() => { toggleAllAlignments(); }}
                            className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {allAlignmentsVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                            {allAlignmentsVisible ? "Alle ausblenden" : "Alle einblenden"}
                          </button>
                        </div>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </RibbonGroup>

              {alignmentFileCount > 0 && (
                <RibbonGroup label="Schnitte">
                  <RibbonLargeBtn icon={<TrendingUp size={18} />} label="Längsschnitt"
                    onClick={() => setProfilePanelOpen(!profilePanelOpen)} active={profilePanelOpen}
                    title="Längenschnitt / Profil [P]" kbd="P" />
                  <RibbonLargeBtn icon={<BoxSelect size={18} />} label="Querschnitt"
                    onClick={() => setActiveTool(activeTool === "face-section" ? "select" : "face-section")}
                    active={activeTool === "face-section"}
                    title="Flächen-Querschnitt — Fläche anklicken" />
                </RibbonGroup>
              )}

              {alignmentFileCount > 0 && (
                <RibbonGroup label="Beschriftung">
                  <RibbonLargeBtn
                    icon={<Tag size={18} />}
                    label={stationLabelVisible ? `Station ${stationLabelInterval} m` : "Stationierung"}
                    onClick={toggleStationLabels} active={stationLabelVisible}
                    title="Stationierungsbeschriftung ein-/ausblenden" />
                  <div className="relative flex flex-col justify-center">
                    <RibbonSmBtn icon={<ChevronDown size={14} />} label="Intervall"
                      onClick={() => setLabelIntervalOpen(v => !v)} title="Stationsintervall wählen" />
                    {labelIntervalOpen && (
                      <DropdownMenu onClose={() => setLabelIntervalOpen(false)}>
                        <div className="px-2 py-1.5 text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Stationsintervall</div>
                        {[10, 25, 50, 100, 250, 500, 1000].map(v => (
                          <DropdownItem key={v} onClick={() => { setStationLabelInterval(v); setLabelIntervalOpen(false); }}>
                            <span className={cn("flex items-center gap-2 font-mono", stationLabelInterval === v && "text-primary font-semibold")}>
                              {stationLabelInterval === v ? "✓" : <span className="w-3" />}{v} m
                            </span>
                          </DropdownItem>
                        ))}
                      </DropdownMenu>
                    )}
                  </div>
                </RibbonGroup>
              )}

              {alignmentFileCount > 0 && (
                <RibbonGroup label="Messen">
                  <RibbonLargeBtn icon={<Ruler size={18} />} label={stationToolActive ? "Messen AN" : "Stationierung"}
                    onClick={toggleStationTool} active={stationToolActive}
                    title="Stationierung auf Achse messen" />
                  <RibbonLargeBtn icon={<Crosshair size={18} />} label="Absetzmass"
                    onClick={toggleOffsetTool} active={offsetToolActive}
                    title="Absetzmass messen" />
                </RibbonGroup>
              )}

              {alignmentFileCount > 0 && (
                <RibbonGroup label="Darstellung">
                  <div className="flex flex-col gap-0.5 justify-center px-1">
                    <span className="text-[9px] text-muted-foreground">Auflösung</span>
                    <select
                      value={sampleInterval}
                      onChange={e => setSampleInterval(Number(e.target.value))}
                      className="bg-background border border-border text-foreground text-[11px] rounded-[3px] px-1 py-0.5 outline-none w-16"
                    >
                      {[1, 2, 5, 10, 25, 50].map(v => (
                        <option key={v} value={v}>{v} m</option>
                      ))}
                    </select>
                  </div>
                </RibbonGroup>
              )}

              {alignmentFileCount === 0 && (
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 mx-2 my-1.5 rounded-[6px] border-2 border-dashed cursor-pointer transition-colors text-xs text-muted-foreground",
                    alignmentDragOver ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-muted-foreground hover:bg-muted/20"
                  )}
                  onClick={() => landXmlInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setAlignmentDragOver(true); }}
                  onDragLeave={() => setAlignmentDragOver(false)}
                  onDrop={e => { e.preventDefault(); setAlignmentDragOver(false); handleLandXmlFiles(e.dataTransfer.files); }}
                >
                  <Navigation2 size={16} className="opacity-50 shrink-0" />
                  <span>LandXML / .xml hier ablegen oder klicken zum Laden</span>
                </div>
              )}
            </>
          )}

          {activeTab === "billing5d" && (
            <>
              {/* 5D-ABRECHNUNG */}
              <RibbonGroup label="5D-Abrechnung">
                <div className="relative group/popout5d h-full">
                  <RibbonLargeBtn
                    icon={<BarChart2 size={18} />}
                    label={billing5DCount > 0 ? `5D-Panel (${billing5DCount})` : "5D-Panel"}
                    onClick={() => setBilling5DPanelOpen(!billing5DPanelOpen)}
                    active={billing5DPanelOpen}
                    title="5D-Abrechnung (Inline-Overlay)"
                    primary={!billing5DPanelOpen}
                  />
                  <button
                    className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-card border border-border flex items-center justify-center opacity-0 group-hover/popout5d:opacity-100 hover:!opacity-100 hover:bg-primary hover:border-primary hover:text-primary-foreground text-muted-foreground transition-all z-10"
                    title="5D-Abrechnung in neuem Fenster öffnen"
                    onClick={(e) => { e.stopPropagation(); openBillingWindow(); }}
                  >
                    <ExternalLink size={7} />
                  </button>
                </div>
              </RibbonGroup>

              {/* VISUALISIERUNG */}
              <RibbonGroup label="Visualisierung">
                <RibbonLargeBtn
                  icon={<Target size={18} />}
                  label={isolatedElements !== null ? "Isolation aus" : "Isolieren"}
                  active={isolatedElements !== null}
                  onClick={handleIsolate5D}
                  disabled={billing5DCount === 0 && isolatedElements === null}
                  title={isolatedElements !== null ? "Isolation aufheben" : billing5DCount > 0 ? `5D-Elemente isolieren (${billing5DCount} erfasst)` : "Keine 5D-Elemente erfasst"}
                />
                <RibbonLargeBtn icon={<Layers size={18} />}
                  label={billingModuleActive ? "Overlay AN" : "Overlay AUS"}
                  onClick={handleToggleVisualize5D} active={billingModuleActive}
                  disabled={billing5DCount === 0}
                  title={billingModuleActive ? "5D-Farbvisualisierung ausschalten" : "5D-Farbvisualisierung einschalten"} />
              </RibbonGroup>

              {billing5DCount === 0 && (
                <div className="flex items-center px-6 text-muted-foreground text-xs gap-2">
                  <BarChart2 size={15} className="opacity-40" />
                  <span className="opacity-60">Noch keine 5D-Elemente erfasst — 5D-Panel öffnen und Elemente auswählen</span>
                </div>
              )}
            </>
          )}

          {activeTab === "extras" && (
            <RibbonGroup label="Modellverwaltung">
              <RibbonLargeBtn icon={<Sliders size={18} />} label="Batch"
                onClick={onOpenBatch} title="Batch-Änderungen an Eigenschaften" />
              <RibbonLargeBtn icon={<AlertTriangle size={18} />} label="Kollision"
                onClick={() => openCollisionWindow()} disabled={models.size === 0}
                title="Kollisionsprüfung (Solibri-Style)" />
            </RibbonGroup>
          )}

          {activeTab === "ids" && (
            <>
              <input
                ref={idsFileInputRef}
                type="file"
                accept=".ids,.xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  try {
                    const doc = parseIdsXml(text);
                    idsLoadDocument(doc, file.name);
                    setIdsPanelOpen(true);
                  } catch (err) {
                    alert(`Fehler beim Laden: ${err}`);
                  }
                  e.target.value = "";
                }}
              />
              <RibbonGroup label="Dokument">
                <RibbonLargeBtn
                  icon={<FilePlus size={18} />}
                  label="Neu"
                  onClick={() => { idsCreateDocument(); setIdsPanelOpen(true); }}
                  title="Neues IDS-Dokument erstellen"
                />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={<Upload size={14} />}
                    label="Öffnen"
                    onClick={() => idsFileInputRef.current?.click()}
                    title=".ids Datei laden"
                  />
                  <RibbonSmBtn
                    icon={<Download size={14} />}
                    label="Speichern"
                    disabled={!idsActiveDocId}
                    onClick={() => {
                      const doc = useIdsStore.getState().documents.find((d) => d.id === idsActiveDocId);
                      if (!doc) return;
                      const xml = serializeIdsToXml(doc);
                      const blob = new Blob([xml], { type: "application/xml" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = doc.fileName ?? `${doc.info.title}.ids`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    title="Aktives IDS-Dokument als .ids exportieren"
                  />
                </div>
              </RibbonGroup>
              <RibbonGroup label="Spezifikationen">
                <RibbonLargeBtn
                  icon={<Shield size={18} />}
                  label="Hinzufügen"
                  disabled={!idsActiveDocId}
                  onClick={() => {
                    if (idsActiveDocId) { idsAddSpecification(idsActiveDocId); setIdsPanelOpen(true); }
                  }}
                  title="Neue Spezifikation zum aktiven Dokument hinzufügen"
                />
              </RibbonGroup>
              <RibbonGroup label="Prüfung">
                <RibbonLargeBtn
                  icon={<Play size={18} />}
                  label="Prüfen"
                  disabled={!idsActiveDocId || models.size === 0}
                  onClick={() => {
                    const doc = useIdsStore.getState().documents.find((d) => d.id === idsActiveDocId);
                    if (!doc) return;
                    const { models: m, loadedProperties } = useModelStore.getState();
                    const report = validateIdsDocument(doc, m, loadedProperties);
                    idsSetValidationReport(report);
                    setIdsPanelOpen(true);
                  }}
                  title="IDS gegen geladene IFC-Modelle prüfen"
                />
                <RibbonLargeBtn
                  icon={<ExternalLink size={18} />}
                  label="Ergebnisse"
                  onClick={openIdsResultsWindow}
                  title="Prüfergebnisse in eigenem Fenster öffnen"
                />
              </RibbonGroup>
            </>
          )}

          {activeTab === "bcf" && (
            <>
              <input
                ref={bcfFileInputRef}
                type="file"
                accept=".bcf,.bcfzip"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const imported = await importBcf(file);
                    useBcfStore.setState({ document: imported, activeTopicId: imported.topics[0]?.id ?? null });
                    setBcfPanelOpen(true);
                  } catch (err) {
                    alert(`BCF Import Fehler: ${err}`);
                  }
                  e.target.value = "";
                }}
              />
              <RibbonGroup label="Themen">
                <RibbonLargeBtn
                  icon={<MessageSquare size={18} />}
                  label="Neu"
                  onClick={() => { bcfAddTopic({ title: "Neues Thema" }); setBcfPanelOpen(true); }}
                  title="Neues BCF-Thema erstellen"
                />
                <div className="flex flex-col gap-0.5 justify-center">
                  <RibbonSmBtn
                    icon={<Upload size={14} />}
                    label="Öffnen"
                    onClick={() => bcfFileInputRef.current?.click()}
                    title="BCF-Datei importieren"
                  />
                  <RibbonSmBtn
                    icon={<FileDown size={14} />}
                    label="Export"
                    disabled={bcfTopicCount === 0}
                    onClick={async () => {
                      const zip = await exportBcf(bcfDocument, bcfExportVersion);
                      const blob = new Blob([zip], { type: "application/zip" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${bcfDocument.projectName.replace(/\s+/g, "_")}_BCF${bcfExportVersion}.bcf`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    title="BCF exportieren"
                  />
                </div>
              </RibbonGroup>
              <RibbonGroup label="Version">
                <div className="flex items-center px-1">
                  <select
                    value={bcfExportVersion}
                    onChange={(e) => setBcfExportVersion(e.target.value as BcfVersion)}
                    className="text-[11px] bg-background border border-border rounded px-1 py-0.5"
                  >
                    <option value="2.1">BCF 2.1</option>
                    <option value="2.0">BCF 2.0</option>
                    <option value="3.0">BCF 3.0</option>
                  </select>
                </div>
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
    <div className="flex items-stretch border-r border-border/30 last:border-r-0">
      <div className="flex flex-col">
        <div className="flex items-stretch gap-0.5 px-1.5 flex-1">
          {children}
        </div>
        <div className="flex items-center justify-center h-[16px] px-2 text-[9px] text-muted-foreground/50 whitespace-nowrap border-t border-border/20">
          {label}
        </div>
      </div>
    </div>
  );
}

function RibbonLargeBtn({
  icon, label, onClick, active, disabled, title, primary, kbd, popout, className,
}: {
  icon: React.ReactNode; label: string; onClick?: () => void;
  active?: boolean; disabled?: boolean; title?: string;
  primary?: boolean; kbd?: string; popout?: () => void; className?: string;
}) {
  return (
    <div className="relative group/lbtn h-full">
      <button
        onClick={onClick} disabled={disabled} title={title}
        className={cn(
          "flex flex-col items-center justify-center gap-0.5 px-2 rounded-[4px] transition-colors min-w-[44px] h-full w-full text-center",
          active
            ? "bg-primary/10 text-primary"
            : "text-foreground/75 hover:bg-[#EBEBEB] dark:hover:bg-[#383838] hover:text-foreground",
          disabled && "opacity-35 cursor-not-allowed pointer-events-none",
          className,
        )}
      >
        <span className={cn("shrink-0", active ? "text-primary" : primary ? "text-primary" : "")}>{icon}</span>
        <span className="text-[10px] leading-tight max-w-[60px] text-center whitespace-nowrap overflow-hidden text-ellipsis">
          {label}
        </span>
        {kbd && (
          <span className="text-[7px] opacity-0 group-hover/lbtn:opacity-50 transition-opacity text-muted-foreground font-mono leading-none">
            {kbd}
          </span>
        )}
      </button>
      {popout && (
        <button
          className="absolute top-0.5 right-0.5 w-3 h-3 rounded-[2px] bg-background border border-border flex items-center justify-center opacity-0 group-hover/lbtn:opacity-100 hover:!opacity-100 hover:bg-primary hover:border-primary hover:text-primary-foreground text-muted-foreground transition-all z-10"
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
  icon: React.ReactNode; label?: string; onClick?: () => void;
  active?: boolean; disabled?: boolean; title?: string; kbd?: string; className?: string;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] transition-colors text-left",
        active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-[#EBEBEB] dark:hover:bg-[#383838] hover:text-foreground",
        disabled && "opacity-35 cursor-not-allowed pointer-events-none",
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label && <span className="text-[11px] whitespace-nowrap">{label}</span>}
      {kbd && <span className="text-[8px] opacity-40 font-mono ml-0.5">{kbd}</span>}
    </button>
  );
}

function UtilBtn({
  children, onClick, title, active, className,
}: {
  children: React.ReactNode; onClick?: () => void;
  title?: string; active?: boolean; className?: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className={cn(
        "flex items-center justify-center w-7 h-7 rounded-[3px] transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-[#EBEBEB] dark:hover:bg-[#383838]",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Dropdown helpers ──────────────────────────────────────────────────────────

function DropdownMenu({ children, onClose, align = "left", minWidth, maxHeight }: {
  children: React.ReactNode; onClose: () => void; align?: "left" | "right";
  minWidth?: number; maxHeight?: number;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className={cn(
          "absolute top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-md min-w-[180px] py-1 overflow-y-auto",
          align === "right" ? "right-0" : "left-0"
        )}
        style={{ minWidth, maxHeight }}
      >
        {children}
      </div>
    </>
  );
}

function DropdownItem({ children, onClick, icon, disabled }: {
  children: React.ReactNode; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-foreground",
        disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-[#E5E5E5] dark:hover:bg-[#404040]"
      )}
      onClick={disabled ? undefined : onClick} disabled={disabled}
    >
      {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

// ── Info modal ────────────────────────────────────────────────────────────────

function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl p-6 w-[420px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <svg width="24" height="24" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[4px]">
              <rect width="32" height="32" rx="5" fill="#E8312A"/>
              <text x="16" y="23" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
            </svg>
            <div>
              <div className="font-bold text-sm">infraCore IFC Viewer</div>
              <div className="text-[10px] text-muted-foreground">by iC consulenten ZT GmbH · VDC</div>
            </div>
          </div>
          <button className="toolbar-button p-1.5" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="text-xs text-muted-foreground mb-5 space-y-1">
          <p>Basierend auf web-ifc 0.0.77 + Three.js</p>
          <p>Multi-Modell, große Koordinatensysteme (bis 20 km), BroadcastChannel-Sync</p>
        </div>
        <div className="border-t border-border pt-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tastenkürzel</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {[
              ["F","Alle einpassen"], ["S","Auswahl-Tool"],
              ["M","Messen"], ["C","Schnittebene"],
              ["N","Fly-Mode"], ["Q","SQL-Panel"],
              ["L","Lens Rules"], ["V","SmartViews"],
              ["T","Mengen / QTO"], ["H → H","Auswahl ausblenden"],
              ["H → I","Auswahl isolieren"], ["H → R","Zurücksetzen"],
              ["Esc","Abbrechen"], ["Entf","Auswahl ausblenden"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-2">
                <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px] font-mono shrink-0 leading-none">{key}</kbd>
                <span className="text-muted-foreground text-[11px]">{desc}</span>
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
