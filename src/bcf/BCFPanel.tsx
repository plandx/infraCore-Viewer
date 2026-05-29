import { useState } from "react";
import {
  AlertTriangle, Zap, Shield, MessageSquare, FileDown, Plus, Trash2,
  ChevronRight, Clock, User, Tag, Upload, X, Send,
} from "lucide-react";
import { useBcfStore } from "./bcfStore";
import { exportBcf } from "./bcfWriter";
import { importBcf } from "./bcfParser";
import type { BcfTopicStatus, BcfTopicType, BcfVersion, BcfPriority } from "./bcfTypes";
import { cn } from "../lib/utils";

const STATUS_COLOR: Record<BcfTopicStatus, string> = {
  Open: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  "In Progress": "bg-orange-500/15 text-orange-500 border-orange-500/30",
  Resolved: "bg-green-500/15 text-green-500 border-green-500/30",
  Closed: "bg-muted text-muted-foreground border-border",
  ReOpened: "bg-red-500/15 text-red-500 border-red-500/30",
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

function formatDate(iso: string): string {
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

  const activeTopic = document.topics.find((t) => t.id === activeTopicId) ?? null;

  const filteredTopics = document.topics.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterType !== "all" && t.type !== filterType) return false;
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

  function handleAddComment() {
    if (!activeTopic || !newCommentText.trim()) return;
    addComment(activeTopic.id, newCommentText.trim(), "infraCore User");
    setNewCommentText("");
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground text-[13px]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <span className="font-semibold text-[13px] mr-1">BCF Manager</span>

        <button
          onClick={() => { addTopic({ title: "Neues Thema" }); }}
          className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[12px]"
        >
          <Plus size={13} /> Neu
        </button>

        <label className="flex items-center gap-1 px-2 py-1 rounded bg-muted hover:bg-muted/70 text-[12px] cursor-pointer">
          <Upload size={13} /> Öffnen
          <input type="file" accept=".bcf,.bcfzip" className="hidden" onChange={handleImport} />
        </label>

        <div className="flex items-center gap-1 ml-auto">
          <select
            value={exportVersion}
            onChange={(e) => setExportVersion(e.target.value as BcfVersion)}
            className="text-[12px] bg-background border border-border rounded px-1 py-0.5"
          >
            {VERSIONS.map((v) => <option key={v} value={v}>BCF {v}</option>)}
          </select>
          <button
            onClick={handleExport}
            disabled={document.topics.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-[12px] disabled:opacity-40"
          >
            <FileDown size={13} /> Export
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0 bg-muted/30">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as BcfTopicStatus | "all")}
          className="text-[11px] bg-background border border-border rounded px-1 py-0.5"
        >
          <option value="all">Alle Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as BcfTopicType | "all")}
          className="text-[11px] bg-background border border-border rounded px-1 py-0.5"
        >
          <option value="all">Alle Typen</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">{filteredTopics.length} Themen</span>
      </div>

      {/* Outlook-style two-pane layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: topic list */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-y-auto">
          {filteredTopics.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-6 text-center text-[12px]">
              <MessageSquare size={28} className="opacity-30" />
              <span>Keine BCF-Themen.<br />Erstelle ein neues Thema oder importiere eine BCF-Datei.</span>
            </div>
          )}
          {filteredTopics.map((topic) => (
            <button
              key={topic.id}
              onClick={() => setActiveTopicId(topic.id)}
              className={cn(
                "flex flex-col gap-1 px-3 py-2.5 text-left border-b border-border/50 hover:bg-muted/40 transition-colors",
                activeTopicId === topic.id && "bg-primary/10 border-l-2 border-l-primary"
              )}
            >
              <div className="flex items-start gap-1.5">
                <span className={cn("mt-0.5 shrink-0", topic.type === "Clash" ? "text-yellow-500" : topic.type === "IDS" ? "text-blue-400" : "text-muted-foreground")}>
                  {TYPE_ICON[topic.type]}
                </span>
                <span className="font-medium text-[12px] leading-snug line-clamp-2 flex-1">{topic.title}</span>
                <ChevronRight size={12} className="mt-0.5 shrink-0 text-muted-foreground/50" />
              </div>
              <div className="flex items-center gap-1.5 pl-5 flex-wrap">
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border", STATUS_COLOR[topic.status])}>
                  {topic.status}
                </span>
                <span className={cn("text-[10px]", PRIORITY_COLOR[topic.priority])}>{topic.priority}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{formatDate(topic.modifiedDate)}</span>
              </div>
              {topic.comments.length > 0 && (
                <div className="pl-5 text-[10px] text-muted-foreground">{topic.comments.length} Kommentar(e)</div>
              )}
            </button>
          ))}
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!activeTopic ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-8 text-center text-[12px]">
              <MessageSquare size={36} className="opacity-20" />
              <span>Thema auswählen oder neues Thema erstellen</span>
            </div>
          ) : (
            <>
              {/* Topic header */}
              <div className="px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-start gap-2">
                  <input
                    className="flex-1 font-semibold text-[15px] bg-transparent border-none outline-none"
                    value={activeTopic.title}
                    onChange={(e) => updateTopic(activeTopic.id, { title: e.target.value })}
                  />
                  <button
                    onClick={() => { deleteTopic(activeTopic.id); }}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    title="Thema löschen"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Metadata row */}
                <div className="flex flex-wrap gap-3 mt-2">
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Status:
                    <select
                      value={activeTopic.status}
                      onChange={(e) => updateTopic(activeTopic.id, { status: e.target.value as BcfTopicStatus })}
                      className="ml-1 text-[11px] bg-background border border-border rounded px-1 py-0.5"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>

                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Typ:
                    <select
                      value={activeTopic.type}
                      onChange={(e) => updateTopic(activeTopic.id, { type: e.target.value as BcfTopicType })}
                      className="ml-1 text-[11px] bg-background border border-border rounded px-1 py-0.5"
                    >
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>

                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Priorität:
                    <select
                      value={activeTopic.priority}
                      onChange={(e) => updateTopic(activeTopic.id, { priority: e.target.value as BcfPriority })}
                      className="ml-1 text-[11px] bg-background border border-border rounded px-1 py-0.5"
                    >
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap gap-3 mt-1">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <User size={10} /> {activeTopic.creationAuthor}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock size={10} /> {formatDate(activeTopic.creationDate)}
                  </span>
                  {activeTopic.labels.length > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Tag size={10} />
                      {activeTopic.labels.map((l) => (
                        <span key={l} className="px-1.5 py-0.5 bg-muted rounded text-[10px]">{l}</span>
                      ))}
                    </span>
                  )}
                </div>
              </div>

              {/* Description */}
              {(activeTopic.description !== undefined || activeTopic.source !== "manual") && (
                <div className="px-4 py-2 border-b border-border/50 shrink-0">
                  <textarea
                    className="w-full text-[12px] bg-muted/20 border border-border/50 rounded p-2 outline-none resize-none min-h-[60px]"
                    value={activeTopic.description ?? ""}
                    placeholder="Beschreibung…"
                    onChange={(e) => updateTopic(activeTopic.id, { description: e.target.value || undefined })}
                  />
                </div>
              )}

              {/* Related elements */}
              {activeTopic.relatedExpressIds && activeTopic.relatedExpressIds.length > 0 && (
                <div className="px-4 py-2 border-b border-border/50 shrink-0 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground mr-2">Verknüpfte Elemente:</span>
                  {activeTopic.relatedExpressIds.slice(0, 5).map((r, i) => (
                    <span key={i} className="mr-2">#{r.expressId}</span>
                  ))}
                  {activeTopic.relatedExpressIds.length > 5 && <span>+{activeTopic.relatedExpressIds.length - 5} weitere</span>}
                </div>
              )}

              {/* Comment thread */}
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
                {activeTopic.comments.length === 0 && (
                  <div className="text-[12px] text-muted-foreground text-center py-4">Noch keine Kommentare.</div>
                )}
                {activeTopic.comments.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1 bg-muted/20 rounded-lg px-3 py-2 border border-border/40">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium">{c.author}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDate(c.date)}</span>
                      <button
                        onClick={() => deleteComment(activeTopic.id, c.id)}
                        className="ml-auto text-muted-foreground/50 hover:text-destructive transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <p className="text-[12px] whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>

              {/* New comment input */}
              <div className="px-4 py-3 border-t border-border shrink-0 flex gap-2">
                <textarea
                  className="flex-1 text-[12px] bg-muted/20 border border-border rounded p-2 outline-none resize-none min-h-[56px]"
                  placeholder="Kommentar hinzufügen…"
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleAddComment(); }}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newCommentText.trim()}
                  className="self-end px-3 py-2 rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1 text-[12px]"
                >
                  <Send size={13} /> Senden
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
