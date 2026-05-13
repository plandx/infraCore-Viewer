import { useState, useCallback } from "react";
import { Tag, List, Hash, Code, Copy, Check, Eye, ScanLine } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";

type Tab = "attributes" | "properties" | "quantities" | "raw";

export function PropertiesPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("attributes");
  const selected = useModelStore((s) => s.selectedElement);
  const models = useModelStore((s) => s.models);
  const hideElement = useModelStore((s) => s.hideElement);
  const isolateElement = useModelStore((s) => s.isolateElement);
  const showAll = useModelStore((s) => s.showAll);
  const isolatedElements = useModelStore((s) => s.isolatedElements);
  const hiddenElements = useModelStore((s) => s.hiddenElements);

  if (!selected) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center">
            <Tag size={24} className="opacity-30" />
          </div>
          <div>
            <p className="text-sm font-medium">Kein Element ausgewählt</p>
            <p className="text-xs mt-1 opacity-60">Element im 3D-Viewer anklicken</p>
          </div>
        </div>
      </div>
    );
  }

  const model = models.get(selected.modelId);
  const isHidden = hiddenElements.has(`${selected.modelId}:${selected.expressId}`);
  const isIsolated = isolatedElements !== null && isolatedElements.has(`${selected.modelId}:${selected.expressId}`);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "attributes", label: "Attribute",     icon: <Tag size={12} /> },
    { id: "properties", label: "Eigenschaften", icon: <List size={12} /> },
    { id: "quantities", label: "Mengen",         icon: <Hash size={12} /> },
    { id: "raw",        label: "</>",            icon: <Code size={12} /> },
  ];

  return (
    <div className="flex flex-col h-full">
      <PanelHeader>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex-1 min-w-0">
            <span className="text-xs text-muted-foreground truncate block">{model?.name ?? selected.modelId}</span>
            <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              #{selected.expressId}
            </span>
          </div>
          {/* Quick actions */}
          <div className="flex gap-0.5 shrink-0">
            <button
              className={cn("toolbar-button p-1", isIsolated && "text-primary")}
              title="Isolieren"
              onClick={() => isIsolated ? showAll() : isolateElement(selected.modelId, selected.expressId)}
            >
              <ScanLine size={13} />
            </button>
            <button
              className={cn("toolbar-button p-1")}
              title={isHidden ? "Einblenden" : "Ausblenden"}
              onClick={() => {
                if (isHidden) showAll();
                else hideElement(selected.modelId, selected.expressId);
              }}
            >
              <Eye size={13} className={isHidden ? "opacity-40" : ""} />
            </button>
            <CopyButton value={JSON.stringify({ expressId: selected.expressId, ...selected.properties, psets: selected.psets }, null, 2)} title="Alle Eigenschaften kopieren" />
          </div>
        </div>
      </PanelHeader>

      {/* Tabs */}
      <div className="properties-tabs-list panel-container shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={cn("properties-tab-trigger", t.id === "raw" && "raw-step-tab-trigger flex-none", activeTab === t.id && "active")}
            onClick={() => setActiveTab(t.id)}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === "attributes" && (
          <AttributesTab properties={selected.properties} />
        )}
        {activeTab === "properties" && (
          <PropertySetsTab psets={selected.psets.filter(p => !p.name.startsWith("Qto_"))} />
        )}
        {activeTab === "quantities" && (
          <PropertySetsTab psets={selected.psets.filter(p => p.name.startsWith("Qto_"))} emptyMsg="Keine Mengen vorhanden" />
        )}
        {activeTab === "raw" && (
          <RawTab properties={selected.properties} psets={selected.psets} expressId={selected.expressId} />
        )}
      </div>
    </div>
  );
}

function PanelHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col px-3 py-2 border-b border-border bg-muted/30 shrink-0 gap-1">
      <span className="text-xs font-semibold text-foreground">Eigenschaften</span>
      {children}
    </div>
  );
}

function AttributesTab({ properties }: { properties: Record<string, unknown> }) {
  // Extract the IFC schema type name from the numeric type code
  const ifcTypeCode = typeof properties.type === "number" ? properties.type : null;
  const ifcTypeName = ifcTypeCode ? lookupIfcTypeName(ifcTypeCode) : null;

  const entries = Object.entries(properties)
    .filter(([k]) => k !== "expressID" && k !== "type")
    .map(([k, v]) => ({ name: k, value: v }))
    .filter(({ value }) => {
      // Skip pure entity-references (they show nothing meaningful)
      if (isIfcRef(value)) return false;
      return true;
    });

  if (!entries.length && !ifcTypeName) return <EmptyState msg="Keine Attribute vorhanden" />;

  return (
    <div className="p-0">
      <SectionHeader title="Basis-Attribute" count={entries.length + (ifcTypeName ? 1 : 0)} />
      <table className="w-full text-[11px] border-collapse">
        <tbody>
          {ifcTypeName && (
            <tr className="border-b border-border/30">
              <td className="px-3 py-1.5 text-muted-foreground w-2/5 font-medium">IFC-Typ</td>
              <td className="px-3 py-1.5 text-primary font-mono">{ifcTypeName}</td>
            </tr>
          )}
        </tbody>
      </table>
      <PropTable rows={entries} />
    </div>
  );
}

