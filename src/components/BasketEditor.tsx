import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { X, Download, Upload, Table2, Loader2, Check, TriangleAlert, Info, FileDown } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { loadBasketProperties } from "../utils/ifcLoader";
import { writeIFCWithOverrides, downloadFile } from "../utils/ifcWriter";
import type { PropertySet } from "../types/ifc";

// ── Types ────────────────────────────────────────────────────────────────────

interface EditorRow {
  key: string;
  modelId: string;
  modelName: string;
  expressId: number;
  name: string;
  type: string;
  globalId: string;
  directProps: Record<string, unknown>;
  psets: PropertySet[];
}

interface EditorCol {
  key: string;
  label: string;
  group: string;
}

interface ImportResult {
  applied: number;
  skipped: number;
  notFound: string[];
  edits: Array<{ modelId: string; expressId: number; key: string; value: string }>;
}

// These three columns are display-only context — GlobalId is the key and must
// not be duplicated from propColKeys; Typ + Modell are not IFC property names.
const INFO_COLS  = ["GlobalId", "Typ", "Modell"] as const;
const SKIP_COLS  = new Set<string>(INFO_COLS);

const PRIO_DIRECT = ["Name", "Description", "ObjectType", "Tag", "GlobalId"];

// ── Component ────────────────────────────────────────────────────────────────

