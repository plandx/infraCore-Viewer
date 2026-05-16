# 3D Viewer (ViewportContainer)

**Datei:** `src/components/ViewportContainer.tsx`

Der Kern der Anwendung. Verwaltet die gesamte Three.js-Szene inkl. Rendering, Interaktion und visuellen Übersteuerungen.

---

## Szene-Aufbau

```
THREE.Scene
├── AmbientLight (0xffffff, 0.65)
├── DirectionalLight (sun, 1.2, Position 200/400/200, wirft Schatten)
├── HemisphereLight (sky: 0x8899ff, ground: 0x443300, 0.45)
├── GridHelper (10000×10000, 100 Felder) name="__grid"
├── AxesHelper (500 Einheiten) name="__axes"
├── model:<uuid>              ← Three.js Group je Modell
│   └── Mesh[]               ← Geometrie-Meshes, userData.expressId gesetzt
│       └── LineSegments[]   ← Kanten-Overlay (userData.isEdge=true), ein Kind je Mesh
├── section:<planeId>         ← Ein Group je aktiver SectionPlane
│   ├── Mesh (PlaneGeometry, transparent disc)
│   ├── LineSegments (border ring)
│   ├── ArrowHelper (Normale-Pfeil)
│   └── Mesh (SphereGeometry, Drag-Handle)
├── highlightMesh             ← Klon des selektierten Mesh (isHighlight: true)
├── billingOverlay            ← Merged-Mesh je Billing-Eintrag (userData.isBillingOverlay=true)
│                                MeshBasicMaterial mit Füllstand-Uniform (uFillTop)
│
│   — Geometrie-Inspektor (nur wenn Inspektor aktiv) —
├── inspFace_<id>             ← MeshBasicMaterial-Overlay je Fläche
│                                renderOrder=10, DoubleSide, transparent
│                                1mm entlang Flächennormale versetzt (FACE_OFFSET=0.001)
├── inspEdge_lines            ← LineSegments für alle Kanten, renderOrder=11
└── inspEdge_pick_<id>        ← BoxGeometry(0.025, len, 0.025) je Kante
                                 visible=false, nur für Raycasting
```

## Kameras

**Perspektivisch** (Standard): `PerspectiveCamera(fov=60, near=0.01, far=500000)`

**Orthografisch**: `OrthographicCamera` — synchron zur Perspektiv-Kamera gehalten.

**OrbitControls**: `enableDamping=false`, `screenSpacePanning=true`

### Maustasten-Belegung
```typescript
controls.mouseButtons = {
  LEFT:   THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT:  THREE.MOUSE.ROTATE,
};
```

---

## Refs-Übersicht

| Ref | Typ | Zweck |
|---|---|---|
| `mountRef` | `HTMLDivElement` | DOM-Container für Renderer |
| `rendererRef` | `WebGLRenderer` | Three.js Renderer |
| `sceneRef` | `Scene` | Three.js Szene |
| `cameraRef` | `PerspectiveCamera` | Aktive Perspektiv-Kamera |
| `orthoCameraRef` | `OrthographicCamera` | Orthografische Kamera |
| `controlsRef` | `OrbitControls` | Orbit-Steuerung |
| `highlightRef` | `Mesh` | Aktuell selektiertes Element (Overlay) |
| `colorMaterialsRef` | `Material[]` | Farb-Overrides aus ColorGroups (für Disposal) |
| `basketOverlaysRef` | `Mesh[]` | Overlay-Meshes für Korb-Hervorhebung |
| `basketOverlayMatRef` | `Material` | Shared Highlight-Material für Korb |
| `basketGhostMatsRef` | `Map<Mesh, Material>` | Original-Materialien vor Ghost-Modus |
| `basketOutlinesRef` | `LineSegments[]` | Gelbe Edge-Outlines für Korb-Elemente |
| `sectionVisualsRef` | `Map<string, SectionVisuals>` | planeId → Three.js-Objekte |
| `dragSectionRef` | `SectionDragState \| null` | Aktiver Schnittebenen-Drag-State |
| `pickerRef` | `FaceEdgePicker \| null` | Aktiver Geometrie-Inspektor-Picker |
| `needsRenderRef` | `boolean` | Render-on-Demand Flag |

---

## useEffect-Reihenfolge

