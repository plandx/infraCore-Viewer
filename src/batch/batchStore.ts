import { create } from "zustand";
import type { BatchRule, PreviewResult } from "./types";

function nanoid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

interface BatchStore {
  rules: BatchRule[];
  selectedRuleId: string | null;
  previewResult: PreviewResult | null;
  isPreviewing: boolean;
  isApplying: boolean;

  addRule(): void;
  duplicateRule(id: string): void;
  removeRule(id: string): void;
  updateRule(id: string, patch: Partial<Omit<BatchRule, "id">>): void;
  selectRule(id: string | null): void;
  setPreviewResult(r: PreviewResult | null): void;
  setIsPreviewing(v: boolean): void;
  setIsApplying(v: boolean): void;
}

export const useBatchStore = create<BatchStore>((set, get) => ({
  rules: [],
  selectedRuleId: null,
  previewResult: null,
  isPreviewing: false,
  isApplying: false,

  addRule() {
    const id = nanoid();
    const rule: BatchRule = {
      id, label: "Neue Regel", enabled: true,
      filter: { kind: "all" },
      operations: [],
    };
    set(s => ({ rules: [...s.rules, rule], selectedRuleId: id }));
  },

  duplicateRule(id) {
    const src = get().rules.find(r => r.id === id);
    if (!src) return;
    const copy: BatchRule = { ...src, id: nanoid(), label: src.label + " (Kopie)" };
    set(s => ({ rules: [...s.rules, copy], selectedRuleId: copy.id }));
  },

  removeRule(id) {
    set(s => ({
      rules: s.rules.filter(r => r.id !== id),
      selectedRuleId: s.selectedRuleId === id ? null : s.selectedRuleId,
      previewResult: s.previewResult?.ruleId === id ? null : s.previewResult,
    }));
  },

  updateRule(id, patch) {
    set(s => ({ rules: s.rules.map(r => r.id === id ? { ...r, ...patch } : r) }));
  },

  selectRule(id) { set({ selectedRuleId: id, previewResult: null }); },
  setPreviewResult(r) { set({ previewResult: r }); },
  setIsPreviewing(v) { set({ isPreviewing: v }); },
  setIsApplying(v) { set({ isApplying: v }); },
}));
