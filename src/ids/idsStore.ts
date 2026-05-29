import { create } from "zustand";
import type { IdsDocument, IdsSpecification, IdsFacet, IdsValidationReport, IdsCardinality, IfcVersion } from "./idsTypes";

interface IdsState {
  documents: IdsDocument[];
  activeDocumentId: string | null;
  activeSpecificationId: string | null;
  validationReport: IdsValidationReport | null;
  idsPanelOpen: boolean;

  createDocument: (title?: string) => IdsDocument;
  loadDocument: (doc: IdsDocument, fileName?: string) => void;
  removeDocument: (id: string) => void;
  setActiveDocument: (id: string | null) => void;
  updateDocumentInfo: (id: string, info: Partial<IdsDocument["info"]>) => void;

  addSpecification: (docId: string, spec?: Partial<IdsSpecification>) => void;
  removeSpecification: (docId: string, specId: string) => void;
  updateSpecification: (docId: string, specId: string, update: Partial<IdsSpecification>) => void;
  setActiveSpecification: (id: string | null) => void;

  addApplicabilityFacet: (docId: string, specId: string, facet: IdsFacet) => void;
  removeApplicabilityFacet: (docId: string, specId: string, index: number) => void;
  updateApplicabilityFacet: (docId: string, specId: string, index: number, facet: IdsFacet) => void;
  addRequirementFacet: (docId: string, specId: string, facet: IdsFacet) => void;
  removeRequirementFacet: (docId: string, specId: string, index: number) => void;
  updateRequirementFacet: (docId: string, specId: string, index: number, facet: IdsFacet) => void;

  setValidationReport: (report: IdsValidationReport | null) => void;
  setIdsPanelOpen: (open: boolean) => void;
}

export const useIdsStore = create<IdsState>((set, get) => ({
  documents: [],
  activeDocumentId: null,
  activeSpecificationId: null,
  validationReport: null,
  idsPanelOpen: false,

  createDocument: (title = "Neues IDS") => {
    const doc: IdsDocument = {
      id: crypto.randomUUID(),
      info: { title, date: new Date().toISOString().split("T")[0] },
      specifications: [],
    };
    set((s) => ({
      documents: [...s.documents, doc],
      activeDocumentId: doc.id,
      activeSpecificationId: null,
      validationReport: null,
    }));
    return doc;
  },

  loadDocument: (doc, fileName) => {
    const d = fileName ? { ...doc, fileName } : doc;
    set((s) => ({
      documents: [...s.documents.filter((x) => x.id !== d.id), d],
      activeDocumentId: d.id,
      activeSpecificationId: null,
      validationReport: null,
    }));
  },

  removeDocument: (id) =>
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== id),
      activeDocumentId:
        s.activeDocumentId === id
          ? (s.documents.find((d) => d.id !== id)?.id ?? null)
          : s.activeDocumentId,
    })),

  setActiveDocument: (id) => set({ activeDocumentId: id, activeSpecificationId: null }),

  updateDocumentInfo: (id, info) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, info: { ...d.info, ...info } } : d
      ),
    })),

  addSpecification: (docId, spec = {}) => {
    const newSpec: IdsSpecification = {
      id: crypto.randomUUID(),
      name: "Neue Spezifikation",
      ifcVersion: ["IFC4"] as IfcVersion[],
      necessity: "required" as IdsCardinality,
      applicability: [],
      requirements: [],
      ...spec,
    };
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? { ...d, specifications: [...d.specifications, newSpec] }
          : d
      ),
      activeSpecificationId: newSpec.id,
    }));
  },

  removeSpecification: (docId, specId) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? { ...d, specifications: d.specifications.filter((sp) => sp.id !== specId) }
          : d
      ),
      activeSpecificationId:
        s.activeSpecificationId === specId ? null : s.activeSpecificationId,
    })),

  updateSpecification: (docId, specId, update) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId ? { ...sp, ...update } : sp
              ),
            }
          : d
      ),
    })),

  setActiveSpecification: (id) => set({ activeSpecificationId: id }),

  addApplicabilityFacet: (docId, specId, facet) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId
                  ? { ...sp, applicability: [...sp.applicability, facet] }
                  : sp
              ),
            }
          : d
      ),
    })),

  removeApplicabilityFacet: (docId, specId, index) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId
                  ? { ...sp, applicability: sp.applicability.filter((_, i) => i !== index) }
                  : sp
              ),
            }
          : d
      ),
    })),

  updateApplicabilityFacet: (docId, specId, index, facet) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId
                  ? {
                      ...sp,
                      applicability: sp.applicability.map((f, i) => (i === index ? facet : f)),
                    }
                  : sp
              ),
            }
          : d
      ),
    })),

  addRequirementFacet: (docId, specId, facet) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId
                  ? { ...sp, requirements: [...sp.requirements, facet] }
                  : sp
              ),
            }
          : d
      ),
    })),

  removeRequirementFacet: (docId, specId, index) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId
                  ? { ...sp, requirements: sp.requirements.filter((_, i) => i !== index) }
                  : sp
              ),
            }
          : d
      ),
    })),

  updateRequirementFacet: (docId, specId, index, facet) =>
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              specifications: d.specifications.map((sp) =>
                sp.id === specId
                  ? {
                      ...sp,
                      requirements: sp.requirements.map((f, i) => (i === index ? facet : f)),
                    }
                  : sp
              ),
            }
          : d
      ),
    })),

  setValidationReport: (report) => set({ validationReport: report }),
  setIdsPanelOpen: (open) => set({ idsPanelOpen: open }),
}));
