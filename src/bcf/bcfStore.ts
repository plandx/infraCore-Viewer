import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { BcfDocument, BcfTopic, BcfComment, BcfTopicStatus, BcfTopicType, BcfPriority, BcfClashRule, ClashMetaField } from "./bcfTypes";
import type { IdsSpecResult, IdsElementResult } from "../ids/idsTypes";
import type { ClashResult } from "../utils/windowSync";

interface BcfStore {
  document: BcfDocument;
  activeTopicId: string | null;
  bcfPanelOpen: boolean;
  clashRules: BcfClashRule[];

  addTopic: (partial: Partial<Omit<BcfTopic, "id" | "guid" | "creationDate" | "modifiedDate" | "comments">>) => string;
  updateTopic: (id: string, partial: Partial<BcfTopic>) => void;
  deleteTopic: (id: string) => void;
  addComment: (topicId: string, text: string, author: string) => void;
  updateComment: (topicId: string, commentId: string, text: string) => void;
  deleteComment: (topicId: string, commentId: string) => void;
  setActiveTopicId: (id: string | null) => void;
  setBcfPanelOpen: (open: boolean) => void;
  createFromIdsFailure: (specResult: IdsSpecResult, elements: IdsElementResult[]) => void;
  createFromClashResult: (results: ClashResult[]) => void;
  addClashRule: (partial?: Partial<BcfClashRule>) => string;
  updateClashRule: (id: string, patch: Partial<BcfClashRule>) => void;
  deleteClashRule: (id: string) => void;
  applyClashRule: (ruleId: string, clashResults: ClashResult[]) => number;
}

const now = () => new Date().toISOString();

const defaultDoc = (): BcfDocument => ({
  id: uuidv4(),
  projectName: "infraCore Project",
  topics: [],
});

