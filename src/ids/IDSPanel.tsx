import { useState, useRef, useMemo, useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { createPortal } from "react-dom";
import {
  FileCheck2, Plus, Trash2, ChevronDown, ChevronRight, Play, Download, Upload,
  FilePlus, X, Check, AlertTriangle, Info, Tag, Database, Box, Layers, Hash,
  List, Shield, Search, FolderOpen, Pencil, ExternalLink,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useIdsStore } from "./idsStore";
import { useModelStore } from "../store/modelStore";
import { parseIdsXml } from "./idsParser";
import { serializeIdsToXml } from "./idsWriter";
import { validateIdsDocument } from "./idsValidator";
import { openIdsResultsWindow } from "../utils/windowSync";
import { useBcfStore } from "../bcf/bcfStore";
import type {
  IdsFacet, IdsValue, IdsCardinality, IfcVersion,
  IdsEntityFacet, IdsAttributeFacet, IdsPropertyFacet,
  IdsClassificationFacet, IdsMaterialFacet,
  IdsSpecResult,
} from "./idsTypes";

// ── Constants ─────────────────────────────────────────────────────────────────

const IFC_TYPES = [
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCBEAM", "IFCCOLUMN", "IFCSLAB",
  "IFCDOOR", "IFCWINDOW", "IFCSPACE", "IFCROOF", "IFCSTAIR", "IFCSTAIRFLIGHT",
  "IFCBUILDINGELEMENT", "IFCBUILDINGELEMENTPROXY", "IFCFURNISHINGELEMENT",
  "IFCMEMBER", "IFCPLATE", "IFCPILE", "IFCFOOTING", "IFCSITE",
  "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCRAILING", "IFCRAMP", "IFCRAMPFLIGHT",
  "IFCCOVERING", "IFCCHIMNEY", "IFCCURTAINWALL", "IFCSHADINGDEVICE",
  "IFCEARTHWORKSFILL", "IFCEARTHWORKSCUT", "IFCREINFORCINGBAR",
  "IFCREINFORCINGMESH", "IFCTENDON", "IFCELEMENTASSEMBLY",
  "IFCDISCRETEACCESSORY", "IFCFASTENER", "IFCMECHANICALFASTENER",
  "IFCPIPESEGMENT", "IFCPIPEFITTING", "IFCDUCTSEGMENT", "IFCDUCTFITTING",
  "IFCFLOWSEGMENT", "IFCKERB", "IFCPAVEMENT", "IFCRAIL", "IFCTRACKELEMENT",
  "IFCBEARING", "IFCDEEPFOUNDATION", "IFCCAISSONFOUNDATION",
  "IFCNAVIGATIONELEMENT", "IFCMOORINGDEVICE", "IFCCOURSE",
  "IFCVEHICLE", "IFCTRANSPORTELEMENT", "IFCGEOGRAPHICELEMENT",
  "IFCGEOTECHNICALELEMENT", "IFCBOREHOLE", "IFCGEOMODEL", "IFCGEOSLICE",
  "IFCGEOTECHNICALSTRATUM", "IFCELEMENTCOMPONENT",
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
  value, onChange, placeholder,
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
      onChange={(e) => onChange(e.target.value ? { type: "simple", value: e.target.value } : undefined)}
    />
  );
}

