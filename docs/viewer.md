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
| `colorOverrideMeshesRef` | `Mesh[]` | Meshes mit aktivem Farb-Override (für O(k) Restore) |
| `basketOutlinesRef` | `LineSegments[]` | Gelbe Edge-Outlines für Korb-Elemente |
| `basketMatsRef` | `Map<Mesh, Material>` | Original-Materialien vor Korb-Override (Restore) |
| `pickerRef` | `FaceEdgePicker \| null` | Aktiver Geometrie-Inspektor-Picker |
| `needsRenderRef` | `boolean` | Render-on-Demand Flag |
| **`meshIndexRef`** | `Map<string, Mesh[]>` | **`"modelId:expressId"` → Meshes** — Kern-Performance-Cache |
| **`edgeLinesRef`** | `LineSegments[]` | **Alle Kanten-LineSegments** — für O(edges) Edge-Toggle |
| **`pickableMeshesRef`** | `Mesh[]` | **Alle Raycast-Kandidaten** — kein Traversal beim Klicken |
| `billingMeshMapRef` | `Map<string, Mesh[]>` | `"filename:expressId"` → Meshes für Billing-Viz |

---

## useEffect-Reihenfolge

1. **Init** — Renderer, Szene, Kamera, Controls, Beleuchtung, Grid, Axes, Render-Loop
2. **Grid/Axes** — `settings.grid/axes` → Sichtbarkeit
3. **Kanten** — `settings.edges` → O(edgeLines) via `edgeLinesRef` — kein Traversal
4. **Modelle in Szene** — `models` → fügt neue hinzu, entfernt gelöschte; baut `EdgesGeometry`-Overlays (15°); **baut danach meshIndexRef, edgeLinesRef, pickableMeshesRef, billingMeshMapRef** in einem einzigen Traversal
5. **Element-Sichtbarkeit** — `hiddenElements, isolatedElements, selectionBasket, basketMode, models` → O(index) via `meshIndexRef.forEach` — kein Traversal
6. **ColorGroup-Overrides** — `colorGroups` → O(affected) via `meshIndexRef.get(key)`; Restore O(k) via `colorOverrideMeshesRef`
7. **Korb-Visuals** — `selectionBasket, basketMode, models` → highlight: O(basket) via `meshIndexRef`; ghost: O(index)
8. **Selektion-Highlight** — `selectedElement, hiddenElements, isolatedElements` → O(1) via `meshIndexRef.get(key)`
9. **Inspektor-Mesh-Sichtbarkeit** — `inspShowMesh, inspSession` → direkt auf `inspMeshesRef`
10. **Schnittebenen** — `sectionPlanes` → `sectionModule.syncPlanes()`
11. **Billing-Viz-Subscription** — `useBillingStore.subscribe()` — kein React-Dependency
12. **BroadcastChannel-Listener** — `"infracore-billing"` Kanal
13. **viewer:alignToPlane** — Event-Listener

### Performance-Invarianten

- **Kein reaktiver Effect darf `scene.traverse()` aufrufen.** Alle reaktiven Effects nutzen ausschließlich die Index-Refs.
- `scene.traverse()` ist nur erlaubt in: models-Effect (Index-Aufbau), FaceEdgePicker-Setup (Inspector-Tagging), exportGLTF.
- Neue Features, die per-Element-Zugriff brauchen, müssen `meshIndexRef` nutzen — kein eigenes Traversal hinzufügen.

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

Implementierung: `meshIndexRef.current.forEach((meshes, key) => { … })` — kein `scene.traverse`.

---

## Material-Override-System

### ColorGroups
- Lookup via `meshIndexRef.get(key)` — O(affected elements)
- Speichert Override-Meshes in `colorOverrideMeshesRef` für O(k) Restore ohne Traversal
- Jede Farbe bekommt genau ein `MeshLambertMaterial` (geteilt zwischen Meshes gleicher Gruppe)

### Korb Hervorheben (highlight)
- Lookup via `meshIndexRef.get(key)` für jeden Korb-Key — O(basket)
- `MeshStandardMaterial(0xf59e0b)` + gelbe `EdgesGeometry`-Outlines (`renderOrder=998`)
- Original-Material in `basketMatsRef` gespeichert

### Korb Ghost
- Iteriert `meshIndexRef` für alle Nicht-Korb-Meshes — O(all)
- Klonet das aktuelle Material, setzt `transparent=true, opacity=0.10`
- Original-Material in `basketMatsRef` gespeichert

### Selektion-Highlight
- `meshIndexRef.get("modelId:expressId")` — O(1)
- `MeshStandardMaterial(0xf59e0b, opacity=0.55, depthTest=false)`
- `renderOrder = 999`, `userData.isHighlight = true`

### Kanten (Edges)
- `EdgesGeometry(geometry, 15°)` + `LineSegments` als Kind jedes Mesh beim Laden
- `userData.isEdge = true`, in `edgeLinesRef` registriert
- Toggle: `for (line of edgeLinesRef.current) line.visible = vis` — O(edges)

### Raycasting
- Kandidatenliste: `pickableMeshesRef.current.filter(isWorldVisible)` — kein Traversal
- `Raycaster.intersectObjects(meshes, false)`

**Alle Lookup-Operationen** gehen über `meshIndexRef` — kein `scene.traverse()` in reaktiven Pfaden.

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
- **three-mesh-bvh**: `acceleratedRaycast` auf `THREE.Mesh.prototype` gepatcht; `computeBoundsTree()` je Geometrie beim Mesh-Index-Rebuild → O(log T) statt O(N·T) pro Klick/Hover. BVH wird bei Modell-Entfernung mit `disposeBoundsTree()` freigegeben.
- **Frustum Culling** im Raycast: `_frustum/_projMat/_bSphere` pre-alloziert; `raycastPoint()` filtert `pickableMeshesRef` per Frustum-Sphere-Test vor `intersectObjects()` → Meshes außerhalb des Sichtfelds werden übersprungen.

### Hotpath-Optimierungen (>20 % Throughput-Gewinn)

| Optimierung | Detail |
|---|---|
| Pre-allozierte Three.js-Objekte | `_v3`, `_v3b`, `_ray`, `_ndc` als Modul-Singletons; kein GC-Druck bei 60 fps |
| `domRectRef` via ResizeObserver | `getBoundingClientRect()` nur bei Größenänderung, nicht bei jedem Maus-Event |
| Selektive `useAlignmentStore.subscribe` | Rebuild-Callbacks nur wenn relevante Felder (files/visibleIds/colors/…) geändert — `hoveredStation`-Updates bei 60 fps triggern keinen Rebuild mehr |
| `stationTicksWorldRef` Cache | 3D-Weltkoordinaten der Stations-Ticks werden nur bei Achsdaten-Änderung neu berechnet, nicht bei Kamerabewegung |
| `scheduleAnnotLabels` (RAF-throttle) | Annotations-Neuprojizierung per RAF gedrosselt — ein Aufruf pro Frame, egal wie viele `controls.change`-Events feuern |
| Vector3-Wiederverwendung | `_v3` in `updateInspLabels`, `updateMeasureLabels`, `updateAnnotLabels` wiederverwendet; kein `new THREE.Vector3()` pro Label |
| `_ray`/`_ndc`-Wiederverwendung | Raycasting in `raycastPoint`, `handleClick`, `handleDoubleClick`, `handleMouseMove` ohne neue Objekte |
| `models.size` statt `models.length` | `Map` hat `.size`, nicht `.length` — war immer `undefined` |
