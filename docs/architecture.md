# Architektur

## Übersicht

infraCore-Viewer ist eine **rein clientseitige** Single-Page-Application ohne Backend-Server.
IFC-Dateien werden lokal im Browser geparst (WASM), alle Daten liegen im Arbeitsspeicher.

```
Browser
├── Main-Fenster (React App)
│   ├── MainToolbar
│   ├── HierarchyPanel  ←→  Zustand-Store  ←→  BroadcastChannel
│   ├── ViewportContainer (Three.js)               ↕
│   ├── PropertiesPanel                    Sekundär-Fenster(r)
│   ├── LensRulesPanel / SmartViews          ├── HierarchyPanel
│   ├── SQLPanel                             ├── PropertiesPanel
│   ├── SelectionBasket                      ├── LensRulesPanel
│   ├── BatchPanel (Modal)                   ├── SQLPanel
│   └── GeometryInspectorPanel (Overlay)     └── BasketListPanel
└── web-ifc WASM (IFC-Parser)
```

## Verzeichnisstruktur

```
/
├── CLAUDE.md                  ← Pflicht-Lektüre für Claude
├── docs/                      ← Diese Dokumentation (immer aktuell halten!)
│   ├── architecture.md
│   ├── frontend.md
│   ├── backend.md
│   ├── state-management.md
│   ├── viewer.md
│   └── window-system.md
├── public/
│   └── wasm/                  ← web-ifc WASM-Binaries
├── src/
│   ├── App.tsx                ← Root: erkennt Sekundär-Fenster, rendert MainApp
│   ├── main.tsx               ← Erkennt ?billing → BillingApp, sonst App
│   ├── billing/               ← 5D-Abrechnungsmodul
│   │   ├── types.ts           ← BillingEntry, BillingStage, DocumentRef, ElementQuantities, ElementInfo, BillingMsg
│   │   ├── billingStore.ts    ← Zustand-Store + localStorage + BroadcastChannel
│   │   ├── BillingVisualizer.ts ← Three.js Füllstand-Overlays (MeshBasicMaterial + clip plane)
│   │   ├── BillingPanel.tsx   ← Haupt-UI im Billing-Fenster
│   │   ├── BillingApp.tsx     ← Root-Komponente für ?billing
│   │   └── quantityUtils.ts   ← Volumen + Oberfläche aus Three.js-Geometrie (Divergenz-Theorem)
│   ├── batch/                 ← Batch-Änderungsmodul
│   │   ├── types.ts           ← IfcValueType, FilterOp, TargetFilter, BatchOperation, BatchRule, PreviewResult
│   │   ├── batchStore.ts      ← In-Memory-Zustand-Store (keine Persistenz)
│   │   ├── BatchExecutor.ts   ← Pure Funktionen: buildElementRows, executeRule, collectEdits
│   │   └── BatchPanel.tsx     ← Modal-UI: Regeleditor, Vorschau, Anwenden; datalist-Autocomplete
│   ├── geometry-inspector/    ← Interaktive Flächen-/Kanten-Auswahl
│   │   ├── types.ts           ← InspFace, InspEdge, InspectionSession, PickMode
│   │   ├── GeometryAnalyzer.ts ← BFS Flächengruppierung + Hard-Edge-Extraktion + kollineare Kantenverschmelzung
│   │   ├── FaceEdgePicker.ts  ← Three.js Overlays + Raycasting-Interaktion
│   │   └── GeometryInspectorPanel.tsx ← Floating React-Panel (Flächen-/Kantenliste, Speichern)
│   ├── components/            ← Alle React-Komponenten
│   ├── section/               ← Eigenständiges BIM-Schnitt-Paket
│   │   ├── index.ts           ← Public API
│   │   ├── SectionModule.ts   ← Controller: Gizmos, Caps, Drag, Clips
│   │   └── CapGenerator.ts    ← CPU-Schnittflächen (Triangle → Earcut)
│   ├── store/
│   │   └── modelStore.ts      ← Zentraler Zustand (Zustand)
│   ├── types/
│   │   └── ifc.ts             ← Alle TypeScript-Typen
│   └── utils/
│       ├── ifcLoader.ts       ← IFC-Parsing (web-ifc WASM)
│       ├── ifcWriter.ts       ← IFC-Export mit Eigenschafts-Overrides
│       ├── sqlEngine.ts       ← Mini-SQL über alasql
│       ├── smartViewUtils.ts  ← SmartView-Regelauswertung
│       ├── windowSync.ts      ← BroadcastChannel-Protokoll
│       └── coordinateUtils.ts ← Formatierungs-Helfer
└── package.json
```

## Datenfluss beim IFC-Laden

```
User wählt Datei
      ↓
handleFiles() [App.tsx]
      ↓
loadIFCFile() [ifcLoader.ts]
  ├── web-ifc: Mesh-Geometrie streamen → Three.js Group
  ├── getSpatialStructure() → SpatialNode-Baum
  ├── GetLineIDsWithType() → elementsByType
  └── Fortschritts-Callbacks → loadStates UI
      ↓
addModel() / updateModel() [modelStore]
      ↓
ViewportContainer erkennt neues Model → scene.add(mesh)
HierarchyPanel abonniert models → baut Baum auf
BroadcastChannel sendet SyncState → Sekundär-Fenster
```

## Datenfluss beim Element-Klick

