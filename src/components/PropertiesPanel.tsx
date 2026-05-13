import { useModelStore } from "../store/modelStore";

export default function PropertiesPanel() {
  const selected = useModelStore((s) => s.selectedElement);
  const models = useModelStore((s) => s.models);

  if (!selected) {
    return (
      <div className="panel-empty">
        <span>Element anklicken um Eigenschaften zu sehen</span>
      </div>
    );
  }

  const model = models.get(selected.modelId);

  return (
    <div className="properties-panel">
      <div className="prop-header">
        <div className="prop-model">{model?.name ?? selected.modelId}</div>
        <div className="prop-id">
          ExpressID: <strong>{selected.expressId}</strong>
        </div>
      </div>

      {/* Base Properties */}
      {Object.keys(selected.properties).length > 0 && (
        <div className="pset">
          <div className="pset-name">Basis-Eigenschaften</div>
          <table className="prop-table">
            <tbody>
              {Object.entries(selected.properties).map(([key, val]) => (
                <tr key={key}>
                  <td className="prop-key">{key}</td>
                  <td className="prop-val">{renderValue(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Property Sets */}
      {selected.psets.map((pset) => (
        <div key={pset.name} className="pset">
          <div className="pset-name">{pset.name}</div>
          <table className="prop-table">
            <tbody>
              {pset.properties.map((p) => (
                <tr key={p.name}>
                  <td className="prop-key">{p.name}</td>
                  <td className="prop-val">{renderValue(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {selected.psets.length === 0 &&
        Object.keys(selected.properties).length === 0 && (
          <div className="panel-empty">Keine Eigenschaften verfügbar</div>
        )}
    </div>
  );
}

function renderValue(val: unknown): string {
  if (val === null || val === undefined) return "–";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