1. **Init** — Renderer, Szene, Kamera, Controls, Beleuchtung, Grid, Axes, Render-Loop
2. **Grid/Axes** — `settings.grid/axes` → Sichtbarkeit
3. **Kanten** — `settings.edges` → `visible` auf allen `isEdge`-Objekten
4. **Modelle in Szene** — `models` → fügt neue hinzu, entfernt gelöschte; baut `EdgesGeometry`-Overlays (15°)
5. **Element-Sichtbarkeit** — `hiddenElements, isolatedElements, selectionBasket, basketMode, models` → traversiert Szene, setzt `obj.visible`
6. **ColorGroup-Overrides** — `colorGroups` → ersetzt Materialien
7. **Korb-Overrides** — `selectionBasket, basketMode, models` → Overlay-Meshes (highlight) oder Ghost-Materialien
8. **Korb-Outlines** — `selectionBasket, models` → gelbe `LineSegments` (`EdgesGeometry`, 15°, `0xfbbf24`, `depthTest=false`, `renderOrder=998`)
9. **Selektion-Highlight** — `selectedElement, hiddenElements, isolatedElements` → amber Overlay-Meshes (`depthTest=false`)
10. **Schnittebenen-Visuals** — `sectionPlanes` → `syncSectionVisuals()`: entfernt veraltete, erstellt neue
11. **BroadcastChannel-Listener** — `"infracore-billing"` Kanal: verarbeitet `requestQuantities` und `startInspection`
12. **viewer:alignToPlane** — Event-Listener

---

## BroadcastChannel-Listener (Billing-Kanal)

`ViewportContainer` lauscht auf `"infracore-billing"` für zwei Nachrichten:

### `{ t: "requestQuantities", key }`

1. Key splitten: `[modelId, expressId]`
2. Alle Meshes des Elements aus Szene sammeln
3. `computeQuantities(meshes)` → `ElementQuantities`
4. Antwort: `{ t: "quantities", key, data }` via BroadcastChannel

### `{ t: "startInspection", key, elementName }`

1. Key splitten: `[modelId, expressId]`
2. Alle Meshes sammeln
3. `isolateEntries([{ modelId, expressId }])` → Element allein sichtbar
4. `GeometryAnalyzer.analyze(meshes)` → `{ faces, edges, faceVertArrays }`
5. `pickerRef.current = new FaceEdgePicker(scene)` + `picker.load(meshes)`
6. React-State setzen: `inspSession`, `inspFaces`, `inspEdges`, `inspSelFaces=new Set()`, `inspSelEdges=new Set()`

---

## Inspektions-Modus — Maus-Event-Routing

Solange `pickerRef.current !== null` (Inspektor aktiv):

### `handleMouseMove`

```typescript
if (pickerRef.current) {
  const ndc = computeNDC(event, canvas);
  const result = pickerRef.current.onMouseMove(ndc, camera);
  // result: { hoveredFaceId, hoveredEdgeId }
  needsRenderRef.current = true;
  return; // kein normales Hover-Handling
}
```

### `handleClick`

```typescript
if (pickerRef.current && inspSession) {
  const ndc = computeNDC(event, canvas);
  const result = pickerRef.current.onClick(ndc, camera, event.ctrlKey, inspPickMode);
  setInspSelFaces(result.selectedFaceIds);
  setInspSelEdges(result.selectedEdgeIds);
  needsRenderRef.current = true;
  return; // kein normales Element-Select
}
```

Normale Element-Selektion und Kontext-Menü sind im Inspektions-Modus deaktiviert.

---

## Element-Sichtbarkeits-Logik

**Priorität (von hoch nach niedrig):**
1. Korb-Isolieren: `basketMode === "isolate"` → nur Korb-Elemente sichtbar
2. Store-Isolierung: `isolatedElements !== null` → nur diese sichtbar
3. Standard: `!hiddenElements.has(key)`

```typescript
if (state.basketMode === "isolate" && state.selectionBasket.size > 0) {
  obj.visible = state.selectionBasket.has(key);
} else if (state.isolatedElements !== null) {
  obj.visible = state.isolatedElements.has(key);
} else {
  obj.visible = !state.hiddenElements.has(key);
}
```

---

## Material-Override-System

### ColorGroups
- Speichert Original in `obj.userData.originalMaterial`
- Erstellt `MeshLambertMaterial(color)`

### Korb Hervorheben (highlight)
- Klonet Meshes als Overlay, `renderOrder = 997`
- Shared amber Material: `MeshLambertMaterial(0xf59e0b, opacity=0.55, depthTest=false)`
- `userData.isBasketOverlay = true`

### Korb Ghost
- Klonet das aktuelle Material, setzt `transparent=true, opacity=0.12`
- Speichert Original in `basketGhostMatsRef`

### Selektion-Highlight
- `MeshLambertMaterial(0xf59e0b, opacity=0.45, depthTest=false)`
- `renderOrder = 999`
- `userData.isHighlight = true`

### Kanten (Edges)
- `EdgesGeometry(geometry, 15°)` + `LineSegments` als Kind jedes Mesh beim Laden
- `userData.isEdge = true`
- Toggle via `settings.edges`

**Raycasting überspringt** alle Meshes mit `isHighlight`, `isBasketOverlay`, `isSectionVisual`.

Geometrie-Inspektor-Overlays (`inspFace_*`, `inspEdge_pick_*`) werden vom normalen Element-Raycast ebenfalls übersprungen — sie haben dedizierte Raycast-Aufrufe im Picker.

