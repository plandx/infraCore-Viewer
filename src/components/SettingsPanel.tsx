import { useState } from "react";
import { X, RotateCcw, Check } from "lucide-react";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import type { KeyBindings } from "../types/ifc";
import { DEFAULT_KEYBINDINGS } from "../types/ifc";

const KEYBINDING_LABELS: Record<keyof KeyBindings, string> = {
  fitAll:          "Alles einpassen",
  select:          "Auswahl-Werkzeug",
  measure:         "Messen",
  section:         "Schnitt (Clip-Ebene)",
  faceSectionTool: "Flächen-Querschnitt",
  sqlPanel:        "SQL-Panel",
  listPanel:       "Listen-Panel",
  smartViews:      "Smart Views",
  qtoPanel:        "QTO-Panel",
  profilePanel:    "Längenschnitt",
  flyMode:         "Fly-Mode",
  hideSelected:    "Ausgewähltes ausblenden",
  showAll:         "Alles einblenden",
};

export function SettingsPanel() {
  const {
    settings, updateSettings,
    keyBindings, setKeyBindings,
    setSettingsPanelOpen,
  } = useModelStore();

  const [kbDraft, setKbDraft] = useState<KeyBindings>({ ...keyBindings });
  const [editingKey, setEditingKey] = useState<keyof KeyBindings | null>(null);
  const [kbSaved, setKbSaved] = useState(false);

  const captureKey = (e: React.KeyboardEvent, field: keyof KeyBindings) => {
    e.preventDefault();
    e.stopPropagation();
    let combo = "";
    if (e.shiftKey) combo += "shift+";
    if (e.ctrlKey)  combo += "ctrl+";
    if (e.altKey)   combo += "alt+";
    const key = e.key.toLowerCase();
    if (key === "shift" || key === "control" || key === "alt" || key === "meta") return;
    combo += key;
    setKbDraft(prev => ({ ...prev, [field]: combo }));
    setEditingKey(null);
  };

  const saveKeyBindings = () => {
    setKeyBindings(kbDraft);
    setKbSaved(true);
    setTimeout(() => setKbSaved(false), 1500);
  };

  const resetKeyBindings = () => {
    setKbDraft({ ...DEFAULT_KEYBINDINGS });
    setKeyBindings(DEFAULT_KEYBINDINGS);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">Einstellungen</h2>
          <button
            onClick={() => setSettingsPanelOpen(false)}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 flex flex-col gap-6">
          {/* Font size */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Schriftgröße
            </h3>
            <div className="flex gap-2">
              {(["sm", "md", "lg"] as const).map(sz => (
                <button
                  key={sz}
                  onClick={() => updateSettings({ fontSize: sz })}
                  className={cn(
                    "flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all",
                    settings.fontSize === sz
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  {sz === "sm" ? "Klein" : sz === "md" ? "Mittel" : "Groß"}
                  <span className="block text-[10px] opacity-60 mt-0.5">
                    {sz === "sm" ? "12px" : sz === "md" ? "14px" : "16px"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Display settings */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Anzeige
            </h3>
            <div className="flex flex-col gap-2">
              {([
                ["grid",        "Gitternetz anzeigen"],
                ["axes",        "Koordinatenachsen anzeigen"],
                ["edges",       "Kanten anzeigen"],
                ["shadows",     "Schatten aktivieren"],
                ["fog",         "Nebel aktivieren"],
                ["showSpaces",  "IFC-Spaces anzeigen"],
                ["orthographic","Orthografische Ansicht"],
              ] as [keyof typeof settings, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 cursor-pointer group">
                  <span className="text-sm text-foreground group-hover:text-primary transition-colors">{label}</span>
                  <button
                    role="switch"
                    aria-checked={!!settings[key]}
                    onClick={() => updateSettings({ [key]: !settings[key] } as any)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
                      settings[key] ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      settings[key] ? "translate-x-4" : "translate-x-0"
                    )} />
                  </button>
                </label>
              ))}
            </div>
          </section>

          {/* Keyboard shortcuts */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tastenkürzel
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetKeyBindings}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw size={10} />
                  Standard
                </button>
                <button
                  onClick={saveKeyBindings}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all",
                    kbSaved
                      ? "bg-green-500/20 text-green-400"
                      : "bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  {kbSaved ? <Check size={10} /> : null}
                  {kbSaved ? "Gespeichert" : "Speichern"}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {(Object.keys(KEYBINDING_LABELS) as (keyof KeyBindings)[]).map(field => (
                <div key={field} className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-muted/30">
                  <span className="text-xs text-foreground">{KEYBINDING_LABELS[field]}</span>
                  {editingKey === field ? (
                    <input
                      autoFocus
                      readOnly
                      placeholder="Taste drücken…"
                      onKeyDown={e => captureKey(e, field)}
                      onBlur={() => setEditingKey(null)}
                      className="w-32 text-center text-xs px-2 py-1 bg-primary/10 border border-primary rounded font-mono focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setEditingKey(field)}
                      className="w-32 text-center text-xs px-2 py-1 bg-muted border border-border rounded font-mono hover:border-primary/50 hover:bg-muted/60 transition-colors"
                    >
                      {kbDraft[field]}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
