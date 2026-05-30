import { useState } from "react";
import {
  AlertTriangle, Zap, Shield, MessageSquare, FileDown, Plus, Trash2,
  ChevronRight, Clock, User, Tag, Upload, X, Send, Camera, MapPin,
  Calendar, Eye, Navigation, Bot, ShoppingBasket, Search,
} from "lucide-react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useBcfStore } from "./bcfStore";
import { exportBcf } from "./bcfWriter";
import { importBcf } from "./bcfParser";
import type { BcfTopicStatus, BcfTopicType, BcfVersion, BcfPriority } from "./bcfTypes";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { openBcfLightWindow } from "../utils/windowSync";

const STATUS_COLOR: Record<BcfTopicStatus, string> = {
  Open: "bg-transparent text-blue-600 border-blue-500/50 dark:text-blue-400",
  "In Progress": "bg-transparent text-orange-600 border-orange-500/50 dark:text-orange-400",
  Resolved: "bg-transparent text-green-600 border-green-500/50 dark:text-green-400",
  Closed: "bg-transparent text-muted-foreground border-border",
  ReOpened: "bg-transparent text-red-600 border-red-500/50 dark:text-red-400",
};

const TYPE_ICON: Record<BcfTopicType, React.ReactNode> = {
  Issue: <AlertTriangle size={13} />,
  Clash: <Zap size={13} />,
  IDS: <Shield size={13} />,
  Request: <MessageSquare size={13} />,
  Remark: <MessageSquare size={13} />,
  Error: <AlertTriangle size={13} />,
};

const PRIORITY_COLOR: Record<BcfPriority, string> = {
  Critical: "text-red-500",
  Major: "text-orange-400",
  Normal: "text-foreground",
  Minor: "text-muted-foreground",
};

const STATUSES: BcfTopicStatus[] = ["Open", "In Progress", "Resolved", "Closed", "ReOpened"];
const TYPES: BcfTopicType[] = ["Issue", "Request", "Clash", "IDS", "Remark", "Error"];
const PRIORITIES: BcfPriority[] = ["Critical", "Major", "Normal", "Minor"];
const VERSIONS: BcfVersion[] = ["2.1", "2.0", "3.0"];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAuthorHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 360;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

