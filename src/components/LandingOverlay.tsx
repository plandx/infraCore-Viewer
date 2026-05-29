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
      <div className="relative pointer-events-auto">
        <div
          className="bg-card border border-border rounded-lg p-8 w-[380px] text-center"
          style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.08)' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-5">
            <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[4px]">
              <rect width="32" height="32" rx="5" fill="#C42B1C"/>
              <text x="16" y="23" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
            </svg>
            <span className="text-[18px] font-semibold text-foreground">infraCore</span>
          </div>

          <p className="text-[13px] text-muted-foreground mb-5">
            Web-basierter IFC Viewer mit Multi-Modell-Unterstützung
          </p>

          {/* Drop zone */}
          <label
            className="flex flex-col items-center gap-3 p-6 cursor-pointer transition-all group"
            style={{
              border: '2px dashed #0078D4',
              background: 'rgba(0,120,212,0.04)',
              borderRadius: '4px',
            }}
          >
            <input type="file" accept=".ifc" multiple className="hidden" onChange={handleInput} disabled={loading} />
            {loading ? (
              <div className="w-7 h-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <FolderOpen size={24} className="text-primary transition-colors" />
            )}
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                {loading ? "Lädt…" : "IFC-Datei öffnen"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Ablegen oder klicken · IFC2X3, IFC4, IFC4X3
              </p>
            </div>
          </label>

          {/* Feature list */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: "Multi-Modell", desc: "Mehrere IFC gleichzeitig" },
              { label: "20 km+", desc: "Große Koordinaten" },
              { label: "Eigenschaften", desc: "IFC Properties" },
            ].map((f) => (
              <div key={f.label} className="bg-muted/50 rounded-[4px] p-2.5 text-left border border-border">
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
