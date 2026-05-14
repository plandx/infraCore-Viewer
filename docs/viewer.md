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
├── model:<uuid>            ← Three.js Group je Modell
│   └── Mesh[]             ← Geometrie-Meshes, userData.expressId gesetzt
├── __sectionGroup          ← Schnittebene-Visuals (nur wenn aktiv)
│   ├── PlaneGeometry (disc)
│   ├── GridLines
│   ├── Border
│   ├── ArrowHelper
│   └── handleMesh         ← Drag-Handle Sphere
└── highlightMesh           ← Klon des selektierten Mesh (isHighlight: true)
```

## Kameras

**Perspektivisch** (Standard): `PerspectiveCamera(fov=60, near=0.01, far=500000)`

**Orthografisch**: `OrthographicCamera` — wird synchron zur Perspektiv-Kamera gehalten. Wechsel via `settings.orthographic`. Die Frustum-Größe wird aus der Perspektiv-Entfernung berechnet damit Zoom funktioniert.

**OrbitControls**: `enableDamping=false`, `screenSpacePanning=true` — kein Nachdrehen nach Mausloslassen

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
| `sectionGroupRef` | `Group` | Schnittebene-Visuals-Gruppe |
| `sectionHandleRef` | `Mesh` | Drag-Handle Sphere |

---

## useEffect-Reihenfolge

1. **Init** — Renderer, Szene, Kamera, Controls, Beleuchtung, Grid, Axes, Render-Loop
2. **Clip Plane Renderer** — `settings.clipPlanes/clipNormal/clipPoint` → `renderer.clippingPlanes`
3. **Section Visuals** — `settings.clipPlanes/clipNormal` → baut/entfernt `__sectionGroup`
4. **Section Position Sync** — `settings.clipPoint/clipNormal` → verschiebt Visuals ohne neu aufzubauen
5. **Grid/Axes** — `settings.grid/axes` → Sichtbarkeit
6. **Kanten** — `settings.edges` → setzt `visible` auf allen `isEdge`-Objekten
7. **Modelle in Szene** — `models` → fügt neue hinzu, entfernt gelöschte; baut beim Hinzufügen `EdgesGeometry`-Overlays (15° Schwelle) als Kinder jedes Mesh
8. **Element-Sichtbarkeit** — `hiddenElements, isolatedElements, selectionBasket, basketMode, models` → traversiert Szene, setzt `obj.visible`
9. **ColorGroup-Overrides** — `colorGroups` → ersetzt Materialien, speichert Originale in `userData.originalMaterial`
10. **Korb-Overrides** — `selectionBasket, basketMode, models` → Overlay-Meshes (highlight) oder Ghost-Materialien
11. **Selektion-Highlight** — `selectedElement` → findet alle Sub-Meshes, fügt amber Overlay-Meshes ein (`matrixWorld`-Kopie, `depthTest=false`)

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

Drei unabhängige Override-Ebenen (müssen in Reihenfolge aufgebaut/abgebaut werden):

### ColorGroups
- Speichert Original in `obj.userData.originalMaterial`
- Erstellt `MeshLambertMaterial(color)`
- Cleanup: restores `userData.originalMaterial`, disposed tracked materials

### Korb Hervorheben (highlight)
- Klonet betroffene Meshes als Overlay (nicht Material-Austausch)
- Shared amber Material: `MeshLambertMaterial(0xf59e0b, opacity=0.55, depthTest=false)`
- `renderOrder = 997`
- `userData.isBasketOverlay = true`

### Korb Ghost
- Klonet das aktuelle Material (nicht das Original um Shared-Material-Mutation zu vermeiden)
- Setzt `transparent=true, opacity=0.12`
- Speichert Original in `basketGhostMatsRef`
- Cleanup: restores aus Map

### Selektion-Highlight
- Findet alle Sub-Meshes des selektierten Elements per `traverse`
- `new THREE.Mesh(geometry, mat)` + `updateWorldMatrix(true,false)` + `matrix.copy(matrixWorld)` + `matrixAutoUpdate=false` → korrekter World-Space-Overlay
- `MeshLambertMaterial(0xf59e0b, opacity=0.45, depthTest=false)` (amber)
- `renderOrder = 999`
- `userData.isHighlight = true`

### Kanten (Edges)
- Beim Laden jedes Modells: `EdgesGeometry(geometry, 15°)` + `LineSegments` als Kind jedes Mesh
- `userData.isEdge = true` auf allen Kanten-Objekten
- Sichtbarkeit gesteuert via `settings.edges` (Standard: ein)
- Toggle-Button in der Toolbar (Box-Icon)

**Raycasting überspringt** alle Meshes mit `isHighlight`, `isBasketOverlay`, `isSectionVisual`.

---

## Werkzeuge

### Select (Standard)
- Linksklick → `raycastPoint()` → `onElementClick(modelId, expressId)`

### Measure
- 1. Klick: Punkt A speichern
- 2. Klick: Punkt B, Linie zeichnen, Abstand berechnen
- Labels: CSS-Overlays, Position via `camera.project()`
- `Esc` / `viewer:clearMeasure` Event → zurücksetzen

### Section
- Klick auf Fläche → Normalen der Fläche **negiert** als Clip-Normal
- Clip-Punkt = Hit-Point
- Schnittebene-Drag: Handle-Sphere ziehen → neuer Clip-Punkt
- Drag projiziert auf View-Plane, dann auf Clip-Normal

---

## Schnittebene-Drag

1. `mousedown` auf Handle → baut View-Plane auf (senkrecht zur Kamera)
2. `mousemove` → schneidet Ray mit View-Plane → Delta projiziert auf Clip-Normal → neuer Punkt
3. Aktualisiert 3D-Visuals **direkt** (kein React-State für Smooth-Dragging)
4. `mouseup` → persistiert in Store via `updateSettings({ clipPoint })`

**OrbitControls werden während Drag deaktiviert** (`controls.enabled = false`).

---

## Globale Window-Events

| Event | Auslöser | Aktion |
|---|---|---|
| `viewer:fitAll` | Taste `F`, Toolbar-Button | Kamera auf alle sichtbaren Modelle |
| `viewer:fitTo` | HierarchyPanel | Kamera auf BoundingBox (CustomEvent.detail) |
| `viewer:preset` | Toolbar-Dropdown | Kamera auf Preset (top/front/left/…) |
| `viewer:exportGLTF` | Toolbar | GLTF-Export |
| `viewer:screenshot` | Toolbar | PNG-Screenshot |
| `viewer:clearMeasure` | Esc-Key, Toolbar | Alle Messungen löschen |

---

## Rechtsklick-Kontextmenü

Erscheint bei Rechtsklick auf ein Element. Optionen:
- Isolieren
- Ausblenden
- Alles einblenden
- Modell einpassen

Schließt sich bei nächstem `click`-Event (einmaliger Window-Listener).

---

## Doppelklick

Wendet die `stagedSmartViewId` an (wenn vorhanden und noch nicht aktiv).

---

## Performance-Hinweise

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` — begrenzt auf 2x
- `logarithmicDepthBuffer: true` — vermeidet Z-Fighting bei großen Modellen
- Klick-Unterdrückung: Mouse-Delta > 5px → kein Klick nach Orbit/Pan
- Material-Disposal bei Cleanup immer aufrufen (Memory Leak vermeiden)
