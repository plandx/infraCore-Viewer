import { useRef, useState, useCallback } from "react";
import {
  Navigation2,
  Eye,
  EyeOff,
  X,
  Upload,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAlignmentStore } from "./alignmentStore";
import { evaluateProfile, stationDisplayToInternal } from "./landXmlParser";
import type { Alignment } from "./types";

function formatStation(sta: number): string {
  const km = Math.floor(sta / 1000);
  const m = sta - km * 1000;
  return `${km}+${m.toFixed(0).padStart(3, "0")}`;
}

function formatLength(len: number): string {
  return len.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
}

function niceTickInterval(range: number, maxTicks = 6): number {
  const rawStep = range / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let nice: number;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3.5) nice = 2;
  else if (normalized < 7.5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

interface ProfileChartProps {
  alignment: Alignment;
  color: string;
}

function ProfileChart({ alignment, color }: ProfileChartProps) {
  const { profileGeom, staStart, staEnd, stationEquations } = alignment;

  if (profileGeom.vertices.length < 2) {
    return (
      <p className="text-xs text-zinc-500 italic px-1 mt-1">Kein Profil verfügbar</p>
    );
  }

  const W = 288;
  const H = 140;
  const PL = 38;
  const PR = 8;
  const PT = 8;
  const PB = 24;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const SAMPLE_COUNT = 200;
  const staRange = staEnd - staStart;
  if (staRange <= 0) return null;

  const sampled: { sta: number; elev: number }[] = [];
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const sta = staStart + (i / SAMPLE_COUNT) * staRange;
    const internalSta = stationDisplayToInternal(stationEquations, sta);
    const elev = evaluateProfile(profileGeom, internalSta === sta ? sta : internalSta);
    if (elev !== null) sampled.push({ sta, elev });
  }

  if (sampled.length < 2) {
    return <p className="text-xs text-zinc-500 italic px-1 mt-1">Kein Profil verfügbar</p>;
  }

  const elevMin = Math.min(...sampled.map(p => p.elev));
  const elevMax = Math.max(...sampled.map(p => p.elev));
  const elevRange = elevMax - elevMin || 1;
  const elevPad = elevRange * 0.1;
  const yMin = elevMin - elevPad;
  const yMax = elevMax + elevPad;
  const yRange = yMax - yMin;

  const toSvgX = (sta: number) => PL + ((sta - staStart) / staRange) * chartW;
  const toSvgY = (elev: number) => PT + (1 - (elev - yMin) / yRange) * chartH;

  const pathD = sampled
    .map((p, i) => `${i === 0 ? "M" : "L"}${toSvgX(p.sta).toFixed(1)},${toSvgY(p.elev).toFixed(1)}`)
    .join(" ");

  const xInterval = niceTickInterval(staRange, 5);
  const xTickStart = Math.ceil(staStart / xInterval) * xInterval;
  const xTicks: number[] = [];
  for (let sta = xTickStart; sta <= staEnd + 1e-9; sta += xInterval) {
    xTicks.push(sta);
  }

  const yInterval = niceTickInterval(yRange, 4);
  const yTickStart = Math.ceil(yMin / yInterval) * yInterval;
  const yTicks: number[] = [];
  for (let elev = yTickStart; elev <= yMax + 1e-9; elev += yInterval) {
    yTicks.push(elev);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: H }}
      aria-label="Längsprofil"
    >
      {yTicks.map(elev => {
        const sy = toSvgY(elev);
        if (sy < PT - 1 || sy > PT + chartH + 1) return null;
        return (
          <g key={elev}>
            <line
              x1={PL}
              y1={sy}
              x2={PL + chartW}
              y2={sy}
              stroke="#3f3f46"
              strokeWidth={0.5}
            />
            <text
              x={PL - 3}
              y={sy + 3.5}
              textAnchor="end"
              fontSize={8}
              fill="#a1a1aa"
            >
              {elev.toFixed(0)}
            </text>
          </g>
        );
      })}

      {xTicks.map(sta => {
        const sx = toSvgX(sta);
        if (sx < PL - 1 || sx > PL + chartW + 1) return null;
        return (
          <g key={sta}>
            <line
              x1={sx}
              y1={PT}
              x2={sx}
              y2={PT + chartH}
              stroke="#3f3f46"
              strokeWidth={0.5}
            />
            <text
              x={sx}
              y={PT + chartH + 12}
              textAnchor="middle"
              fontSize={7.5}
              fill="#a1a1aa"
            >
              {formatStation(sta)}
            </text>
          </g>
        );
      })}

      <rect
        x={PL}
        y={PT}
        width={chartW}
        height={chartH}
        fill="none"
        stroke="#52525b"
        strokeWidth={0.5}
      />

      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />

      {profileGeom.vertices.map((v, i) => {
        const sx = toSvgX(v.sta);
        const sy = toSvgY(v.elev);
        if (sx < PL || sx > PL + chartW || sy < PT || sy > PT + chartH) return null;
        return (
          <circle key={i} cx={sx} cy={sy} r={2} fill={color} opacity={0.8} />
        );
      })}
    </svg>
  );
}

interface AlignmentRowProps {
  alignment: Alignment;
  color: string;
  visible: boolean;
  selected: boolean;
  onToggleVisible: () => void;
  onSelect: () => void;
}