```
User klickt im Viewport
      ↓
raycastPoint() → {modelId, expressId, mesh, point}
      ↓
handleElementClick(modelId, expressId)
  ├── setSelected({modelId, expressId, properties:{}, psets:[]})
  └── loadIFCProperties(file, expressId) → {properties, psets}
        ↓
      setSelected(vollständige Daten)
        ↓
      PropertiesPanel rendert neu
      BroadcastChannel sendet State → Sekundär-Fenster
```

## Datenfluss beim IFC-Export (Eigenschafts-Overrides)

```
User bearbeitet Eigenschaft in PropertiesPanel  ─────┐
                                                      │
User wendet Batch-Regel an in BatchPanel  ────────────┤
      ↓                                               │
applyPropertyEdits([{modelId, expressId, key, value, ifcType}]) [modelStore]
      ↓  (propertyOverrides: Map<modelId, Map<expressId, Record<key, PropOverride>>>)
User klickt „IFC Export"
      ↓
writeIFCWithOverrides(file, overrides) [ifcWriter.ts]
  ├── api.OpenModel(data)
  ├── Direkte Attribute: GetLine → WriteLine
  ├── Pset-Eigenschaften: getPropertySets → GetLine → NominalValue → WriteLine
  └── api.SaveModel(modelId) → Uint8Array
        ↓
downloadFile(data, filename)
```

## Datenfluss Batch-Änderungen

```
User öffnet BatchPanel (Toolbar „Batch"-Button)
      ↓
BatchPanel liest models + propertyOverrides aus modelStore
      ↓
[Optional] „Properties laden"-Button → loadAllElementProperties() für alle Modelle
  → propKeys + ifcTypes für datalist-Autocomplete in allen Eingabefeldern
      ↓
buildElementRows() → ElementRow[] (alle Elemente aller Modelle)
      ↓
executeRule() → PreviewResult (max. 50 Vorschau-Änderungen)
      ↓  [Vorschau-Tabelle anzeigen]
User klickt „Anwenden"
      ↓
collectEdits() → alle Änderungen als Flat-Liste
      ↓
applyPropertyEdits() → propertyOverrides aktualisiert
  ├── key === "Name": patcht auch models.elementsByType[type][i].name
  └── key === "Name": patcht auch spatialTree-Knoten rekursiv → HierarchyPanel re-rendert sofort
```

## Datenfluss Geometrie-Inspektor

```
User klickt „Messen"-Button im 5D-Panel (BillingPanel)
      ↓
BroadcastChannel: { t: "startInspection", key, elementName }
      ↓
ViewportContainer empfängt Nachricht
  ├── Sammelt alle Meshes des Elements (modelId:expressId)
  ├── isolateEntries([{ modelId, expressId }]) → nur dieses Element sichtbar
  ├── GeometryAnalyzer.analyze(meshes) → { faces, edges, faceVertArrays }
  │     ├── BFS-Flood-Fill coplanarer Dreiecke → InspFace[]
  │     ├── Hard-Edge-Extraktion (Diederwinkel > 25°) → InspEdge[]
  │     └── kollineare Kantenverschmelzung (iterativ)
  └── FaceEdgePicker.load(meshes) → Overlay-Meshes + Edge-Pick-Boxen in Szene
        ↓
GeometryInspectorPanel erscheint (Overlay top-right)
      ↓
User klickt Fläche / Kante (Ctrl = Mehrfachauswahl)
  → FaceEdgePicker.onClick() → selectedFaceIds / selectedEdgeIds aktualisiert
  → Panel zeigt Summe Fläche / einzelne Kantenlängen
      ↓
„In 5D-Eintrag speichern"
  → billingStore.setQuantities(key, { volume, surfaceArea, bboxX, bboxY, bboxZ })
```

## Datenfluss 5D-Mengenberechnung (automatisch)

```
User klickt „Auto"-Button im 5D-Panel
      ↓
BroadcastChannel: { t: "requestQuantities", key }
      ↓
ViewportContainer empfängt Nachricht
  ├── Sammelt Meshes des Elements
  └── computeQuantities(meshes) [quantityUtils.ts]
        ├── Divergenz-Theorem → Volumen (m³)
        ├── Kreuzprodukt-Summe → Oberfläche (m²)
        └── THREE.Box3 → Bounding Box X/Y/Z (m)
          ↓
BroadcastChannel: { t: "quantities", key, data: ElementQuantities }
          ↓
BillingPanel empfängt → zeigt liveQuantities an
          ↓
„Speichern" → billingStore.setQuantities(key, data)
```

## Kritische Abhängigkeiten

- `web-ifc 0.0.77` — API ist versioniert; nicht ohne Test upgraden
- `three 0.184` — Material-Disposal-Pattern muss bei Updates geprüft werden
- `zustand 5` — Subscriptions sind synchron; Echo-Loop-Prävention beachten
- `react-resizable-panels 4` — `Panel`/`Group`/`Separator` Imports beachten

## WASM-Concurrency-Hinweis

web-ifc WASM ist **nicht thread-safe** für parallele async-Aufrufe. Niemals `Promise.all` für mehrere `getPropertySets`- oder `getItemProperties`-Aufrufe auf demselben `modelId` verwenden — das korrumpiert den internen WASM-Zustand. Immer sequentielle `await`-Ketten nutzen.
