import { useEffect, useRef, useState } from "react";
import {
  BarChart2, X, ExternalLink, Plus, Trash2,
  Calculator, Cpu, ScanEye, User,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { useBillingStore, BILLING_CHANNEL } from "./billingStore";
import { openBillingWindow } from "../utils/windowSync";
import { QuantitySetPanel } from "./QuantitySetPanel";
import type { BillingMsg, ElementInfo, ElementQuantities } from "./types";
import type { QuantityItem } from "./quantityTypes";

const fmt = (n: number, d = 3) => n.toFixed(d).replace(".", ",");

type OverlayTab = "mengen" | "abschnitte" | "dokumente";

// Resolve the billing key (GUID) and ElementInfo for the currently selected 3D element.
function useSelectedBillingInfo(): { guid: string | null; info: ElementInfo | null } {
  const selectedElement = useModelStore(s => s.selectedElement);
  const models = useModelStore(s => s.models);

  if (!selectedElement) return { guid: null, info: null };

  const model = models.get(selectedElement.modelId);
  if (!model) return { guid: null, info: null };

  for (const [ifcType, els] of Object.entries(model.elementsByType)) {
    const found = (els as Array<{ expressId: number; name?: string; guid?: string }>)
      .find(e => e.expressId === selectedElement.expressId);
    if (found) {
      const key = found.guid ?? `${model.name}:${selectedElement.expressId}`;
      return {
        guid: key,
        info: {
          key,
          guid: found.guid ?? "",
          expressId: selectedElement.expressId,
          modelId: selectedElement.modelId,
          name: found.name || `${ifcType} #${selectedElement.expressId}`,
          ifcType,
        },
      };
    }
  }
  return { guid: null, info: null };
}

export function Billing5DOverlay({ onClose }: { onClose: () => void }) {
  const { guid, info } = useSelectedBillingInfo();

  const {
    entries,
    addEntry, removeEntry,
    addStage, removeStage,
    addDocument, removeDocument,
    addQuantityItem, updateQuantityItem, removeQuantityItem, mergeQuantityItems,
    setQuantities,
  } = useBillingStore();

  const entry    = guid ? entries[guid] : null;
  const tracked  = !!entry;

  const [tab,          setTab]          = useState<OverlayTab>("mengen");
  const [pendingGeo,   setPendingGeo]   = useState(false);
  const [pendingIfc,   setPendingIfc]   = useState(false);
  const [liveQ,        setLiveQ]        = useState<ElementQuantities | null>(null);
  const [stageLabel,   setStageLabel]   = useState("");
  const [stageDate,    setStageDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [stageDegree,  setStageDegree]  = useState("0");
  const [stageNote,    setStageNote]    = useState("");
  const [stageCreatedBy, setStageCreatedBy] = useState(
    () => localStorage.getItem("infracore-username") ?? ""
  );
  const [docDocId, setDocDocId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docUrl,   setDocUrl]   = useState("");

  const bcRef = useRef<BroadcastChannel | null>(null);

  // Reset transient state when the selected element changes
  useEffect(() => {
    setPendingGeo(false);
    setPendingIfc(false);
    setLiveQ(null);
    setTab("mengen");
  }, [guid]);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(BILLING_CHANNEL); } catch { return; }
    bcRef.current = bc;

    bc.addEventListener("message", (ev) => {
      const msg = ev.data as BillingMsg;
      if (msg.t === "quantities" && guid && msg.key === guid) {
        setPendingGeo(false);
        setLiveQ(msg.data);
        if (msg.data) {
          const q = msg.data;
          const dims = [q.bboxX, q.bboxY, q.bboxZ].sort((a, b) => a - b);
          const items: QuantityItem[] = [];
          if (q.volume > 0)      items.push({ id: "_gv", type: "volume",    label: "Volumen (Geometrie)",    value: q.volume,      unit: "m³", source: "geometry" });
          if (q.surfaceArea > 0) items.push({ id: "_ga", type: "area",      label: "Oberfläche (Geometrie)", value: q.surfaceArea, unit: "m²", source: "geometry" });
          if (dims[2] > 0)       items.push({ id: "_gh", type: "height",    label: "Größte Ausdehnung",      value: dims[2],       unit: "m",  source: "geometry" });
          if (dims[1] > 0)       items.push({ id: "_gw", type: "width",     label: "Mittlere Ausdehnung",    value: dims[1],       unit: "m",  source: "geometry" });
          if (dims[0] > 0)       items.push({ id: "_gt", type: "thickness", label: "Kleinste Ausdehnung",    value: dims[0],       unit: "m",  source: "geometry" });
          mergeQuantityItems(guid, items, "geometry");
          setQuantities(guid, q);
        }
      }
      if (msg.t === "ifcQuantities" && guid && msg.key === guid) {
        setPendingIfc(false);
        if (msg.items && msg.items.length > 0) mergeQuantityItems(guid, msg.items, "ifc");
      }
    });

    return () => { bc?.close(); bcRef.current = null; };
  }, [guid, mergeQuantityItems, setQuantities]);

  const handleAddEntry = () => {
    if (!info) return;
    addEntry({ key: info.key, guid: info.guid, expressId: info.expressId, modelId: info.modelId, elementName: info.name, ifcType: info.ifcType });
  };

  const handleAddStage = () => {
    if (!guid || !stageLabel.trim()) return;
    if (stageCreatedBy) localStorage.setItem("infracore-username", stageCreatedBy);
    addStage(guid, { label: stageLabel.trim(), date: stageDate, degree: Math.max(0, parseFloat(stageDegree) || 0), note: stageNote.trim(), createdBy: stageCreatedBy.trim() || undefined });
    setStageLabel(""); setStageDegree("0"); setStageNote("");
  };

  const handleAddDoc = () => {
    if (!guid || !docTitle.trim()) return;
    addDocument(guid, { docId: docDocId.trim(), title: docTitle.trim(), url: docUrl.trim() });
    setDocDocId(""); setDocTitle(""); setDocUrl("");
  };

  const handleFocus = () => {
    if (!info) return;
    bcRef.current?.postMessage({ t: "focusElement", modelId: info.modelId, expressId: info.expressId } satisfies BillingMsg);
  };
  const handleIsolate = () => {
    if (!info) return;
    bcRef.current?.postMessage({ t: "isolateElement", modelId: info.modelId, expressId: info.expressId } satisfies BillingMsg);
  };
  const handleRequestGeo = () => {
    if (!guid) return;
    setPendingGeo(true);
    bcRef.current?.postMessage({ t: "requestQuantities", key: guid } satisfies BillingMsg);
  };
  const handleRequestIfc = () => {
    if (!guid) return;
    setPendingIfc(true);
    bcRef.current?.postMessage({ t: "requestIfcQuantities", key: guid } satisfies BillingMsg);
  };

  const latestDegree = entry && entry.stages.length > 0
    ? entry.stages[entry.stages.length - 1].degree
    : 0;

  return (
    <div className="absolute bottom-4 left-4 z-20 w-[380px] max-h-[72vh] flex flex-col rounded-xl border border-border bg-card/95 backdrop-blur shadow-2xl overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <BarChart2 size={14} className="text-primary shrink-0" />
        <span className="font-semibold text-xs truncate flex-1">
          {info?.name ?? "Kein Element ausgewählt"}
        </span>
        {info && (
          <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
            {info.ifcType.replace(/^Ifc/, "")}
          </span>
        )}
        {latestDegree > 0 && (
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0",
            latestDegree >= 100 ? "bg-green-500/20 text-green-400" : "bg-amber-400/20 text-amber-400"
          )}>
            {latestDegree}%
          </span>
        )}
        <button
          onClick={() => openBillingWindow()}
          className="p-1 rounded text-muted-foreground hover:text-primary transition-colors shrink-0"
          title="Vollansicht in neuem Fenster"
        >
          <ExternalLink size={12} />
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Schließen"
        >
          <X size={14} />
        </button>
      </div>

      {/* Empty state */}
      {!info && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <BarChart2 size={28} className="opacity-20" />
          <p className="text-xs">Element im 3D-Viewer auswählen</p>
        </div>
      )}

      {/* Not tracked */}
      {info && !tracked && (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
          <BarChart2 size={28} className="opacity-20" />
          <p className="text-xs font-medium text-foreground">{info.name}</p>
          <p className="text-xs">Noch nicht in 5D erfasst.</p>
          <div className="flex gap-2">
            <button
              onClick={handleAddEntry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus size={12} />In 5D erfassen
            </button>
            <button
              onClick={handleIsolate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Im Viewer anzeigen"
            >
              <ScanEye size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Tracked detail */}
      {info && tracked && entry && (
        <>
          {/* Sub-header: actions */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/50 shrink-0 bg-card/50">
            <button onClick={handleIsolate} className="p-1 rounded text-muted-foreground hover:text-primary transition-colors" title="Element isolieren">
              <ScanEye size={13} />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => removeEntry(guid!)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors"
              title="Aus 5D entfernen"
            >
              <Trash2 size={10} />Entfernen
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border shrink-0 bg-card/30">
            {(["mengen", "abschnitte", "dokumente"] as OverlayTab[]).map(t => {
              const badge = t === "mengen" ? (entry.quantitySet?.items.length || undefined)
                          : t === "abschnitte" ? (entry.stages.length || undefined)
                          : (entry.documents.length || undefined);
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex items-center gap-1 px-4 py-2 text-xs transition-colors",
                    tab === t ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t === "mengen" ? "Mengen" : t === "abschnitte" ? "Abschnitte" : "Dokumente"}
                  {badge !== undefined && (
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-mono", tab === t ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab: Mengen */}
          {tab === "mengen" && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 shrink-0 flex-wrap">
                <button onClick={handleRequestIfc} disabled={pendingIfc}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-sky-400/10 hover:bg-sky-400/20 text-sky-400 border border-sky-400/30 disabled:opacity-40 transition-colors">
                  <Cpu size={10} />{pendingIfc ? "Lese IFC…" : "IFC-Extrakt"}
                </button>
                <button onClick={handleRequestGeo} disabled={pendingGeo}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-violet-400/10 hover:bg-violet-400/20 text-violet-400 border border-violet-400/30 disabled:opacity-40 transition-colors">
                  <Calculator size={10} />{pendingGeo ? "Berechne…" : "Geometrie"}
                </button>
                <button onClick={() => { if (guid) addQuantityItem(guid, { type: "count", label: "Stückzahl", value: 1, unit: "Stk", source: "manual" }); }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 border border-emerald-400/30 transition-colors">
                  <Plus size={10} />Manuell
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <QuantitySetPanel
                  entry={entry}
                  onAddItem={item => guid && addQuantityItem(guid, item)}
                  onUpdateItem={(id, p) => guid && updateQuantityItem(guid, id, p)}
                  onRemoveItem={id => guid && removeQuantityItem(guid, id)}
                />
              </div>
            </div>
          )}

          {/* Tab: Abschnitte */}
          {tab === "abschnitte" && (
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 flex flex-col gap-3">
              {entry.stages.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left pb-1.5 pr-2 font-medium">Bezeichnung</th>
                      <th className="text-left pb-1.5 pr-2 font-medium w-20">Datum</th>
                      <th className="text-right pb-1.5 pr-2 font-medium w-16">Grad</th>
                      <th className="w-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {entry.stages.map(s => (
                      <tr key={s.id} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="py-1.5 pr-2">
                          <div>{s.label}</div>
                          {s.note && <div className="text-[10px] text-muted-foreground">{s.note}</div>}
                          {s.createdBy && <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-0.5"><User size={8} />{s.createdBy}</div>}
                        </td>
                        <td className="py-1.5 pr-2 text-muted-foreground font-mono text-[10px]">{s.date}</td>
                        <td className="py-1.5 pr-2">
                          <div className="flex items-center gap-1 justify-end">
                            <div className="w-10 h-1.5 bg-border rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full", s.degree >= 100 ? "bg-green-500" : "bg-amber-400")} style={{ width: `${Math.min(s.degree, 100)}%` }} />
                            </div>
                            <span className="font-mono text-[10px] w-8 text-right">{s.degree}%</span>
                          </div>
                        </td>
                        <td className="py-1.5">
                          <button onClick={() => guid && removeStage(guid, s.id)} className="text-muted-foreground/40 hover:text-destructive transition-colors"><X size={11} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted-foreground">Noch kein Abrechnungsstand erfasst.</p>
              )}

              {/* Quick add stage */}
              <div className="bg-muted/30 border border-border rounded-lg p-2.5 flex flex-col gap-2 shrink-0">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neuer Stand</span>
                <div className="grid grid-cols-5 gap-1">
                  {[20, 40, 60, 80, 100].map(v => (
                    <button key={v} type="button" onClick={() => setStageDegree(String(v))}
                      className={cn("py-1 rounded text-[10px] font-mono border transition-colors",
                        Number(stageDegree) === v ? "bg-primary/20 text-primary border-primary/30" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted")}>
                      {v}%
                    </button>
                  ))}
                </div>
                <input type="text" placeholder="Bezeichnung *" value={stageLabel} onChange={e => setStageLabel(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={stageDate} onChange={e => setStageDate(e.target.value)}
                    className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} value={stageDegree} onChange={e => setStageDegree(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <User size={11} className="text-muted-foreground shrink-0" />
                  <input type="text" placeholder="Erfasst von (optional)" value={stageCreatedBy} onChange={e => setStageCreatedBy(e.target.value)}
                    className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <button onClick={handleAddStage} disabled={!stageLabel.trim()}
                  className="self-end flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity">
                  <Plus size={11} />Hinzufügen
                </button>
              </div>
            </div>
          )}

          {/* Tab: Dokumente */}
          {tab === "dokumente" && (
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 flex flex-col gap-3">
              {entry.documents.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {entry.documents.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border rounded-md">
                      {doc.docId && <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{doc.docId}</span>}
                      <span className="text-xs flex-1 truncate">{doc.title}</span>
                      {doc.url && <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors shrink-0" title="Öffnen"><ExternalLink size={11} /></a>}
                      <button onClick={() => guid && removeDocument(guid, doc.id)} className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"><X size={11} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Noch keine Dokumente verknüpft.</p>
              )}
              <div className="bg-muted/30 border border-border rounded-lg p-2.5 flex flex-col gap-2 shrink-0">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neues Dokument</span>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Dok.-Nr. (optional)" value={docDocId} onChange={e => setDocDocId(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  <input type="text" placeholder="Titel *" value={docTitle} onChange={e => setDocTitle(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  <input type="text" placeholder="URL (optional)" value={docUrl} onChange={e => setDocUrl(e.target.value)}
                    className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <button onClick={handleAddDoc} disabled={!docTitle.trim()}
                  className="self-end flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity">
                  <Plus size={11} />Hinzufügen
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
