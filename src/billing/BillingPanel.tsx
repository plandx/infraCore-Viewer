import { useEffect, useRef, useState } from "react";
import { Trash2, Plus, FileDown, FileUp, BarChart2, X, ExternalLink, ScanEye, Calculator, Save, Ruler } from "lucide-react";
import { cn } from "../lib/utils";
import { useBillingStore, BILLING_CHANNEL } from "./billingStore";
import type { ElementInfo, BillingExport, BillingMsg, ElementQuantities } from "./types";

interface Props {
  elements: ElementInfo[];
}

export function BillingPanel({ elements }: Props) {
  const {
    entries, moduleActive, setModuleActive,
    addEntry, removeEntry,
    addStage, removeStage,
    addDocument, removeDocument,
    importData, exportData, setQuantities,
  } = useBillingStore();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [vizActive, setVizActive] = useState(moduleActive);

  const [stageLabel, setStageLabel] = useState("");
  const [stageDate, setStageDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stageDegree, setStageDegree] = useState("0");
  const [stageNote, setStageNote] = useState("");

  const [docDocId, setDocDocId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [importError, setImportError] = useState("");
  const [pendingQKey, setPendingQKey] = useState<string | null>(null);
  const [liveQuantities, setLiveQuantities] = useState<ElementQuantities | null>(null);

  const bcRef = useRef<BroadcastChannel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVizActive(moduleActive);
  }, [moduleActive]);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(BILLING_CHANNEL); } catch { return; }
    bcRef.current = bc;

    bc.addEventListener("message", (ev) => {
      const msg = ev.data as BillingMsg;
      if (msg.t === "moduleActive") setVizActive(msg.active);
      if (msg.t === "selectEntry") { setSelectedKey(msg.key); setLiveQuantities(null); }
      if (msg.t === "quantities") {
        setPendingQKey(null);
        setLiveQuantities(msg.data);
      }
    });

    bc.postMessage({ t: "ready" } satisfies BillingMsg);

    return () => { bc?.close(); bcRef.current = null; };
  }, []);

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
    a.download = `billing-export-${new Date().toISOString().slice(0, 10)}.json`;
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
      } catch {
        setImportError("Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const filtered = elements.filter(
    (el) =>
      el.name.toLowerCase().includes(search.toLowerCase()) ||
      el.ifcType.toLowerCase().includes(search.toLowerCase())
  );

  const selectedEntry = selectedKey ? entries[selectedKey] : null;

  const handleSelectKey = (key: string) => {
    setSelectedKey(key);
    setLiveQuantities(null);
    setPendingQKey(null);
  };

  const handleRequestQuantities = (key: string) => {
    setPendingQKey(key);
    setLiveQuantities(null);
    bcRef.current?.postMessage({ t: "requestQuantities", key } satisfies BillingMsg);
  };

  const handleAddEntry = (el: ElementInfo) => {
    addEntry({
      key: el.key,
      guid: el.guid,
      expressId: el.expressId,
      modelId: el.modelId,
      elementName: el.name,
      ifcType: el.ifcType,
    });
    handleSelectKey(el.key);
  };

  const handleAddStage = () => {
    if (!selectedKey || !stageLabel.trim()) return;
    const deg = Math.max(0, Math.min(100, parseFloat(stageDegree) || 0));
    addStage(selectedKey, { label: stageLabel.trim(), date: stageDate, degree: deg, note: stageNote.trim() });
    setStageLabel("");
    setStageDegree("0");
    setStageNote("");
  };

  const handleAddDoc = () => {
    if (!selectedKey || !docTitle.trim()) return;
    addDocument(selectedKey, { docId: docDocId.trim(), title: docTitle.trim(), url: docUrl.trim() });
    setDocDocId("");
    setDocTitle("");
    setDocUrl("");
  };

  const latestDegree = (key: string): number => {
    const entry = entries[key];
    if (!entry || entry.stages.length === 0) return 0;
    return entry.stages[entry.stages.length - 1].degree;
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
        <BarChart2 size={16} className="text-primary shrink-0" />
        <span className="font-semibold text-sm">5D-Abrechnung</span>
        <div className="flex-1" />
        {Object.keys(entries).length > 0 && (
          <button
            onClick={() => bcRef.current?.postMessage({ t: "isolateTracked" } satisfies BillingMsg)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors"
            title="Nur erfasste Objekte im Viewer isolieren"
          >
            <ScanEye size={12} />
            <span>Isolieren</span>
          </button>
        )}
        <button
          onClick={handleToggleViz}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
            vizActive
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
          title="3D-Visualisierung ein/ausschalten"
        >
          <span className={cn("w-2 h-2 rounded-full", vizActive ? "bg-primary-foreground" : "bg-muted-foreground")} />
          Visualisierung
        </button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          title="JSON importieren"
        >
          <FileUp size={12} />
          <span>Import</span>
        </button>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          title="JSON exportieren"
        >
          <FileDown size={12} />
          <span>Export</span>
        </button>
      </div>

      {importError && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-400/10 border-b border-red-400/20 flex items-center justify-between gap-2">
          <span>{importError}</span>
          <button onClick={() => setImportError("")} className="shrink-0 text-red-400/60 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left: element list */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border">
          <div className="px-3 py-2 border-b border-border shrink-0">
            <input
              type="text"
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {elements.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground p-6 gap-3">
              <BarChart2 size={28} className="opacity-30" />
              <p className="text-xs leading-relaxed">
                Kein Modell geladen.<br />
                Öffne zuerst eine IFC-Datei im Hauptfenster.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              {filtered.map((el) => {
                const tracked = !!entries[el.key];
                const degree = tracked ? latestDegree(el.key) : null;
                const isSelected = selectedKey === el.key;
                return (
                  <div
                    key={el.key}
                    onClick={() => handleSelectKey(el.key)}
                    className={cn(
                      "group flex flex-col gap-1 px-3 py-2 cursor-pointer border-b border-border/50 hover:bg-muted/40 transition-colors",
                      isSelected && "bg-primary/10 border-l-2 border-l-primary"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        tracked ? (degree! >= 100 ? "bg-green-500" : degree! > 0 ? "bg-amber-400" : "bg-blue-400") : "bg-border"
                      )} />
                      <span className="text-xs font-medium truncate flex-1">{el.name}</span>
                      {!tracked && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAddEntry(el); }}
                          className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary hover:bg-primary/40 transition-all"
                          title="Hinzufügen"
                        >
                          <Plus size={10} />
                          Hinzufügen
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pl-4">
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                        {el.ifcType.replace(/^Ifc/, "")}
                      </span>
                      {tracked && degree !== null && (
                        <div className="flex-1 flex items-center gap-1.5">
                          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                degree >= 100 ? "bg-green-500" : "bg-amber-400"
                              )}
                              style={{ width: `${degree}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{degree}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!selectedKey ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center p-8 gap-3">
              <BarChart2 size={36} className="opacity-20" />
              <p className="text-sm font-medium">Kein Element gewählt</p>
              <p className="text-xs leading-relaxed max-w-xs">
                Wähle ein Element aus der Liste aus. Nicht erfasste Elemente können über "Hinzufügen" verfolgt werden.
              </p>
            </div>
          ) : !selectedEntry ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center p-8 gap-3">
              <BarChart2 size={36} className="opacity-20" />
              <p className="text-sm">Element noch nicht erfasst</p>
              <button
                onClick={() => {
                  const el = elements.find(e => e.key === selectedKey);
                  if (el) handleAddEntry(el);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Plus size={12} />
                Erfassen
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {/* Element header */}
              <div className="px-5 py-3 border-b border-border bg-card/50 shrink-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{selectedEntry.elementName}</span>
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono shrink-0">
                        {selectedEntry.ifcType.replace(/^Ifc/, "")}
                      </span>
                    </div>
                    {selectedEntry.guid && (
                      <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block truncate">
                        {selectedEntry.guid}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      #{selectedEntry.expressId} · {selectedEntry.modelId.slice(0, 8)}…
                    </span>
                  </div>
                  <button
                    onClick={() => { removeEntry(selectedKey); setSelectedKey(null); }}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                    title="Element entfernen"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Quantities section */}
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mengen</span>
                  <button
                    onClick={() => handleRequestQuantities(selectedKey)}
                    disabled={pendingQKey === selectedKey}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground border border-border transition-colors disabled:opacity-40"
                    title="Volumen automatisch aus Geometrie berechnen"
                  >
                    <Calculator size={10} />
                    {pendingQKey === selectedKey ? "Berechne…" : "Auto"}
                  </button>
                  <button
                    onClick={() => {
                      const el = elements.find(e => e.key === selectedKey);
                      bcRef.current?.postMessage({
                        t: "startInspection",
                        key: selectedKey,
                        elementName: el?.name ?? selectedEntry.elementName,
                      } satisfies BillingMsg);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground border border-border transition-colors"
                    title="Flächen und Kanten im Viewer manuell auswählen"
                  >
                    <Ruler size={10} />
                    Messen
                  </button>
                  {(liveQuantities ?? selectedEntry.quantities) && (
                    <button
                      onClick={() => {
                        const q = liveQuantities ?? selectedEntry.quantities;
                        if (q) setQuantities(selectedKey, q);
                        setLiveQuantities(null);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors"
                      title="Berechnete Mengen am Eintrag speichern"
                    >
                      <Save size={10} />
                      Speichern
                    </button>
                  )}
                </div>

                {(() => {
                  const q = liveQuantities ?? selectedEntry.quantities ?? null;
                  if (!q) return (
                    <p className="text-xs text-muted-foreground">
                      Noch keine Mengen berechnet. Klicke „Berechnen" um Volumen, Oberfläche und Abmessungen aus der Geometrie zu ermitteln.
                    </p>
                  );
                  const fmt = (n: number, decimals = 3) => n.toFixed(decimals).replace(".", ",");
                  const isLive = liveQuantities !== null;
                  return (
                    <div className={cn("rounded-md border p-3 text-xs", isLive ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30")}>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        <div className="text-muted-foreground">Volumen</div>
                        <div className="font-mono text-right font-medium">{fmt(q.volume)} m³</div>
                        <div className="text-muted-foreground">Oberfläche</div>
                        <div className="font-mono text-right font-medium">{fmt(q.surfaceArea)} m²</div>
                        <div className="col-span-2 border-t border-border/50 mt-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold">
                          Bounding Box
                        </div>
                        <div className="text-muted-foreground">Breite (X)</div>
                        <div className="font-mono text-right">{fmt(q.bboxX)} m</div>
                        <div className="text-muted-foreground">Höhe (Y)</div>
                        <div className="font-mono text-right">{fmt(q.bboxY)} m</div>
                        <div className="text-muted-foreground">Tiefe (Z)</div>
                        <div className="font-mono text-right">{fmt(q.bboxZ)} m</div>
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground/50">
                        {isLive ? "Neu berechnet · noch nicht gespeichert" : `Gespeichert ${new Date(q.computedAt).toLocaleDateString("de-DE")}`}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Stages section */}
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abrechnungsstände</span>
                  {selectedEntry.stages.length > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {selectedEntry.stages.length}
                    </span>
                  )}
                </div>

                {selectedEntry.stages.length > 0 ? (
                  <table className="w-full text-xs mb-4">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left pb-1.5 pr-2 font-medium w-6">Nr</th>
                        <th className="text-left pb-1.5 pr-2 font-medium">Bezeichnung</th>
                        <th className="text-left pb-1.5 pr-2 font-medium w-24">Datum</th>
                        <th className="text-right pb-1.5 pr-2 font-medium w-12">Grad</th>
                        <th className="text-right pb-1.5 pr-2 font-medium w-14">Delta</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEntry.stages.map((s, i) => {
                        const prev = i > 0 ? selectedEntry.stages[i - 1].degree : 0;
                        const delta = s.degree - prev;
                        return (
                          <tr key={s.id} className="border-b border-border/40 hover:bg-muted/30">
                            <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                            <td className="py-1.5 pr-2">
                              <div className="font-medium">{s.label}</div>
                              {s.note && <div className="text-[10px] text-muted-foreground">{s.note}</div>}
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground font-mono">{s.date}</td>
                            <td className="py-1.5 pr-2 text-right">
                              <div className="flex items-center gap-1.5 justify-end">
                                <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full", s.degree >= 100 ? "bg-green-500" : "bg-amber-400")}
                                    style={{ width: `${s.degree}%` }}
                                  />
                                </div>
                                <span className="font-mono w-8 text-right">{s.degree}%</span>
                              </div>
                            </td>
                            <td className={cn("py-1.5 pr-2 text-right font-mono", delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-muted-foreground")}>
                              {delta > 0 ? "+" : ""}{delta}%
                            </td>
                            <td className="py-1.5">
                              <button
                                onClick={() => removeStage(selectedKey, s.id)}
                                className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                title="Löschen"
                              >
                                <X size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-muted-foreground mb-3">Noch kein Abrechnungsstand erfasst.</p>
                )}

                {/* Add stage form */}
                <div className="bg-muted/30 border border-border rounded-md p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neuer Stand</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Bezeichnung"
                      value={stageLabel}
                      onChange={(e) => setStageLabel(e.target.value)}
                      className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      type="date"
                      value={stageDate}
                      onChange={(e) => setStageDate(e.target.value)}
                      className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={stageDegree}
                        onChange={(e) => setStageDegree(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Grad %"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Notiz (optional)"
                      value={stageNote}
                      onChange={(e) => setStageNote(e.target.value)}
                      className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    onClick={handleAddStage}
                    disabled={!stageLabel.trim()}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity self-end"
                  >
                    <Plus size={12} />
                    Hinzufügen
                  </button>
                </div>
              </div>

              {/* Documents section */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dokumente</span>
                  {selectedEntry.documents.length > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {selectedEntry.documents.length}
                    </span>
                  )}
                </div>

                {selectedEntry.documents.length > 0 ? (
                  <div className="flex flex-col gap-1.5 mb-4">
                    {selectedEntry.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border rounded-md">
                        {doc.docId && (
                          <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                            {doc.docId}
                          </span>
                        )}
                        <span className="text-xs flex-1 truncate">{doc.title}</span>
                        {doc.url && (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                            title="Link öffnen"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                        <button
                          onClick={() => removeDocument(selectedKey, doc.id)}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                          title="Löschen"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-3">Noch keine Dokumente verknüpft.</p>
                )}

                {/* Add document form */}
                <div className="bg-muted/30 border border-border rounded-md p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neues Dokument</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Dok.-Nr. (optional)"
                      value={docDocId}
                      onChange={(e) => setDocDocId(e.target.value)}
                      className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      type="text"
                      placeholder="Titel"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      type="text"
                      placeholder="URL (optional)"
                      value={docUrl}
                      onChange={(e) => setDocUrl(e.target.value)}
                      className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    onClick={handleAddDoc}
                    disabled={!docTitle.trim()}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity self-end"
                  >
                    <Plus size={12} />
                    Hinzufügen
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
