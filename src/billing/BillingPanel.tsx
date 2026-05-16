import { useEffect, useRef, useState } from "react";
import {
  Trash2, Plus, FileDown, FileUp, BarChart2, X, ExternalLink,
  ScanEye, Calculator, Ruler, Cpu, Hash, ChevronRight,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useBillingStore, BILLING_CHANNEL } from "./billingStore";
import type { ElementInfo, BillingExport, BillingMsg, ElementQuantities } from "./types";
import type { QuantityItem } from "./quantityTypes";
import { QuantitySetPanel } from "./QuantitySetPanel";

interface Props {
  elements: ElementInfo[];
}

type DetailTab = "mengen" | "abschnitte" | "dokumente";

// ── Utility ───────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 3) => n.toFixed(d).replace(".", ",");

// ── Left sidebar: element list ────────────────────────────────────────────────

function ElementList({ elements, entries, selectedKey, onSelect }: {
  elements: ElementInfo[];
  entries: ReturnType<typeof useBillingStore.getState>["entries"];
  selectedKey: string | null;
  onSelect(key: string): void;
}) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");

  const types = [...new Set(elements.map(e => e.ifcType))].sort();
  const filtered = elements.filter(el => {
    const s = search.toLowerCase();
    const matchSearch = !s || el.name.toLowerCase().includes(s) || el.ifcType.toLowerCase().includes(s);
    const matchType = !filterType || el.ifcType === filterType;
    return matchSearch && matchType;
  });

  const trackedCount = elements.filter(el => !!entries[el.key]).length;

  return (
    <div className="w-64 shrink-0 flex flex-col border-r border-border bg-card/30">
      {/* Search + filter */}
      <div className="px-2.5 py-2 border-b border-border space-y-1.5 shrink-0">
        <input
          type="text"
          placeholder="Suchen…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {types.length > 1 && (
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-muted-foreground"
          >
            <option value="">Alle IFC-Typen ({elements.length})</option>
            {types.map(t => <option key={t} value={t}>{t.replace(/^Ifc/, "")} ({elements.filter(e => e.ifcType === t).length})</option>)}
          </select>
        )}
      </div>

      {/* Stats bar */}
      <div className="px-3 py-1.5 border-b border-border/50 shrink-0 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{filtered.length} Elemente</span>
        {trackedCount > 0 && <span className="text-primary">{trackedCount} erfasst</span>}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {elements.length === 0 ? "Kein Modell geladen." : "Keine Treffer."}
          </div>
        ) : (
          filtered.map(el => {
            const tracked = !!entries[el.key];
            const entry = entries[el.key];
            const lastDegree = entry?.stages.length ? entry.stages[entry.stages.length - 1].degree : null;
            const qCount = entry?.quantitySet?.items.length ?? 0;
            const isSelected = selectedKey === el.key;

            return (
              <button
                key={el.key}
                onClick={() => onSelect(el.key)}
                className={cn(
                  "w-full text-left flex flex-col gap-0.5 px-3 py-2 border-b border-border/40 transition-colors",
                  isSelected
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0 mt-0.5",
                    !tracked ? "bg-border" :
                    lastDegree === 100 ? "bg-green-500" :
                    lastDegree && lastDegree > 0 ? "bg-amber-400" : "bg-sky-400"
                  )} />
                  <span className="text-xs font-medium truncate flex-1">{el.name}</span>
                  {qCount > 0 && (
                    <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded shrink-0">{qCount}M</span>
                  )}
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded font-mono">
                    {el.ifcType.replace(/^Ifc/, "")}
                  </span>
                  {tracked && lastDegree !== null && (
                    <div className="flex-1 flex items-center gap-1">
                      <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", lastDegree >= 100 ? "bg-green-500" : "bg-amber-400")}
                          style={{ width: `${lastDegree}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground">{lastDegree}%</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BillingPanel({ elements }: Props) {
  const {
    entries, moduleActive, setModuleActive,
    addEntry, removeEntry,
    addStage, removeStage,
    addDocument, removeDocument,
    importData, exportData, setQuantities,
    addQuantityItem, updateQuantityItem, removeQuantityItem, mergeQuantityItems,
  } = useBillingStore();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("mengen");
  const [vizActive, setVizActive] = useState(moduleActive);

  // Stages form
  const [stageLabel, setStageLabel] = useState("");
  const [stageDate,  setStageDate]  = useState(() => new Date().toISOString().slice(0, 10));
  const [stageDegree,setStageDegree]= useState("0");
  const [stageNote,  setStageNote]  = useState("");

  // Documents form
  const [docDocId, setDocDocId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docUrl,   setDocUrl]   = useState("");

  const [importError, setImportError] = useState("");
  const [pendingGeo, setPendingGeo] = useState<string | null>(null);
  const [pendingIfc, setPendingIfc] = useState<string | null>(null);
  const [liveQuantities, setLiveQuantities] = useState<ElementQuantities | null>(null);

  const bcRef      = useRef<BroadcastChannel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setVizActive(moduleActive); }, [moduleActive]);

  // BroadcastChannel listener
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(BILLING_CHANNEL); } catch { return; }
    bcRef.current = bc;

    bc.addEventListener("message", (ev) => {
      const msg = ev.data as BillingMsg;
      if (msg.t === "moduleActive") setVizActive(msg.active);
      if (msg.t === "selectEntry")  { setSelectedKey(msg.key); setLiveQuantities(null); setTab("mengen"); }
      if (msg.t === "quantities") {
        setPendingGeo(null);
        setLiveQuantities(msg.data);
        // Auto-convert legacy quantities into quantitySet geo items
        if (msg.key && msg.data) {
          const q = msg.data;
          const dims = [q.bboxX, q.bboxY, q.bboxZ].sort((a, b) => a - b);
          const items: QuantityItem[] = [];
          if (q.volume > 0)      items.push({ id: "_gv", type: "volume",    label: "Volumen (Geometrie)",    value: q.volume,      unit: "m³", source: "geometry" });
          if (q.surfaceArea > 0) items.push({ id: "_ga", type: "area",      label: "Oberfläche (Geometrie)", value: q.surfaceArea, unit: "m²", source: "geometry" });
          if (dims[2] > 0)       items.push({ id: "_gh", type: "height",    label: "Größte Ausdehnung",      value: dims[2],       unit: "m",  source: "geometry" });
          if (dims[1] > 0)       items.push({ id: "_gw", type: "width",     label: "Mittlere Ausdehnung",    value: dims[1],       unit: "m",  source: "geometry" });
          if (dims[0] > 0)       items.push({ id: "_gt", type: "thickness", label: "Kleinste Ausdehnung",    value: dims[0],       unit: "m",  source: "geometry" });
          mergeQuantityItems(msg.key, items, "geometry");
          setQuantities(msg.key, q);
        }
      }
      if (msg.t === "ifcQuantities") {
        setPendingIfc(null);
        if (msg.key && msg.items && msg.items.length > 0) {
          mergeQuantityItems(msg.key, msg.items, "ifc");
        }
      }
    });

    bc.postMessage({ t: "ready" } satisfies BillingMsg);
    return () => { bc?.close(); bcRef.current = null; };
  }, [mergeQuantityItems, setQuantities]);

  const handleToggleViz = () => {
    const next = !vizActive;
    setVizActive(next);
    setModuleActive(next);
  };

  const handleExport = () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `5D-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as BillingExport;
        if (data.version === 1 && Array.isArray(data.entries)) {
          importData(data);
          setImportError("");
        } else {
          setImportError("Ungültiges Format – keine gültige 5D-Export-Datei.");
        }
      } catch { setImportError("Datei konnte nicht gelesen werden."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSelectKey = (key: string) => {
    setSelectedKey(key);
    setLiveQuantities(null);
    setPendingGeo(null);
    setPendingIfc(null);
  };

  const handleAddEntry = (el: ElementInfo) => {
    addEntry({ key: el.key, guid: el.guid, expressId: el.expressId, modelId: el.modelId, elementName: el.name, ifcType: el.ifcType });
    handleSelectKey(el.key);
    setTab("mengen");
  };

  const handleAddStage = () => {
    if (!selectedKey || !stageLabel.trim()) return;
    const deg = Math.max(0, Math.min(100, parseFloat(stageDegree) || 0));
    addStage(selectedKey, { label: stageLabel.trim(), date: stageDate, degree: deg, note: stageNote.trim() });
    setStageLabel(""); setStageDegree("0"); setStageNote("");
  };

  const handleAddDoc = () => {
    if (!selectedKey || !docTitle.trim()) return;
    addDocument(selectedKey, { docId: docDocId.trim(), title: docTitle.trim(), url: docUrl.trim() });
    setDocDocId(""); setDocTitle(""); setDocUrl("");
  };

  const handleRequestGeo = (key: string) => {
    setPendingGeo(key);
    setLiveQuantities(null);
    bcRef.current?.postMessage({ t: "requestQuantities", key } satisfies BillingMsg);
  };

  const handleRequestIfc = (key: string) => {
    setPendingIfc(key);
    bcRef.current?.postMessage({ t: "requestIfcQuantities", key } satisfies BillingMsg);
  };

  const handleStartMeasure = (key: string) => {
    const el = elements.find(e => e.key === key);
    bcRef.current?.postMessage({
      t: "startInspection",
      key,
      elementName: el?.name ?? entries[key]?.elementName ?? key,
    } satisfies BillingMsg);
  };

  const latestDegree = (key: string) => {
    const e = entries[key];
    if (!e || e.stages.length === 0) return 0;
    return e.stages[e.stages.length - 1].degree;
  };

  const selectedEntry = selectedKey ? entries[selectedKey] : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background text-foreground">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0 flex-wrap gap-y-1.5">
        <BarChart2 size={15} className="text-primary shrink-0" />
        <span className="font-semibold text-sm">5D-Abrechnung</span>
        <div className="flex-1" />

        {Object.keys(entries).length > 0 && (
          <button
            onClick={() => bcRef.current?.postMessage({ t: "isolateTracked" } satisfies BillingMsg)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors"
            title="Nur erfasste Objekte isolieren"
          >
            <ScanEye size={12} />
          </button>
        )}
        <button
          onClick={handleToggleViz}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
            vizActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
          title="3D-Visualisierung"
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", vizActive ? "bg-primary-foreground" : "bg-muted-foreground")} />
          Viz
        </button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors" title="Importieren"><FileUp size={13} /></button>
        <button onClick={handleExport} className="p-1.5 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors" title="Exportieren"><FileDown size={13} /></button>
      </div>

      {importError && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-400/10 border-b border-red-400/20 flex items-center justify-between gap-2 shrink-0">
          <span>{importError}</span>
          <button onClick={() => setImportError("")}><X size={12} /></button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0">

        {/* Left: element list */}
        <ElementList
          elements={elements}
          entries={entries}
          selectedKey={selectedKey}
          onSelect={handleSelectKey}
        />

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {!selectedKey ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center p-8 gap-3">
              <BarChart2 size={36} className="opacity-20" />
              <p className="text-sm font-medium">Element aus der Liste wählen</p>
              <p className="text-xs leading-relaxed max-w-xs text-muted-foreground/70">
                Elemente aus dem IFC-Modell werden links aufgelistet.
                Wähle ein Element um Mengen, Abschnitte und Dokumente zu erfassen.
              </p>
            </div>
          ) : !selectedEntry ? (
            <NotTrackedView
              selectedKey={selectedKey}
              elements={elements}
              onAdd={handleAddEntry}
            />
          ) : (
            <TrackedDetailView
              selectedKey={selectedKey}
              entry={selectedEntry}
              tab={tab}
              onTabChange={setTab}
              elements={elements}
              pendingGeo={pendingGeo}
              pendingIfc={pendingIfc}
              liveQuantities={liveQuantities}
              onRemoveEntry={() => { removeEntry(selectedKey); setSelectedKey(null); }}
              onRequestGeo={() => handleRequestGeo(selectedKey)}
              onRequestIfc={() => handleRequestIfc(selectedKey)}
              onStartMeasure={() => handleStartMeasure(selectedKey)}
              onAddQuantityItem={item => addQuantityItem(selectedKey, item)}
              onUpdateQuantityItem={(id, p) => updateQuantityItem(selectedKey, id, p)}
              onRemoveQuantityItem={id => removeQuantityItem(selectedKey, id)}
              onAddStage={handleAddStage}
              onRemoveStage={id => removeStage(selectedKey, id)}
              stageLabel={stageLabel} setStageLabel={setStageLabel}
              stageDate={stageDate}   setStageDate={setStageDate}
              stageDegree={stageDegree} setStageDegree={setStageDegree}
              stageNote={stageNote}   setStageNote={setStageNote}
              onAddDoc={handleAddDoc}
              onRemoveDoc={id => removeDocument(selectedKey, id)}
              docDocId={docDocId} setDocDocId={setDocDocId}
              docTitle={docTitle} setDocTitle={setDocTitle}
              docUrl={docUrl}     setDocUrl={setDocUrl}
              latestDegree={latestDegree(selectedKey)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Not-tracked placeholder ────────────────────────────────────────────────────

function NotTrackedView({ selectedKey, elements, onAdd }: {
  selectedKey: string;
  elements: ElementInfo[];
  onAdd(el: ElementInfo): void;
}) {
  const el = elements.find(e => e.key === selectedKey);
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center p-8 gap-3">
      <BarChart2 size={36} className="opacity-20" />
      {el && <p className="text-sm font-medium text-foreground">{el.name}</p>}
      <p className="text-xs">Dieses Element ist noch nicht erfasst.</p>
      {el && (
        <button
          onClick={() => onAdd(el)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          In 5D-Liste aufnehmen
        </button>
      )}
    </div>
  );
}

// ── Tracked detail view ────────────────────────────────────────────────────────

interface DetailProps {
  selectedKey: string;
  entry: ReturnType<typeof useBillingStore.getState>["entries"][string];
  tab: DetailTab;
  onTabChange(t: DetailTab): void;
  elements: ElementInfo[];
  pendingGeo: string | null;
  pendingIfc: string | null;
  liveQuantities: ElementQuantities | null;
  onRemoveEntry(): void;
  onRequestGeo(): void;
  onRequestIfc(): void;
  onStartMeasure(): void;
  onAddQuantityItem(item: Omit<QuantityItem, "id">): void;
  onUpdateQuantityItem(id: string, patch: Partial<QuantityItem>): void;
  onRemoveQuantityItem(id: string): void;
  onAddStage(): void;
  onRemoveStage(id: string): void;
  stageLabel: string; setStageLabel(v: string): void;
  stageDate: string;  setStageDate(v: string): void;
  stageDegree: string; setStageDegree(v: string): void;
  stageNote: string;  setStageNote(v: string): void;
  onAddDoc(): void;
  onRemoveDoc(id: string): void;
  docDocId: string; setDocDocId(v: string): void;
  docTitle: string; setDocTitle(v: string): void;
  docUrl: string;   setDocUrl(v: string): void;
  latestDegree: number;
}

function TrackedDetailView(props: DetailProps) {
  const {
    selectedKey, entry, tab, onTabChange,
    pendingGeo, pendingIfc,
    onRemoveEntry, onRequestGeo, onRequestIfc, onStartMeasure,
    onAddQuantityItem, onUpdateQuantityItem, onRemoveQuantityItem,
    latestDegree,
  } = props;

  const qCount = entry.quantitySet?.items.length ?? 0;

  const tabs: { id: DetailTab; label: string; badge?: number }[] = [
    { id: "mengen",     label: "Mengen",     badge: qCount || undefined },
    { id: "abschnitte", label: "Abschnitte", badge: entry.stages.length || undefined },
    { id: "dokumente",  label: "Dokumente",  badge: entry.documents.length || undefined },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Element header */}
      <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{entry.elementName}</span>
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono shrink-0">
                {entry.ifcType.replace(/^Ifc/, "")}
              </span>
              {latestDegree > 0 && (
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0",
                  latestDegree >= 100 ? "bg-green-500/20 text-green-400" : "bg-amber-400/20 text-amber-400"
                )}>
                  {latestDegree}%
                </span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">#{entry.expressId}</span>
          </div>
          <button onClick={onRemoveEntry} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1" title="Entfernen">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 bg-card/30">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs transition-colors",
              tab === t.id
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.badge !== undefined && (
              <span className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full font-mono",
                tab === t.id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "mengen" && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Mengen toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 shrink-0 flex-wrap">
            <button
              onClick={onRequestIfc}
              disabled={pendingIfc === selectedKey}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-sky-400/10 hover:bg-sky-400/20 text-sky-400 border border-sky-400/30 transition-colors disabled:opacity-40"
              title="Mengen aus IFC-Eigenschaftssätzen extrahieren"
            >
              <Cpu size={11} />
              {pendingIfc === selectedKey ? "Lese IFC…" : "IFC-Extrakt"}
            </button>
            <button
              onClick={onRequestGeo}
              disabled={pendingGeo === selectedKey}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-violet-400/10 hover:bg-violet-400/20 text-violet-400 border border-violet-400/30 transition-colors disabled:opacity-40"
              title="Volumen, Fläche und Abmessungen aus Geometrie berechnen"
            >
              <Calculator size={11} />
              {pendingGeo === selectedKey ? "Berechne…" : "Geometrie"}
            </button>
            <button
              onClick={onStartMeasure}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 border border-amber-400/30 transition-colors"
              title="Flächen und Kanten im 3D-Viewer messen"
            >
              <Ruler size={11} />
              Messen
            </button>
            <button
              onClick={() => onAddQuantityItem({ type: "count", label: "Stückzahl", value: 1, unit: "Stk", source: "manual" })}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 border border-emerald-400/30 transition-colors"
              title="Manuelle Mengenposition"
            >
              <Hash size={11} />
              Stückzahl +1
            </button>
          </div>

          <QuantitySetPanel
            entry={entry}
            onAddItem={onAddQuantityItem}
            onUpdateItem={onUpdateQuantityItem}
            onRemoveItem={onRemoveQuantityItem}
          />
        </div>
      )}

      {tab === "abschnitte" && (
        <StagesTab entry={entry} {...props} />
      )}

      {tab === "dokumente" && (
        <DocsTab entry={entry} {...props} />
      )}
    </div>
  );
}

// ── Stages tab ─────────────────────────────────────────────────────────────────

function StagesTab({ entry, selectedKey, onAddStage, onRemoveStage, stageLabel, setStageLabel, stageDate, setStageDate, stageDegree, setStageDegree, stageNote, setStageNote }: DetailProps) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-4">
      {entry.stages.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left pb-1.5 pr-2 font-medium w-6">Nr</th>
              <th className="text-left pb-1.5 pr-2 font-medium">Bezeichnung</th>
              <th className="text-left pb-1.5 pr-2 font-medium w-24">Datum</th>
              <th className="text-right pb-1.5 pr-2 font-medium w-20">Grad</th>
              <th className="text-right pb-1.5 pr-2 font-medium w-12">Δ</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {entry.stages.map((s, i) => {
              const prev = i > 0 ? entry.stages[i - 1].degree : 0;
              const delta = s.degree - prev;
              return (
                <tr key={s.id} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <div className="font-medium">{s.label}</div>
                    {s.note && <div className="text-[10px] text-muted-foreground">{s.note}</div>}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground font-mono">{s.date}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1.5 justify-end">
                      <div className="w-14 h-1.5 bg-border rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", s.degree >= 100 ? "bg-green-500" : "bg-amber-400")} style={{ width: `${s.degree}%` }} />
                      </div>
                      <span className="font-mono w-8 text-right">{s.degree}%</span>
                    </div>
                  </td>
                  <td className={cn("py-1.5 pr-2 text-right font-mono text-xs", delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-muted-foreground")}>
                    {delta > 0 ? "+" : ""}{delta}%
                  </td>
                  <td className="py-1.5">
                    <button onClick={() => onRemoveStage(s.id)} className="text-muted-foreground/40 hover:text-destructive transition-colors"><X size={12} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted-foreground">Noch kein Abrechnungsstand erfasst.</p>
      )}

      <div className="bg-muted/30 border border-border rounded-lg p-3 flex flex-col gap-2 shrink-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neuer Stand</span>
        <input type="text" placeholder="Bezeichnung" value={stageLabel} onChange={e => setStageLabel(e.target.value)}
          className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={stageDate} onChange={e => setStageDate(e.target.value)}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} max={100} value={stageDegree} onChange={e => setStageDegree(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <input type="text" placeholder="Notiz (optional)" value={stageNote} onChange={e => setStageNote(e.target.value)}
          className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
        <button onClick={onAddStage} disabled={!stageLabel.trim()}
          className="self-end flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity">
          <Plus size={12} />Hinzufügen
        </button>
      </div>
    </div>
  );
}

// ── Documents tab ──────────────────────────────────────────────────────────────

function DocsTab({ entry, onAddDoc, onRemoveDoc, docDocId, setDocDocId, docTitle, setDocTitle, docUrl, setDocUrl }: DetailProps) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-4">
      {entry.documents.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {entry.documents.map(doc => (
            <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border rounded-md">
              {doc.docId && <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{doc.docId}</span>}
              <span className="text-xs flex-1 truncate">{doc.title}</span>
              {doc.url && (
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors shrink-0" title="Öffnen">
                  <ExternalLink size={12} />
                </a>
              )}
              <button onClick={() => onRemoveDoc(doc.id)} className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"><X size={12} /></button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Noch keine Dokumente verknüpft.</p>
      )}

      <div className="bg-muted/30 border border-border rounded-lg p-3 flex flex-col gap-2 shrink-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neues Dokument</span>
        <div className="grid grid-cols-2 gap-2">
          <input type="text" placeholder="Dok.-Nr. (optional)" value={docDocId} onChange={e => setDocDocId(e.target.value)}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
          <input type="text" placeholder="Titel *" value={docTitle} onChange={e => setDocTitle(e.target.value)}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
          <input type="text" placeholder="URL (optional)" value={docUrl} onChange={e => setDocUrl(e.target.value)}
            className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <button onClick={onAddDoc} disabled={!docTitle.trim()}
          className="self-end flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity">
          <Plus size={12} />Hinzufügen
        </button>
      </div>
    </div>
  );
}