export function BasketEditor({ onClose, mode = "modal" }: { onClose: () => void; mode?: "modal" | "window" }) {
  const models             = useModelStore((s) => s.models);
  const selectionBasket    = useModelStore((s) => s.selectionBasket);
  const applyPropertyEdits = useModelStore((s) => s.applyPropertyEdits);

  const [rows, setRows]               = useState<EditorRow[]>([]);
  const [columns, setColumns]         = useState<EditorCol[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadMsg, setLoadMsg]         = useState("");
  const [exporting, setExporting]     = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError]   = useState<string | null>(null);
  const [importing, setImporting]       = useState(false);
  const [ifcExporting, setIfcExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load basket properties ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const byModel = new Map<string, number[]>();
      for (const key of selectionBasket) {
        const colon = key.indexOf(":");
        const modelId = key.slice(0, colon);
        const eid = parseInt(key.slice(colon + 1));
        if (!byModel.has(modelId)) byModel.set(modelId, []);
        byModel.get(modelId)!.push(eid);
      }

      const newRows: EditorRow[] = [];

      for (const [modelId, eids] of byModel) {
        if (cancelled) return;
        const model = models.get(modelId);
        if (!model?.file || model.status !== "loaded") continue;

        setLoadMsg(`Lade ${model.name} …`);
        const propsMap = await loadBasketProperties(model.file, eids);

        for (const eid of eids) {
          const data = propsMap.get(eid);
          let name = `#${eid}`;
          let type = "Unbekannt";
          for (const [typeName, elements] of Object.entries(model.elementsByType)) {
            const el = elements.find((e) => e.expressId === eid);
            if (el) { name = el.name; type = typeName; break; }
          }
          const directProps = data?.properties ?? {};
          newRows.push({
            key: `${modelId}:${eid}`,
            modelId,
            modelName: model.name,
            expressId: eid,
            name,
            type,
            globalId: String(directProps["GlobalId"] ?? ""),
            directProps,
            psets: data?.psets ?? [],
          });
        }
      }

      if (cancelled) return;

      // Build property columns — exclude GlobalId (already an info col)
      const directSet = new Set<string>();
      const psetMap   = new Map<string, Set<string>>();

      for (const row of newRows) {
        for (const k of Object.keys(row.directProps)) {
          if (k !== "type" && k !== "GlobalId") directSet.add(k);
        }
        for (const pset of row.psets) {
          if (!psetMap.has(pset.name)) psetMap.set(pset.name, new Set());
          for (const prop of pset.properties) psetMap.get(pset.name)!.add(prop.name);
        }
      }

      const cols: EditorCol[] = [];
      const seen = new Set<string>();
      for (const k of [...PRIO_DIRECT.filter(k => k !== "GlobalId"), ...Array.from(directSet).sort()]) {
        if (directSet.has(k) && !seen.has(k)) {
          seen.add(k);
          cols.push({ key: k, label: k, group: "Direkte Attribute" });
        }
      }
      for (const [psetName, propNames] of psetMap) {
        for (const propName of Array.from(propNames).sort()) {
          cols.push({ key: `${psetName}.${propName}`, label: propName, group: psetName });
        }
      }

      setRows(newRows);
      setColumns(cols);
      setLoading(false);
    }

    load().catch((err) => {
      if (!cancelled) { setLoadMsg(`Fehler: ${err}`); setLoading(false); }
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cell value helper ─────────────────────────────────────────────────────

  const getCellValue = useCallback((row: EditorRow, colKey: string): string => {
    if (colKey.includes(".")) {
      const dot      = colKey.indexOf(".");
      const psetName = colKey.slice(0, dot);
      const propName = colKey.slice(dot + 1);
      const pset     = row.psets.find((p) => p.name === psetName);
      const prop     = pset?.properties.find((p) => p.name === propName);
      return prop ? String(prop.value ?? "") : "";
    }
    const val = row.directProps[colKey];
    return val != null ? String(val) : "";
  }, []);

  // ── XLSX Export ───────────────────────────────────────────────────────────

  function handleExport() {
    setExporting(true);
    try {
      // propColKeys excludes GlobalId (it's already in INFO_COLS as the key)
      const propColKeys = columns.map((c) => c.key);
      const header = [...INFO_COLS, ...propColKeys];

      const sheetData: unknown[][] = [header];

      for (const row of rows) {
        sheetData.push([
          row.globalId,
          row.type,
          row.modelName,
          ...propColKeys.map((k) => {
            let raw: unknown;
            if (k.includes(".")) {
              const dot  = k.indexOf(".");
              const pset = row.psets.find((p) => p.name === k.slice(0, dot));
              raw = pset?.properties.find((p) => p.name === k.slice(dot + 1))?.value ?? null;
            } else {
              raw = row.directProps[k] ?? null;
            }
            if (typeof raw === "number" || typeof raw === "boolean") return raw;
            return raw != null ? String(raw) : "";
          }),
        ]);
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      ws["!cols"] = header.map((h) => ({
        wch: h === "GlobalId" ? 26 : h === "Name" ? 30 : h === "Modell" ? 22 : 18,
      }));
      // Freeze first row (header) and first column (GlobalId key)
      ws["!freeze"] = { xSplit: 1, ySplit: 1 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "InfraCore Eigenschaften");
      XLSX.writeFile(wb, "auswahlkorb_eigenschaften.xlsx");
    } finally {
      setExporting(false);
    }
  }

  // ── XLSX Import ───────────────────────────────────────────────────────────

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportResult(null);
    setImportError(null);

    try {
      const data = await file.arrayBuffer();
      const wb   = XLSX.read(data, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Keine Tabelle in der Datei gefunden.");

      const xlsxRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
        raw: false,  // all values as strings → predictable comparison
      });

      if (xlsxRows.length === 0) throw new Error("Die Tabelle ist leer.");

      // GUID → EditorRow lookup
      const guidIndex = new Map<string, EditorRow>();
      for (const row of rows) {
        if (row.globalId) guidIndex.set(row.globalId, row);
      }

      const edits: Array<{ modelId: string; expressId: number; key: string; value: string }> = [];
      const notFound: string[] = [];
      let skipped = 0;

      for (const xlsxRow of xlsxRows) {
        const guid = String(xlsxRow["GlobalId"] ?? "").trim();
        if (!guid) { skipped++; continue; }

        const match = guidIndex.get(guid);
        if (!match) { notFound.push(guid); continue; }

        for (const [colKey, rawValue] of Object.entries(xlsxRow)) {
          // Skip the fixed info columns — they are not editable properties
          if (SKIP_COLS.has(colKey)) continue;

          const newVal   = String(rawValue ?? "").trim();
          const original = getCellValue(match, colKey).trim();

          if (newVal !== original) {
            edits.push({
              modelId:   match.modelId,
              expressId: match.expressId,
              key:       colKey,
              value:     newVal,
            });
          }
        }
      }

      if (edits.length > 0) applyPropertyEdits(edits);

      const appliedElements = new Set(edits.map((e) => `${e.modelId}:${e.expressId}`)).size;
      setImportResult({ applied: appliedElements, skipped, notFound, edits });
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── IFC export after import ───────────────────────────────────────────────

  async function handleExportIFC() {
    if (!importResult || importResult.edits.length === 0) return;
    setIfcExporting(true);
    try {
      const byModel = new Map<string, Map<number, Record<string, { value: string }>>>();
      for (const { modelId, expressId, key, value } of importResult.edits) {
        if (!byModel.has(modelId)) byModel.set(modelId, new Map());
        const eidMap = byModel.get(modelId)!;
        eidMap.set(expressId, { ...(eidMap.get(expressId) ?? {}), [key]: { value } });
      }
      for (const [modelId, eidMap] of byModel) {
        const model = models.get(modelId);
        if (!model?.file) continue;
        const overrides = Array.from(eidMap.entries()).map(([expressId, ov]) => ({ expressId, overrides: ov }));
        const result = await writeIFCWithOverrides(model.file, overrides);
        downloadFile(result, model.name.replace(/\.ifc$/i, "") + "_bearbeitet.ifc");
      }
    } finally {
      setIfcExporting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const hasImportedChanges = (importResult?.edits.length ?? 0) > 0;

  const inner = (
    <div
      className={mode === "window"
        ? "flex flex-col h-full w-full bg-card overflow-hidden"
        : "flex flex-col w-full max-w-[92vw] h-[85vh] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
      }
      onMouseDown={(e) => e.stopPropagation()}
    >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <Table2 size={16} className="text-primary shrink-0" />
          <span className="font-semibold text-sm">Eigenschaften-Export / -Import</span>
          <span className="text-xs text-muted-foreground">
            — {selectionBasket.size} {selectionBasket.size === 1 ? "Element" : "Elemente"}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Action bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 bg-muted/30 flex-wrap">
          <button
            onClick={handleExport}
            disabled={loading || rows.length === 0 || exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Als XLSX exportieren
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || rows.length === 0 || importing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            XLSX importieren
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
          />

          {hasImportedChanges && (
            <button
              onClick={handleExportIFC}
              disabled={ifcExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 disabled:opacity-40 transition-colors"
              title="Modifizierte IFC-Datei(en) herunterladen"
            >
              {ifcExporting ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
              Als IFC exportieren
            </button>
          )}

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
            <Info size={11} />
            <span>
              Spalte <code className="font-mono bg-muted px-1 rounded">GlobalId</code> nicht ändern — Schlüssel für den Abgleich
            </span>
          </div>
        </div>

        {/* ── Import result / error ─────────────────────────────────────────── */}
        {(importResult || importError) && (
          <div className={cn(
            "flex items-start gap-2 px-4 py-2 text-xs shrink-0 border-b border-border",
            importError ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-400"
          )}>
            {importError ? (
              <><TriangleAlert size={13} className="mt-px shrink-0" /><span>{importError}</span></>
            ) : importResult && (
              <>
                <Check size={13} className="mt-px shrink-0" />
                <span>
                  {importResult.applied > 0
                    ? `${importResult.applied} Element${importResult.applied !== 1 ? "e" : ""} mit Änderungen — in Eigenschaften-Panel sichtbar`
                    : "Keine Änderungen erkannt"}
                  {importResult.skipped > 0 && ` · ${importResult.skipped} Zeile${importResult.skipped !== 1 ? "n" : ""} übersprungen`}
                  {importResult.notFound.length > 0 && ` · ${importResult.notFound.length} GlobalId nicht gefunden`}
                </span>
              </>
            )}
          </div>
        )}

        {/* ── Preview table ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 size={22} className="animate-spin text-primary" />
              <span className="text-sm">{loadMsg || "Lade Eigenschaften …"}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Keine Elemente im Auswahlkorb.
            </div>
          ) : (
            <table className="text-xs border-collapse min-w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  {/* Info / key columns */}
                  {(["GlobalId", "Typ", "Modell"] as const).map((col, i) => (
                    <th
                      key={col}
                      className={cn(
                        "sticky z-20 bg-muted border-b border-r border-border px-3 py-1.5 text-left font-medium whitespace-nowrap",
                        col === "GlobalId" && "text-primary/80"
                      )}
                      style={{
                        left:     [0, 220, 360][i],
                        minWidth: [220, 140, 160][i],
                        width:    [220, 140, 160][i],
                      }}
                    >
                      {col === "GlobalId" ? "🔑 GlobalId" : col}
                    </th>
                  ))}
                  {/* Property columns */}
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      title={col.key}
                      className="bg-muted border-b border-r border-border px-3 py-1.5 text-left font-medium whitespace-nowrap"
                      style={{ minWidth: 150, width: 150 }}
                    >
                      <div className="truncate max-w-[140px]">{col.label}</div>
                      {col.group !== "Direkte Attribute" && (
                        <div className="text-[10px] text-muted-foreground/60 truncate max-w-[140px]">{col.group}</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.key} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    {[row.globalId, row.type, row.modelName].map((val, i) => (
                      <td
                        key={i}
                        className={cn(
                          "sticky z-10 border-b border-r border-border/40 px-3 py-1.5 truncate",
                          ri % 2 === 0 ? "bg-background" : "bg-muted/20",
                          i === 0 && "font-mono text-[10px] text-primary/70"
                        )}
                        style={{
                          left:     [0, 220, 360][i],
                          minWidth: [220, 140, 160][i],
                          maxWidth: [220, 140, 160][i],
                        }}
                        title={val}
                      >
                        {val}
                      </td>
                    ))}
                    {columns.map((col) => {
                      const val = getCellValue(row, col.key);
                      return (
                        <td
                          key={col.key}
                          className="border-b border-r border-border/40 px-3 py-1.5 text-foreground/70 truncate"
                          style={{ minWidth: 150, maxWidth: 150 }}
                          title={val}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border shrink-0 text-xs text-muted-foreground">
          <span className="flex-1">
            {!loading && rows.length > 0 &&
              `${rows.length} Element${rows.length !== 1 ? "e" : ""} · ${columns.length} Eigenschaft${columns.length !== 1 ? "en" : ""}`
            }
          </span>
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-muted/60 transition-colors">
            Schließen
          </button>
        </div>
      </div>
  );

  if (mode === "window") return inner;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-sm bg-black/60">
      {inner}
    </div>
  );
}
