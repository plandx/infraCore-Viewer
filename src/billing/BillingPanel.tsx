import { useEffect, useRef, useState } from "react";
import {
  Trash2, Plus, FileDown, FileUp, BarChart2, X, ExternalLink,
  ScanEye, Calculator, Ruler, Cpu, Hash, ChevronRight,
  Fingerprint, ShieldCheck, ShieldAlert, ShieldOff, RefreshCw,
  ListFilter, ArrowDownUp, ClipboardCheck,
} from "lucide-react";
import type { BillingEntry } from "./types";
import { cn } from "../lib/utils";
import { useBillingStore, BILLING_CHANNEL } from "./billingStore";
import type { ElementIdentity, ElementInfo, BillingExport, BillingMsg, ElementQuantities } from "./types";
import type { QuantityItem } from "./quantityTypes";
import { QuantitySetPanel } from "./QuantitySetPanel";

interface Props {
  elements: ElementInfo[];
}

type DetailTab = "mengen" | "abschnitte" | "dokumente" | "id";

// ── Identity check result (display-only, not persisted) ───────────────────────

interface IdentityCheckResult {
  checkedAt: string;
  guidOk: boolean | null; // null = element not found in current model
  volumeOk: boolean;
  positionOk: boolean;
  sizeOk: boolean;
  posDelta: number;
  currentGuid?: string;
  currentVolume?: number;
}

