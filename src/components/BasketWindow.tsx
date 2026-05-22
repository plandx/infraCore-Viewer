import { useEffect, useRef } from "react";
import { useModelStore } from "../store/modelStore";
import { SYNC_CHANNEL, serializeState } from "../utils/windowSync";
import type { SyncMsg } from "../utils/windowSync";
import { BasketEditor } from "./BasketEditor";

function useBasketSync() {
  const applyRemoteState = useModelStore((s) => s.applyRemoteState);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    document.title = "Auswahlkorb — infraCore";
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<SyncMsg>) => {
      if (e.data.t === "state") {
        applyingRef.current = true;
        applyRemoteState(e.data.s);
        applyingRef.current = false;
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useModelStore.subscribe(() => {
      if (applyingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        ch.postMessage({ t: "state", s: serializeState(useModelStore.getState()) } satisfies SyncMsg);
      }, 80);
    });
    ch.postMessage({ t: "req" } satisfies SyncMsg);
    return () => { ch.close(); unsub(); if (timer) clearTimeout(timer); };
  }, [applyRemoteState]);
}

export function BasketWindow() {
  useBasketSync();
  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">
      <BasketEditor onClose={() => window.close()} mode="window" />
    </div>
  );
}
