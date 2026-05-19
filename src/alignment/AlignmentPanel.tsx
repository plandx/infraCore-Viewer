import { useRef, useState, useCallback } from "react";
import {
  Navigation2,
  Eye,
  EyeOff,
  X,
  Upload,
  ChevronDown,
  ChevronRight,
  Ruler,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAlignmentStore } from "./alignmentStore";
import { evaluateProfile } from "./landXmlParser";
import { AlignmentAnnotations } from "./AlignmentAnnotations";
import type { Alignment } from "./types";

function formatStation(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m  = sta - km * 1000;
  return `${km}+${m.toFixed(3).padStart(7, "0")}`;
}

function formatLength(len: number): string {
  return len.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
}

function niceStep(range: number, maxTicks = 6): number {
  const raw = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n   = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

// ── Profile chart ─────────────────────────────────────────────────────────────
interface ProfileChartProps {
  alignment: Alignment;
  color: string;
}

function ProfileChart({ alignment, color }: ProfileChartProps) {
  const { profileGeom, staStart, staEnd } = alignment;
  if (profileGeom.vertices.length < 2) {
    return <p className="text-xs text-muted-foreground italic px-1 mt-1">Kein Profil verfügbar</p>;
  }

  const W = 288, H = 140;
  const PL = 38, PR = 8, PT = 8, PB = 24;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const staRange = staEnd - staStart;
  if (staRange <= 0) return null;

  // Sample profile at display stations directly — profile vertex sta values are
  // already in display station format, so no internal conversion needed.
  const N = 200;
  const pts: { sta: number; elev: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const sta  = staStart + (i / N) * staRange;
    const elev = evaluateProfile(profileGeom, sta);
    if (elev !== null) pts.push({ sta, elev });
  }
  if (pts.length < 2) {
    return <p className="text-xs text-muted-foreground italic px-1 mt-1">Kein Profil verfügbar</p>;
  }

  const elevs  = pts.map(p => p.elev);
  const eMin   = Math.min(...elevs);
  const eMax   = Math.max(...elevs);
  const eRange = eMax - eMin || 1;
  const ePad   = eRange * 0.12;
  const yMin   = eMin - ePad;
  const yMax   = eMax + ePad;
  const yRange = yMax - yMin;

  const toX = (sta: number)  => PL + ((sta - staStart) / staRange) * chartW;
  const toY = (elev: number) => PT + (1 - (elev - yMin) / yRange) * chartH;

  const pathD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.sta).toFixed(1)},${toY(p.elev).toFixed(1)}`)
    .join(" ");

  const xStep = niceStep(staRange, 5);
  const xTicks: number[] = [];
  for (let s = Math.ceil(staStart / xStep) * xStep; s <= staEnd + 1e-9; s += xStep) xTicks.push(s);

  const yStep = niceStep(yRange, 4);
  const yTicks: number[] = [];
  for (let e = Math.ceil(yMin / yStep) * yStep; e <= yMax + 1e-9; e += yStep) yTicks.push(e);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} aria-label="Längsprofil">
      {yTicks.map(elev => {
        const sy = toY(elev);
        if (sy < PT - 1 || sy > PT + chartH + 1) return null;
        return (
          <g key={elev}>
            <line x1={PL} y1={sy} x2={PL + chartW} y2={sy} stroke="#3f3f46" strokeWidth={0.5} />
            <text x={PL - 3} y={sy + 3.5} textAnchor="end" fontSize={8} fill="#a1a1aa">
              {elev.toFixed(0)}
            </text>
          </g>
        );
      })}

      {xTicks.map(sta => {
        const sx = toX(sta);
        if (sx < PL - 1 || sx > PL + chartW + 1) return null;
        return (
          <g key={sta}>
            <line x1={sx} y1={PT} x2={sx} y2={PT + chartH} stroke="#3f3f46" strokeWidth={0.5} />
            <text x={sx} y={PT + chartH + 12} textAnchor="middle" fontSize={7.5} fill="#a1a1aa">
              {formatStation(sta)}
            </text>
          </g>
        );
      })}

      <rect x={PL} y={PT} width={chartW} height={chartH} fill="none" stroke="#52525b" strokeWidth={0.5} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />

      {profileGeom.vertices.map((v, i) => {
        const sx = toX(v.sta), sy = toY(v.elev);
        if (sx < PL || sx > PL + chartW || sy < PT || sy > PT + chartH) return null;
        return <circle key={i} cx={sx} cy={sy} r={2} fill={color} opacity={0.8} />;
      })}
    </svg>
  );
}

// ── Alignment row ─────────────────────────────────────────────────────────────
interface AlignmentRowProps {
  alignment: Alignment;
  color: string;
  visible: boolean;
  selected: boolean;
  onToggleVisible: () => void;
  onSelect: () => void;
}

function AlignmentRow({ alignment, color, visible, selected, onToggleVisible, onSelect }: AlignmentRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs select-none",
        selected ? "bg-muted" : "hover:bg-muted/50"
      )}
      onClick={onSelect}
    >
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={e => { e.stopPropagation(); onToggleVisible(); }}
        aria-label={visible ? "Ausblenden" : "Einblenden"}
      >
        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      <span className="shrink-0 w-2.5 h-2.5 rounded-full border border-border" style={{ backgroundColor: color }} />
      <span className="flex-1 truncate">{alignment.displayName}</span>
      <span className="text-muted-foreground shrink-0">{formatLength(alignment.length)}</span>
      {alignment.zSource === "profile"    && <span className="text-sky-400   text-[10px] font-mono shrink-0">Z</span>}
      {alignment.zSource === "coordgeom" && <span className="text-yellow-400 text-[10px] font-mono shrink-0">Z?</span>}
    </div>
  );
}

// ── File group ────────────────────────────────────────────────────────────────
interface FileGroupProps {
  fileId: string;
  fileName: string;
  alignments: Alignment[];
  colors: Record<number, string>;
  visibleIds: Set<number>;
  selectedId: number | null;
  onRemove: () => void;
  onToggleVisible: (id: number) => void;
  onSelect: (id: number | null) => void;
}

function FileGroup({ fileId, fileName, alignments, colors, visibleIds, selectedId, onRemove, onToggleVisible, onSelect }: FileGroupProps) {
  const [expanded, setExpanded] = useState(true);
  void fileId;
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground select-none">
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setExpanded(e => !e)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="flex-1 truncate font-medium text-foreground">{fileName}</span>
        <button className="text-muted-foreground hover:text-red-400 ml-auto" onClick={onRemove} aria-label="Datei entfernen">
          <X size={12} />
        </button>
      </div>
      {expanded && (
        <div className="pl-2">
          {alignments.map(align => (
            <AlignmentRow
              key={align.id}
              alignment={align}
              color={colors[align.id] ?? "#888"}
              visible={visibleIds.has(align.id)}
              selected={selectedId === align.id}
              onToggleVisible={() => onToggleVisible(align.id)}
              onSelect={() => onSelect(selectedId === align.id ? null : align.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function AlignmentPanel() {
  const files          = useAlignmentStore(s => s.files);
  const selectedId     = useAlignmentStore(s => s.selectedId);
  const visibleIds     = useAlignmentStore(s => s.visibleIds);
  const colors         = useAlignmentStore(s => s.colors);
  const loadFile       = useAlignmentStore(s => s.loadFile);
  const removeFile     = useAlignmentStore(s => s.removeFile);
  const toggleVisible  = useAlignmentStore(s => s.toggleVisible);
  const selectAlignment = useAlignmentStore(s => s.selectAlignment);

  const sampleInterval    = useAlignmentStore(s => s.sampleInterval);
  const stationToolActive = useAlignmentStore(s => s.stationToolActive);
  const hoveredStation    = useAlignmentStore(s => s.hoveredStation);
  const setSampleInterval = useAlignmentStore(s => s.setSampleInterval);
  const toggleStationTool = useAlignmentStore(s => s.toggleStationTool);

  const inputRef  = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    for (const f of Array.from(fileList)) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".xml") || lower.endsWith(".landxml")) void loadFile(f);
    }
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const allAlignments  = files.flatMap(f => f.alignments);
  const selectedAlign  = selectedId !== null ? allAlignments.find(a => a.id === selectedId) : null;
  const segmentCounts  = selectedAlign
    ? {
        lines:   selectedAlign.segments.filter(s => s.type === "Line").length,
        curves:  selectedAlign.segments.filter(s => s.type === "Curve").length,
        spirals: selectedAlign.segments.filter(s => s.type === "Transition").length,
      }
    : null;

  return (
    <div className="h-full flex flex-col bg-card text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Navigation2 size={15} className="text-sky-400 shrink-0" />
        <span className="flex-1 text-sm font-semibold">Achsen (LandXML)</span>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0">
        {/* Drop zone */}
        <div className="p-2">
          <div
            className={cn(
              "border-2 border-dashed rounded-md px-3 py-4 flex flex-col items-center gap-1.5 cursor-pointer transition-colors",
              dragOver ? "border-sky-500 bg-sky-950/30" : "border-border hover:border-muted-foreground hover:bg-muted/20"
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === "Enter" && inputRef.current?.click()}
            aria-label="LandXML-Datei laden"
          >
            <Upload size={18} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground text-center">
              LandXML / .xml hier ablegen<br />
              <span className="text-muted-foreground/60">oder klicken zum Durchsuchen</span>
            </span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xml,.landxml"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="px-1 pb-1">
            {files.map(f => (
              <FileGroup
                key={f.id}
                fileId={f.id}
                fileName={f.fileName}
                alignments={f.alignments}
                colors={colors}
                visibleIds={visibleIds}
                selectedId={selectedId}
                onRemove={() => removeFile(f.id)}
                onToggleVisible={toggleVisible}
                onSelect={selectAlignment}
              />
            ))}
          </div>
        )}

        {/* Station tool + resolution toolbar */}
        {files.length > 0 && (
          <div className="px-2 pb-2 border-t border-border pt-2 flex flex-col gap-2">
            {/* Station tool */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleStationTool}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
                  stationToolActive
                    ? "bg-sky-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                <Ruler size={11} />
                Stationierung messen
              </button>
            </div>
            {/* Hovered station display */}
            {stationToolActive && hoveredStation && (
              <div className="bg-muted rounded px-2 py-1 text-xs">
                <span className="text-muted-foreground">{hoveredStation.name}: </span>
                <span className="text-sky-400 font-mono">{formatStation(hoveredStation.station)}</span>
              </div>
            )}
            {stationToolActive && !hoveredStation && (
              <p className="text-xs text-muted-foreground italic">Maus über Achse bewegen…</p>
            )}
            {/* Arc spacing interval */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Auflösung:</span>
              <select
                value={sampleInterval}
                onChange={e => setSampleInterval(Number(e.target.value))}
                className="flex-1 bg-muted border border-border text-foreground text-xs rounded px-1 py-0.5"
              >
                {[1, 2, 5, 10, 25, 50].map(v => (
                  <option key={v} value={v}>{v} m</option>
                ))}
              </select>
            </div>
            {/* Approximation warning */}
            <p className="text-[10px] text-yellow-500 leading-tight">
              ⚠ Übergangskurven werden linear angenähert. Bögen und Geraden sind exakt.
            </p>
          </div>
        )}

        {/* Selected alignment details */}
        {selectedAlign && segmentCounts && (
          <div className="mx-2 mb-2 p-2 bg-muted rounded-md text-xs border border-border">
            <div className="font-semibold truncate mb-1">{selectedAlign.displayName}</div>
            <div className="text-muted-foreground mb-0.5">
              {formatStation(selectedAlign.staStart)} – {formatStation(selectedAlign.staEnd)}
            </div>
            <div className="text-muted-foreground mb-1">Länge: {formatLength(selectedAlign.length)}</div>
            <div className="flex gap-2 text-muted-foreground flex-wrap">
              {segmentCounts.lines   > 0 && <span>{segmentCounts.lines} Gerade{segmentCounts.lines   !== 1 ? "n" : ""}</span>}
              {segmentCounts.curves  > 0 && <span>{segmentCounts.curves} Bogen{segmentCounts.curves  !== 1 ? "bögen" : ""}</span>}
              {segmentCounts.spirals > 0 && <span>{segmentCounts.spirals} Spirale{segmentCounts.spirals !== 1 ? "n" : ""}</span>}
            </div>
            {selectedAlign.zStatus && (
              <div className="mt-1 text-muted-foreground truncate">{selectedAlign.zStatus}</div>
            )}
          </div>
        )}

        {/* Profile chart */}
        {selectedAlign && selectedAlign.profileGeom.vertices.length > 0 && (
          <div className="mx-2 mb-3">
            <div className="text-xs text-muted-foreground font-medium mb-1 px-0.5">Längsprofil</div>
            <ProfileChart alignment={selectedAlign} color={colors[selectedAlign.id] ?? "#42a5f5"} />
          </div>
        )}

        {/* Annotation controls */}
        <AlignmentAnnotations />
      </div>
    </div>
  );
}
