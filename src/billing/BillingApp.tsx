import { useEffect, useState } from "react";
import { BillingPanel } from "./BillingPanel";
import type { ElementInfo, BillingMsg } from "./types";
import { BILLING_CHANNEL } from "./billingStore";

export function BillingApp() {
  const [elements, setElements] = useState<ElementInfo[]>([]);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(BILLING_CHANNEL); } catch { return; }

    bc.addEventListener("message", (ev) => {
      const msg = ev.data as BillingMsg;
      if (msg.t === "elements") setElements(msg.list);
    });

    bc.postMessage({ t: "ready" } satisfies BillingMsg);

    return () => { bc?.close(); };
  }, []);

  return (
    <div className="w-screen h-screen bg-background text-foreground overflow-hidden">
      <BillingPanel elements={elements} />
    </div>
  );
}