export const useBcfStore = create<BcfStore>((set, get) => ({
  document: defaultDoc(),
  activeTopicId: null,
  bcfPanelOpen: false,
  clashRules: [],

  addTopic: (partial) => {
    const id = uuidv4();
    const topic: BcfTopic = {
      id,
      guid: uuidv4(),
      title: partial.title ?? "Neues Thema",
      description: partial.description,
      status: partial.status ?? "Open",
      type: partial.type ?? "Issue",
      priority: partial.priority ?? "Normal",
      assignedTo: partial.assignedTo,
      creationDate: now(),
      modifiedDate: now(),
      creationAuthor: partial.creationAuthor ?? "infraCore",
      labels: partial.labels ?? [],
      comments: [],
      source: partial.source ?? "manual",
      sourceRef: partial.sourceRef,
      relatedExpressIds: partial.relatedExpressIds,
    };
    set(s => ({ document: { ...s.document, topics: [topic, ...s.document.topics] } }));
    return id;
  },

  updateTopic: (id, partial) => {
    set(s => ({
      document: {
        ...s.document,
        topics: s.document.topics.map(t =>
          t.id === id ? { ...t, ...partial, modifiedDate: now() } : t
        ),
      },
    }));
  },

  deleteTopic: (id) => {
    set(s => ({
      document: { ...s.document, topics: s.document.topics.filter(t => t.id !== id) },
      activeTopicId: s.activeTopicId === id ? null : s.activeTopicId,
    }));
  },

  addComment: (topicId, text, author) => {
    const comment: BcfComment = { id: uuidv4(), text, author, date: now() };
    set(s => ({
      document: {
        ...s.document,
        topics: s.document.topics.map(t =>
          t.id === topicId
            ? { ...t, comments: [...t.comments, comment], modifiedDate: now() }
            : t
        ),
      },
    }));
  },

  updateComment: (topicId, commentId, text) => {
    set(s => ({
      document: {
        ...s.document,
        topics: s.document.topics.map(t =>
          t.id === topicId
            ? {
                ...t,
                modifiedDate: now(),
                comments: t.comments.map(c =>
                  c.id === commentId ? { ...c, text, modifiedDate: now() } : c
                ),
              }
            : t
        ),
      },
    }));
  },

  deleteComment: (topicId, commentId) => {
    set(s => ({
      document: {
        ...s.document,
        topics: s.document.topics.map(t =>
          t.id === topicId
            ? { ...t, comments: t.comments.filter(c => c.id !== commentId), modifiedDate: now() }
            : t
        ),
      },
    }));
  },

  setActiveTopicId: (id) => set({ activeTopicId: id }),
  setBcfPanelOpen: (open) => set({ bcfPanelOpen: open }),

  createFromIdsFailure: (specResult, elements) => {
    const failedElements = elements.filter(e => e.status === "failed");
    const desc = failedElements.length > 0
      ? `${failedElements.length} Elemente fehlgeschlagen: ${failedElements.slice(0, 5).map(e => e.name || `#${e.expressId}`).join(", ")}${failedElements.length > 5 ? "…" : ""}`
      : specResult.note ?? "";

    const id = get().addTopic({
      title: `IDS: ${specResult.specificationName}`,
      description: desc,
      type: "IDS" as BcfTopicType,
      priority: specResult.necessity === "required" ? "Major" : "Normal" as BcfPriority,
      status: "Open" as BcfTopicStatus,
      source: "ids",
      sourceRef: specResult.specificationId,
      labels: ["IDS", specResult.necessity],
      relatedExpressIds: failedElements.map(e => ({ modelId: e.modelId, expressId: e.expressId })),
    });
    set({ activeTopicId: id });
  },

  createFromClashResult: (results) => {
    for (const r of results) {
      const id = get().addTopic({
        title: `Kollision: ${r.nameA || r.typeA} ↔ ${r.nameB || r.typeB}`,
        description: `Regel: ${r.ruleName} | Wert: ${r.overlap.toFixed(4)} | Typ: ${r.checkType}`,
        type: "Clash" as BcfTopicType,
        priority: r.severity === "error" ? "Critical" : r.severity === "warning" ? "Major" : "Normal" as BcfPriority,
        status: "Open" as BcfTopicStatus,
        source: "clash",
        sourceRef: r.ruleId,
        labels: ["Kollision", r.ruleName],
        relatedExpressIds: [
          { modelId: r.modelIdA, expressId: r.expressIdA },
          { modelId: r.modelIdB, expressId: r.expressIdB },
        ],
      });
      set({ activeTopicId: id });
    }
  },

  addClashRule: (partial = {}) => {
    const id = uuidv4();
    const rule: BcfClashRule = {
      id,
      name: partial.name ?? "Neue BCF-Regel",
      filterSeverity: partial.filterSeverity ?? "all",
      filterStatus: partial.filterStatus ?? "new",
      filterClashRuleId: partial.filterClashRuleId ?? "",
      titleTemplate: partial.titleTemplate ?? "Kollision: {nameA} ↔ {nameB}",
      includeFields: partial.includeFields ?? ["severity", "ruleName", "nameA", "nameB", "overlap"],
      bcfType: partial.bcfType ?? "Clash",
      bcfPriority: partial.bcfPriority ?? "Major",
      bcfStatus: partial.bcfStatus ?? "Open",
    };
    set(s => ({ clashRules: [...s.clashRules, rule] }));
    return id;
  },

  updateClashRule: (id, patch) => {
    set(s => ({ clashRules: s.clashRules.map(r => r.id === id ? { ...r, ...patch } : r) }));
  },

  deleteClashRule: (id) => {
    set(s => ({ clashRules: s.clashRules.filter(r => r.id !== id) }));
  },

  applyClashRule: (ruleId, clashResults) => {
    const rule = get().clashRules.find(r => r.id === ruleId);
    if (!rule) return 0;

    const FIELD_LABELS: Record<ClashMetaField, string> = {
      severity: "Schwere", ruleName: "Regel", checkType: "Prüftyp", overlap: "Wert",
      typeA: "Typ A", nameA: "Element A", typeB: "Typ B", nameB: "Element B",
    };

    const renderTitle = (r: ClashResult) =>
      rule.titleTemplate
        .replace(/{nameA}/g, r.nameA || r.typeA.replace("Ifc",""))
        .replace(/{nameB}/g, r.nameB || r.typeB.replace("Ifc",""))
        .replace(/{typeA}/g, r.typeA.replace("Ifc",""))
        .replace(/{typeB}/g, r.typeB.replace("Ifc",""))
        .replace(/{ruleName}/g, r.ruleName);

    const renderDesc = (r: ClashResult): string => {
      const vals: string[] = [];
      for (const f of rule.includeFields) {
        let v = "";
        switch (f) {
          case "severity":  v = r.severity; break;
          case "ruleName":  v = r.ruleName; break;
          case "checkType": v = r.checkType; break;
          case "overlap":   v = `${r.overlap.toFixed(4)} m`; break;
          case "typeA":     v = r.typeA.replace("Ifc",""); break;
          case "nameA":     v = r.nameA || "—"; break;
          case "typeB":     v = r.typeB.replace("Ifc",""); break;
          case "nameB":     v = r.nameB || "—"; break;
        }
        vals.push(`${FIELD_LABELS[f]}: ${v}`);
      }
      return vals.join(" | ");
    };

    const filtered = clashResults.filter(r => {
      if (rule.filterSeverity !== "all" && r.severity !== rule.filterSeverity) return false;
      if (rule.filterStatus !== "all" && r.status !== rule.filterStatus) return false;
      if (rule.filterClashRuleId && r.ruleId !== rule.filterClashRuleId) return false;
      return true;
    });

    let count = 0;
    for (const r of filtered) {
      get().addTopic({
        title: renderTitle(r),
        description: renderDesc(r) || undefined,
        type: rule.bcfType,
        priority: rule.bcfPriority,
        status: rule.bcfStatus,
        source: "clash",
        sourceRef: r.ruleId,
        labels: ["Kollision", r.ruleName],
        relatedExpressIds: [
          { modelId: r.modelIdA, expressId: r.expressIdA },
          { modelId: r.modelIdB, expressId: r.expressIdB },
        ],
      });
      count++;
    }
    return count;
  },
}));