function AlignmentRow({
  alignment,
  color,
  visible,
  selected,
  onToggleVisible,
  onSelect,
}: AlignmentRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs select-none",
        selected ? "bg-zinc-700" : "hover:bg-zinc-800"
      )}
      onClick={onSelect}
    >
      <button
        className="shrink-0 text-zinc-400 hover:text-zinc-100"
        onClick={e => { e.stopPropagation(); onToggleVisible(); }}
        aria-label={visible ? "Ausblenden" : "Einblenden"}
      >
        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>

      <span
        className="shrink-0 w-2.5 h-2.5 rounded-full border border-zinc-600"
        style={{ backgroundColor: color }}
      />

      <span className="flex-1 truncate text-zinc-200">{alignment.displayName}</span>

      <span className="text-zinc-500 shrink-0">{formatLength(alignment.length)}</span>

      {alignment.zSource === "profile" && (
        <span className="text-sky-400 text-[10px] font-mono shrink-0">Z</span>
      )}
      {alignment.zSource === "coordgeom" && (
        <span className="text-yellow-400 text-[10px] font-mono shrink-0">Z?</span>
      )}
    </div>
  );
}

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

function FileGroup({
  fileId,
  fileName,
  alignments,
  colors,
  visibleIds,
  selectedId,
  onRemove,
  onToggleVisible,
  onSelect,
}: FileGroupProps) {
  const [expanded, setExpanded] = useState(true);

  void fileId;

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 select-none">
        <button
          className="text-zinc-500 hover:text-zinc-200"
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? "Einklappen" : "Ausklappen"}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="flex-1 truncate font-medium text-zinc-300">{fileName}</span>
        <button
          className="text-zinc-600 hover:text-red-400 ml-auto"
          onClick={onRemove}
          aria-label="Datei entfernen"
        >
          <X size={12} />
        </button>
      </div>

      {expanded && (
        <div className="pl-2">
          {alignments.map(align => (
            <AlignmentRow
              key={align.id}
              alignment={align}
              color={colors[align.id] || "#888"}
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

export function AlignmentPanel() {
  const panelOpen = useAlignmentStore(s => s.panelOpen);
  const files = useAlignmentStore(s => s.files);
  const selectedId = useAlignmentStore(s => s.selectedId);
  const visibleIds = useAlignmentStore(s => s.visibleIds);
  const colors = useAlignmentStore(s => s.colors);
  const loadFile = useAlignmentStore(s => s.loadFile);
  const removeFile = useAlignmentStore(s => s.removeFile);
  const toggleVisible = useAlignmentStore(s => s.toggleVisible);
  const selectAlignment = useAlignmentStore(s => s.selectAlignment);
  const togglePanel = useAlignmentStore(s => s.togglePanel);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      for (const file of Array.from(fileList)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".xml") || lower.endsWith(".landxml")) {
          void loadFile(file);
        }
      }
    },
    [loadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  if (!panelOpen) return null;

  const allAlignments = files.flatMap(f => f.alignments);
  const selectedAlign = selectedId !== null ? allAlignments.find(a => a.id === selectedId) : null;

  const segmentCounts = selectedAlign
    ? {
        lines: selectedAlign.segments.filter(s => s.type === "Line").length,
        curves: selectedAlign.segments.filter(s => s.type === "Curve").length,
        spirals: selectedAlign.segments.filter(s => s.type === "Transition").length,
      }
    : null;

  return (
    <div className="absolute top-4 left-4 z-30 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col max-h-[calc(100vh-5rem)]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700 shrink-0">
        <Navigation2 size={15} className="text-sky-400 shrink-0" />
        <span className="flex-1 text-sm font-semibold text-zinc-100">Trassen-Viewer</span>
        <button
          className="text-zinc-500 hover:text-zinc-200"
          onClick={togglePanel}
          aria-label="Panel schließen"
        >
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0">
        <div className="p-2">
          <div
            className={cn(
              "border-2 border-dashed rounded-md px-3 py-4 flex flex-col items-center gap-1.5 cursor-pointer transition-colors",
              dragOver
                ? "border-sky-500 bg-sky-950/30"
                : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30"
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
            <Upload size={18} className="text-zinc-500" />
            <span className="text-xs text-zinc-400 text-center">
              LandXML / .xml hier ablegen<br />
              <span className="text-zinc-600">oder klicken zum Durchsuchen</span>
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

        {selectedAlign && segmentCounts && (
          <div className="mx-2 mb-2 p-2 bg-zinc-800 rounded-md text-xs border border-zinc-700">
            <div className="font-semibold text-zinc-100 truncate mb-1">
              {selectedAlign.displayName}
            </div>
            <div className="text-zinc-400 mb-0.5">
              {formatStation(selectedAlign.staStart)} –{" "}
              {formatStation(selectedAlign.staEnd)}
            </div>
            <div className="text-zinc-400 mb-1">
              Länge: {formatLength(selectedAlign.length)}
            </div>
            <div className="flex gap-2 text-zinc-500 flex-wrap">
              {segmentCounts.lines > 0 && (
                <span>{segmentCounts.lines} Gerade{segmentCounts.lines !== 1 ? "n" : ""}</span>
              )}
              {segmentCounts.curves > 0 && (
                <span>{segmentCounts.curves} Bogen{segmentCounts.curves !== 1 ? "bögen" : ""}</span>
              )}
              {segmentCounts.spirals > 0 && (
                <span>{segmentCounts.spirals} Spirale{segmentCounts.spirals !== 1 ? "n" : ""}</span>
              )}
            </div>
            {selectedAlign.zStatus && (
              <div className="mt-1 text-zinc-500 truncate">{selectedAlign.zStatus}</div>
            )}
          </div>
        )}

        {selectedAlign && selectedAlign.profileGeom.vertices.length > 0 && (
          <div className="mx-2 mb-3">
            <div className="text-xs text-zinc-400 font-medium mb-1 px-0.5">Längsprofil</div>
            <ProfileChart
              alignment={selectedAlign}
              color={colors[selectedAlign.id] || "#42a5f5"}
            />
          </div>
        )}
      </div>
    </div>
  );
}