function PropertySetsTab({
  psets,
  emptyMsg = "Keine Eigenschaften vorhanden",
}: {
  psets: { name: string; properties: { name: string; value: unknown; type: string }[] }[];
  emptyMsg?: string;
}) {
  if (!psets.length) return <EmptyState msg={emptyMsg} />;

  return (
    <div>
      {psets.map((pset) => (
        <div key={pset.name}>
          <SectionHeader title={pset.name} count={pset.properties.length} />
          <PropTable rows={pset.properties} />
        </div>
      ))}
    </div>
  );
}

function RawTab({
  properties, psets, expressId,
}: {
  properties: Record<string, unknown>;
  psets: { name: string; properties: { name: string; value: unknown; type: string }[] }[];
  expressId: number;
}) {
  const raw = { expressID: expressId, ...properties, propertySets: psets };
  const json = JSON.stringify(raw, null, 2);
  return (
    <div className="relative">
      <div className="absolute top-2 right-2">
        <CopyButton value={json} />
      </div>
      <pre className="p-3 text-[11px] font-mono text-green-400 dark:text-[#9ece6a] overflow-auto whitespace-pre-wrap break-words leading-relaxed">
        {json}
      </pre>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border/50 sticky top-0">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">{title}</span>
      {count != null && (
        <span className="text-[10px] text-muted-foreground/60">{count}</span>
      )}
    </div>
  );
}

function PropTable({ rows }: { rows: { name: string; value: unknown; type?: string }[] }) {
  return (
    <table className="w-full text-[11px] border-collapse">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/30 hover:bg-muted/20 group">
            <td className="px-3 py-1.5 text-muted-foreground w-2/5 align-top font-medium truncate max-w-0" title={r.name}>
              {r.name}
            </td>
            <td className="px-3 py-1.5 text-foreground font-mono break-words max-w-0">
              <div className="flex items-start gap-1">
                <span className="flex-1">{renderVal(r.value)}</span>
                <CopyButton value={String(r.value ?? "")} className="opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CopyButton({ value, title = "Kopieren", className }: { value: string; title?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [value]
  );

  return (
    <button
      className={cn("toolbar-button p-0.5 text-muted-foreground/60 hover:text-foreground transition-opacity", className)}
      onClick={copy}
      title={title}
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">{msg}</div>
  );
}

// IFC values are wrapped: { value: X, type: N } where type=5 is a reference
function isIfcRef(v: unknown): boolean {
  return typeof v === "object" && v !== null && "type" in v &&
    (v as { type?: number }).type === 5;
}

function unwrapIfcValue(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "value" in v) {
    const w = v as { value: unknown; type?: number };
    if (w.type === 5) return `→ #${w.value}`;   // entity reference
    return w.value ?? null;
  }
  return v;
}

function renderVal(v: unknown): string {
  const val = unwrapIfcValue(v);
  if (val == null) return "–";
  if (typeof val === "boolean") return val ? "Ja" : "Nein";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// Quick lookup for the most common IFC type codes
const IFC_TYPE_NAMES: Record<number, string> = {
  // Walls
  238321258: "IfcWallStandardCase", 2391406946: "IfcWall",
  // Beams / columns
  753842376: "IfcBeam", 2500020860: "IfcColumn",
  // Slabs / roofs
  3448662350: "IfcSlab", 1562808683: "IfcRoof",
  // Openings / doors / windows
  2176052936: "IfcOpeningElement", 395920057: "IfcDoor", 3256556792: "IfcWindow",
  // Stairs / railings
  331165869: "IfcStair", 374418227: "IfcStairFlight", 2051836757: "IfcRailing",
  // Spaces / storeys / buildings
  3588315303: "IfcSpace", 3124254112: "IfcBuildingStorey",
  4031249490: "IfcBuilding", 4097777520: "IfcSite",
  // MEP
  4288193352: "IfcFlowSegment", 2044713172: "IfcPipeSegment",
  4222183408: "IfcDuctSegment", 3304561284: "IfcDuctFitting",
  // Generic / civil
  1959218052: "IfcBuildingElementProxy", 1027743046: "IfcCivilElement",
  1674181508: "IfcTransportElement",
  // Coverings / plates / members
  1307041759: "IfcCovering", 4237592921: "IfcPlate", 1073191201: "IfcMember",
  // Foundations
  900683007: "IfcFooting", 1247058037: "IfcPile",
  // Furniture
  263784265: "IfcFurnishingElement",
};

function lookupIfcTypeName(code: number): string | null {
  return IFC_TYPE_NAMES[code] ?? null;
}
