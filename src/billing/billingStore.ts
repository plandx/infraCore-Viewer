import { create } from "zustand";
import type { BillingEntry, BillingExport, BillingStage, DocumentRef, ElementQuantities } from "./types";

const LS_KEY = "infracore-billing-v1";
export const BILLING_CHANNEL = "infracore-billing";

function loadFromStorage(): Record<string, BillingEntry> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, BillingEntry>;
  } catch { /* ignore */ }
  return {};
}

function persist(entries: Record<string, BillingEntry>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch { /* ignore */ }
}

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

let bc: BroadcastChannel | null = null;
try { bc = new BroadcastChannel(BILLING_CHANNEL); } catch { /* SSR/test env */ }

interface BillingStore {
  entries: Record<string, BillingEntry>;
  moduleActive: boolean;

  addEntry(info: { key: string; guid: string; expressId: number; modelId: string; elementName: string; ifcType: string }): void;
  removeEntry(key: string): void;
  addStage(key: string, stage: Omit<BillingStage, "id">): void;
  updateStage(key: string, stageId: string, patch: Partial<BillingStage>): void;
  removeStage(key: string, stageId: string): void;
  addDocument(key: string, doc: Omit<DocumentRef, "id">): void;
  updateDocument(key: string, docId: string, patch: Partial<DocumentRef>): void;
  removeDocument(key: string, docId: string): void;
  importData(data: BillingExport): void;
  exportData(): BillingExport;
  setModuleActive(active: boolean): void;
  setQuantities(key: string, q: ElementQuantities): void;
  _applySync(entries: Record<string, BillingEntry>): void;
}

export const useBillingStore = create<BillingStore>((set, get) => {
  function broadcast(entries: Record<string, BillingEntry>) {
    bc?.postMessage({ t: "dataSync", entries: Object.values(entries) });
  }

  return {
    entries: loadFromStorage(),
    moduleActive: false,

    addEntry(info) {
      if (get().entries[info.key]) return;
      const entry: BillingEntry = { ...info, stages: [], documents: [], createdAt: new Date().toISOString() };
      const next = { ...get().entries, [entry.key]: entry };
      persist(next); broadcast(next); set({ entries: next });
    },

    removeEntry(key) {
      const { [key]: _, ...next } = get().entries;
      persist(next); broadcast(next); set({ entries: next });
    },

    addStage(key, stage) {
      const entry = get().entries[key]; if (!entry) return;
      const s: BillingStage = { ...stage, id: nanoid() };
      const updated = { ...entry, stages: [...entry.stages, s] };
      const next = { ...get().entries, [key]: updated };
      persist(next); broadcast(next); set({ entries: next });
    },

    updateStage(key, stageId, patch) {
      const entry = get().entries[key]; if (!entry) return;
      const stages = entry.stages.map(s => s.id === stageId ? { ...s, ...patch } : s);
      const next = { ...get().entries, [key]: { ...entry, stages } };
      persist(next); broadcast(next); set({ entries: next });
    },

    removeStage(key, stageId) {
      const entry = get().entries[key]; if (!entry) return;
      const next = { ...get().entries, [key]: { ...entry, stages: entry.stages.filter(s => s.id !== stageId) } };
      persist(next); broadcast(next); set({ entries: next });
    },

    addDocument(key, doc) {
      const entry = get().entries[key]; if (!entry) return;
      const d: DocumentRef = { ...doc, id: nanoid() };
      const next = { ...get().entries, [key]: { ...entry, documents: [...entry.documents, d] } };
      persist(next); broadcast(next); set({ entries: next });
    },

    updateDocument(key, docId, patch) {
      const entry = get().entries[key]; if (!entry) return;
      const documents = entry.documents.map(d => d.id === docId ? { ...d, ...patch } : d);
      const next = { ...get().entries, [key]: { ...entry, documents } };
      persist(next); broadcast(next); set({ entries: next });
    },

    removeDocument(key, docId) {
      const entry = get().entries[key]; if (!entry) return;
      const next = { ...get().entries, [key]: { ...entry, documents: entry.documents.filter(d => d.id !== docId) } };
      persist(next); broadcast(next); set({ entries: next });
    },

    importData(data) {
      const next = { ...get().entries };
      for (const e of data.entries) next[e.key] = e;
      persist(next); broadcast(next); set({ entries: next });
    },

    exportData() {
      return { version: 1, exportedAt: new Date().toISOString(), entries: Object.values(get().entries) };
    },

    setModuleActive(active) {
      bc?.postMessage({ t: "moduleActive", active });
      set({ moduleActive: active });
    },

    setQuantities(key, q) {
      const entry = get().entries[key]; if (!entry) return;
      const next = { ...get().entries, [key]: { ...entry, quantities: q } };
      persist(next); broadcast(next); set({ entries: next });
    },

    _applySync(entries) {
      persist(entries); set({ entries });
    },
  };
});

bc?.addEventListener("message", (ev) => {
  const msg = ev.data as { t: string; entries?: BillingEntry[]; active?: boolean };
  if (msg.t === "dataSync" && msg.entries) {
    const map: Record<string, BillingEntry> = {};
    for (const e of msg.entries) map[e.key] = e;
    useBillingStore.getState()._applySync(map);
  }
  if (msg.t === "moduleActive") {
    useBillingStore.setState({ moduleActive: msg.active as boolean });
  }
});
