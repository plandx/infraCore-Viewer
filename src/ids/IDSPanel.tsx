import { useState, useRef } from "react";
import {
  FileCheck2, Plus, Trash2, ChevronDown, ChevronRight, Play, Download, Upload,
  FilePlus, X, Check, AlertTriangle, Info, Tag, Database, Box, Layers, Hash,
  List, Shield,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useIdsStore } from "./idsStore";
import { useModelStore } from "../store/modelStore";
import { parseIdsXml } from "./idsParser";
import { serializeIdsToXml } from "./idsWriter";
import { validateIdsDocument } from "./idsValidator";
import type {
  IdsFacet, IdsValue, IdsCardinality, IfcVersion,
  IdsEntityFacet, IdsAttributeFacet, IdsPropertyFacet,
  IdsClassificationFacet, IdsMaterialFacet,
  IdsSpecResult,
} from "./idsTypes";

// ── Constants ─────────────────────────────────────────────────────────────────

const IFC_TYPES = [
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCBEAM", "IFCCOLUMN", "IFCSLAB",
  "IFCDOOR", "IFCWINDOW", "IFCSPACE", "IFCROOF", "IFCSTAIR",
  "IFCBUILDINGELEMENT", "IFCBUILDINGELEMENTPROXY",
  "IFCFURNISHINGELEMENT", "IFCMEMBER", "IFCPLATE",
  "IFCPILE", "IFCFOOTING", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY",
];

const CARDINALITY_LABELS: Record<IdsCardinality, string> = {
  required: "Erforderlich",
  optional: "Optional",
  prohibited: "Verboten",
};

const IFC_VERSIONS: IfcVersion[] = ["IFC2X3", "IFC4", "IFC4X3ADD2"];

const DATA_TYPES = [
  "IFCTEXT", "IFCLABEL", "IFCIDENTIFIER", "IFCBOOLEAN",
  "IFCINTEGER", "IFCREAL", "IFCLENGTHMEASURE",
];

// ── Value editor ──────────────────────────────────────────────────────────────

function SimpleValueEditor({
  value,
  onChange,
  placeholder,
}: {
  value: IdsValue | undefined;
  onChange: (v: IdsValue | undefined) => void;
  placeholder?: string;
}) {
  const str = value?.type === "simple" ? value.value : "";
  return (
    <input
      className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      value={str}
      placeholder={placeholder ?? "Wert…"}
      onChange={(e) =>
        onChange(e.target.value ? { type: "simple", value: e.target.value } : undefined)
      }
    />
  );
}

// ── Facet type icon ───────────────────────────────────────────────────────────

function facetIcon(type: string) {
  switch (type) {
    case "entity": return <Box size={12} />;
    case "attribute": return <Hash size={12} />;
    case "property": return <Database size={12} />;
    case "classification": return <Tag size={12} />;
    case "material": return <Layers size={12} />;
    case "partOf": return <List size={12} />;
    default: return <Info size={12} />;
  }
}

// ── Entity facet editor ───────────────────────────────────────────────────────

function EntityFacetEditor({
  facet,
  onChange,
}: {
  facet: IdsEntityFacet;
  onChange: (f: IdsEntityFacet) => void;
}) {
  const typeStr = facet.name.type === "simple" ? facet.name.value : "";
  const predStr =
    facet.predefinedType?.type === "simple" ? facet.predefinedType.value : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">IFC-Typ</label>
        <input
          list="ids-ifc-types"
          className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mt-0.5"
          value={typeStr}
          placeholder="z.B. IFCWALL"
          onChange={(e) =>
            onChange({
              ...facet,
              name: e.target.value ? { type: "simple", value: e.target.value.toUpperCase() } : { type: "simple", value: "" },
            })
          }
        />
        <datalist id="ids-ifc-types">
          {IFC_TYPES.map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Vordefinierter Typ (optional)</label>
        <SimpleValueEditor
          value={facet.predefinedType}
          onChange={(v) => onChange({ ...facet, predefinedType: v })}
          placeholder="z.B. SOLIDWALL"
        />
      </div>
    </div>
  );
}

