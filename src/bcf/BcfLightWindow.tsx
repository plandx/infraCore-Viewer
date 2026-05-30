import { useEffect, useState } from "react";
import { AlertTriangle, Zap, Shield, MessageSquare, Navigation, Camera } from "lucide-react";
import { BCF_LIGHT_CHANNEL } from "../utils/windowSync";
import type { BcfTopic, BcfTopicStatus, BcfTopicType } from "./bcfTypes";
import type { BcfLightMsg } from "../utils/windowSync";
import { cn } from "../lib/utils";

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

function formatDate(iso: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

export function BcfLightWindow() {
  const [topics, setTopics] = useState<BcfTopic[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(BCF_LIGHT_CHANNEL); } catch { return; }

    ch.onmessage = (e: MessageEvent<BcfLightMsg>) => {
      const msg = e.data;
      if (msg.t === "state") {
        setTopics(msg.topics);
        setActiveId(msg.activeId);
      }
    };

    ch.postMessage({ t: "req" } satisfies BcfLightMsg);

    return () => ch.close();
  }, []);

  const activeTopic = topics.find((t) => t.id === activeId) ?? null;

  function selectTopic(id: string) {
    setActiveId(id);
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(BCF_LIGHT_CHANNEL); } catch { return; }
    ch.postMessage({ t: "setActive", id } satisfies BcfLightMsg);
    ch.close();
  }

  function jumpViewpoint() {
    if (!activeTopic?.viewpoint) return;
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(BCF_LIGHT_CHANNEL); } catch { return; }
    ch.postMessage({ t: "jumpViewpoint", viewpoint: activeTopic.viewpoint } satisfies BcfLightMsg);
    ch.close();
  }

  return (
    <div className="flex h-screen bg-background text-foreground text-[13px]">
      {/* Topic list */}
      <div className="w-48 shrink-0 border-r border-border flex flex-col overflow-y-auto">
        <div className="px-3 py-2 border-b border-border font-semibold text-[13px] bg-muted/20">BCF</div>
        {topics.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-4 text-center text-[11px]">
            <MessageSquare size={22} className="opacity-30" />
            <span>Keine Themen</span>
          </div>
        )}
        {topics.map((topic) => (
          <button
            key={topic.id}
            onClick={() => selectTopic(topic.id)}
            className={cn(
              "flex gap-2 px-2 py-2 text-left border-b border-border/50 hover:bg-[#E5E5E5] dark:hover:bg-[#333333] transition-colors",
              activeId === topic.id && "bg-primary/8 border-l-2 border-l-primary"
            )}
          >
            {topic.snapshot ? (
              <img src={topic.snapshot} alt="" className="w-10 h-8 object-cover rounded-[3px] shrink-0 border border-border/50" />
            ) : (
              <div className="w-10 h-8 rounded-[3px] bg-muted/40 border border-border/30 shrink-0 flex items-center justify-center text-muted-foreground/30">
                <Camera size={12} />
              </div>
            )}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <div className="flex items-start gap-1">
                <span className="text-muted-foreground shrink-0 mt-0.5">{TYPE_ICON[topic.type]}</span>
                <span className="font-medium text-[11px] leading-snug line-clamp-2 flex-1">{topic.title}</span>
              </div>
              <span className={cn("text-[10px] px-1 py-0 rounded-[3px] border w-fit", STATUS_COLOR[topic.status])}>
                {topic.status}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Detail pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!activeTopic ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-8 text-center text-[12px]">
            <MessageSquare size={32} className="opacity-20" />
            <span>Thema auswählen</span>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-muted-foreground">{TYPE_ICON[activeTopic.type]}</span>
                <span className="font-semibold text-[14px] flex-1">{activeTopic.title}</span>
              </div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={cn("text-[10px] px-1.5 py-0 rounded-[3px] border", STATUS_COLOR[activeTopic.status])}>
                  {activeTopic.status}
                </span>
                <span className="text-[11px] text-muted-foreground">{activeTopic.type}</span>
                <span className="text-[11px] text-muted-foreground ml-auto">{formatDate(activeTopic.modifiedDate)}</span>
              </div>
              {activeTopic.viewpoint?.cameraPosition && (
                <button
                  onClick={jumpViewpoint}
                  className="flex items-center gap-1 px-2 py-1 rounded-[4px] bg-primary text-primary-foreground text-[11px] hover:bg-primary/90 transition-colors"
                >
                  <Navigation size={11} /> Im Modell zeigen
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {activeTopic.snapshot && (
                <img src={activeTopic.snapshot} alt="Snapshot" className="w-full max-h-48 object-cover rounded-[4px] border border-border" />
              )}
              {activeTopic.description && (
                <p className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">{activeTopic.description}</p>
              )}
              {activeTopic.comments.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Kommentare</span>
                  {activeTopic.comments.map((c) => (
                    <div key={c.id} className="flex flex-col gap-0.5 bg-muted/20 rounded-[4px] p-2 border border-border/50">
                      <span className="text-[10px] text-muted-foreground">{c.author} · {formatDate(c.date)}</span>
                      <span className="text-[12px] whitespace-pre-wrap">{c.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