export function BCFPanel() {
  const document = useBcfStore((s) => s.document);
  const activeTopicId = useBcfStore((s) => s.activeTopicId);
  const setActiveTopicId = useBcfStore((s) => s.setActiveTopicId);
  const addTopic = useBcfStore((s) => s.addTopic);
  const updateTopic = useBcfStore((s) => s.updateTopic);
  const deleteTopic = useBcfStore((s) => s.deleteTopic);
  const addComment = useBcfStore((s) => s.addComment);
  const deleteComment = useBcfStore((s) => s.deleteComment);

  const [exportVersion, setExportVersion] = useState<BcfVersion>("2.1");
  const [newCommentText, setNewCommentText] = useState("");
  const [filterStatus, setFilterStatus] = useState<BcfTopicStatus | "all">("all");
  const [filterType, setFilterType] = useState<BcfTopicType | "all">("all");
  const [searchText, setSearchText] = useState("");
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const activeTopic = document.topics.find((t) => t.id === activeTopicId) ?? null;

  const filteredTopics = document.topics.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterType !== "all" && t.type !== filterType) return false;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const inTitle = t.title.toLowerCase().includes(q);
      const inDesc = (t.description ?? "").toLowerCase().includes(q);
      const inAuthor = t.creationAuthor.toLowerCase().includes(q);
      if (!inTitle && !inDesc && !inAuthor) return false;
    }
    return true;
  });

  async function handleExport() {
    const zip = await exportBcf(document, exportVersion);
    const blob = new Blob([zip], { type: "application/zip" });
    const a = window.document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${document.projectName.replace(/\s+/g, "_")}_BCF${exportVersion}.bcf`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importBcf(file);
      useBcfStore.setState({ document: imported, activeTopicId: imported.topics[0]?.id ?? null });
    } catch (err) {
      alert(`BCF Import Fehler: ${err}`);
    }
    e.target.value = "";
  }

  function jumpToViewpoint(topic: typeof activeTopic) {
    if (!topic?.viewpoint?.cameraPosition || !topic.viewpoint.cameraDirection) return;
    openBcfLightWindow();
    window.dispatchEvent(new CustomEvent("viewer:bcfViewpoint", {
      detail: {
        position:  topic.viewpoint.cameraPosition,
        direction: topic.viewpoint.cameraDirection,
        up:        topic.viewpoint.cameraUpVector,
        fov:       topic.viewpoint.fieldOfView,
      },
    }));
  }

  function handleAddComment() {
    if (!activeTopic || !newCommentText.trim()) return;
    addComment(activeTopic.id, newCommentText.trim(), "infraCore User");
    setNewCommentText("");
  }

  function handleAddToBasket() {
    if (!activeTopic?.relatedExpressIds?.length) return;
    const store = useModelStore.getState();
    for (const r of activeTopic.relatedExpressIds) {
      store.addToBasket(r.modelId, r.expressId);
    }
    store.setBasketMode("isolate");
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground text-[13px]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap bg-background">
        <span className="font-semibold text-[13px] mr-1">BCF Manager</span>

        <button
          onClick={() => { addTopic({ title: "Neues Thema" }); }}
          className="flex items-center gap-1 px-2 py-1 rounded-[4px] bg-primary/10 hover:bg-primary/20 text-primary text-[12px]"
        >
          <Plus size={13} /> Neu
        </button>

        <label className="flex items-center gap-1 px-2 py-1 rounded-[4px] border border-border hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] text-[12px] cursor-pointer">
          <Upload size={13} /> Öffnen
          <input type="file" accept=".bcf,.bcfzip" className="hidden" onChange={handleImport} />
        </label>

        <div className="flex items-center gap-1 ml-auto">
          <select
            value={exportVersion}
            onChange={(e) => setExportVersion(e.target.value as BcfVersion)}
            className="text-[12px] bg-background border border-border rounded-[4px] px-1 py-0.5"
          >
            {VERSIONS.map((v) => <option key={v} value={v}>BCF {v}</option>)}
          </select>
          <button
            onClick={handleExport}
            disabled={document.topics.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded-[4px] bg-primary text-primary-foreground text-[12px] disabled:opacity-40 hover:bg-primary/90"
          >
            <FileDown size={13} /> Export
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-muted/20 flex-wrap">
        <div className="relative flex items-center">
          <Search size={11} className="absolute left-1.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Suchen…"
            className="text-[11px] bg-background border border-border rounded-[4px] pl-5 pr-2 py-0.5 w-32 outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as BcfTopicStatus | "all")}
          className="text-[11px] bg-background border border-border rounded-[4px] px-1 py-0.5"
        >
          <option value="all">Alle Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as BcfTopicType | "all")}
          className="text-[11px] bg-background border border-border rounded-[4px] px-1 py-0.5"
        >
          <option value="all">Alle Typen</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">{filteredTopics.length} Themen</span>
      </div>

      {/* Two-pane resizable layout */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* Left: topic list */}
        <Panel defaultSize={32} minSize={20}>
          <div className="h-full border-r border-border flex flex-col overflow-y-auto">
            {filteredTopics.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-6 text-center text-[12px]">
                <MessageSquare size={28} className="opacity-30" />
                <span>Keine BCF-Themen.<br />Erstelle ein neues Thema oder importiere eine BCF-Datei.</span>
              </div>
            )}
            {filteredTopics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => { setActiveTopicId(topic.id); setSnapshotOpen(false); }}
                className={cn(
                  "flex gap-2 px-2 py-2 text-left border-b border-border/50 hover:bg-[#E5E5E5] dark:hover:bg-[#333333] transition-colors",
                  activeTopicId === topic.id && "bg-primary/8 border-l-2 border-l-primary"
                )}
              >
                {/* Snapshot thumbnail */}
                {topic.snapshot ? (
                  <img src={topic.snapshot} alt="" className="w-12 h-10 object-cover rounded-[3px] shrink-0 border border-border/50" />
                ) : (
                  <div className="w-12 h-10 rounded-[3px] bg-muted/40 border border-border/30 shrink-0 flex items-center justify-center text-muted-foreground/30">
                    <Camera size={14} />
                  </div>
                )}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-start gap-1">
                    <span className="text-muted-foreground shrink-0 mt-0.5">{TYPE_ICON[topic.type]}</span>
                    <span className="font-medium text-[12px] leading-snug line-clamp-2 flex-1">{topic.title}</span>
                    <ChevronRight size={11} className="shrink-0 text-muted-foreground/40 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn("text-[10px] px-1.5 py-0 rounded-[3px] border", STATUS_COLOR[topic.status])}>
                      {topic.status}
                    </span>
                    <span className={cn("text-[10px]", PRIORITY_COLOR[topic.priority])}>{topic.priority}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{formatDate(topic.modifiedDate)}</span>
                  </div>
                  {topic.comments.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{topic.comments.length} Kommentar(e)</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

        {/* Right: detail pane */}
        <Panel defaultSize={68} minSize={30}>
          <div className="h-full min-w-0 flex flex-col overflow-hidden">
            {!activeTopic ? (
              <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-8 text-center text-[12px]">
                <MessageSquare size={36} className="opacity-20" />
                <span>Thema auswählen oder neues Thema erstellen</span>
              </div>
            ) : (
              <>
                {/* Snapshot lightbox */}
                {snapshotOpen && activeTopic.snapshot && (
                  <div
                    className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center"
                    onClick={() => setSnapshotOpen(false)}
                  >
                    <img src={activeTopic.snapshot} alt="Snapshot" className="max-w-full max-h-full object-contain" />
                  </div>
                )}

                {/* Topic header */}
                <div className="px-4 py-3 border-b border-border shrink-0">
                  <div className="flex items-start gap-2 mb-2">
                    <input
                      className="flex-1 font-semibold text-[14px] bg-transparent border-none outline-none"
                      value={activeTopic.title}
                      onChange={(e) => updateTopic(activeTopic.id, { title: e.target.value })}
                    />
                    <button
                      onClick={() => deleteTopic(activeTopic.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded-[4px]"
                      title="Thema löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Status / Type / Priority row */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      Status:
                      <select
                        value={activeTopic.status}
                        onChange={(e) => updateTopic(activeTopic.id, { status: e.target.value as BcfTopicStatus })}
                        className="ml-1 text-[11px] bg-background border border-border rounded-[4px] px-1 py-0.5"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      Typ:
                      <select
                        value={activeTopic.type}
                        onChange={(e) => updateTopic(activeTopic.id, { type: e.target.value as BcfTopicType })}
                        className="ml-1 text-[11px] bg-background border border-border rounded-[4px] px-1 py-0.5"
                      >
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      Priorität:
                      <select
                        value={activeTopic.priority}
                        onChange={(e) => updateTopic(activeTopic.id, { priority: e.target.value as BcfPriority })}
                        className="ml-1 text-[11px] bg-background border border-border rounded-[4px] px-1 py-0.5"
                      >
                        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                  </div>

                  {/* Metadata row */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <User size={10} /> {activeTopic.creationAuthor}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock size={10} /> Erstellt: {formatDate(activeTopic.creationDate)}
                    </span>
                    {activeTopic.modifiedDate !== activeTopic.creationDate && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock size={10} /> Geändert: {formatDate(activeTopic.modifiedDate)}
                        {activeTopic.modifiedAuthor && ` (${activeTopic.modifiedAuthor})`}
                      </span>
                    )}
                    {activeTopic.dueDate && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar size={10} /> Fällig: {formatDate(activeTopic.dueDate)}
                      </span>
                    )}
                    {activeTopic.stage && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Tag size={10} /> Phase: {activeTopic.stage}
                      </span>
                    )}
                    {activeTopic.assignedTo && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <User size={10} /> Zugewiesen: {activeTopic.assignedTo}
                      </span>
                    )}
                    {activeTopic.labels.length > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Tag size={10} />
                        {activeTopic.labels.map((l) => (
                          <span key={l} className="px-1.5 py-0 bg-muted rounded-[3px] text-[10px] border border-border">{l}</span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>

                {/* Resizable body: description+related (top) and comments (bottom) */}
                <PanelGroup orientation="vertical" className="flex-1 min-h-0">
                  <Panel defaultSize={45} minSize={20}>
                    <div className="h-full overflow-y-auto">
                      {/* Snapshot + Viewpoint */}
                      {(activeTopic.snapshot || activeTopic.viewpoint) && (
                        <div className="px-4 py-3 border-b border-border/50 flex gap-3">
                          {activeTopic.snapshot && (
                            <button
                              onClick={() => setSnapshotOpen(true)}
                              className="relative shrink-0 group"
                              title="Screenshot vergrößern"
                            >
                              <img
                                src={activeTopic.snapshot}
                                alt="Snapshot"
                                className="h-24 w-36 object-cover rounded-[4px] border border-border group-hover:opacity-90 transition-opacity"
                              />
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <Eye size={18} className="text-white drop-shadow" />
                              </div>
                            </button>
                          )}
                          {activeTopic.viewpoint && (
                            <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground text-[12px] flex items-center gap-1">
                                  <MapPin size={11} /> Viewpoint
                                </span>
                                {activeTopic.viewpoint.cameraPosition && (
                                  <button
                                    onClick={() => jumpToViewpoint(activeTopic)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-primary text-primary-foreground text-[11px] hover:bg-primary/90 transition-colors"
                                    title="Im Modell auf diesen Blickwinkel springen"
                                  >
                                    <Navigation size={11} /> Im Modell zeigen
                                  </button>
                                )}
                              </div>
                              {activeTopic.viewpoint.cameraPosition && (
                                <span className="font-mono text-[10px]">
                                  Pos: {activeTopic.viewpoint.cameraPosition.x.toFixed(2)},
                                  {" "}{activeTopic.viewpoint.cameraPosition.y.toFixed(2)},
                                  {" "}{activeTopic.viewpoint.cameraPosition.z.toFixed(2)}
                                </span>
                              )}
                              {activeTopic.viewpoint.fieldOfView && (
                                <span>FoV: {activeTopic.viewpoint.fieldOfView.toFixed(1)}°</span>
                              )}
                              {(activeTopic.viewpoint.selectedIfcGuids?.length ?? 0) > 0 && (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-foreground">
                                    Selektierte Elemente ({activeTopic.viewpoint.selectedIfcGuids!.length}):
                                  </span>
                                  <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                                    {activeTopic.viewpoint.selectedIfcGuids!.map((g) => (
                                      <span key={g} className="font-mono text-[9px] bg-muted px-1 py-0 rounded-[3px] border border-border">{g}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(activeTopic.viewpoint.coloring?.length ?? 0) > 0 && (
                                <span>{activeTopic.viewpoint.coloring!.length} Farbgruppe(n)</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Description */}
                      <div className="px-4 py-3 border-b border-border/50">
                        <textarea
                          className="w-full text-[12px] bg-muted/20 border border-border/50 rounded-[4px] p-2 outline-none resize-none min-h-[60px] focus:ring-1 focus:ring-primary"
                          value={activeTopic.description ?? ""}
                          placeholder="Beschreibung…"
                          onChange={(e) => updateTopic(activeTopic.id, { description: e.target.value || undefined })}
                        />
                      </div>

                      {/* Related express IDs */}
                      {activeTopic.relatedExpressIds && activeTopic.relatedExpressIds.length > 0 && (
                        <div className="px-4 py-2 border-b border-border/50 text-[11px] text-muted-foreground">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-foreground">Verknüpfte Elemente:</span>
                            <button
                              onClick={handleAddToBasket}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-primary/10 hover:bg-primary/20 text-primary text-[11px] transition-colors"
                              title="Alle verknüpften Elemente in den Korb legen"
                            >
                              <ShoppingBasket size={11} /> In Korb
                            </button>
                          </div>
                          {activeTopic.relatedExpressIds.slice(0, 8).map((r, i) => (
                            <span key={i} className="mr-2 font-mono">#{r.expressId}</span>
                          ))}
                          {activeTopic.relatedExpressIds.length > 8 && (
                            <span>+{activeTopic.relatedExpressIds.length - 8} weitere</span>
                          )}
                        </div>
                      )}
                    </div>
                  </Panel>

                  <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-row-resize" />

                  <Panel defaultSize={55} minSize={20}>
                    <div className="h-full flex flex-col overflow-hidden">
                      {/* Comment thread */}
                      <div className="px-4 pt-3 pb-1 flex-1 overflow-y-auto">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Kommentare
                          </span>
                          {activeTopic.comments.length > 0 && (
                            <span className="text-[10px] bg-muted px-1.5 py-0 rounded-full border border-border text-muted-foreground">
                              {activeTopic.comments.length}
                            </span>
                          )}
                        </div>

                        {activeTopic.comments.length === 0 && (
                          <div className="flex flex-col items-center py-4 text-muted-foreground/50 gap-1.5">
                            <MessageSquare size={20} className="opacity-40" />
                            <span className="text-[11px]">Noch keine Kommentare</span>
                          </div>
                        )}

                        <div className="flex flex-col gap-0">
                          {activeTopic.comments.map((c, idx) => {
                            const isSystem = !c.author || c.author === "infraCore" || c.author.toLowerCase().includes("auto");
                            const hue = isSystem ? 0 : getAuthorHue(c.author);
                            const initials = isSystem ? null : getInitials(c.author || "?");
                            const isLast = idx === activeTopic.comments.length - 1;
                            return (
                              <div key={c.id} className="group relative flex gap-3 py-2.5">
                                {!isLast && (
                                  <div className="absolute left-[15px] top-[38px] bottom-0 w-px bg-border/40" />
                                )}
                                <div className="shrink-0 mt-0.5">
                                  {isSystem ? (
                                    <div className="w-[30px] h-[30px] rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground">
                                      <Bot size={13} />
                                    </div>
                                  ) : (
                                    <div
                                      className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                                      style={{ background: `hsl(${hue},55%,42%)` }}
                                    >
                                      {initials}
                                    </div>
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-semibold leading-none">
                                      {isSystem ? "System" : c.author || "—"}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground leading-none">{formatDate(c.date)}</span>
                                    {c.modifiedDate && c.modifiedDate !== c.date && (
                                      <span className="text-[9px] text-muted-foreground/50 leading-none">
                                        · geändert {c.modifiedAuthor ? `von ${c.modifiedAuthor}` : formatDate(c.modifiedDate)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/90">
                                    {c.text || <span className="italic text-muted-foreground/50">(kein Text)</span>}
                                  </div>
                                </div>

                                <button
                                  onClick={() => deleteComment(activeTopic.id, c.id)}
                                  className="absolute top-2.5 right-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all p-0.5 rounded"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* New comment input */}
                      <div className="px-4 py-3 border-t border-border shrink-0 flex gap-2">
                        <textarea
                          className="flex-1 text-[12px] bg-muted/20 border border-border rounded-[4px] p-2 outline-none resize-none min-h-[52px] focus:ring-1 focus:ring-primary"
                          placeholder="Kommentar hinzufügen… (Strg+Enter)"
                          value={newCommentText}
                          onChange={(e) => setNewCommentText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleAddComment(); }}
                        />
                        <button
                          onClick={handleAddComment}
                          disabled={!newCommentText.trim()}
                          className="self-end px-3 py-2 rounded-[4px] bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1 text-[12px] hover:bg-primary/90"
                        >
                          <Send size={13} /> Senden
                        </button>
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              </>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
