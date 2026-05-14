import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Download, FileDown, Table2, Loader2, Check, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { loadBasketProperties } from "../utils/ifcLoader";
import { writeIFCWithOverrides, downloadFile } from "../utils/ifcWriter";
import type { PropertySet } from "../types/ifc";

// ── Types ────────────────────────────────────────────────────────────────────

interface EditorRow {
  key: string;           // "modelId:expressId"
  modelId: string;
  modelName: string;
  expressId: number;
  name: string;
  type: string;
  directProps: Record<string, unknown>;
  psets: PropertySet[];
}

interface EditorCol {
  key: string;    // "AttrName" or "PsetName.PropName"
  label: string;  // short label (part after last ".")
  group: string;  // "Direkte Attribute" or pset name
}

interface ColGroup {
  label: string;
  span: number;
  sticky?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const COL_W_NAME   = 200;
const COL_W_TYPE   = 130;
const COL_W_MODEL  = 160;
const COL_W_PROP   = 160;
const FROZEN_COLS  = 3;
const FROZEN_W     = COL_W_NAME + COL_W_TYPE + COL_W_MODEL;

const PRIO_DIRECT = ["Name", "Description", "ObjectType", "Tag", "GlobalId"];

// ── Component ────────────────────────────────────────────────────────────────

export function BasketEditor({ onClose }: { onClose: () => void }) {
  const models          = useModelStore((s) => s.models);
  const selectionBasket = useModelStore((s) => s.selectionBasket);
  const applyPropertyEdits = useModelStore((s) => s.applyPropertyEdits);

  const [rows, setRows]                 = useState<EditorRow[]>([]);
  const [columns, setColumns]           = useState<EditorCol[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadMsg, setLoadMsg]           = useState("");
  const [edits, setEdits]               = useState<Map<string, string>>(new Map());
  const [editingCell, setEditingCell]   = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue]       = useState("");
  const [exporting, setExporting]       = useState(false);
  const [saved, setSaved]               = useState(false);
  const [exportError, setExportError]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Group basket keys by model
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
          newRows.push({
            key: `${modelId}:${eid}`,
            modelId,
            modelName: model.name,
            expressId: eid,
            name,
            type,
            directProps: data?.properties ?? {},
            psets: data?.psets ?? [],
          });
        }
      }

      if (cancelled) return;

      // ── Build columns ──────────────────────────────────────────────────────
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
      const seenDirect = new Set<string>();
      for (const k of [...PRIO_DIRECT, ...Array.from(directSet).sort()]) {
        if (directSet.has(k) && !seenDirect.has(k)) {
          seenDirect.add(k);
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

  // Auto-focus input when editing starts
  useEffect(() => {
    if (editingCell) inputRef.current?.focus();
  }, [editingCell]);

  // ── Column groups for header ──────────────────────────────────────────────

  const colGroups = useMemo<ColGroup[]>(() => {
    const groups: ColGroup[] = [
      { label: "Element", span: FROZEN_COLS, sticky: true },
    ];
    let i = 0;
    while (i < columns.length) {
      const g = columns[i].group;
      let span = 0;
      while (i + span < columns.length && columns[i + span].group === g) span++;
      groups.push({ label: g, span });
      i += span;
    }
    return groups;
  }, [columns]);

  // ── Cell helpers ──────────────────────────────────────────────────────────

  const getOriginalValue = useCallback((row: EditorRow, colKey: string): string => {
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

  const getCellValue = useCallback((row: EditorRow, colKey: string): string => {
    const editKey = `${row.key}:${colKey}`;
    return edits.has(editKey) ? edits.get(editKey)! : getOriginalValue(row, colKey);
  }, [edits, getOriginalValue]);

  const isEdited = useCallback((row: EditorRow, colKey: string) =>
    edits.has(`${row.key}:${colKey}`), [edits]);

  // ── Edit lifecycle ────────────────────────────────────────────────────────

  function startEdit(row: EditorRow, colKey: string) {
    setEditingCell({ rowKey: row.key, colKey });
    setEditValue(getCellValue(row, colKey));
  }

  function commitEdit() {
    if (!editingCell) return;
    const editKey = `${editingCell.rowKey}:${editingCell.colKey}`;
    const row = rows.find((r) => r.key === editingCell.rowKey);
    const original = row ? getOriginalValue(row, editingCell.colKey) : "";
    setEdits((prev) => {
      const next = new Map(prev);
      if (editValue === original) {
        next.delete(editKey); // revert to original
      } else {
        next.set(editKey, editValue);
      }
      return next;
    });
    setEditingCell(null);
  }

  function cancelEdit() { setEditingCell(null); }

  function handleCellKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") cancelEdit();
    if (e.key === "Tab")   { e.preventDefault(); commitEdit(); }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleApply() {
    const editList: Array<{ modelId: string; expressId: number; key: string; value: string }> = [];
    for (const [editKey, value] of edits) {
      const row = rows.find((r) => editKey.startsWith(r.key + ":"));
      if (!row) continue;
      const colKey = editKey.slice(row.key.length + 1);
      editList.push({ modelId: row.modelId, expressId: row.expressId, key: colKey, value });
    }
    applyPropertyEdits(editList);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleExportIFC() {
    setExporting(true);
    setExportError(null);
    try {
      // Group edits by modelId → expressId
      const byModel = new Map<string, Map<number, Record<string, string>>>();
      for (const [editKey, value] of edits) {
        const row = rows.find((r) => editKey.startsWith(r.key + ":"));
        if (!row) continue;
        const colKey = editKey.slice(row.key.length + 1);
        if (!byModel.has(row.modelId)) byModel.set(row.modelId, new Map());
        const eidMap = byModel.get(row.modelId)!;
        eidMap.set(row.expressId, { ...(eidMap.get(row.expressId) ?? {}), [colKey]: value });
      }

      for (const [modelId, eidMap] of byModel) {
        const model = models.get(modelId);
        if (!model?.file) continue;
        const elementOverrides = Array.from(eidMap.entries()).map(([expressId, overrides]) => ({
          expressId,
          overrides,
        }));
        const result = await writeIFCWithOverrides(model.file, elementOverrides);
        const baseName = model.name.replace(/\.ifc$/i, "");
        downloadFile(result, `${baseName}_bearbeitet.ifc`);
      }
    } catch (err) {
      setExportError(String(err));
    } finally {
      setExporting(false);
    }
  }

  function handleExportCSV() {
    const infoHeader = ["Name", "Typ", "Modell"];
    const propHeader = columns.map((c) => c.key);
    const header     = [...infoHeader, ...propHeader];

    const csvRows = rows.map((row) => {
      const cells = [
        row.name,
        row.type,
        row.modelName,
        ...columns.map((c) => getCellValue(row, c.key)),
      ];
      return cells.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });

    const csv  = [header.join(","), ...csvRows].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "auswahlkorb_eigenschaften.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const editCount = edits.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/60">
      <div
        className="flex flex-col w-full max-w-[96vw] h-[88vh] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-card/95">
          <Table2 size={16} className="text-primary shrink-0" />
          <span className="font-semibold text-sm">Eigenschaften bearbeiten</span>
          <span className="text-xs text-muted-foreground">
            — {selectionBasket.size} {selectionBasket.size === 1 ? "Element" : "Elemente"}
          </span>

          {editCount > 0 && (
            <span className="ml-1 text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
              {editCount} Änderung{editCount !== 1 ? "en" : ""}
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Schließen"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto relative">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 size={24} className="animate-spin text-primary" />
              <span className="text-sm">{loadMsg || "Lade Eigenschaften …"}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Keine Elemente im Auswahlkorb.
            </div>
          ) : (
            <table className="text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                {/* ── Group row ──────────────────────────────────────────────── */}
                <tr>
                  {colGroups.map((g, gi) => (
                    <th
                      key={gi}
                      colSpan={g.span}
                      className={cn(
                        "border-b border-r border-border/60 px-2 py-1 text-center font-semibold text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/50",
                        g.sticky && "sticky left-0 z-30"
                      )}
                      style={g.sticky ? { minWidth: FROZEN_W } : undefined}
                    >
                      {g.label}
                    </th>
                  ))}
                </tr>

                {/* ── Column name row ────────────────────────────────────────── */}
                <tr>
                  <th
                    className="sticky left-0 z-30 bg-muted border-b border-r border-border text-left px-3 py-1.5 font-medium whitespace-nowrap"
                    style={{ minWidth: COL_W_NAME, width: COL_W_NAME }}
                  >
                    Name
                  </th>
                  <th
                    className="sticky z-30 bg-muted border-b border-r border-border text-left px-3 py-1.5 font-medium whitespace-nowrap"
                    style={{ left: COL_W_NAME, minWidth: COL_W_TYPE, width: COL_W_TYPE }}
                  >
                    Typ
                  </th>
                  <th
                    className="sticky z-30 bg-muted border-b border-r border-border text-left px-3 py-1.5 font-medium whitespace-nowrap"
                    style={{ left: COL_W_NAME + COL_W_TYPE, minWidth: COL_W_MODEL, width: COL_W_MODEL }}
                  >
                    Modell
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="bg-muted border-b border-r border-border text-left px-3 py-1.5 font-medium whitespace-nowrap"
                      style={{ minWidth: COL_W_PROP, width: COL_W_PROP }}
                      title={col.key}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.key} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    {/* ── Frozen: Name ─────────────────────────────────────── */}
                    <td
                      className={cn(
                        "sticky left-0 z-10 border-b border-r border-border/40 px-3 py-1.5 font-medium truncate",
                        ri % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                      style={{ minWidth: COL_W_NAME, maxWidth: COL_W_NAME }}
                      title={row.name}
                    >
                      {row.name}
                    </td>

                    {/* ── Frozen: Typ ──────────────────────────────────────── */}
                    <td
                      className={cn(
                        "sticky z-10 border-b border-r border-border/40 px-3 py-1.5 text-muted-foreground truncate",
                        ri % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                      style={{ left: COL_W_NAME, minWidth: COL_W_TYPE, maxWidth: COL_W_TYPE }}
                    >
                      {row.type}
                    </td>

                    {/* ── Frozen: Modell ───────────────────────────────────── */}
                    <td
                      className={cn(
                        "sticky z-10 border-b border-r border-border/40 px-3 py-1.5 text-muted-foreground truncate",
                        ri % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                      style={{ left: COL_W_NAME + COL_W_TYPE, minWidth: COL_W_MODEL, maxWidth: COL_W_MODEL }}
                      title={row.modelName}
                    >
                      {row.modelName}
                    </td>

                    {/* ── Property columns ─────────────────────────────────── */}
                    {columns.map((col) => {
                      const isActive =
                        editingCell?.rowKey === row.key && editingCell?.colKey === col.key;
                      const edited = isEdited(row, col.key);
                      const display = getCellValue(row, col.key);

                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "border-b border-r border-border/40 px-0 py-0 cursor-text select-none",
                            edited && !isActive && "bg-amber-500/10"
                          )}
                          style={{ minWidth: COL_W_PROP, maxWidth: COL_W_PROP }}
                          onDoubleClick={() => startEdit(row, col.key)}
                        >
                          {isActive ? (
                            <input
                              ref={inputRef}
                              className="w-full h-full px-3 py-1.5 bg-primary/10 border border-primary outline-none text-xs"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={handleCellKeyDown}
                              onBlur={commitEdit}
                            />
                          ) : (
                            <div
                              className={cn(
                                "px-3 py-1.5 truncate",
                                edited ? "text-amber-400" : "text-foreground/80"
                              )}
                              title={display}
                            >
                              {display}
                            </div>
                          )}
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
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0 bg-card/95">
          <span className="text-xs text-muted-foreground flex-1">
            {!loading && (
              <>
                {rows.length} Element{rows.length !== 1 ? "e" : ""}
                {columns.length > 0 && ` · ${columns.length} Spalte${columns.length !== 1 ? "n" : ""}`}
                {editCount > 0 && ` · ${editCount} Änderung${editCount !== 1 ? "en" : ""}`}
              </>
            )}
            {exportError && (
              <span className="text-destructive ml-2 flex items-center gap-1">
                <TriangleAlert size={12} /> {exportError}
              </span>
            )}
          </span>

          {/* Apply to session */}
          <button
            onClick={handleApply}
            disabled={editCount === 0 || loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
              saved
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
            )}
            title="Änderungen in der Sitzung übernehmen"
          >
            {saved ? <Check size={12} /> : <Check size={12} />}
            {saved ? "Übernommen" : "Übernehmen"}
          </button>

          {/* Export IFC */}
          <button
            onClick={handleExportIFC}
            disabled={editCount === 0 || loading || exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Geänderte IFC-Datei(en) herunterladen"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
            Als IFC exportieren
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            disabled={loading || rows.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Als CSV exportieren"
          >
            <Download size={12} />
            CSV
          </button>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
