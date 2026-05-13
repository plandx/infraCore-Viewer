import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import * as THREE from "three";
import IFCViewer3D from "./components/IFCViewer3D";
import FileUpload from "./components/FileUpload";
import ModelList from "./components/ModelList";
import PropertiesPanel from "./components/PropertiesPanel";
import SQLPanel from "./components/SQLPanel";
import ViewerSettingsPanel from "./components/ViewerSettings";
import { useModelStore } from "./store/modelStore";
import { loadIFCFile, loadIFCProperties } from "./utils/ifcLoader";
import type { IFCModelEntry } from "./types/ifc";
import "./App.css";

type Tab = "models" | "properties" | "sql" | "settings";

interface LoadingState {
  phase: string;
  progress: number;
  fileName: string;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("models");
  const [loadingStates, setLoadingStates] = useState<Map<string, LoadingState>>(
    new Map()
  );
  const sceneGroupRef = useRef<Map<string, THREE.Group>>(new Map());

  const { addModel, removeModel, updateModel, setWorldOrigin, setSelected, models } =
    useModelStore();

  const activeLoads = loadingStates.size;

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const tempId = uuidv4();
        const placeholder: IFCModelEntry = {
          id: tempId,
          name: file.name,
          file,
          mesh: new THREE.Group(),
          visible: true,
          color: "#4f8ef7",
          opacity: 1,
          boundingBox: new THREE.Box3(),
          originOffset: new THREE.Vector3(),
          properties: {},
          loadedAt: new Date(),
          size: file.size,
          status: "loading",
        };
        addModel(placeholder);

        setLoadingStates((prev) => {
          const next = new Map(prev);
          next.set(tempId, { phase: "Initialisieren", progress: 0, fileName: file.name });
          return next;
        });

        try {
          const currentOrigin = useModelStore.getState().worldOrigin;
          const modelIndex = useModelStore.getState().models.size;

          const { entry, newWorldOrigin } = await loadIFCFile(
            file,
            modelIndex,
            currentOrigin,
            (p) => {
              setLoadingStates((prev) => {
                const next = new Map(prev);
                next.set(tempId, {
                  phase: p.phase,
                  progress: p.progress,
                  fileName: file.name,
                });
                return next;
              });
            }
          );

          if (!currentOrigin) {
            setWorldOrigin(newWorldOrigin);
          }

          sceneGroupRef.current.set(tempId, entry.mesh);

          updateModel(tempId, {
            ...entry,
            id: tempId,
            status: "loaded",
          });
        } catch (err) {
          updateModel(tempId, {
            status: "error",
            error: String(err),
          });
        } finally {
          setLoadingStates((prev) => {
            const next = new Map(prev);
            next.delete(tempId);
            return next;
          });
        }
      }
    },
    [addModel, updateModel, setWorldOrigin]
  );

  const handleRemove = useCallback(
    (id: string) => {
      removeModel(id);
      sceneGroupRef.current.delete(id);
    },
    [removeModel]
  );

  const handleFitTo = useCallback((id: string) => {
    const model = useModelStore.getState().models.get(id);
    if (!model) return;
    window.dispatchEvent(
      new CustomEvent("viewer:fitTo", { detail: model.boundingBox })
    );
  }, []);

  const handleElementClick = useCallback(
    async (modelId: string, expressId: number) => {
      setTab("properties");
      const model = useModelStore.getState().models.get(modelId);
      if (!model) return;

      setSelected({
        modelId,
        expressId,
        properties: {},
        psets: [],
      });

      try {
        const { properties, psets } = await loadIFCProperties(
          model.file,
          expressId
        );
        setSelected({ modelId, expressId, properties, psets });
      } catch {
        // properties stay empty on error
      }
    },
    [setSelected]
  );

  const modelCount = models.size;
  const loadedCount = Array.from(models.values()).filter(
    (m) => m.status === "loaded"
  ).length;

  return (
    <div className="app">
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="logo">
          <span className="logo-icon">⬡</span>
          <span className="logo-text">infraCore</span>
          <span className="logo-sub">IFC Viewer</span>
        </div>
        <div className="topbar-stats">
          {modelCount > 0 && (
            <span className="stat">
              {loadedCount}/{modelCount} Modelle geladen
            </span>
          )}
          {activeLoads > 0 && (
            <span className="stat loading">
              <span className="spinner-xs" />
              Lädt {activeLoads} Datei{activeLoads > 1 ? "en" : ""}…
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className="tool-btn"
            onClick={() => window.dispatchEvent(new Event("viewer:fitAll"))}
            title="Auf alle Modelle zoomen"
          >
            ⌖ Fit All
          </button>
        </div>
      </header>

      <div className="main">
        {/* ── Left Sidebar ───────────────────────────────────────── */}
        <aside className="sidebar">
          <FileUpload onFiles={handleFiles} loading={activeLoads > 0} />

          {/* Loading progress */}
          {Array.from(loadingStates.entries()).map(([id, state]) => (
            <div key={id} className="load-progress">
              <div className="load-filename">{state.fileName}</div>
              <div className="load-phase">{state.phase}</div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${state.progress}%` }}
                />
              </div>
            </div>
          ))}

          {/* Tabs */}
          <nav className="tab-nav">
            {(
              [
                { id: "models", label: "Modelle" },
                { id: "properties", label: "Eigenschaften" },
                { id: "sql", label: "SQL" },
                { id: "settings", label: "Einstellungen" },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                className={`tab-btn ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {tab === "models" && (
              <ModelList onRemove={handleRemove} onFitTo={handleFitTo} />
            )}
            {tab === "properties" && <PropertiesPanel />}
            {tab === "sql" && <SQLPanel />}
            {tab === "settings" && <ViewerSettingsPanel />}
          </div>
        </aside>

        {/* ── 3D Viewport ────────────────────────────────────────── */}
        <main className="viewport">
          <IFCViewer3D onElementClick={handleElementClick} />

          {/* Overlay: empty state */}
          {modelCount === 0 && activeLoads === 0 && (
            <div className="viewport-empty">
              <div className="empty-icon">⬡</div>
              <p>IFC-Dateien in die linke Leiste laden</p>
              <p className="empty-hint">
                Multi-Model · Große Koordinaten (bis 20 km) · IFC2X3 / IFC4 / IFC4X3
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
