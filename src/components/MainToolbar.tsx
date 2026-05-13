import { useRef } from "react";
import {
  FolderOpen, Plus, Sun, Moon, Maximize2,
  MousePointer2, Ruler, Scissors, Eye, EyeOff,
  Download, Info,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";

interface Props {
  onOpenFiles: (files: File[]) => void;
  onFitAll: () => void;
  loading: boolean;
}

export function MainToolbar({ onOpenFiles, onFitAll, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const theme = useModelStore((s) => s.settings.theme);
  const clipPlanes = useModelStore((s) => s.settings.clipPlanes);
  const updateSettings = useModelStore((s) => s.updateSettings);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.name.toLowerCase().endsWith(".ifc"));
    if (files.length) onOpenFiles(files);
    e.target.value = "";
  };

  const toggleTheme = () => {
    updateSettings({ theme: theme === "dark" ? "light" : "dark" });
    document.documentElement.classList.toggle("dark", theme !== "dark");
  };

  return (
    <div className="flex items-center h-11 px-3 gap-1 border-b bg-card text-card-foreground shrink-0 select-none">
      {/* Logo */}
      <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-primary">
          <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="currentColor" opacity="0.3"/>
        </svg>
        <span className="font-bold text-sm tracking-tight text-foreground">infraCore</span>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">IFC Viewer</span>
      </div>

      {/* Open file */}
      <input ref={inputRef} type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
      <button
        className={cn("toolbar-button flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded",
          "bg-primary text-primary-foreground hover:opacity-90")}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        title="IFC-Datei öffnen"
      >
        <FolderOpen size={14} />
        <span>Öffnen</span>
      </button>

      {/* Add model (multi-model) */}
      <input ref={addInputRef} type="file" accept=".ifc" multiple className="hidden" onChange={handleFiles} />
      <button
        className="toolbar-button"
        onClick={() => addInputRef.current?.click()}
        disabled={loading}
        title="Modell hinzufügen (Multi-Modell)"
      >
        <Plus size={16} />
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Camera / View tools */}
      <button className="toolbar-button" onClick={onFitAll} title="Auf alle Modelle zoomen (F)">
        <Maximize2 size={16} />
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Interaction tools (visual only for now) */}
      <button className="toolbar-button active" title="Auswahl">
        <MousePointer2 size={16} />
      </button>
      <button className="toolbar-button" title="Messen">
        <Ruler size={16} />
      </button>
      <button
        className={cn("toolbar-button", clipPlanes && "active text-primary")}
        title="Schnittebene ein/ausschalten"
        onClick={() => updateSettings({ clipPlanes: !clipPlanes })}
      >
        <Scissors size={16} />
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Visibility */}
      <button
        className="toolbar-button"
        title="Spaces ein/ausblenden"
        onClick={() => useModelStore.getState().updateSettings({
          showSpaces: !useModelStore.getState().settings.showSpaces
        })}
      >
        {useModelStore.getState().settings.showSpaces ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>

      <div className="flex-1" />

      {/* Right side */}
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span>Lädt…</span>
        </div>
      )}

      <button className="toolbar-button" title="Export">
        <Download size={16} />
      </button>
      <button className="toolbar-button" title="Info / Über">
        <Info size={16} />
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      <button className="toolbar-button" onClick={toggleTheme} title="Hell/Dunkel umschalten">
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  );
}