function runIdentityCheck(
  identity: ElementIdentity,
  currentGuid: string | undefined,
  q: ElementQuantities,
): IdentityCheckResult {
  const volRel = Math.abs(identity.volume - q.volume) / Math.max(identity.volume, 1e-6);
  const cx = (q.bboxCenterX ?? 0), cy = (q.bboxCenterY ?? 0), cz = (q.bboxCenterZ ?? 0);
  const posDelta = Math.sqrt(
    (cx - identity.bboxCenterX) ** 2 +
    (cy - identity.bboxCenterY) ** 2 +
    (cz - identity.bboxCenterZ) ** 2,
  );
  return {
    checkedAt: new Date().toISOString(),
    guidOk:     currentGuid === undefined ? null : currentGuid === identity.guid,
    volumeOk:   volRel < 0.01,
    positionOk: posDelta <= 0.05,
    sizeOk:     Math.abs(q.bboxX - identity.bboxSizeX) <= 0.01 &&
                Math.abs(q.bboxY - identity.bboxSizeY) <= 0.01 &&
                Math.abs(q.bboxZ - identity.bboxSizeZ) <= 0.01,
    posDelta,
    currentGuid,
    currentVolume: q.volume,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 3) => n.toFixed(d).replace(".", ",");

// ── Left sidebar: element list ────────────────────────────────────────────────

type SortMode = "model" | "date-asc" | "date-desc";

function ElementList({ elements, entries, selectedKey, onSelect }: {
  elements: ElementInfo[];
  entries: ReturnType<typeof useBillingStore.getState>["entries"];
  selectedKey: string | null;
  onSelect(key: string): void;
}) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("model");

  const types = [...new Set(elements.map(e => e.ifcType))].sort();

  const filtered = elements.filter(el => {
    const s = search.toLowerCase();
    const matchSearch = !s || el.name.toLowerCase().includes(s) || el.ifcType.toLowerCase().includes(s);
    const matchType = !filterType || el.ifcType === filterType;
    const matchTracked = !onlyTracked || !!entries[el.key];
    return matchSearch && matchType && matchTracked;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "model") return 0;
    const dateA = entries[a.key]?.createdAt ?? "";
    const dateB = entries[b.key]?.createdAt ?? "";
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return sortMode === "date-asc"
      ? dateA.localeCompare(dateB)
      : dateB.localeCompare(dateA);
  });

  const trackedCount = elements.filter(el => !!entries[el.key]).length;

  const nextSortMode = (): SortMode => {
    if (sortMode === "model") return "date-desc";
    if (sortMode === "date-desc") return "date-asc";
    return "model";
  };

  const sortLabel = sortMode === "model" ? "Modellreihenfolge" : sortMode === "date-desc" ? "Datum ↓ (neueste)" : "Datum ↑ (älteste)";

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
        {/* Tracked filter + sort */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setOnlyTracked(v => !v)}
            title={onlyTracked ? "Alle anzeigen" : "Nur erfasste anzeigen"}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] flex-1 transition-colors border",
              onlyTracked
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
            )}
          >
            <ListFilter size={10} />
            {onlyTracked ? `Erfasste (${trackedCount})` : "Alle anzeigen"}
          </button>
          <button
            onClick={() => setSortMode(nextSortMode())}
            title={`Sortierung: ${sortLabel}`}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors border shrink-0",
              sortMode !== "model"
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
            )}
          >
            <ArrowDownUp size={10} />
            {sortMode === "date-desc" ? "↓" : sortMode === "date-asc" ? "↑" : ""}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="px-3 py-1.5 border-b border-border/50 shrink-0 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{sorted.length} Elemente</span>
        {trackedCount > 0 && <span className="text-primary">{trackedCount} erfasst</span>}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {sorted.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {elements.length === 0 ? "Kein Modell geladen." : "Keine Treffer."}
          </div>
        ) : (
          sorted.map(el => {
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
                {sortMode !== "model" && entry?.createdAt && (
                  <p className="pl-4 text-[9px] text-muted-foreground/60 font-mono">
                    {new Date(entry.createdAt).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </p>
                )}
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
    setIdentity,
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

  // Identity / tamper-detection state
  const [checkResults, setCheckResults] = useState<Record<string, IdentityCheckResult>>({});
  const [postImportIdentityCount, setPostImportIdentityCount] = useState(0);
  const [pendingChecksState, setPendingChecksState] = useState<Set<string>>(new Set());
  const [showCheckPanel, setShowCheckPanel] = useState(false);
  const pendingSnapshotRef = useRef<string | null>(null);
  const pendingChecksRef   = useRef<Set<string>>(new Set());

  const bcRef        = useRef<BroadcastChannel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const elementsRef  = useRef(elements);
  elementsRef.current = elements;

  useEffect(() => { setVizActive(moduleActive); }, [moduleActive]);

  // Auto-snapshot: whenever a tracked entry with no fingerprint is selected, capture it
  useEffect(() => {
    if (!selectedKey) return;
    const entry = entries[selectedKey];
    if (!entry || entry.identity || pendingSnapshotRef.current === selectedKey) return;
    pendingSnapshotRef.current = selectedKey;
    bcRef.current?.postMessage({ t: "requestQuantities", key: selectedKey } satisfies BillingMsg);
  }, [selectedKey, entries]);

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
        setPendingGeo(prev => prev === msg.key ? null : prev);
        setLiveQuantities(msg.data);
        if (msg.key && !msg.data && pendingChecksRef.current.has(msg.key)) {
          pendingChecksRef.current.delete(msg.key);
          setPendingChecksState(prev => { const s = new Set(prev); s.delete(msg.key); return s; });
          const entry = useBillingStore.getState().entries[msg.key];
          if (entry?.identity) {
            setCheckResults(prev => ({
              ...prev,
              [msg.key]: { checkedAt: new Date().toISOString(), guidOk: null, volumeOk: false, positionOk: false, sizeOk: false, posDelta: 0 },
            }));
          }
        }
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

          // Identity snapshot
          if (pendingSnapshotRef.current === msg.key) {
            const entry = useBillingStore.getState().entries[msg.key];
            if (entry) {
              const identity: ElementIdentity = {
                guid: entry.guid,
                bboxCenterX: q.bboxCenterX ?? 0,
                bboxCenterY: q.bboxCenterY ?? 0,
                bboxCenterZ: q.bboxCenterZ ?? 0,
                bboxSizeX: q.bboxX,
                bboxSizeY: q.bboxY,
                bboxSizeZ: q.bboxZ,
                volume: q.volume,
                capturedAt: new Date().toISOString(),
              };
              setIdentity(msg.key, identity);
            }
            pendingSnapshotRef.current = null;
          }

          // Identity check
          if (pendingChecksRef.current.has(msg.key)) {
            pendingChecksRef.current.delete(msg.key);
            setPendingChecksState(prev => { const s = new Set(prev); s.delete(msg.key); return s; });
            const entry = useBillingStore.getState().entries[msg.key];
            if (entry?.identity) {
              const currentGuid = elementsRef.current.find(e => e.key === msg.key)?.guid;
              setCheckResults(prev => ({
                ...prev,
                [msg.key]: runIdentityCheck(entry.identity!, currentGuid, q),
              }));
            }
          }
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
          // GUID-based key remapping: match imported entries to current model by GUID
          const guidToCurrentKey = new Map<string, string>();
          for (const el of elementsRef.current) {
            if (el.guid) guidToCurrentKey.set(el.guid, el.key);
          }
          const remapped: BillingEntry[] = data.entries.map(entry => {
            if (!entry.guid) return entry;
            const currentKey = guidToCurrentKey.get(entry.guid);
            if (currentKey && currentKey !== entry.key) return { ...entry, key: currentKey };
            return entry;
          });
          importData({ ...data, entries: remapped });
          const withIdentity = remapped.filter(e => e.identity).length;
          if (withIdentity > 0) {
            setPostImportIdentityCount(withIdentity);
            setShowCheckPanel(true);
          }
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

  const handleSnapshot = (key: string) => {
    pendingSnapshotRef.current = key;
    bcRef.current?.postMessage({ t: "requestQuantities", key } satisfies BillingMsg);
  };

  const handleCheck = (key: string) => {
    pendingChecksRef.current.add(key);
    setPendingChecksState(prev => new Set(prev).add(key));
    bcRef.current?.postMessage({ t: "requestQuantities", key } satisfies BillingMsg);
  };

  const handleCheckAll = () => {
    const keys: string[] = [];
    for (const entry of Object.values(entries)) {
      if (entry.identity) {
        keys.push(entry.key);
        pendingChecksRef.current.add(entry.key);
        bcRef.current?.postMessage({ t: "requestQuantities", key: entry.key } satisfies BillingMsg);
      }
    }
    if (keys.length > 0) setPendingChecksState(prev => { const s = new Set(prev); keys.forEach(k => s.add(k)); return s; });
    setPostImportIdentityCount(0);
    setShowCheckPanel(true);
  };

  const handleFocusElement = (key: string) => {
    const el = elementsRef.current.find(e => e.key === key);
    if (!el) return;
    bcRef.current?.postMessage({ t: "focusElement", modelId: el.modelId, expressId: el.expressId } satisfies BillingMsg);
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
        {Object.values(entries).some(e => e.identity) && (
          <button
            onClick={() => setShowCheckPanel(v => !v)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
              showCheckPanel
                ? "bg-primary text-primary-foreground"
                : Object.keys(checkResults).some(k => { const r = checkResults[k]; return r && !(r.guidOk !== false && r.volumeOk && r.positionOk && r.sizeOk); })
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  : "bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary"
            )}
            title="Prüffenster öffnen"
          >
            <ClipboardCheck size={12} />
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

      {postImportIdentityCount > 0 && (
        <div className="px-4 py-2 text-xs bg-amber-400/10 border-b border-amber-400/20 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-amber-400">
            <ShieldAlert size={13} />
            <span>{postImportIdentityCount} Einträge mit Fingerabdruck importiert — Integrität prüfen?</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCheckAll}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-400/20 hover:bg-amber-400/30 text-amber-400 transition-colors"
            >
              <ShieldCheck size={11} />Alle prüfen
            </button>
            <button onClick={() => setPostImportIdentityCount(0)} className="text-amber-400/60 hover:text-amber-400 transition-colors"><X size={12} /></button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Check panel overlay */}
        {showCheckPanel && (
          <CheckPanel
            entries={entries}
            checkResults={checkResults}
            elements={elements}
            pendingKeys={pendingChecksState}
            onClose={() => setShowCheckPanel(false)}
            onFocus={handleFocusElement}
            onCheck={handleCheck}
            onCheckAll={handleCheckAll}
          />
        )}

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
              onSnapshot={() => handleSnapshot(selectedKey)}
              onCheck={() => handleCheck(selectedKey)}
              pendingSnapshot={pendingSnapshotRef.current === selectedKey}
              checkResult={checkResults[selectedKey] ?? null}
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
  onSnapshot(): void;
  onCheck(): void;
  pendingSnapshot: boolean;
  checkResult: IdentityCheckResult | null;
}

function TrackedDetailView(props: DetailProps) {
  const {
    selectedKey, entry, tab, onTabChange, elements,
    pendingGeo, pendingIfc,
    onRemoveEntry, onRequestGeo, onRequestIfc, onStartMeasure,
    onAddQuantityItem, onUpdateQuantityItem, onRemoveQuantityItem,
    latestDegree, onSnapshot, onCheck, pendingSnapshot, checkResult,
  } = props;

  const qCount = entry.quantitySet?.items.length ?? 0;
  const hasIdentity = !!entry.identity;

  const tabs: { id: DetailTab; label: string; badge?: number; warn?: boolean }[] = [
    { id: "mengen",     label: "Mengen",          badge: qCount || undefined },
    { id: "abschnitte", label: "Fertigstellungsgrad", badge: entry.stages.length || undefined },
    { id: "dokumente",  label: "Dokumente",  badge: entry.documents.length || undefined },
    { id: "id",         label: "ID",         warn: hasIdentity && checkResult !== null && !(checkResult.guidOk !== false && checkResult.volumeOk && checkResult.positionOk && checkResult.sizeOk) },
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
              "flex items-center gap-1.5 px-4 py-2 text-xs transition-colors relative",
              tab === t.id
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.id === "id" && <Fingerprint size={11} />}
            {t.label}
            {t.badge !== undefined && (
              <span className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full font-mono",
                tab === t.id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {t.badge}
              </span>
            )}
            {t.warn && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
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

      {tab === "id" && (
        <IdTab
          entry={entry}
          currentElement={elements.find(e => e.key === selectedKey)}
          onSnapshot={onSnapshot}
          onCheck={onCheck}
          pendingSnapshot={pendingSnapshot}
          checkResult={checkResult}
        />
      )}
    </div>
  );
}

// ── ID / Fingerprint tab ──────────────────────────────────────────────────────

function IdTab({
  entry, currentElement, onSnapshot, onCheck, pendingSnapshot, checkResult,
}: {
  entry: ReturnType<typeof useBillingStore.getState>["entries"][string];
  currentElement: ElementInfo | undefined;
  onSnapshot(): void;
  onCheck(): void;
  pendingSnapshot: boolean;
  checkResult: IdentityCheckResult | null;
}) {
  const f = (n: number) => n.toFixed(3).replace(".", ",");
  const fmtDate = (s: string) => new Date(s).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });

  const { identity } = entry;
  const allOk = checkResult
    ? (checkResult.guidOk !== false && checkResult.volumeOk && checkResult.positionOk && checkResult.sizeOk)
    : null;

  const CheckRow = ({ ok, label, stored, current }: { ok: boolean | null; label: string; stored?: string; current?: string }) => (
    <div className={cn(
      "flex items-start gap-2 px-3 py-2 rounded-md text-xs",
      ok === null  ? "bg-muted/30 text-muted-foreground" :
      ok           ? "bg-green-500/10 text-green-400" :
                     "bg-red-500/10 text-red-400",
    )}>
      <div className="mt-0.5 shrink-0">
        {ok === null  ? <ShieldOff size={12} />  :
         ok           ? <ShieldCheck size={12} /> :
                        <ShieldAlert size={12} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{label}</p>
        {!ok && stored !== undefined && (
          <div className="text-[10px] mt-0.5 opacity-80 space-y-0.5">
            <p>Gespeichert: <span className="font-mono">{stored}</span></p>
            {current !== undefined && <p>Aktuell: <span className="font-mono">{current}</span></p>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4">

      {/* GUID */}
      <section className="space-y-1.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">IFC Global ID</h4>
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-md">
          <code className="text-xs font-mono flex-1 break-all text-foreground">{entry.guid}</code>
          {currentElement && currentElement.guid !== entry.guid && (
            <span className="text-[9px] text-red-400 shrink-0">⚠ GUID geändert</span>
          )}
        </div>
        {currentElement?.guid && currentElement.guid !== entry.guid && (
          <div className="text-[10px] text-red-400 px-1">
            Aktuell im Modell: <code className="font-mono">{currentElement.guid}</code>
          </div>
        )}
      </section>

      {/* Fingerprint */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fingerabdruck</h4>
          <div className="flex gap-1.5">
            {identity && (
              <button
                onClick={onCheck}
                disabled={pendingSnapshot}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors disabled:opacity-40"
              >
                {pendingSnapshot ? <RefreshCw size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
                Prüfen
              </button>
            )}
            <button
              onClick={onSnapshot}
              disabled={pendingSnapshot}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-muted/80 text-muted-foreground border border-border transition-colors disabled:opacity-40"
            >
              {pendingSnapshot ? <RefreshCw size={10} className="animate-spin" /> : <Fingerprint size={10} />}
              {identity ? "Neu erfassen" : "Erfassen"}
            </button>
          </div>
        </div>

        {!identity ? (
          <p className="text-xs text-muted-foreground px-1">
            Noch kein Fingerabdruck gespeichert. Klicke "Erfassen" um Lage, Abmessungen und Volumen des Elements im aktuell geladenen Modell zu sichern.
          </p>
        ) : (
          <div className="space-y-1 text-xs">
            <p className="text-[10px] text-muted-foreground px-1">
              Erfasst: {fmtDate(identity.capturedAt)}
            </p>
            <div className="bg-muted/30 rounded-md overflow-hidden">
              <table className="w-full text-[11px]">
                <tbody>
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 text-muted-foreground w-28">IFC Global ID</td>
                    <td className="px-3 py-1.5 font-mono break-all text-[10px]">{identity.guid}</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 text-muted-foreground w-28">Zentrum X/Y/Z</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {f(identity.bboxCenterX)} / {f(identity.bboxCenterY)} / {f(identity.bboxCenterZ)} m
                    </td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 text-muted-foreground">Abm. X/Y/Z</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {f(identity.bboxSizeX)} / {f(identity.bboxSizeY)} / {f(identity.bboxSizeZ)} m
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-muted-foreground">Volumen</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{f(identity.volume)} m³</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Check results */}
      {checkResult && identity && (
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prüfergebnis</h4>
            <span className="text-[10px] text-muted-foreground/60">{fmtDate(checkResult.checkedAt)}</span>
            {allOk !== null && (
              <span className={cn(
                "ml-auto text-[10px] font-semibold px-2 py-0.5 rounded",
                allOk ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
              )}>
                {allOk ? "✓ OK" : "⚠ Abweichung"}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <CheckRow
              ok={checkResult.guidOk}
              label="IFC Global ID"
              stored={identity.guid}
              current={checkResult.currentGuid}
            />
            <CheckRow
              ok={checkResult.volumeOk}
              label="Volumen"
              stored={`${f(identity.volume)} m³`}
              current={checkResult.currentVolume !== undefined ? `${f(checkResult.currentVolume)} m³` : undefined}
            />
            <CheckRow
              ok={checkResult.positionOk}
              label={`Lage (Δ ${checkResult.posDelta < 0.001 ? "<0,001" : f(checkResult.posDelta)} m)`}
            />
            <CheckRow
              ok={checkResult.sizeOk}
              label="Abmessungen"
            />
          </div>
        </section>
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

// ── Check panel overlay ────────────────────────────────────────────────────────

function CheckPanel({
  entries, checkResults, elements, pendingKeys,
  onClose, onFocus, onCheck, onCheckAll,
}: {
  entries: Record<string, BillingEntry>;
  checkResults: Record<string, IdentityCheckResult>;
  elements: ElementInfo[];
  pendingKeys: Set<string>;
  onClose(): void;
  onFocus(key: string): void;
  onCheck(key: string): void;
  onCheckAll(): void;
}) {
  const withIdentity = Object.values(entries).filter(e => e.identity);
  const checkedCount = withIdentity.filter(e => checkResults[e.key]).length;
  const issueCount   = withIdentity.filter(e => {
    const r = checkResults[e.key];
    return r && !(r.guidOk !== false && r.volumeOk && r.positionOk && r.sizeOk);
  }).length;
  const f = (n: number) => n.toFixed(3).replace(".", ",");

  return (
    <div className="absolute inset-0 z-10 bg-background/97 backdrop-blur flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <ClipboardCheck size={14} className="text-primary shrink-0" />
        <span className="font-semibold text-sm">Prüffenster</span>
        <span className="text-[10px] text-muted-foreground">
          {checkedCount}/{withIdentity.length} geprüft
        </span>
        {issueCount > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
            {issueCount} Abweichung{issueCount > 1 ? "en" : ""}
          </span>
        )}
        {checkedCount === withIdentity.length && withIdentity.length > 0 && issueCount === 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
            ✓ Alle OK
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onCheckAll}
          disabled={pendingKeys.size > 0}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors disabled:opacity-40"
        >
          {pendingKeys.size > 0
            ? <RefreshCw size={10} className="animate-spin" />
            : <RefreshCw size={10} />}
          Alle prüfen
        </button>
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors ml-1">
          <X size={14} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {withIdentity.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Keine Einträge mit Fingerabdruck.
          </div>
        ) : (
          withIdentity.map(entry => {
            const result = checkResults[entry.key];
            const isPending = pendingKeys.has(entry.key);
            const allOk = result
              ? (result.guidOk !== false && result.volumeOk && result.positionOk && result.sizeOk)
              : null;
            const notFound = result?.guidOk === null;
            const canFocus = !!elements.find(e => e.key === entry.key);

            return (
              <div key={entry.key} className={cn(
                "flex items-start gap-2 px-3 py-2.5 border-b border-border/40 transition-colors hover:bg-muted/20",
                !result && !isPending ? "" :
                notFound ? "border-l-2 border-l-amber-500/50" :
                allOk ? "border-l-2 border-l-green-500/50" : "border-l-2 border-l-red-500/50"
              )}>
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0 mt-1",
                  isPending ? "bg-amber-400 animate-pulse" :
                  allOk === null ? "bg-border" :
                  notFound ? "bg-amber-500" :
                  allOk ? "bg-green-500" : "bg-red-500"
                )} />

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{entry.elementName}</p>
                  <p className="text-[10px] text-muted-foreground/70 font-mono truncate">{entry.guid || "–"}</p>

                  {isPending && (
                    <p className="text-[10px] text-amber-400 mt-0.5">Prüfe…</p>
                  )}
                  {result && !isPending && (
                    <div className="mt-1 space-y-0.5">
                      {notFound ? (
                        <p className="text-[10px] text-amber-400">⚠ Element nicht im aktuellen Modell gefunden</p>
                      ) : allOk ? (
                        <p className="text-[10px] text-green-400">✓ Alle Parameter übereinstimmend</p>
                      ) : (
                        <>
                          {result.guidOk === false && <p className="text-[10px] text-red-400">⚠ GUID geändert</p>}
                          {!result.volumeOk && <p className="text-[10px] text-red-400">⚠ Volumen: {result.currentVolume !== undefined ? f(result.currentVolume) : "?"} m³ (erwartet {f(entry.identity!.volume)} m³)</p>}
                          {!result.positionOk && <p className="text-[10px] text-red-400">⚠ Position verschoben (Δ {f(result.posDelta)} m)</p>}
                          {!result.sizeOk && <p className="text-[10px] text-red-400">⚠ Abmessungen geändert</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {canFocus && (
                    <button
                      onClick={() => onFocus(entry.key)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors border border-border"
                      title="Im Viewer anzeigen"
                    >
                      <ChevronRight size={10} />
                      Anzeigen
                    </button>
                  )}
                  <button
                    onClick={() => onCheck(entry.key)}
                    disabled={isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors border border-border disabled:opacity-40"
                    title="Prüfen"
                  >
                    {isPending
                      ? <RefreshCw size={10} className="animate-spin" />
                      : <ShieldCheck size={10} />}
                    Prüfen
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
