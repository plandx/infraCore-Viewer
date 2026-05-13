import { useModelStore } from "../store/modelStore";
import { formatBytes, getSceneExtentKm } from "../utils/coordinateUtils";
import * as THREE from "three";

interface Props {
  onRemove: (id: string) => void;
  onFitTo: (id: string) => void;
}

export default function ModelList({ onRemove, onFitTo }: Props) {
  const models = useModelStore((s) => s.models);
  const updateModel = useModelStore((s) => s.updateModel);

  const arr = Array.from(models.values());
  if (arr.length === 0) {
    return (
      <div className="panel-empty">
        <span>Keine Modelle geladen</span>
      </div>
    );
  }

  return (
    <div className="model-list">
      {arr.map((model) => {
        const size = new THREE.Vector3();
        if (!model.boundingBox.isEmpty()) model.boundingBox.getSize(size);
        const extent = getSceneExtentKm(model.boundingBox);

        return (
          <div
            key={model.id}
            className={`model-item ${model.status === "error" ? "error" : ""}`}
          >
            <div className="model-header">
              <input
                type="color"
                value={model.color}
                onChange={(e) => updateModel(model.id, { color: e.target.value })}
                title="Modellfarbe"
                className="color-swatch"
              />
              <div className="model-name" title={model.name}>
                {model.name}
              </div>
              <div className="model-actions">
                <button
                  className="icon-btn"
                  title="An Modell anpassen"
                  onClick={() => onFitTo(model.id)}
                >
                  ⌖
                </button>
                <button
                  className="icon-btn"
                  title={model.visible ? "Ausblenden" : "Einblenden"}
                  onClick={() =>
                    updateModel(model.id, { visible: !model.visible })
                  }
                >
                  {model.visible ? "👁" : "👁‍🗨"}
                </button>
                <button
                  className="icon-btn danger"
                  title="Modell entfernen"
                  onClick={() => onRemove(model.id)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="model-meta">
              <span>{formatBytes(model.size)}</span>
              <span>Ausdehnung: {extent}</span>
              {model.status === "loading" && (
                <span className="badge loading">Lädt...</span>
              )}
              {model.status === "loaded" && (
                <span className="badge ok">Geladen</span>
              )}
              {model.status === "error" && (
                <span className="badge err" title={model.error}>
                  Fehler
                </span>
              )}
            </div>

            <div className="model-opacity">
              <label>Transparenz</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={model.opacity}
                onChange={(e) => {
                  const opacity = parseFloat(e.target.value);
                  updateModel(model.id, { opacity });
                  model.mesh.traverse((obj) => {
                    if (
                      obj instanceof THREE.Mesh &&
                      obj.material instanceof THREE.MeshLambertMaterial
                    ) {
                      obj.material.opacity = opacity;
                      obj.material.transparent = opacity < 1;
                      obj.material.needsUpdate = true;
                    }
                  });
                }}
              />
              <span>{Math.round(model.opacity * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
