import { FolderOpen } from "lucide-react";

interface Props {
  onOpenFiles: (files: File[]) => void;
  loading: boolean;
}

export function LandingOverlay({ onOpenFiles, loading }: Props) {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".ifc"));
    if (files.length) onOpenFiles(files);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.name.toLowerCase().endsWith(".ifc"));
    if (files.length) onOpenFiles(files);
    e.target.value = "";
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
      data-viewport=""
    >
      {/* Background grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(122,162,247,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(122,162,247,0.04) 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative pointer-events-auto">
        <div
          className="bg-card border border-border rounded-xl shadow-2xl p-8 w-[380px] text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" className="text-primary">
              <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="currentColor" opacity="0.4"/>
            </svg>
            <span className="text-2xl font-bold text-foreground">infraCore</span>
          </div>

          <p className="text-sm text-muted-foreground mb-6">
            Web-basierter IFC Viewer mit Multi-Modell-Unterstützung
          </p>

          {/* Drop zone */}
          <label className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-all group">
            <input type="file" accept=".ifc" multiple className="hidden" onChange={handleInput} disabled={loading} />
            {loading ? (
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <FolderOpen size={28} className="text-muted-foreground group-hover:text-primary transition-colors" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {loading ? "Lädt…" : "IFC-Datei öffnen"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Ablegen oder klicken · IFC2X3, IFC4, IFC4X3
              </p>
            </div>
          </label>

          {/* Feature list */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            {[
              { label: "Multi-Modell", desc: "Mehrere IFC gleichzeitig" },
              { label: "20 km+", desc: "Große Koordinaten" },
              { label: "Eigenschaften", desc: "IFC Properties" },
            ].map((f) => (
              <div key={f.label} className="bg-muted/40 rounded-lg p-2.5 text-left">
                <p className="text-[11px] font-semibold text-foreground">{f.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