// Handles both simple values and xs:restriction enumeration lists.
// Shows chips for each allowed value; a small list icon toggles into enumeration mode.
function ValueEditor({
  value, onChange, placeholder,
}: {
  value: IdsValue | undefined;
  onChange: (v: IdsValue | undefined) => void;
  placeholder?: string;
}) {
  const [newEnum, setNewEnum] = useState("");
  const isEnum = value?.type === "restriction" &&
    value.restrictions.some((r) => r.kind === "enumeration");

  if (!isEnum) {
    return (
      <div className="flex gap-1">
        <input
          className="flex-1 bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          value={value?.type === "simple" ? value.value : ""}
          placeholder={placeholder ?? "Wert…"}
          onChange={(e) => onChange(e.target.value ? { type: "simple", value: e.target.value } : undefined)}
        />
        <button
          className="px-2 rounded border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
          title="Auf Aufzählung umschalten"
          onClick={() => onChange({ type: "restriction", base: "xs:string", restrictions: [] })}
        >
          <List size={11} />
        </button>
      </div>
    );
  }

  const enums = (value as Extract<IdsValue, { type: "restriction" }>)
    .restrictions.filter((r) => r.kind === "enumeration").map((r) => r.value);
  const base = (value as Extract<IdsValue, { type: "restriction" }>).base;

  const addEnum = () => {
    const v = newEnum.trim();
    if (!v || enums.includes(v)) return;
    onChange({ type: "restriction", base, restrictions: [...enums, v].map((val) => ({ kind: "enumeration" as const, value: val })) });
    setNewEnum("");
  };

  const removeEnum = (val: string) => {
    const remaining = enums.filter((e) => e !== val);
    onChange(remaining.length > 0
      ? { type: "restriction", base, restrictions: remaining.map((v) => ({ kind: "enumeration" as const, value: v })) }
      : undefined);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1 min-h-[30px] bg-muted/40 border border-border rounded px-2 py-1">
        {enums.length === 0 && <span className="text-[10px] text-muted-foreground/50 self-center">Erlaubte Werte…</span>}
        {enums.map((v) => (
          <span key={v} className="flex items-center gap-1 bg-primary/10 text-primary text-[10px] rounded-[3px] px-1.5 py-0.5 font-medium">
            {v}
            <button onMouseDown={(e) => { e.preventDefault(); removeEnum(v); }} className="hover:text-destructive transition-colors">
              <X size={9} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          className="flex-1 bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          value={newEnum}
          placeholder="Wert eingeben + Enter…"
          onChange={(e) => setNewEnum(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEnum(); } }}
        />
        <button
          className="px-2 py-1 text-[10px] rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-bold"
          onClick={addEnum}
        >+</button>
        <button
          className="px-2 rounded border border-dashed border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
          title="Zurück zu einfachem Wert"
          onClick={() => onChange(undefined)}
        >
          <X size={10} />
        </button>
      </div>
    </div>
  );
}

// ── Multi-select IFC-Type input ────────────────────────────────────────────────
// Stores selected types as a pipe-separated simpleValue: "IFCWALL|IFCBEAM|..."

function IfcTypeMultiSelect({
  value, onChange,
}: {
  value: string;          // pipe-separated, e.g. "IFCWALL|IFCBEAM"
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => value.split("|").map((s) => s.trim()).filter(Boolean),
    [value],
  );

  const filtered = useMemo(() => {
    const q = search.toUpperCase();
    return IFC_TYPES.filter((t) => (!q || t.includes(q)) && !selected.includes(t));
  }, [search, selected]);

  // Recalculate dropdown position whenever it opens
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropH = Math.min(220, filtered.length * 30 + 8);
    if (spaceBelow >= dropH || spaceBelow >= 120) {
      setDropdownStyle({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    } else {
      setDropdownStyle({ bottom: window.innerHeight - rect.top + 2, left: rect.left, width: rect.width });
    }
  }, [open, filtered.length]);

  const add = (t: string) => {
    onChange([...selected, t].join("|"));
    setSearch("");
    inputRef.current?.focus();
  };

  const remove = (t: string) => {
    onChange(selected.filter((s) => s !== t).join("|"));
  };

  return (
    <div ref={wrapRef}>
      {/* Tag list + search input */}
      <div
        className="flex flex-wrap gap-1 min-h-[30px] bg-muted/40 border border-border rounded px-2 py-1 cursor-text focus-within:ring-1 focus-within:ring-primary/50"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map((t) => (
          <span key={t} className="flex items-center gap-1 bg-primary/10 text-primary text-[10px] rounded-[3px] px-1.5 py-0.5 font-medium shrink-0">
            {t}
            <button
              className="hover:text-destructive transition-colors"
              onMouseDown={(e) => { e.preventDefault(); remove(t); }}
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[80px] bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          placeholder={selected.length === 0 ? "IFC-Typ suchen und hinzufügen…" : "Weiteren Typ…"}
          value={search}
          onChange={(e) => { setSearch(e.target.value.toUpperCase()); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>

      {/* Dropdown rendered as portal → always above all overflow:hidden containers */}
      {open && createPortal(
        <div
          className="fixed bg-popover border border-border rounded shadow-2xl max-h-56 overflow-y-auto"
          style={{ ...dropdownStyle, zIndex: 9999 }}
        >
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">Keine weiteren Typen</p>
          )}
          {filtered.slice(0, 60).map((t) => (
            <button
              key={t}
              className="w-full text-left px-3 py-1.5 text-[11px] text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              onMouseDown={(e) => { e.preventDefault(); add(t); }}
            >
              {t}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
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

function EntityFacetEditor({ facet, onChange }: { facet: IdsEntityFacet; onChange: (f: IdsEntityFacet) => void }) {
  const typeStr = facet.name.type === "simple" ? facet.name.value : "";
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          IFC-Typ(en) <span className="normal-case text-muted-foreground/60">(Mehrfachauswahl möglich)</span>
        </label>
        <div className="mt-0.5">
          <IfcTypeMultiSelect
            value={typeStr}
            onChange={(v) => onChange({ ...facet, name: { type: "simple", value: v } })}
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Vordefinierter Typ (optional)</label>
        <div className="mt-0.5">
          <SimpleValueEditor
            value={facet.predefinedType}
            onChange={(v) => onChange({ ...facet, predefinedType: v })}
            placeholder="z.B. SOLIDWALL"
          />
        </div>
      </div>
    </div>
  );
}

// ── Attribute facet editor ────────────────────────────────────────────────────

function AttributeFacetEditor({ facet, onChange }: { facet: IdsAttributeFacet; onChange: (f: IdsAttributeFacet) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Attribut-Name</label>
        <div className="mt-0.5">
          <SimpleValueEditor value={facet.name} onChange={(v) => onChange({ ...facet, name: v ?? { type: "simple", value: "" } })} placeholder="z.B. Name" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Erwarteter Wert (optional)</label>
        <div className="mt-0.5">
          <SimpleValueEditor value={facet.value} onChange={(v) => onChange({ ...facet, value: v })} />
        </div>
      </div>
      <CardinalitySelect value={facet.cardinality} onChange={(c) => onChange({ ...facet, cardinality: c })} />
    </div>
  );
}

// ── Property facet editor ─────────────────────────────────────────────────────

function PropertyFacetEditor({ facet, onChange }: { facet: IdsPropertyFacet; onChange: (f: IdsPropertyFacet) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">PropertySet</label>
          <div className="mt-0.5">
            <SimpleValueEditor value={facet.propertySet} onChange={(v) => onChange({ ...facet, propertySet: v ?? { type: "simple", value: "" } })} placeholder="Pset_WallCommon" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Property-Name</label>
          <div className="mt-0.5">
            <SimpleValueEditor value={facet.baseName} onChange={(v) => onChange({ ...facet, baseName: v ?? { type: "simple", value: "" } })} placeholder="FireRating" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Erwarteter Wert (optional)</label>
          <div className="mt-0.5">
            <ValueEditor value={facet.value} onChange={(v) => onChange({ ...facet, value: v })} />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Datentyp</label>
          <select
            className="w-full mt-0.5 bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={facet.dataType ?? ""}
            onChange={(e) => onChange({ ...facet, dataType: e.target.value || undefined })}
          >
            <option value="">— keiner —</option>
            {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <CardinalitySelect value={facet.cardinality} onChange={(c) => onChange({ ...facet, cardinality: c })} />
    </div>
  );
}

// ── Classification / Material editors ────────────────────────────────────────

function ClassificationFacetEditor({ facet, onChange }: { facet: IdsClassificationFacet; onChange: (f: IdsClassificationFacet) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">System (optional)</label>
        <div className="mt-0.5"><SimpleValueEditor value={facet.system} onChange={(v) => onChange({ ...facet, system: v })} placeholder="z.B. Uniclass" /></div>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Wert (optional)</label>
        <div className="mt-0.5"><SimpleValueEditor value={facet.value} onChange={(v) => onChange({ ...facet, value: v })} /></div>
      </div>
      <CardinalitySelect value={facet.cardinality} onChange={(c) => onChange({ ...facet, cardinality: c })} />
    </div>
  );
}

function MaterialFacetEditor({ facet, onChange }: { facet: IdsMaterialFacet; onChange: (f: IdsMaterialFacet) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Material-Wert (optional)</label>
        <div className="mt-0.5"><SimpleValueEditor value={facet.value} onChange={(v) => onChange({ ...facet, value: v })} placeholder="z.B. Beton" /></div>
      </div>
      <CardinalitySelect value={facet.cardinality} onChange={(c) => onChange({ ...facet, cardinality: c })} />
    </div>
  );
}

// ── Cardinality select ────────────────────────────────────────────────────────

function CardinalitySelect({ value, onChange }: { value: IdsCardinality; onChange: (c: IdsCardinality) => void }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Kardinalität</label>
      <select
        className="w-full mt-0.5 bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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

function FacetCard({ facet, onUpdate, onRemove }: { facet: IdsFacet; onUpdate: (f: IdsFacet) => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(true);

  const title = () => {
    switch (facet.type) {
      case "entity": return `Entität: ${facet.name.type === "simple" ? facet.name.value || "…" : "(Ausdruck)"}`;
      case "attribute": return `Attribut: ${facet.name.type === "simple" ? facet.name.value || "…" : "(Ausdruck)"}`;
      case "property": {
        const ps = facet.propertySet.type === "simple" ? facet.propertySet.value : "…";
        const pn = facet.baseName.type === "simple" ? facet.baseName.value : "…";
        return `${ps} · ${pn}`;
      }
      case "classification": return "Klassifikation";
      case "material": return "Material";
      case "partOf": return "Teil von";
    }
  };

  return (
    <div className="border border-border rounded-[6px] overflow-hidden bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpanded((v) => !v)}>
        <span className="text-muted-foreground shrink-0">{facetIcon(facet.type)}</span>
        <span className="text-xs font-medium flex-1 truncate text-foreground">{title()}</span>
        {expanded ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
        <button
          className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-border/50">
          {facet.type === "entity" && <EntityFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />}
          {facet.type === "attribute" && <AttributeFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />}
          {facet.type === "property" && <PropertyFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />}
          {facet.type === "classification" && <ClassificationFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />}
          {facet.type === "material" && <MaterialFacetEditor facet={facet} onChange={(f) => onUpdate(f)} />}
        </div>
      )}
    </div>
  );
}

// ── Grouped requirements view (by PropertySet) ────────────────────────────────

function GroupedRequirementsView({
  facets,
  onUpdate,
  onRemove,
}: {
  facets: IdsFacet[];
  onUpdate: (index: number, f: IdsFacet) => void;
  onRemove: (index: number) => void;
}) {
  const [expandedPsets, setExpandedPsets] = useState<Set<string>>(new Set());
  // Set of original facet indices currently in edit mode
  const [editingIndices, setEditingIndices] = useState<Set<number>>(new Set());

  const nonProps = facets.map((f, i) => ({ f, i })).filter(({ f }) => f.type !== "property");

  const psetGroups = new Map<string, { f: IdsPropertyFacet; i: number }[]>();
  facets.forEach((f, i) => {
    if (f.type !== "property") return;
    const pf = f as IdsPropertyFacet;
    const pset = pf.propertySet.type === "simple" ? pf.propertySet.value : "(unbekannt)";
    if (!psetGroups.has(pset)) psetGroups.set(pset, []);
    psetGroups.get(pset)!.push({ f: pf, i });
  });

  const sortedPsets = Array.from(psetGroups.keys()).sort();

  const togglePset = (name: string) =>
    setExpandedPsets((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const toggleEdit = (idx: number) =>
    setEditingIndices((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });

  return (
    <div className="flex flex-col gap-1.5">
      {/* Non-property facets */}
      {nonProps.map(({ f, i }) => (
        <FacetCard key={i} facet={f} onUpdate={(nf) => onUpdate(i, nf)} onRemove={() => onRemove(i)} />
      ))}

      {/* PropertySet groups */}
      {sortedPsets.map((psetName) => {
        const items = psetGroups.get(psetName)!;
        const isExpanded = expandedPsets.has(psetName);

        return (
          <div key={psetName} className="border border-border rounded-[6px] overflow-hidden bg-card/30">
            {/* Group header */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
              onClick={() => togglePset(psetName)}
            >
              <FolderOpen size={12} className="text-primary/70 shrink-0" />
              <span className="text-xs font-semibold text-foreground flex-1 truncate">{psetName}</span>
              <span className="text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 shrink-0">
                {items.length}
              </span>
              {isExpanded
                ? <ChevronDown size={12} className="text-muted-foreground shrink-0" />
                : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
            </button>

            {isExpanded && (
              <div className="border-t border-border/50 divide-y divide-border/30">
                {items.map(({ f, i }) => {
                  const propName = f.baseName.type === "simple" ? f.baseName.value : "…";
                  const isEditing = editingIndices.has(i);

                  const valueLabel = (() => {
                    if (!f.value) return null;
                    if (f.value.type === "simple") return `= ${f.value.value}`;
                    const enums = f.value.restrictions.filter((r) => r.kind === "enumeration").map((r) => r.value);
                    if (enums.length > 0) return enums.join(" | ");
                    return "(Einschränkung)";
                  })();

                  return (
                    <div key={i}>
                      {/* Compact row */}
                      <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20 group">
                        <Database size={11} className="text-primary/50 shrink-0" />
                        <span className="text-xs text-foreground flex-1 truncate font-medium">{propName}</span>
                        {valueLabel && (
                          <span className="text-[10px] text-muted-foreground bg-muted/40 rounded px-1 shrink-0 truncate max-w-[120px]" title={valueLabel}>
                            {valueLabel}
                          </span>
                        )}
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-[3px] border shrink-0",
                          f.cardinality === "required" ? "border-primary/40 text-primary" :
                          f.cardinality === "prohibited" ? "border-destructive/40 text-destructive" :
                          "border-border text-muted-foreground"
                        )}>
                          {CARDINALITY_LABELS[f.cardinality]}
                        </span>
                        {f.dataType && (
                          <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden group-hover:inline">{f.dataType}</span>
                        )}
                        {/* Edit / delete buttons */}
                        <button
                          className={cn(
                            "p-0.5 rounded transition-all shrink-0",
                            isEditing
                              ? "text-primary"
                              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                          )}
                          title="Bearbeiten"
                          onClick={() => toggleEdit(i)}
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                          title="Entfernen"
                          onClick={() => { setEditingIndices((prev) => { const n = new Set(prev); n.delete(i); return n; }); onRemove(i); }}
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>

                      {/* Inline editor */}
                      {isEditing && (
                        <div className="px-3 pb-3 pt-2 bg-muted/10 border-t border-border/30">
                          <PropertyFacetEditor
                            facet={f}
                            onChange={(nf) => onUpdate(i, nf)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Add facet button group ────────────────────────────────────────────────────

function AddFacetButtons({ onAdd }: { onAdd: (f: IdsFacet) => void }) {
  const defaultFacets: { label: string; icon: React.ReactNode; facet: IdsFacet }[] = [
    { label: "Entität", icon: <Box size={10} />, facet: { type: "entity", name: { type: "simple", value: "" } } },
    { label: "Attribut", icon: <Hash size={10} />, facet: { type: "attribute", cardinality: "required", name: { type: "simple", value: "Name" } } },
    { label: "Property", icon: <Database size={10} />, facet: { type: "property", cardinality: "required", propertySet: { type: "simple", value: "" }, baseName: { type: "simple", value: "" } } },
    { label: "Klassifikation", icon: <Tag size={10} />, facet: { type: "classification", cardinality: "required" } },
    { label: "Material", icon: <Layers size={10} />, facet: { type: "material", cardinality: "required" } },
  ];

  return (
    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-dashed border-border/50">
      <span className="text-[10px] text-muted-foreground/60 w-full mb-0.5">Hinzufügen:</span>
      {defaultFacets.map(({ label, icon, facet }) => (
        <button
          key={label}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onClick={() => onAdd({ ...facet } as IdsFacet)}
        >
          {icon} {label}
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
    const rows: string[][] = [["Spezifikation", "Status", "Anwendbar", "Bestanden", "Fehler", "ElementID", "Name", "Typ", "Fehlerdetail"]];
    for (const r of results) {
      if (r.elements.length === 0) {
        rows.push([r.specificationName, r.status, String(r.applicableCount), String(r.passCount), String(r.failCount), "", "", "", r.note ?? ""]);
      } else {
        for (const el of r.elements) {
          rows.push([r.specificationName, el.status, String(r.applicableCount), String(r.passCount), String(r.failCount), String(el.expressId), el.name ?? "", el.type ?? "", el.failures.map((f) => f.message).join("; ")]);
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
      <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-border/50">
        <span className="text-xs font-semibold">{total} Spezifikationen</span>
        <span className="flex items-center gap-1 text-xs text-green-500"><Check size={11} /> {passed}</span>
        {failed > 0 && <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle size={11} /> {failed}</span>}
        {skipped > 0 && <span className="text-xs text-muted-foreground">{skipped} übersprungen</span>}
        <button
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          onClick={exportCSV}
        >
          <Download size={10} /> CSV
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {results.map((r) => {
          const isExpanded = expandedSpec === r.specificationId;
          const statusColor =
            r.status === "passed" ? "border-green-500/60 text-green-600 dark:text-green-400" :
            r.status === "failed" ? "border-red-500/60 text-red-500" :
            "text-muted-foreground border-border";

          return (
            <div key={r.specificationId} className={cn("border rounded-[6px] overflow-hidden", r.status === "failed" ? "border-red-400/20" : "border-border")}>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedSpec(isExpanded ? null : r.specificationId)}
              >
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-[3px] border shrink-0", statusColor)}>
                  {r.status === "passed" ? "OK" : r.status === "failed" ? "FAIL" : "SKIP"}
                </span>
                <span className="text-xs font-medium flex-1 truncate">{r.specificationName}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {r.applicableCount > 0 ? `${r.passCount}/${r.applicableCount}` : "—"}
                </span>
                {r.status === "failed" && (
                  <button
                    className="text-[9px] px-1.5 py-0.5 rounded-[3px] border border-amber-500/40 text-amber-600 hover:bg-amber-400/10 transition-colors shrink-0"
                    title="Als BCF-Thema erstellen"
                    onClick={(e) => {
                      e.stopPropagation();
                      const failedEls = r.elements.filter(el => el.status === "failed");
                      useBcfStore.getState().createFromIdsFailure(r, failedEls);
                    }}
                  >
                    BCF
                  </button>
                )}
                {isExpanded ? <ChevronDown size={11} className="text-muted-foreground shrink-0" /> : <ChevronRight size={11} className="text-muted-foreground shrink-0" />}
              </button>

              {isExpanded && (
                <div className="border-t border-border/50 bg-muted/5">
                  {r.note && (
                    <p className="px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <Info size={10} /> {r.note}
                    </p>
                  )}
                  {r.elements.length > 0 && (
                    <div className="max-h-56 overflow-y-auto">
                      {r.elements.filter((e) => e.status === "failed").slice(0, 50).map((el) => (
                        <div key={`${el.modelId}:${el.expressId}`} className="px-3 py-1.5 border-b border-border/20 last:border-b-0">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle size={10} className="text-red-400 shrink-0" />
                            <span className="text-xs font-medium truncate">{el.name || `#${el.expressId}`}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{el.type}</span>
                          </div>
                          {el.failures.map((f, fi) => (
                            <p key={fi} className="text-[10px] text-red-300/80 pl-4 mt-0.5 leading-tight">{f.message}</p>
                          ))}
                        </div>
                      ))}
                      {r.failCount > 50 && (
                        <p className="px-3 py-1.5 text-[10px] text-muted-foreground">… und {r.failCount - 50} weitere</p>
                      )}
                      {r.passCount > 0 && (
                        <div className="px-3 py-1.5 flex items-center gap-1 text-[10px] text-green-500">
                          <Check size={10} /> {r.passCount} Elemente bestanden
                        </div>
                      )}
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
    validationReport,
    createDocument, loadDocument, removeDocument, setActiveDocument, updateDocumentInfo,
    addSpecification, removeSpecification, updateSpecification, setActiveSpecification,
    addApplicabilityFacet, removeApplicabilityFacet, updateApplicabilityFacet,
    addRequirementFacet, removeRequirementFacet, updateRequirementFacet,
    setValidationReport, setIdsPanelOpen,
  } = useIdsStore();

  const models = useModelStore((s) => s.models);
  const loadedProperties = useModelStore((s) => s.loadedProperties);
  const loadingPropertiesProgress = useModelStore((s) => s.loadingPropertiesProgress);
  const propertiesLoaded = loadedProperties !== null && loadedProperties.size > 0;

  const idsInputRef = useRef<HTMLInputElement>(null);
  const [specSearch, setSpecSearch] = useState("");
  const [validating, setValidating] = useState(false);

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

  const handleValidate = async () => {
    if (!activeDoc) return;
    setValidating(true);
    try {
      const serverUrl = "http://127.0.0.1:8765";
      let serverOnline = false;
      try {
        const ping = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(1500) });
        serverOnline = ping.ok;
      } catch { /* offline */ }

      if (serverOnline && models.length > 0) {
        const idsXml = serializeIdsToXml(activeDoc);
        const allResults = await Promise.all(
          models.map(async (m) => {
            try {
              const r = await fetch(`${serverUrl}/validate-ids`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: m.name, ids_xml: idsXml }),
                signal: AbortSignal.timeout(60_000),
              });
              if (!r.ok) return null;
              return await r.json();
            } catch { return null; }
          })
        );
        const valid = allResults.filter((r): r is NonNullable<typeof r> => r !== null);
        if (valid.length > 0) {
          const merged = {
            documentId: activeDoc.id,
            documentTitle: activeDoc.info.title,
            timestamp: new Date().toISOString(),
            results: valid.flatMap((r) => r.results ?? []),
          };
          setValidationReport(merged);
          return;
        }
      }

      const report = validateIdsDocument(activeDoc, models, loadedProperties);
      setValidationReport(report);
    } finally {
      setValidating(false);
    }
  };

  // Filtered specs for search
  const filteredSpecs = useMemo(() => {
    if (!activeDoc) return [];
    const q = specSearch.trim().toLowerCase();
    if (!q) return activeDoc.specifications;
    return activeDoc.specifications.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q)
    );
  }, [activeDoc, specSearch]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <input ref={idsInputRef} type="file" accept=".ids,.xml" className="hidden" onChange={handleLoadFile} />

      <PanelGroup orientation="horizontal" className="flex-1">

        {/* ── Left sidebar ─────────────────────────────────────────────────── */}
        <Panel defaultSize={22} minSize={14} className="flex flex-col border-r border-border bg-card/50">

          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
            <FileCheck2 size={15} className="text-primary shrink-0" />
            <span className="text-sm font-semibold flex-1">IDS</span>
            <button className="p-1 rounded-[4px] text-muted-foreground hover:text-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] transition-colors" onClick={() => setIdsPanelOpen(false)}>
              <X size={13} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/50 shrink-0">
            <button
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-[4px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => createDocument()}
            >
              <FilePlus size={11} /> Neu
            </button>
            <button
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-[4px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              onClick={() => idsInputRef.current?.click()}
            >
              <Upload size={11} /> Laden
            </button>
          </div>

          {/* Document tabs */}
          {documents.length > 1 && (
            <div className="flex overflow-x-auto gap-0.5 px-2 py-1 border-b border-border/50 shrink-0">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 text-[10px] rounded whitespace-nowrap transition-colors shrink-0",
                    doc.id === activeDocumentId ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  )}
                  onClick={() => setActiveDocument(doc.id)}
                >
                  <span className="truncate max-w-[80px]">{doc.info.title}</span>
                  <button className="hover:text-destructive" onClick={(e) => { e.stopPropagation(); removeDocument(doc.id); }}><X size={9} /></button>
                </button>
              ))}
            </div>
          )}

          {/* Single doc title + remove */}
          {documents.length === 1 && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0">
              <FileCheck2 size={11} className="text-primary/60 shrink-0" />
              <span className="text-[11px] text-foreground flex-1 truncate">{documents[0].info.title}</span>
              <button className="text-muted-foreground hover:text-destructive p-0.5 rounded transition-colors" onClick={() => removeDocument(documents[0].id)}><X size={10} /></button>
            </div>
          )}

          {/* Search */}
          {activeDoc && (
            <div className="px-2 py-1.5 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-1.5 bg-muted/40 border border-border rounded px-2 py-1">
                <Search size={11} className="text-muted-foreground shrink-0" />
                <input
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none min-w-0"
                  placeholder="Spezifikation suchen…"
                  value={specSearch}
                  onChange={(e) => setSpecSearch(e.target.value)}
                />
                {specSearch && <button onClick={() => setSpecSearch("")}><X size={10} className="text-muted-foreground hover:text-foreground" /></button>}
              </div>
            </div>
          )}

          {/* Spec list */}
          <div className="flex-1 overflow-y-auto py-1">
            {!activeDoc && (
              <p className="text-[11px] text-muted-foreground text-center py-6 px-3">
                Kein Dokument geöffnet.<br />Neu erstellen oder .ids laden.
              </p>
            )}
            {activeDoc && filteredSpecs.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-4 px-3">
                Keine Spezifikation gefunden.
              </p>
            )}
            {activeDoc && filteredSpecs.map((spec) => {
              const result = validationReport?.results.find((r) => r.specificationId === spec.id);
              const statusDot = result
                ? result.status === "passed" ? "bg-green-500" : result.status === "failed" ? "bg-red-400" : "bg-muted-foreground/40"
                : null;
              return (
                <button
                  key={spec.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left rounded-[4px] mx-1 transition-colors group",
                    spec.id === activeSpecificationId
                      ? "bg-primary/8 border-l-2 border-l-primary text-primary"
                      : "text-foreground/80 hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A]"
                  )}
                  style={{ width: "calc(100% - 8px)" }}
                  onClick={() => setActiveSpecification(spec.id)}
                >
                  <Shield size={11} className="shrink-0" />
                  <span className="text-[11px] flex-1 truncate">{spec.name}</span>
                  {statusDot && <span className={cn("w-2 h-2 rounded-full shrink-0", statusDot)} />}
                  <button
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                    onClick={(e) => { e.stopPropagation(); removeSpecification(activeDoc.id, spec.id); }}
                  >
                    <Trash2 size={9} />
                  </button>
                </button>
              );
            })}
            {activeDoc && (
              <button
                className="w-full flex items-center gap-1 px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors mt-0.5"
                onClick={() => addSpecification(activeDoc.id)}
              >
                <Plus size={10} /> Spezifikation hinzufügen
              </button>
            )}
          </div>

          {/* Bottom actions */}
          {activeDoc && (
            <div className="border-t border-border p-2 flex flex-col gap-1 shrink-0">
              {/* Properties warning */}
              {!propertiesLoaded && models.size > 0 && (
                <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 mb-1">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  <span>Eigenschaften nicht geladen. Für Prüfung zuerst "Eigenschaften laden" im Analyse-Tab ausführen.</span>
                </div>
              )}
              {loadingPropertiesProgress !== null && (
                <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-muted-foreground mb-1">
                  <div className="flex-1 bg-border rounded-full h-1">
                    <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${loadingPropertiesProgress}%` }} />
                  </div>
                  {loadingPropertiesProgress}%
                </div>
              )}
              <button
                className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] rounded-[4px] bg-muted/40 border border-border text-foreground hover:bg-muted/70 transition-colors"
                onClick={handleSave}
              >
                <Download size={11} /> Speichern (.ids)
              </button>
              <button
                className={cn(
                  "flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] rounded-[4px] transition-colors",
                  models.size > 0
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted/40 border border-border text-muted-foreground cursor-not-allowed opacity-50"
                )}
                onClick={handleValidate}
                disabled={models.size === 0 || validating}
                title={models.size === 0 ? "Kein IFC-Modell geladen" : "Prüfung ausführen"}
              >
                <Play size={11} /> {validating ? "Prüft …" : "Prüfung ausführen"}
              </button>
            </div>
          )}
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

        {/* ── Center: Spec editor ───────────────────────────────────────────── */}
        <Panel defaultSize={50} minSize={25} className="flex flex-col min-w-0 overflow-hidden">
          {!activeDoc ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <FileCheck2 size={36} className="opacity-20" />
              <p className="text-sm">Kein Dokument ausgewählt</p>
            </div>
          ) : !activeSpec ? (
            <div className="flex flex-col h-full overflow-y-auto">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold mb-3">Dokument-Informationen</h2>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ["title", "Titel"], ["version", "Version"], ["author", "Autor"],
                    ["date", "Datum"], ["copyright", "Copyright"], ["purpose", "Zweck"],
                    ["milestone", "Meilenstein"],
                  ] as [keyof typeof activeDoc.info, string][]).map(([key, label]) => (
                    <div key={key}>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
                      <input
                        type={key === "date" ? "date" : "text"}
                        className="w-full mt-0.5 bg-muted/40 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                        value={(activeDoc.info[key] as string) ?? ""}
                        onChange={(e) => updateDocumentInfo(activeDoc.id, { [key]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="col-span-3">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Beschreibung</label>
                    <textarea
                      className="w-full mt-0.5 bg-muted/40 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                      rows={2}
                      value={activeDoc.info.description ?? ""}
                      onChange={(e) => updateDocumentInfo(activeDoc.id, { description: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                <div className="text-center">
                  <Shield size={28} className="mx-auto mb-2 opacity-20" />
                  <p>Spezifikation in der Seitenleiste auswählen oder neue hinzufügen</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">{activeDoc.specifications.length} Spezifikation{activeDoc.specifications.length !== 1 ? "en" : ""}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Spec header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
                <Shield size={14} className="text-primary shrink-0" />
                <input
                  className="flex-1 bg-transparent text-sm font-semibold focus:outline-none border-b border-transparent focus:border-primary/50 transition-colors"
                  value={activeSpec.name}
                  onChange={(e) => updateSpecification(activeDoc.id, activeSpec.id, { name: e.target.value })}
                />
              </div>

              {/* Spec metadata bar */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50 bg-muted/10 shrink-0 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">Notwendigkeit</label>
                  <select
                    className="bg-muted/40 border border-border rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={activeSpec.necessity}
                    onChange={(e) => updateSpecification(activeDoc.id, activeSpec.id, { necessity: e.target.value as IdsCardinality })}
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
                        className="accent-primary"
                        onChange={(e) => {
                          const next = e.target.checked ? [...activeSpec.ifcVersion, v] : activeSpec.ifcVersion.filter((x) => x !== v);
                          updateSpecification(activeDoc.id, activeSpec.id, { ifcVersion: next });
                        }}
                      />
                      <span className="text-[11px]">{v}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Desc / instructions */}
              <div className="flex gap-3 px-4 py-2 border-b border-border/50 shrink-0">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Beschreibung</label>
                  <input
                    className="w-full mt-0.5 bg-muted/40 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={activeSpec.description ?? ""}
                    onChange={(e) => updateSpecification(activeDoc.id, activeSpec.id, { description: e.target.value || undefined })}
                    placeholder="Beschreibung…"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Anweisungen</label>
                  <input
                    className="w-full mt-0.5 bg-muted/40 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={activeSpec.instructions ?? ""}
                    onChange={(e) => updateSpecification(activeDoc.id, activeSpec.id, { instructions: e.target.value || undefined })}
                    placeholder="Anweisungen…"
                  />
                </div>
              </div>

              {/* Facets area — 2 resizable columns */}
              <PanelGroup orientation="horizontal" className="flex-1">
                {/* Applicability */}
                <Panel defaultSize={50} minSize={20} className="overflow-y-auto p-4 min-w-0 border-r border-border/50">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px] font-semibold text-muted-foreground">Anwendbarkeit</span>
                    <span className="text-[10px] bg-primary/10 text-primary rounded-[3px] px-1.5 py-0.5 font-medium">{activeSpec.applicability.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {activeSpec.applicability.map((facet, i) => (
                      <FacetCard
                        key={i} facet={facet}
                        onUpdate={(f) => updateApplicabilityFacet(activeDoc.id, activeSpec.id, i, f)}
                        onRemove={() => removeApplicabilityFacet(activeDoc.id, activeSpec.id, i)}
                      />
                    ))}
                  </div>
                  <AddFacetButtons onAdd={(f) => addApplicabilityFacet(activeDoc.id, activeSpec.id, f)} />
                </Panel>

                <PanelResizeHandle className="w-1 bg-border/50 hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

                {/* Requirements — grouped by PropertySet */}
                <Panel defaultSize={50} minSize={20} className="overflow-y-auto p-4 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px] font-semibold text-muted-foreground">Anforderungen</span>
                    <span className="text-[10px] bg-primary/10 text-primary rounded-[3px] px-1.5 py-0.5 font-medium">{activeSpec.requirements.length}</span>
                  </div>
                  <GroupedRequirementsView
                    facets={activeSpec.requirements}
                    onUpdate={(i, f) => updateRequirementFacet(activeDoc.id, activeSpec.id, i, f)}
                    onRemove={(i) => removeRequirementFacet(activeDoc.id, activeSpec.id, i)}
                  />
                  <AddFacetButtons onAdd={(f) => addRequirementFacet(activeDoc.id, activeSpec.id, f)} />
                </Panel>
              </PanelGroup>
            </div>
          )}
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

        {/* ── Right: Validation results ─────────────────────────────────────── */}
        <Panel defaultSize={28} minSize={16} className="flex flex-col border-l border-border bg-card/30">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
            <Shield size={13} className="text-primary shrink-0" />
            <span className="text-xs font-semibold flex-1">Prüfergebnis</span>
            <button
              className="p-1 rounded-[4px] text-muted-foreground hover:text-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] transition-colors"
              onClick={openIdsResultsWindow}
              title="Ergebnisse in eigenem Fenster öffnen"
            >
              <ExternalLink size={12} />
            </button>
            {validationReport && (
              <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setValidationReport(null)}>
                <X size={12} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!validationReport ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <Shield size={32} className="text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground">Noch keine Prüfung ausgeführt.</p>
                {models.size === 0 && <p className="text-[11px] text-muted-foreground/50">Zuerst ein IFC-Modell laden.</p>}
                {models.size > 0 && !propertiesLoaded && (
                  <p className="text-[11px] text-amber-400/70">Tipp: Eigenschaften laden für vollständige Prüfung.</p>
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
        </Panel>

      </PanelGroup>
    </div>
  );
}
