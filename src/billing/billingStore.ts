import { create } from "zustand";
import type { BillingEntry, BillingExport, BillingStage, DocumentRef, ElementIdentity, ElementQuantities } from "./types";
import type { QuantityItem, QuantitySet } from "./quantityTypes";

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
  // ── QuantitySet actions ──────────────────────────────────────────────────
  setQuantitySet(key: string, set: QuantitySet): void;
  addQuantityItem(key: string, item: Omit<QuantityItem, "id">): void;
  updateQuantityItem(key: string, itemId: string, patch: Partial<QuantityItem>): void;
  removeQuantityItem(key: string, itemId: string): void;
  mergeQuantityItems(key: string, items: QuantityItem[], source: QuantityItem["source"]): void;
  setIdentity(key: string, identity: ElementIdentity): void;
  clearAll(): void;
  _applySync(entries: Record<string, BillingEntry>): void;
}

export const useBillingStore = create<BillingStore>((set, get) => {
  function broadcast(entries: Record<string, BillingEntry>) {
    bc?.postMessage({ t: "dataSync", entries: Object.values(entries) });
  }

  function updateEntry(key: string, patch: Partial<BillingEntry>): boolean {
    const entry = get().entries[key];
    if (!entry) return false;
    const next = { ...get().entries, [key]: { ...entry, ...patch } };
    persist(next); broadcast(next); set({ entries: next });
    return true;
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
      updateEntry(key, { stages: [...entry.stages, s] });
    },

    updateStage(key, stageId, patch) {
      const entry = get().entries[key]; if (!entry) return;
      updateEntry(key, { stages: entry.stages.map(s => s.id === stageId ? { ...s, ...patch } : s) });
    },

    removeStage(key, stageId) {
      const entry = get().entries[key]; if (!entry) return;
      updateEntry(key, { stages: entry.stages.filter(s => s.id !== stageId) });
    },

    addDocument(key, doc) {
      const entry = get().entries[key]; if (!entry) return;
      const d: DocumentRef = { ...doc, id: nanoid() };
      updateEntry(key, { documents: [...entry.documents, d] });
    },

    updateDocument(key, docId, patch) {
      const entry = get().entries[key]; if (!entry) return;
      updateEntry(key, { documents: entry.documents.map(d => d.id === docId ? { ...d, ...patch } : d) });
    },

    removeDocument(key, docId) {
      const entry = get().entries[key]; if (!entry) return;
      updateEntry(key, { documents: entry.documents.filter(d => d.id !== docId) });
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
      updateEntry(key, { quantities: q });
    },

    // ── QuantitySet ────────────────────────────────────────────────────────

    setQuantitySet(key, qs) {
      updateEntry(key, { quantitySet: qs });
    },

    addQuantityItem(key, item) {
      const entry = get().entries[key]; if (!entry) return;
      const newItem: QuantityItem = { ...item, id: nanoid() };
      const existing = entry.quantitySet?.items ?? [];
      updateEntry(key, { quantitySet: { items: [...existing, newItem], updatedAt: new Date().toISOString() } });
    },

    updateQuantityItem(key, itemId, patch) {
      const entry = get().entries[key]; if (!entry) return;
      const items = (entry.quantitySet?.items ?? []).map(i => i.id === itemId ? { ...i, ...patch } : i);
      updateEntry(key, { quantitySet: { items, updatedAt: new Date().toISOString() } });
    },

    removeQuantityItem(key, itemId) {
      const entry = get().entries[key]; if (!entry) return;
      const items = (entry.quantitySet?.items ?? []).filter(i => i.id !== itemId);
      updateEntry(key, { quantitySet: { items, updatedAt: new Date().toISOString() } });
    },

    // Replace all items of a given source and append new ones
    mergeQuantityItems(key, items, source) {
      const entry = get().entries[key]; if (!entry) return;
      const kept = (entry.quantitySet?.items ?? []).filter(i => i.source !== source);
      updateEntry(key, { quantitySet: { items: [...kept, ...items], updatedAt: new Date().toISOString() } });
    },

    setIdentity(key, identity) {
      updateEntry(key, { identity });
    },

    clearAll() {
      const empty: Record<string, BillingEntry> = {};
      persist(empty); broadcast(empty); set({ entries: empty });
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
