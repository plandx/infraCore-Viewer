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
│       └── LineSegments[] ← Kanten-Overlay (userData.isEdge=true), ein Kind je Mesh
├── section:<planeId>       ← Ein Group je aktiver SectionPlane (userData.planeId)
│   ├── Mesh (PlaneGeometry, transparent disc)
│   ├── LineSegments (border ring)
│   ├── ArrowHelper (Normale-Pfeil)
│   └── Mesh (SphereGeometry, Drag-Handle; userData.planeId, userData.isHandle=true)
└── highlightMesh           ← Klon des selektierten Mesh (isHighlight: true)
```

## Kameras

**Perspektivisch** (Standard): `PerspectiveCamera(fov=60, near=0.01, far=500000)`

**Orthografisch**: `OrthographicCamera` — wird synchron zur Perspektiv-Kamera gehalten. Wechsel via `settings.orthographic`. Die Frustum-Größe wird aus der Perspektiv-Entfernung berechnet damit Zoom funktioniert.

**OrbitControls**: `enableDamping=false`, `screenSpacePanning=true` — kein Nachdrehen nach Mausloslassen

### Maustasten-Belegung
```typescript
controls.mouseButtons = {
  LEFT:   THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,    // Mittlere Maustaste = Pan
  RIGHT:  THREE.MOUSE.ROTATE, // Rechte Maustaste = ebenfalls Rotate
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
| `sectionVisualsRef` | `Map<string, SectionVisuals>` | planeId → Three.js-Objekte (group, handle, …) |
| `dragSectionRef` | `SectionDragState \| null` | Aktiver Schnittebenen-Drag-State |

---

## useEffect-Reihenfolge

1. **Init** — Renderer, Szene, Kamera, Controls, Beleuchtung, Grid, Axes, Render-Loop
2. **Grid/Axes** — `settings.grid/axes` → Sichtbarkeit
3. **Kanten** — `settings.edges` → setzt `visible` auf allen `isEdge`-Objekten
4. **Modelle in Szene** — `models` → fügt neue hinzu, entfernt gelöschte; baut beim Hinzufügen `EdgesGeometry`-Overlays (15° Schwelle) als Kinder jedes Mesh
5. **Element-Sichtbarkeit** — `hiddenElements, isolatedElements, selectionBasket, basketMode, models` → traversiert Szene, setzt `obj.visible`
6. **ColorGroup-Overrides** — `colorGroups` → ersetzt Materialien, speichert Originale in `userData.originalMaterial`
7. **Korb-Overrides** — `selectionBasket, basketMode, models` → Overlay-Meshes (highlight) oder Ghost-Materialien
8. **Korb-Outlines** — `selectionBasket, models` → gelbe `LineSegments` (`EdgesGeometry`, 15°, Farbe `0xfbbf24`, `depthTest=false`, `renderOrder=998`) als Kinder jedes Korb-Mesh; `userData.isBasketOutline=true`
9. **Selektion-Highlight** — `selectedElement, hiddenElements, isolatedElements` → findet alle Sub-Meshes, fügt amber Overlay-Meshes ein (`matrixWorld`-Kopie, `depthTest=false`); **kein Highlight wenn Element ausgeblendet oder isoliert**
10. **Schnittebenen-Visuals** — `sectionPlanes` → `syncSectionVisuals()`: entfernt veraltete Groups, erstellt neue per Ebene, setzt `renderer.clippingPlanes`
11. **viewer:alignToPlane** — Event-Listener: bewegt Kamera zu `P + N * dist`, setzt `controls.target = P`

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
- Nur wenn Element weder ausgeblendet noch isoliert (sonst kein Highlight)
- `new THREE.Mesh(geometry, mat)` + `updateWorldMatrix(true,false)` + `matrix.copy(matrixWorld)` + `matrixAutoUpdate=false` → korrekter World-Space-Overlay
- `MeshLambertMaterial(0xf59e0b, opacity=0.45, depthTest=false)` (amber)
- `renderOrder = 999`
- `userData.isHighlight = true`

### Kanten (Edges)
- Beim Laden jedes Modells: `EdgesGeometry(geometry, 15°)` + `LineSegments` als Kind jedes Mesh
- `userData.isEdge = true` auf allen Kanten-Objekten
- Sichtbarkeit gesteuert via `settings.edges` (Standard: **ein**)
- Toggle-Button in der Toolbar (Box-Icon)

**Raycasting überspringt** alle Meshes mit `isHighlight`, `isBasketOverlay`, `isSectionVisual`.

---

## Werkzeuge

### Select (Standard)
- Linksklick → `raycastPoint()` → `onElementClick(modelId, expressId)`
- Doppelklick → `raycastPoint()` → `ctxZoomTo(modelId, [expressId])` (Kamera zoomt auf Element)

### Measure
- 1. Klick: Punkt A speichern
- 2. Klick: Punkt B, Linie zeichnen, Abstand berechnen
- Labels: CSS-Overlays, Position via `camera.project()`
- `Esc` / `viewer:clearMeasure` Event → zurücksetzen

### Section (Mehrfach-Schnitt)
- Klick auf Fläche → `addSectionPlane()` mit Flächen-Normaler und Hit-Punkt; wechselt zu `"select"` danach
- Kontext-Menü **„Schnitt auf dieser Fläche"** → gleicher Effekt via `onSectionFromFace`
- Schnittebenen-Drag: Handle-Sphere ziehen → Ebene entlang ihrer Normalen verschieben

---

## Schnittebenen-System — SectionModule (`src/section/`)

Das gesamte Schnittebenen-System ist als eigenständiges Paket ausgelagert. ViewportContainer hält nur noch eine Ref `sectionModuleRef` und ruft `module.syncPlanes(planes)` bei Store-Änderungen auf.

### Dateistruktur

```
src/section/
  index.ts           — Public API (Re-Export)
  SectionModule.ts   — Haupt-Controller-Klasse
  CapGenerator.ts    — CPU-Schnittflächen: Triangle-Plane-Intersection + Earcut
```

### SectionModule API

```typescript
class SectionModule {
  constructor(cfg: SectionModuleConfig)   // erhält scene, handleScene, renderer, callbacks
  syncPlanes(planes: SectionPlane[]): void // aus ViewportContainer useEffect
  setVisualsHidden(hidden: boolean): void  // Gizmos ein/aus, Clipping bleibt aktiv
  dispose(): void                          // vollständige Bereinigung
}
```

### userData-Flags

| Flag | Bedeutung |
|---|---|
| `isSectionVisual = true` | Gizmo-Geometrie (Disc, Border, Arrow) — Raycast skip |
| `isSectionHandle = true` | Drag-Handle Sphere — nur in Handle-Raycast |
| `isSectionCap = true` | Cap/Edge Mesh — Raycast skip, ColorGroup skip |

### Schnittflächen (Caps)

**Algorithmus** (CPU, pro Mesh × Ebene):
1. BoundingBox-Vorfilter — überspringt Meshes die die Ebene nicht schneiden
2. Für jedes Dreieck: Berechne Schnittpunkte mit Ebene → 0 oder 2 Punkte → Segment
3. Segmente zu geschlossenen Schleifen verketten (quantisierter Punkt-Hash, ε = 1e-5)
4. 2D-Projektion auf Ebenenbasis (U/V) → Flächenvorzeichen prüfen (CCW-Pflicht für Earcut)
5. `THREE.ShapeUtils.triangulateShape` (Earcut-Wrapper aus Three.js)
6. Rückprojektion → `BufferGeometry` für Fläche + Konturkanten

**Materialien:**
- Cap-Fläche: `MeshLambertMaterial`, Farbe aus Mesh-Material (aufgehellt), `polygonOffset (-2/-2)`
- Konturkanten: `LineBasicMaterial(0x111111)`, `renderOrder 2`, `polygonOffset (-4/-4)`

**Performance:**
- Rebuild debounced 150 ms nach Plane-Änderung
- Während Drag: kein Rebuild (smooth 60 fps); Rebuild nach mouseup

### Drag-Ablauf

1. `pointerdown` (capture) auf Handle → `setPointerCapture` → deaktiviert OrbitControls
2. `pointermove` (window) → Ray ∩ ViewPlane → Delta entlang Normal → Gizmo + `renderer.clippingPlanes` direkt aktualisiert
3. `pointerup` (window) → persistiert via `onPlaneMoved` Callback → Store-Update → Re-Render

**Gilt für Solo- und Box-Planes** — Box-Drag speichert korrekt per Handle-Position (früherer Bug behoben).

### Gizmos

- **Solo-Plane**: Kreisscheibe (CircleGeometry, 64 Segmente) + Kreisrand (LineLoop) + ArrowHelper + Kugelhandle
- **Box-Schnitt**: Halb-transparenter Kubus (DoubleSide) + Kantenlinien + 6 Flächenhandles — alles in `handleScene`
- Alle Gizmos in `handleScene` → werden ohne `renderer.clippingPlanes` gerendert → nie weggeschnitten

---

## Globale Window-Events

| Event | Auslöser | Aktion |
|---|---|---|
| `viewer:fitAll` | Taste `F`, Toolbar-Button | Kamera auf alle sichtbaren Modelle |
| `viewer:fitTo` | HierarchyPanel | Kamera auf BoundingBox (CustomEvent.detail) |
| `viewer:zoomToElement` | HierarchyPanel, Doppelklick im Viewport | Kamera auf ein oder mehrere Elemente; `detail: { modelId, expressIds: number[] }` |
| `viewer:preset` | Toolbar-Dropdown | Kamera auf Preset (top/front/left/…) |
| `viewer:exportGLTF` | Toolbar | GLTF-Export |
| `viewer:screenshot` | Toolbar | PNG-Screenshot |
| `viewer:clearMeasure` | Esc-Key, Toolbar | Alle Messungen löschen |
| `viewer:alignToPlane` | SectionPanel Kamera-Button | Kamera senkrecht zur Schnittebene ausrichten; `detail: { normal: [x,y,z], point: [x,y,z] }` |

### `ctxZoomTo(modelId, expressIds)`

Interne Funktion: Sammelt BoundingBoxen aller angegebenen Express-IDs, berechnet die kombinierte Box und setzt `controls.target` + `camera.position` so dass alle Elemente ins Bild passen.

---

## Rechtsklick-Kontextmenü

Erscheint bei Rechtsklick auf ein Element. Optionen:
- **Zoom to** — zoomt auf das geklickte Element (`ctxZoomTo`)
- **Isolieren** — `isolateElement()`
- **Ausblenden** — `hideElement()`
- **Alles einblenden** — `showAll()`
- **Zum Korb hinzufügen / Aus Korb entfernen** — `addToBasket()` / `removeFromBasket()`
- **Gleiche Klasse wählen** — wählt alle Elemente desselben IFC-Typs (`setBasket`)
- **Gleiches Geschoss wählen** — traversiert Spatial-Tree, findet das Storey des Elements, wählt alle Elemente darunter
- **Schnitt auf dieser Fläche** — fügt eine `SectionPlane` mit der angeklickten Flächen-Normalen und dem Hit-Punkt hinzu

Schließt sich bei nächstem `click`-Event (einmaliger Window-Listener).

---

## Doppelklick

- Raycasts auf das angeklickte Element
- Ruft `ctxZoomTo(modelId, [expressId])` auf → Kamera zoomt auf das Element
- Auch aus dem HierarchyPanel auslösbar via `viewer:zoomToElement`-Event (für Eltern-Knoten: alle Kind-IDs)

---

## Performance-Hinweise

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` — begrenzt auf 2x
- `logarithmicDepthBuffer: true` — vermeidet Z-Fighting bei großen Modellen
- Klick-Unterdrückung: Mouse-Delta > 5px → kein Klick nach Orbit/Pan
- Material-Disposal bei Cleanup immer aufrufen (Memory Leak vermeiden)
