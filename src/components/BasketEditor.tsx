import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { X, Download, Upload, Table2, Loader2, Check, TriangleAlert, Info } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { loadBasketProperties } from "../utils/ifcLoader";
import type { PropertySet } from "../types/ifc";

// ── Types ────────────────────────────────────────────────────────────────────

interface EditorRow {
  key: string;           // "modelId:expressId"
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
}

// Fixed info columns that are always first in the sheet
const INFO_COLS = ["GlobalId", "Name", "Typ", "Modell"];
const PRIO_DIRECT = ["Name", "Description", "ObjectType", "Tag", "GlobalId"];

// ── Component ────────────────────────────────────────────────────────────────

export function BasketEditor({ onClose }: { onClose: () => void }) {
  const models             = useModelStore((s) => s.models);
  const selectionBasket    = useModelStore((s) => s.selectionBasket);
  const applyPropertyEdits = useModelStore((s) => s.applyPropertyEdits);

  const [rows, setRows]             = useState<EditorRow[]>([]);
  const [columns, setColumns]       = useState<EditorCol[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadMsg, setLoadMsg]       = useState("");
  const [exporting, setExporting]   = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError]   = useState<string | null>(null);
  const [importing, setImporting]       = useState(false);

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

      // Build property columns
      const directSet = new Set<string>();
      const psetMap   = new Map<string, Set<string>>();

      for (const row of newRows) {
        for (const k of Object.keys(row.directProps)) {
          if (k !== "type") directSet.add(k);
        }
        for (const pset of row.psets) {
          if (!psetMap.has(pset.name)) psetMap.set(pset.name, new Set());
          for (const prop of pset.properties) psetMap.get(pset.name)!.add(prop.name);
        }
      }

      const cols: EditorCol[] = [];
      const seen = new Set<string>();
      for (const k of [...PRIO_DIRECT, ...Array.from(directSet).sort()]) {
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
      // Header row: info cols first, then all property cols
      const propColKeys = columns.map((c) => c.key);
      const header = [...INFO_COLS, ...propColKeys];

      const sheetData: unknown[][] = [header];

      for (const row of rows) {
        const cells: unknown[] = [
          row.globalId,
          row.name,
          row.type,
          row.modelName,
          ...propColKeys.map((k) => {
            const raw = k.includes(".")
              ? (() => {
                  const dot = k.indexOf(".");
                  const pset = row.psets.find((p) => p.name === k.slice(0, dot));
                  return pset?.properties.find((p) => p.name === k.slice(dot + 1))?.value ?? null;
                })()
              : (row.directProps[k] ?? null);
            // Return native number/boolean when possible
            if (typeof raw === "number" || typeof raw === "boolean") return raw;
            return raw != null ? String(raw) : "";
          }),
        ];
        sheetData.push(cells);
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Column widths
      ws["!cols"] = header.map((h) => ({
        wch: h === "GlobalId" ? 24 : h === "Name" ? 28 : h === "Modell" ? 20 : 18,
      }));

      // Freeze first row + first column (GlobalId as key)
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

      // sheet_to_json maps header row → object keys
      const xlsxRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
        raw: false,   // all values as strings for predictable comparison
      });

      if (xlsxRows.length === 0) throw new Error("Die Tabelle ist leer.");

      // Build GUID → row lookup from currently loaded basket data
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
        if (!match) {
          notFound.push(guid);
          continue;
        }

        // Compare each property column value
        for (const [colKey, rawValue] of Object.entries(xlsxRow)) {
          if (INFO_COLS.includes(colKey)) continue; // skip non-editable info cols
          const newVal   = String(rawValue ?? "").trim();
          const original = getCellValue(match, colKey).trim();
          if (newVal !== original) {
            edits.push({ modelId: match.modelId, expressId: match.expressId, key: colKey, value: newVal });
          }
        }
      }

      if (edits.length > 0) applyPropertyEdits(edits);

      const appliedElements = new Set(edits.map((e) => `${e.modelId}:${e.expressId}`)).size;
      setImportResult({ applied: appliedElements, skipped, notFound });
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/60">
      <div
        className="flex flex-col w-full max-w-[92vw] h-[85vh] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
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
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0 bg-muted/30">
          {/* Export */}
          <button
            onClick={handleExport}
            disabled={loading || rows.length === 0 || exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Alle Eigenschaften als XLSX herunterladen"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Als XLSX exportieren
          </button>

          {/* Import */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || rows.length === 0 || importing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Geänderte XLSX importieren (Matching per GlobalId)"
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

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
            <Info size={11} />
            <span>Spalte <code className="font-mono bg-muted px-1 rounded">GlobalId</code> nicht ändern — wird als Schlüssel verwendet</span>
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
                    ? `${importResult.applied} Element${importResult.applied !== 1 ? "e" : ""} aktualisiert`
                    : "Keine Änderungen festgestellt"}
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
                  {/* Frozen info cols */}
                  {INFO_COLS.map((col, i) => (
                    <th
                      key={col}
                      className={cn(
                        "sticky z-20 bg-muted border-b border-r border-border px-3 py-1.5 text-left font-medium whitespace-nowrap",
                        col === "GlobalId" && "text-primary/80"
                      )}
                      style={{
                        left: [0, 200, 330, 460][i],
                        minWidth: [200, 130, 130, 160][i],
                        width:    [200, 130, 130, 160][i],
                      }}
                    >
                      {col === "GlobalId" ? "🔑 GlobalId" : col}
                    </th>
                  ))}
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
                    {/* Info cells (sticky) */}
                    {[row.globalId, row.name, row.type, row.modelName].map((val, i) => (
                      <td
                        key={i}
                        className={cn(
                          "sticky z-10 border-b border-r border-border/40 px-3 py-1.5 truncate",
                          ri % 2 === 0 ? "bg-background" : "bg-muted/20",
                          i === 0 && "font-mono text-[10px] text-primary/70"
                        )}
                        style={{
                          left: [0, 200, 330, 460][i],
                          minWidth: [200, 130, 130, 160][i],
                          maxWidth: [200, 130, 130, 160][i],
                        }}
                        title={val}
                      >
                        {val}
                      </td>
                    ))}
                    {/* Property cells */}
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
            {!loading && rows.length > 0 && (
              `${rows.length} Element${rows.length !== 1 ? "e" : ""} · ${columns.length} Eigenschaft${columns.length !== 1 ? "en" : ""}`
            )}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded hover:bg-muted/60 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