// ── Attribute facet editor ─────────────────────────────────────────────────────

function AttributeFacetEditor({
  facet,
  onChange,
}: {
  facet: IdsAttributeFacet;
  onChange: (f: IdsAttributeFacet) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Attribut-Name</label>
        <SimpleValueEditor
          value={facet.name}
          onChange={(v) => onChange({ ...facet, name: v ?? { type: "simple", value: "" } })}
          placeholder="z.B. Name"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Erwarteter Wert (optional)</label>
        <SimpleValueEditor
          value={facet.value}
          onChange={(v) => onChange({ ...facet, value: v })}
        />
      </div>
      <CardinalitySelect
        value={facet.cardinality}
        onChange={(c) => onChange({ ...facet, cardinality: c })}
      />
    </div>
  );
}

// ── Property facet editor ──────────────────────────────────────────────────────

function PropertyFacetEditor({
  facet,
  onChange,
}: {
  facet: IdsPropertyFacet;
  onChange: (f: IdsPropertyFacet) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">PropertySet</label>
        <SimpleValueEditor
          value={facet.propertySet}
          onChange={(v) => onChange({ ...facet, propertySet: v ?? { type: "simple", value: "" } })}
          placeholder="z.B. Pset_WallCommon"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Property-Name</label>
        <SimpleValueEditor
          value={facet.baseName}
          onChange={(v) => onChange({ ...facet, baseName: v ?? { type: "simple", value: "" } })}
          placeholder="z.B. FireRating"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Erwarteter Wert (optional)</label>
        <SimpleValueEditor
          value={facet.value}
          onChange={(v) => onChange({ ...facet, value: v })}
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Datentyp (optional)</label>
        <select
          className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          value={facet.dataType ?? ""}
          onChange={(e) => onChange({ ...facet, dataType: e.target.value || undefined })}
        >
          <option value="">— keiner —</option>
          {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <CardinalitySelect
        value={facet.cardinality}
        onChange={(c) => onChange({ ...facet, cardinality: c })}
      />
    </div>
  );
}

// ── Classification facet editor ────────────────────────────────────────────────

function ClassificationFacetEditor({
  facet,
  onChange,
}: {
  facet: IdsClassificationFacet;
  onChange: (f: IdsClassificationFacet) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">System (optional)</label>
        <SimpleValueEditor
          value={facet.system}
          onChange={(v) => onChange({ ...facet, system: v })}
          placeholder="z.B. Uniclass"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Wert (optional)</label>
        <SimpleValueEditor
          value={facet.value}
          onChange={(v) => onChange({ ...facet, value: v })}
        />
      </div>
      <CardinalitySelect
        value={facet.cardinality}
        onChange={(c) => onChange({ ...facet, cardinality: c })}
      />
    </div>
  );
}

// ── Material facet editor ──────────────────────────────────────────────────────

function MaterialFacetEditor({
  facet,
  onChange,
}: {
  facet: IdsMaterialFacet;
  onChange: (f: IdsMaterialFacet) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Material-Wert (optional)</label>
        <SimpleValueEditor
          value={facet.value}
          onChange={(v) => onChange({ ...facet, value: v })}
          placeholder="z.B. Beton"
        />
      </div>
      <CardinalitySelect
        value={facet.cardinality}
        onChange={(c) => onChange({ ...facet, cardinality: c })}
      />
    </div>
  );
}

// ── Cardinality select ────────────────────────────────────────────────────────

function CardinalitySelect({
  value,
  onChange,
}: {
  value: IdsCardinality;
  onChange: (c: IdsCardinality) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Kardinalität</label>
      <select
        className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        value={value}
        onChange={(e) => onChange(e.target.value as IdsCardinality)}
      >
        {(Object.keys(CARDINALITY_LABELS) as IdsCardinality[]).map((k) => (
          <option key={k} value={k}>{CARDINALITY_LABELS[k]}</option>
        ))}
      </select>
    </div>
  );
}

// ── Generic facet card ────────────────────────────────────────────────────────

function FacetCard({
  facet,
  onUpdate,
  onRemove,
}: {
  facet: IdsFacet;
  onUpdate: (f: IdsFacet) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const title = () => {
    switch (facet.type) {
      case "entity": return `Entität: ${facet.name.type === "simple" ? facet.name.value || "…" : "(Ausdruck)"}`;
      case "attribute": return `Attribut: ${facet.name.type === "simple" ? facet.name.value || "…" : "(Ausdruck)"}`;
      case "property": {
        const ps = facet.propertySet.type === "simple" ? facet.propertySet.value : "…";
        const pn = facet.baseName.type === "simple" ? facet.baseName.value : "…";
        return `Property: ${ps}.${pn}`;
      }
      case "classification": return "Klassifikation";
      case "material": return "Material";
      case "partOf": return "Teil von";
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card/50">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-muted-foreground">{facetIcon(facet.type)}</span>
        <span className="text-xs font-medium flex-1 truncate">{title()}</span>
        {expanded ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
        <button
          className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Facette entfernen"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50">
          {facet.type === "entity" && (
            <EntityFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />
          )}
          {facet.type === "attribute" && (
            <AttributeFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />
          )}
          {facet.type === "property" && (
            <PropertyFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />
          )}
          {facet.type === "classification" && (
            <ClassificationFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />
          )}
          {facet.type === "material" && (
            <MaterialFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Add facet button group ────────────────────────────────────────────────────

function AddFacetButtons({ onAdd }: { onAdd: (f: IdsFacet) => void }) {
  const defaultFacets: { label: string; facet: IdsFacet }[] = [
    {
      label: "Entität",
      facet: { type: "entity", name: { type: "simple", value: "" } },
    },
    {
      label: "Attribut",
      facet: { type: "attribute", cardinality: "required", name: { type: "simple", value: "Name" } },
    },
    {
      label: "Property",
      facet: {
        type: "property",
        cardinality: "required",
        propertySet: { type: "simple", value: "" },
        baseName: { type: "simple", value: "" },
      },
    },
    {
      label: "Klassifikation",
      facet: { type: "classification", cardinality: "required" },
    },
    {
      label: "Material",
      facet: { type: "material", cardinality: "required" },
    },
  ];

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {defaultFacets.map(({ label, facet }) => (
        <button
          key={label}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onClick={() => onAdd({ ...facet } as IdsFacet)}
        >
          <Plus size={10} />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Validation result panel ───────────────────────────────────────────────────

function ValidationResultPanel({ results }: { results: IdsSpecResult[] }) {
  const [expandedSpec, setExpandedSpec] = useState<string | null>(null);

  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const exportCSV = () => {
    const rows: string[][] = [["Spezifikation", "Status", "Anwendbar", "Bestanden", "Fehler", "ElementID", "Elementname", "Typ", "Fehlerdetail"]];
    for (const r of results) {
      if (r.elements.length === 0) {
        rows.push([r.specificationName, r.status, String(r.applicableCount), String(r.passCount), String(r.failCount), "", "", "", ""]);
      } else {
        for (const el of r.elements) {
          const detail = el.failures.map((f) => f.message).join("; ");
          rows.push([r.specificationName, el.status, String(r.applicableCount), String(r.passCount), String(r.failCount), String(el.expressId), el.name ?? "", el.type ?? "", detail]);
        }
      }
    }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ids-prüfbericht-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-foreground">Gesamt: {total}</span>
        <span className="flex items-center gap-1 text-xs text-green-500"><Check size={11} /> {passed} bestanden</span>
        {failed > 0 && <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle size={11} /> {failed} Fehler</span>}
        {skipped > 0 && <span className="text-xs text-muted-foreground">{skipped} übersprungen</span>}
        <button
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          onClick={exportCSV}
        >
          <Download size={10} /> CSV
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {results.map((r) => {
          const isExpanded = expandedSpec === r.specificationId;
          const statusColor =
            r.status === "passed"
              ? "text-green-500 bg-green-500/10"
              : r.status === "failed"
              ? "text-red-400 bg-red-400/10"
              : "text-muted-foreground bg-muted/30";

          return (
            <div key={r.specificationId} className="border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedSpec(isExpanded ? null : r.specificationId)}
              >
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", statusColor)}>
                  {r.status === "passed" ? "OK" : r.status === "failed" ? "FEHLER" : "SKIP"}
                </span>
                <span className="text-xs font-medium flex-1 truncate">{r.specificationName}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {r.applicableCount} Elemente
                </span>
                {isExpanded ? <ChevronDown size={11} className="text-muted-foreground shrink-0" /> : <ChevronRight size={11} className="text-muted-foreground shrink-0" />}
              </button>

              {isExpanded && r.elements.length > 0 && (
                <div className="border-t border-border/50 max-h-48 overflow-y-auto">
                  {r.elements.filter((e) => e.status === "failed").slice(0, 50).map((el) => (
                    <div
                      key={`${el.modelId}:${el.expressId}`}
                      className="px-3 py-1.5 border-b border-border/30 last:border-b-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={10} className="text-red-400 shrink-0" />
                        <span className="text-xs font-medium truncate">{el.name || `#${el.expressId}`}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{el.type}</span>
                      </div>
                      {el.failures.map((f, fi) => (
                        <p key={fi} className="text-[10px] text-red-300 pl-4 mt-0.5">{f.message}</p>
                      ))}
                    </div>
                  ))}
                  {r.failCount > 50 && (
                    <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
                      … und {r.failCount - 50} weitere Fehler
                    </p>
                  )}
                  {r.passCount > 0 && (
                    <div className="px-3 py-1.5 flex items-center gap-1 text-[10px] text-green-500">
                      <Check size={10} /> {r.passCount} Elemente bestanden
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main IDSPanel ─────────────────────────────────────────────────────────────

export function IDSPanel() {
  const {
    documents, activeDocumentId, activeSpecificationId,
    validationReport, idsPanelOpen,
    createDocument, loadDocument, removeDocument, setActiveDocument, updateDocumentInfo,
    addSpecification, removeSpecification, updateSpecification, setActiveSpecification,
    addApplicabilityFacet, removeApplicabilityFacet, updateApplicabilityFacet,
    addRequirementFacet, removeRequirementFacet, updateRequirementFacet,
    setValidationReport, setIdsPanelOpen,
  } = useIdsStore();

  const models = useModelStore((s) => s.models);
  const idsInputRef = useRef<HTMLInputElement>(null);

  if (!idsPanelOpen) return null;

  const activeDoc = documents.find((d) => d.id === activeDocumentId) ?? null;
  const activeSpec = activeDoc?.specifications.find((s) => s.id === activeSpecificationId) ?? null;

  const handleLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const doc = parseIdsXml(text);
      loadDocument(doc, file.name);
    } catch (err) {
      alert(`Fehler beim Laden der IDS-Datei: ${err}`);
    }
    e.target.value = "";
  };

  const handleSave = () => {
    if (!activeDoc) return;
    const xml = serializeIdsToXml(activeDoc);
    const blob = new Blob([xml], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = activeDoc.fileName ?? `${activeDoc.info.title}.ids`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleValidate = () => {
    if (!activeDoc) return;
    const report = validateIdsDocument(activeDoc, models);
    setValidationReport(report);
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <input ref={idsInputRef} type="file" accept=".ids,.xml" className="hidden" onChange={handleLoadFile} />

      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <div className="w-64 shrink-0 flex flex-col border-r border-border bg-card/50">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <FileCheck2 size={15} className="text-primary shrink-0" />
            <span className="text-sm font-semibold flex-1">IDS-Dokumente</span>
            <button
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Panel schließen"
              onClick={() => setIdsPanelOpen(false)}
            >
              <X size={13} />
            </button>
          </div>

          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/50">
            <button
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => createDocument()}
              title="Neues IDS-Dokument"
            >
              <FilePlus size={11} /> Neu
            </button>
            <button
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              onClick={() => idsInputRef.current?.click()}
              title="IDS-Datei laden"
            >
              <Upload size={11} /> Laden
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {documents.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-4 px-3">
                Kein Dokument geöffnet. Neu erstellen oder .ids laden.
              </p>
            )}
            {documents.map((doc) => (
              <div key={doc.id}>
                <button
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                    doc.id === activeDocumentId
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-foreground/80 hover:bg-muted/40"
                  )}
                  onClick={() => setActiveDocument(doc.id)}
                >
                  <FileCheck2 size={12} className="shrink-0" />
                  <span className="flex-1 truncate">{doc.info.title}</span>
                  <button
                    className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    onClick={(e) => { e.stopPropagation(); removeDocument(doc.id); }}
                    title="Dokument entfernen"
                  >
                    <X size={10} />
                  </button>
                </button>

                {doc.id === activeDocumentId && (
                  <div className="pl-3 pr-2 pb-1">
                    {doc.specifications.map((spec) => (
                      <button
                        key={spec.id}
                        className={cn(
                          "w-full flex items-center gap-1.5 px-2 py-1.5 text-left rounded transition-colors",
                          spec.id === activeSpecificationId
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        )}
                        onClick={() => setActiveSpecification(spec.id)}
                      >
                        <Shield size={10} className="shrink-0" />
                        <span className="text-[11px] flex-1 truncate">{spec.name}</span>
                        <button
                          className="p-0.5 rounded hover:text-destructive transition-colors"
                          onClick={(e) => { e.stopPropagation(); removeSpecification(doc.id, spec.id); }}
                        >
                          <Trash2 size={9} />
                        </button>
                      </button>
                    ))}
                    <button
                      className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-muted/30 transition-colors mt-0.5"
                      onClick={() => addSpecification(doc.id)}
                    >
                      <Plus size={10} /> Spezifikation hinzufügen
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {activeDoc && (
            <div className="border-t border-border p-2 flex flex-col gap-1">
              <button
                className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] rounded bg-muted/40 border border-border text-foreground hover:bg-muted/70 transition-colors"
                onClick={handleSave}
              >
                <Download size={11} /> Speichern (.ids)
              </button>
              <button
                className={cn(
                  "flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] rounded transition-colors",
                  models.size > 0
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted/40 border border-border text-muted-foreground cursor-not-allowed opacity-50"
                )}
                onClick={handleValidate}
                disabled={models.size === 0}
                title={models.size === 0 ? "Kein IFC-Modell geladen" : "Prüfung ausführen"}
              >
                <Play size={11} /> Prüfung ausführen
              </button>
            </div>
          )}
        </div>

        {/* Center: Specification editor */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!activeDoc ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Kein Dokument ausgewählt
            </div>
          ) : !activeSpec ? (
            <div className="flex flex-col h-full">
              {/* Document info editor */}
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground mb-3">Dokument-Informationen</h2>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ["title", "Titel"],
                      ["version", "Version"],
                      ["author", "Autor"],
                      ["date", "Datum"],
                      ["copyright", "Copyright"],
                      ["purpose", "Zweck"],
                      ["milestone", "Meilenstein"],
                    ] as [keyof typeof activeDoc.info, string][]
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
                      <input
                        type={key === "date" ? "date" : "text"}
                        className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mt-0.5"
                        value={(activeDoc.info[key] as string) ?? ""}
                        onChange={(e) => updateDocumentInfo(activeDoc.id, { [key]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Beschreibung</label>
                    <textarea
                      className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mt-0.5 resize-none"
                      rows={2}
                      value={activeDoc.info.description ?? ""}
                      onChange={(e) => updateDocumentInfo(activeDoc.id, { description: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Spezifikation auswählen oder neue hinzufügen
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Spec header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
                <Shield size={14} className="text-primary shrink-0" />
                <input
                  className="flex-1 bg-transparent text-sm font-semibold text-foreground focus:outline-none focus:ring-0 border-b border-transparent focus:border-primary/50 transition-colors"
                  value={activeSpec.name}
                  onChange={(e) => updateSpecification(activeDoc.id, activeSpec.id, { name: e.target.value })}
                />
              </div>

              {/* Spec metadata */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50 bg-muted/10 shrink-0 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">Notwendigkeit</label>
                  <select
                    className="bg-muted/40 border border-border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={activeSpec.necessity}
                    onChange={(e) =>
                      updateSpecification(activeDoc.id, activeSpec.id, {
                        necessity: e.target.value as IdsCardinality,
                      })
                    }
                  >
                    {(Object.keys(CARDINALITY_LABELS) as IdsCardinality[]).map((k) => (
                      <option key={k} value={k}>{CARDINALITY_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">IFC-Version</label>
                  {IFC_VERSIONS.map((v) => (
                    <label key={v} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeSpec.ifcVersion.includes(v)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...activeSpec.ifcVersion, v]
                            : activeSpec.ifcVersion.filter((x) => x !== v);
                          updateSpecification(activeDoc.id, activeSpec.id, { ifcVersion: next });
                        }}
                        className="accent-primary"
                      />
                      <span className="text-[11px] text-foreground">{v}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Spec description/instructions */}
              <div className="flex gap-3 px-4 py-2 border-b border-border/50 shrink-0">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Beschreibung (optional)</label>
                  <input
                    className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mt-0.5"
                    value={activeSpec.description ?? ""}
                    onChange={(e) =>
                      updateSpecification(activeDoc.id, activeSpec.id, { description: e.target.value || undefined })
                    }
                    placeholder="Beschreibung…"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Anweisungen (optional)</label>
                  <input
                    className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mt-0.5"
                    value={activeSpec.instructions ?? ""}
                    onChange={(e) =>
                      updateSpecification(activeDoc.id, activeSpec.id, { instructions: e.target.value || undefined })
                    }
                    placeholder="Anweisungen…"
                  />
                </div>
              </div>

              {/* Facets area */}
              <div className="flex-1 overflow-y-auto">
                <div className="flex min-h-full">
                  {/* Applicability */}
                  <div className="flex-1 p-3 border-r border-border/50 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Anwendbarkeit</span>
                      <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5">
                        {activeSpec.applicability.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {activeSpec.applicability.map((facet, i) => (
                        <FacetCard
                          key={i}
                          facet={facet}
                          onUpdate={(f) => updateApplicabilityFacet(activeDoc.id, activeSpec.id, i, f)}
                          onRemove={() => removeApplicabilityFacet(activeDoc.id, activeSpec.id, i)}
                        />
                      ))}
                    </div>
                    <AddFacetButtons onAdd={(f) => addApplicabilityFacet(activeDoc.id, activeSpec.id, f)} />
                  </div>

                  {/* Requirements */}
                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Anforderungen</span>
                      <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5">
                        {activeSpec.requirements.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {activeSpec.requirements.map((facet, i) => (
                        <FacetCard
                          key={i}
                          facet={facet}
                          onUpdate={(f) => updateRequirementFacet(activeDoc.id, activeSpec.id, i, f)}
                          onRemove={() => removeRequirementFacet(activeDoc.id, activeSpec.id, i)}
                        />
                      ))}
                    </div>
                    <AddFacetButtons onAdd={(f) => addRequirementFacet(activeDoc.id, activeSpec.id, f)} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Validation results */}
        <div className="w-80 shrink-0 flex flex-col border-l border-border bg-card/30">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <Shield size={13} className="text-primary shrink-0" />
            <span className="text-xs font-semibold text-foreground flex-1">Prüfergebnis</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!validationReport ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <Shield size={28} className="text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Noch keine Prüfung ausgeführt.
                </p>
                {models.size === 0 && (
                  <p className="text-[11px] text-muted-foreground/60">
                    Zuerst ein IFC-Modell laden.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="text-[10px] text-muted-foreground">
                  Geprüft: {new Date(validationReport.timestamp).toLocaleString("de-AT")}
                </div>
                <ValidationResultPanel results={validationReport.results} />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
