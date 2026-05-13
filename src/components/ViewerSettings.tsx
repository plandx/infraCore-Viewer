import { useModelStore } from "../store/modelStore";

export default function ViewerSettings() {
  const settings = useModelStore((s) => s.settings);
  const updateSettings = useModelStore((s) => s.updateSettings);

  const toggle = (key: keyof typeof settings) => {
    const val = settings[key];
    if (typeof val === "boolean") {
      updateSettings({ [key]: !val } as never);
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-group">
        <label className="settings-label">Hintergrundfarbe</label>
        <input
          type="color"
          value={settings.background}
          onChange={(e) => updateSettings({ background: e.target.value })}
          className="color-input"
        />
      </div>

      {(
        [
          { key: "grid", label: "Raster" },
          { key: "axes", label: "Achsen" },
          { key: "edges", label: "Kanten" },
          { key: "shadows", label: "Schatten" },
          { key: "fog", label: "Nebel" },
          { key: "logDepthBuffer", label: "Log. Tiefenpuffer (für große Modelle)" },
        ] as const
      ).map(({ key, label }) => (
        <div key={key} className="settings-toggle">
          <label>
            <input
              type="checkbox"
              checked={Boolean(settings[key])}
              onChange={() => toggle(key)}
            />
            <span>{label}</span>
          </label>
        </div>
      ))}

      <div className="settings-group">
        <button
          className="tool-btn"
          onClick={() => window.dispatchEvent(new Event("viewer:fitAll"))}
        >
          Auf alle Modelle zoomen
        </button>
      </div>
    </div>
  );
}