---

## Werkzeuge

### Select (Standard)
- Linksklick → `raycastPoint()` → `onElementClick(modelId, expressId)`
- Doppelklick → `ctxZoomTo(modelId, [expressId])`
- **Deaktiviert im Inspektions-Modus**

### Measure
- 1. Klick: Punkt A; 2. Klick: Punkt B → Linie + Abstands-Label
- `Esc` → zurücksetzen

### Section (Mehrfach-Schnitt)
- Klick auf Fläche → `addSectionPlane()` mit Flächen-Normaler

---

## Schnittebenen-System — SectionModule (`src/section/`)

Das gesamte Schnittebenen-System ist als eigenständiges Paket ausgelagert.

### SectionModule API

```typescript
class SectionModule {
  constructor(cfg: SectionModuleConfig)
  syncPlanes(planes: SectionPlane[]): void
  setVisualsHidden(hidden: boolean): void
  dispose(): void
}
```

### userData-Flags

| Flag | Bedeutung |
|---|---|
| `isSectionVisual = true` | Gizmo-Geometrie — Raycast skip |
| `isSectionHandle = true` | Drag-Handle Sphere |
| `isSectionCap = true` | Cap/Edge Mesh — Raycast skip, ColorGroup skip |

### Schnittflächen (Caps)

**Algorithmus** (CPU, pro Mesh × Ebene):
1. BoundingBox-Vorfilter
2. Triangle-Plane-Intersection → Segmente
3. Segmente zu Schleifen verketten (quantisierter Hash, ε = 1e-5)
4. 2D-Projektion + Earcut-Triangulierung
5. Rückprojektion → `BufferGeometry`

**Performance:** Rebuild debounced 150 ms; kein Rebuild während Drag

### Drag-Ablauf

1. `pointerdown` auf Handle → `setPointerCapture` → OrbitControls deaktiviert
2. `pointermove` → Ray ∩ ViewPlane → Delta entlang Normal → direktes Update
3. `pointerup` → Store-Update via `onPlaneMoved` Callback

---

## Globale Window-Events

| Event | Auslöser | Aktion |
|---|---|---|
| `viewer:fitAll` | Taste `F`, Toolbar | Kamera auf alle sichtbaren Modelle |
| `viewer:fitTo` | HierarchyPanel | Kamera auf BoundingBox |
| `viewer:zoomToElement` | HierarchyPanel, Doppelklick | Kamera auf ein oder mehrere Elemente |
| `viewer:preset` | Toolbar-Dropdown | Kamera-Preset |
| `viewer:exportGLTF` | Toolbar | GLTF-Export |
| `viewer:screenshot` | Toolbar | PNG-Screenshot |
| `viewer:clearMeasure` | Esc, Toolbar | Alle Messungen löschen |
| `viewer:alignToPlane` | SectionPanel | Kamera senkrecht zur Schnittebene |

---

## Rechtsklick-Kontextmenü

Erscheint bei Rechtsklick auf ein Element (nicht im Inspektions-Modus):
- Zoom to / Isolieren / Ausblenden / Alles einblenden
- Zum Korb hinzufügen / entfernen
- Gleiche Klasse wählen / Gleiches Geschoss wählen
- Schnitt auf dieser Fläche
- **In 5D hinzufügen** — fügt Element zum Billing-Store hinzu
- **Fertigungsgrad setzen** (0–100 % in 10%-Schritten) — setzt direkt einen neuen Abrechnungsstand

---

## BillingVisualizer (`src/billing/BillingVisualizer.ts`)

Erzeugt semitransparente Füllstand-Overlays über IFC-Elementen.

- Pro `BillingEntry`: zusammengeführtes `BufferGeometry` aller Meshes (world-space)
- `MeshBasicMaterial` mit `uFillTop`-Uniform (GLSL-Discard über Füllstand)
- Farbe: orange → grün je nach Fertigungsgrad (0 % = orange `#f97316`, 100 % = grün `#22c55e`)
- `renderOrder = 2`, `depthWrite = false`, `transparent = true`
- Aktiv nur wenn `billingModuleActive === true`
- `BillingVisualizer.update(entries, meshMap)` — `meshMap` Key = `${modelId}:${expressId}`
- `BillingVisualizer.clear()` / `.dispose()` — entfernt alle Overlays

---

## Performance-Hinweise

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` — begrenzt auf 2x
- `logarithmicDepthBuffer: true` — vermeidet Z-Fighting
- Render-on-demand: `needsRenderRef` wird gesetzt; `requestAnimationFrame`-Loop prüft Flag
- Klick-Unterdrückung: Mouse-Delta > 5px → kein Klick nach Orbit/Pan
- Inspektor-Overlays haben `depthTest=false` und `renderOrder=10/11` → immer über IFC-Geometrie sichtbar
