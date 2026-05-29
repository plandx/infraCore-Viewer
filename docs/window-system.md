# Multi-Window-System

infraCore-Viewer unterstützt mehrere Browser-Fenster **innerhalb derselben App-Session**.
Die Fenster teilen keinen gemeinsamen Prozess — Kommunikation läuft über die **BroadcastChannel API**.

---

## Konzept

```
Main-Fenster                         Sekundär-Fenster
─────────────────────────────────────────────────────
Zustand-Store                        Zustand-Store (Kopie)
    │                                    │
    ├──── BroadcastChannel ─────────────►│  State-Push (80ms debounce)
    │◄─── BroadcastChannel ──────────────┤  State-Push (bidirektional)
    │                                    │
    └── applyingRef schützt Echo-Loop ───┘
```

Beide Fenster halten **je einen eigenen Zustand-Store**. Änderungen in einem Fenster werden als vollständiger Snapshot übertragen und im anderen angewendet.

---

## URL-Schema

```
Main:           http://localhost:5173/
Sekundär:       http://localhost:5173/?secondary&panel=hierarchy
                                                  panel=properties
                                                  panel=lists
                                                  panel=sql
                                                  panel=qto
                                                  panel=basket
Billing:        http://localhost:5173/?billing
QS-Viewer:      http://localhost:5173/?cross-section
Kollision:      http://localhost:5173/?collision
Korb:           http://localhost:5173/?basket
Längenschnitt:  http://localhost:5173/?longitudinal-section
Abwicklung:     http://localhost:5173/?abwicklung
IDS-Ergebnisse: http://localhost:5173/?ids-results
```

`main.tsx` erkennt `?billing` und rendert `<BillingApp>` statt `<App>`.
`App.tsx` erkennt (in Reihenfolge) `?collision`, `?ids-results`, `?secondary`, `?cross-section`, `?long-section`, `?basket` und rendert die jeweilige Ansicht.

---

## Nachrichten-Protokoll

**Kanal:** `"infracore-sync"` (Konstante `SYNC_CHANNEL`)

```typescript
type SyncMsg =
  | { t: "state"; s: SyncState }  // Vollständiger Zustand-Snapshot
  | { t: "req" }                   // Neues Fenster bittet um aktuellen Zustand
  | { t: "act"; a: SyncAction }   // Legacy: Einzelne Aktion (noch im Main-Fenster verarbeitet)
```

### Ablauf beim Öffnen eines Sekundär-Fensters
1. Sekundär-Fenster sendet `{ t: "req" }`
2. Main-Fenster antwortet mit `{ t: "state", s: serializeState(store) }`
3. Sekundär-Fenster wendet State an via `applyRemoteState()`

### Laufender Sync
- Jede Store-Änderung → 80ms-Debounce → `{ t: "state", s: ... }` senden
- Empfänger wendet State an → `applyRemoteState()` triggert erneut eine Store-Änderung
- **Echo wird verhindert** durch `applyingRef` (s.u.)

---

## Echo-Loop-Prävention

Zustand-Subscriptions feuern **synchron** während `set()`.

```typescript
const applyingRef = useRef(false);

ch.onmessage = (e) => {
  if (e.data.t === "state") {
    applyingRef.current = true;
    applyRemoteState(e.data.s);    // set() → Subscription feuert → sieht Flag → skip
    applyingRef.current = false;   // sofort zurücksetzen (synchron!)
  }
};

useModelStore.subscribe(() => {
  if (applyingRef.current) return;
  // ... debounce + senden
});
```

---

## Serialisierung

**Datei:** `src/utils/windowSync.ts` — `serializeState(store)`

```typescript
interface SyncState {
  models: SyncModel[];
  selectedElement: SelectedElement | null;
  settings: ViewerSettings;
  hiddenElements: string[];       // Set<string> → Array
  isolatedElements: string[] | null;
  colorGroups: ColorGroup[] | null;
  smartViews: SmartView[];
  activeSmartViewId: string | null;
  loadedPropKeys: string[];
  selectionBasket: string[];      // Set<string> → Array
  basketMode: BasketMode | null;
}
```

**Nicht serialisiert:** `propertyOverrides` — Eigenschafts-Editierungen sind session-lokal.

### SyncModel (kein Three.js!)
```typescript
interface SyncModel {
  id: string;
  name: string;
  file: File;       // File ist structured-clone-fähig
  visible: boolean;
  color: string;
  opacity: number;
  size: number;
  elementsByType: Record<string, ElementNode[]>;
  spatialTree: SpatialNode | null;
}
```

Three.js-Objekte (`mesh`, `boundingBox`, `originOffset`) werden **nicht** serialisiert — `applyRemoteState` behält vorhandene Werte.

---

## Sekundär-Fenster öffnen

```typescript
export const PANEL_META: Record<PanelType, { label: string; w: number; h: number }> = {
  hierarchy:  { label: "Hierarchiebaum",      w: 380, h: 700 },
  properties: { label: "Eigenschaften",       w: 420, h: 600 },
  lists:      { label: "Lens Rules",          w: 480, h: 640 },
  sql:        { label: "SQL-Abfrage",         w: 760, h: 480 },
  basket:     { label: "Auswahlkorb",         w: 380, h: 600 },
};
```

### Billing-Fenster öffnen

```typescript
export function openBillingWindow() {
  window.open(`?billing`, "infracore-billing", "width=1100,height=760,resizable=yes");
}
```

### Kollisions-Fenster öffnen

```typescript
export function openCollisionWindow() {
  window.open(`?collision`, "infracore-collision", "width=1100,height=780,resizable=yes");
}
```

`App.tsx` erkennt `?collision` und rendert `<CollisionWindow>`.

---

## IDS-Ergebnisse-Fenster-Protokoll

**Kanal:** `"infracore-ids-results"` (Konstante `IDS_RESULTS_CHANNEL`)

```typescript
type IdsResultsMsg =
  | { t: "state"; report: IdsValidationReport | null; theme: string }  // Main → Popup: aktueller Bericht
  | { t: "req" }                                                        // Popup → Main: Initialzustand anfordern
```

Der Popup sendet Auswahl-/Isolier-Aktionen über den Haupt-Sync-Kanal (`SYNC_CHANNEL`):
```typescript
{ t: "act"; a: { k: "select"; modelId; expressId } }
{ t: "act"; a: { k: "isolate"; modelId; expressId } }
{ t: "act"; a: { k: "showAll" } }
```

**Öffnen:** `openIdsResultsWindow()` in `windowSync.ts`; Button im IDSPanel-Header und im MainToolbar IDS-Tab.

**Gruppiermodi:** `spec` | `pset` | `missingProp` | `ifcClass` | `ifcFile`

---

## Kollisions-Fenster-Protokoll

**Kanal:** `"infracore-collision"` (Konstante `COLLISION_CHANNEL`)

```typescript
type CollisionMsg =
  | { t: "state"; s: CollisionSyncState }                                            // Main → Popup: aktueller Zustand
  | { t: "req" }                                                                     // Popup → Main: Initialzustand anfordern
  | { t: "run"; rules: ClashRule[] }                                                 // Popup → Main: Prüfung starten
  | { t: "setStatus"; key: string; status: ClashStatus }                             // Popup → Main: Status eines Treffers ändern
  | { t: "isolate"; modelIdA: string; expressIdA: number; modelIdB: string; expressIdB: number }  // Popup → Main: Kollisionspaar isolieren
```

### Ablauf
1. Popup sendet `{ t: "req" }`
2. Main antwortet mit vollem `CollisionSyncState` (Regeln, Ergebnisse, allTypes, loadedPropKeys)
3. User startet Prüfung → Popup sendet `{ t: "run"; rules }` → Main läuft Detection, sendet Fortschritt-Updates
4. User ändert Status → Popup sendet `{ t: "setStatus" }` → Main aktualisiert und broadcastet neuen Zustand
5. User klickt Isolieren-Button → Popup sendet `{ t: "isolate" }` → Main ruft `isolateEntries()` im Viewer auf

### CollisionSyncState
```typescript
interface CollisionSyncState {
  rules: ClashRule[];
  results: ClashResult[];
  running: boolean;
  progress: number;        // 0..100
  allTypes: string[];      // alle IFC-Typen aus geladenen Modellen (für Rule-Editor Typ-Filter)
  loadedPropKeys: string[]; // alle bekannten Property-Schlüssel (für Autocomplete in Bedingungen)
}
```

---

## 5D-Abrechnung Kanal

**Kanal:** `"infracore-billing"` (Konstante `BILLING_CHANNEL` in `billingStore.ts`)

Separater BroadcastChannel ausschließlich für das Billing-Modul.

### Vollständiges Nachrichtenprotokoll

```typescript
type BillingMsg =
  | { t: "ready" }
  // Billing-Fenster → Main: "Ich bin da"

  | { t: "elements"; list: ElementInfo[] }
  // Main → Billing: aktuelle Elementliste aller geladenen Modelle

  | { t: "moduleActive"; active: boolean }
  // Billing → Main: 3D-Füllstand-Visualisierung ein/aus

  | { t: "dataSync"; entries: BillingEntry[] }
  // beliebig → beliebig: Billing-Datensynchronisation

  | { t: "selectEntry"; key: string }
  // Billing → Main: Element im Viewer hervorheben / selektieren

  | { t: "isolateTracked" }
  // Billing → Main: alle erfassten 5D-Elemente isolieren

  | { t: "requestQuantities"; key: string }
  // Billing → Main: Mengen automatisch berechnen (Divergenz-Theorem)

  | { t: "quantities"; key: string; data: ElementQuantities | null }
  // Main → Billing: berechnete Mengen als Antwort auf requestQuantities

  | { t: "startInspection"; key: string; elementName: string }
  // Billing → Main: Geometrie-Inspektor starten (Element isolieren + Picker aktivieren)
```

### Nachrichten-Flows

#### Elementliste
1. Billing-Fenster öffnet sich, sendet `{ t: "ready" }`
2. Main antwortet mit `{ t: "elements", list }` aller Elemente aller Modelle
3. Bei Modellwechsel im Main sendet es erneut `{ t: "elements", ... }`

#### Datensync
- Jede Billing-Store-Mutation → `{ t: "dataSync", entries }` → synchronisiert localStorage + Store in beiden Fenstern

#### Mengenberechnung (Auto)
1. User klickt „Auto" in BillingPanel
2. `{ t: "requestQuantities", key }` → ViewportContainer
3. ViewportContainer: sammelt Meshes, `computeQuantities()`, sendet `{ t: "quantities", key, data }`
4. BillingPanel: `setLiveQuantities(data)` → Anzeige aktualisiert

#### Geometrie-Inspektor (Messen)
1. User klickt „Messen" in BillingPanel
2. `{ t: "startInspection", key, elementName }` → ViewportContainer
3. ViewportContainer: `isolateEntries()`, `GeometryAnalyzer.analyze()`, `FaceEdgePicker.load()`
4. `GeometryInspectorPanel` erscheint im Viewer
5. User wählt Flächen/Kanten, klickt „In 5D-Eintrag speichern"
6. `billingStore.setQuantities(key, { ... })` → `{ t: "dataSync" }` → BillingPanel aktualisiert

### ElementQuantities

```typescript
interface ElementQuantities {
  volume:      number;  // m³
  surfaceArea: number;  // m²
  bboxX:       number;  // m
  bboxY:       number;  // m
  bboxZ:       number;  // m
  computedAt:  string;  // ISO 8601
}
```

`volume` und `bboxX/Y/Z` können aus der Auto-Berechnung stammen. `surfaceArea` kann aus dem Geometrie-Inspektor stammen (manuell ausgewählte Flächen). Beide Quellen können gemischt werden — beim Speichern aus dem Inspektor wird `volume` aus dem bestehenden Eintrag beibehalten.

---

## Datenpersistenz

- Billing-Einträge: `localStorage["infracore-billing-v1"]` — überleben Browser-Reload
- Billing-Keys: `filename:expressId` (stabil) statt `modelId:expressId` (UUID, ändert sich je Session)

---

## Einschränkungen

- BroadcastChannel funktioniert nur **same-origin**
- Sekundär-Fenster haben **kein 3D-Viewport**
- `viewer:fitAll`, `viewer:fitTo`, `viewer:zoomToElement` nur im Main-Fenster
- `propertyOverrides` wird **nicht** synchronisiert

---

## Checkliste bei neuen Store-Feldern

1. `ModelStore` Interface (`modelStore.ts`)
2. Initialwert in `create()` (`modelStore.ts`)
3. `SyncState` Interface (`types/ifc.ts`) *(wenn synchronisierbar)*
4. `serializeState()` (`windowSync.ts`)
5. `applyRemoteState()` (`modelStore.ts`)
6. `docs/state-management.md` + `docs/window-system.md` aktualisieren

## Querschnitt-Kanal (`"infracore-cross-section"`)

Separater BroadcastChannel für das Querschnitt-Fenster (`?cross-section`).

```
Main-Fenster (useCrossSectionSync)        CrossSectionWindow
──────────────────────────────────────────────────────────────
   │── { t: "state", s: XSSyncState } ──►│  vollständiger Push
   │◄─ { t: "req" } ────────────────────│  beim Öffnen des Fensters
   │◄─ { t: "setStation", ... } ─────────│  Stationsnavigation
   │◄─ { t: "nextStation", delta } ──────│  Schritt-Navigation
   │◄─ { t: "setMode", mode } ───────────│  Modus-Wechsel
   │◄─ { t: "toggleSectionSurface" } ────│  3D-Fläche ein/aus
   │◄─ { t: "setDepthView", enabled, distance? } ─│  Tiefenansicht ein/aus + Distanz
```

### XSSyncState

| Feld | Typ | Bedeutung |
|---|---|---|
| `station` | `number \| null` | Aktuelle Station in Metern |
| `alignmentId` | `number \| null` | ID des Alignments |
| `alignmentName` | `string` | Anzeigename |
| `staStart` / `staEnd` | `number` | Alignment-Ausdehnung |
| `mode` | `"vertical" \| "normal"` | Schnittmodus |
| `lines` | `XSSyncLine[]` | Rohsegmente des 2D-Schnitts |
| `polygons` | `XSSyncPolygon[]` | Geschlossene Polygone (für Hatch-Fill) |
| `computing` | `boolean` | Berechnung aktiv |
| `showSectionSurface` | `boolean` | 3D-Schnittfläche im Viewport sichtbar |
| `depthView` | `boolean` | Tiefenansicht aktiv |
| `depthDistance` | `number` | Sichttiefe in Metern |
| `depthLines` | `XSSyncDepthLine[]` | Projizierte Kanten — `{ x1,y1,x2,y2, hidden, color }` |

### 3D-Schnittfläche

Wenn `showSectionSurface = true` und `crossSectionBasis` vorhanden ist, baut `ViewportContainer` aus `crossSectionPolygons` `THREE.ShapeGeometry`-Meshes und projiziert sie über `Matrix4.makeBasis(right, up, normal).setPosition(origin)` in den Weltkoordinatenraum. Die Meshes sind semi-transparent (`opacity 0.35`, `depthWrite: false`) und werden in der Gruppe `__xsSurface` gehalten.

## Checkliste bei neuen BillingMsg-Typen

1. `BillingMsg` Union in `src/billing/types.ts` erweitern
2. Sender implementieren (BillingPanel oder ViewportContainer)
3. Empfänger-Handler implementieren
4. `docs/window-system.md` aktualisieren (dieses Dokument)

---

## Längenschnitt-Fenster (`LS_CHANNEL = "infracore-longitudinal-section"`)

### Öffnen
```typescript
openLongitudinalSectionWindow()  // → ?longitudinal-section, 1200×600
```
Wird aus `ProfileViewer` nach `openLongSection(...)` aufgerufen.

### Protokoll (LSMsg)

```
Main-Fenster (useLongitudinalSectionSync)        LongitudinalSectionWindow
────────────────────────────────────────────────────────────────────────────
   │── { t: "state", s: LSSyncState } ──────────►│  vollständiger Push
   │◄─ { t: "req" } ───────────────────────────│  beim Öffnen
   │◄─ { t: "setRange", staStart, staEnd } ────│  Benutzer ändert Bereich
   │◄─ { t: "close" } ─────────────────────────│  Fenster geschlossen
```

Bei `req` im Hauptfenster: `broadcastLSState()` + wenn `lsAlignmentId !== null && !lsComputing` → `retrigger` via `setLSResult([], [])` + `openLongSection(...)`.

### LSSyncState

| Feld | Typ | Bedeutung |
|---|---|---|
| `alignmentId` | `number \| null` | Alignment-ID |
| `alignmentName` | `string` | Anzeigename |
| `staStart` / `staEnd` | `number` | Stationsbereich in Metern |
| `lines` | `LSLineSync[]` | IFC-Schnittlinien `{ sta1,elev1,sta2,elev2,color,objectKey? }` |
| `profile` | `LSProfilePt[]` | Gradiente-Punkte `{ sta, elev }` |
| `computing` | `boolean` | Berechnung läuft |
| `depthView` | `boolean` | Tiefenansicht aktiv |
| `depthDistance` | `number` | Sichttiefe in Metern |
| `depthLines` | `LSDepthLineSync[]` | Projizierte Tiefenlinien `{ sta1,elev1,sta2,elev2,hidden,color }` |
| `theme` | `"light" \| "dark"` | Farb-Theme des Hauptfensters |

### Berechnungslogik (`ViewportContainer.tsx`, `computeLS()`)

1. Polylinien-Cache (`alignPolylineRef`) für das aktive Alignment laden
2. Für jedes Segment zwischen `lsStaStart` und `lsStaEnd`:
   - `normal = (-dzH/hLen, 0, dxH/hLen)` (horizontale Senkrechte)
   - `right  = (dxH/hLen, 0, dzH/hLen)` (horizontale Tangente)
   - `LSSegmentPlane` mit `{ origin, normal, right, staA, staDiff, hLen }` erstellen
3. `sliceSceneLS(scene, segs, staStart, staEnd)` — ein Traversal für alle Segmente
4. Gradiente mit `evaluateProfile(profileGeom, sta)` an 600 Punkten abtasten
5. `setLSResult(lines, profile)` in Store schreiben

### longitudinalSectionUtils.ts

- `LSSegmentPlane` — Interface für eine Schnittebene-Beschreibung pro Segment
- `sliceSceneLS(meshes, segs, staStart, staEnd)` — Kern-Algorithmus:
  - Nimmt `THREE.Mesh[]` statt `THREE.Scene` — kein scene.traverse im Aufrufpfad
  - Pro Mesh: AABB-Test gegen alle Segmentebenen (Bounding-Sphere reject: Normalabstand + rechte Ausdehnung)
  - Pro Dreieck: Ebenen-Intersection, x → Station-Mapping, Bereichsfilter
  - Gibt `LSLine[]` zurück (in Three.js Y-Koordinaten)
- `computeLSDepthLines(meshes, segs, staStart, staEnd, maxDist)` — Tiefenlinien (kein Raycast):
  - Phase 1: AABB-Metadaten je Mesh via 8-Ecken-Transformation (korrekt für beliebige Rotationen)
  - Phase 2: Per-Kanten-AABB-Tiefenvergleich — kein Raycast, O(E×M) statt O(E×M×T)
  - Caller (ViewportContainer) baut `meshes`-Liste einmal und übergibt sie an beide Funktionen

---

## Abwicklung-Fenster (`ABWICKLUNG_CHANNEL = "infracore-abwicklung"`)

### Konzept

Projiziert IFC-Kantengeometrie in ein **Korridorkoordinatensystem**: X = Station entlang der Achse, Y = Lateralabstand (+ = rechts, − = links). Ergibt eine „abgerollte" Grundrissdarstellung des Korridors.

### Öffnen
```typescript
openAbwicklungWindow()  // → ?abwicklung, 1200×640
```
Wird aus `ProfileViewer` aufgerufen (Button neben „Längenschnitt", erscheint wenn LS-Bereich gewählt ist).

### Protokoll (AbwicklungMsg)

```
Main-Fenster (useAbwicklungSync)          AbwicklungWindow
──────────────────────────────────────────────────────────
   │── { t: "state", s: AbwicklungSyncState } ──►│  vollständiger Push
   │◄─ { t: "req" } ─────────────────────────────│  beim Öffnen
   │◄─ { t: "setRange", staStart, staEnd } ───────│  Benutzer ändert Bereich
   │◄─ { t: "setOffsets", left, right } ──────────│  Korridor-Breite ändern
   │◄─ { t: "close" } ───────────────────────────│  Fenster geschlossen
```

### AbwicklungSyncState

| Feld | Typ | Bedeutung |
|---|---|---|
| `alignmentId` | `number \| null` | Alignment-ID |
| `alignmentName` | `string` | Anzeigename |
| `staStart` / `staEnd` | `number` | Stationsbereich in Metern |
| `leftOffset` / `rightOffset` | `number` | Korridor-Halbbreite links/rechts in Metern |
| `lines` | `AbwicklungLineSync[]` | Projizierte IFC-Kanten `{ s1,t1,s2,t2,elevMid,color,objectKey? }` |
| `objectLabels` | `XSSyncObjectLabel[]` | Label je sichtbarem Abwicklungs-Element `{ key, name, type, props }` |
| `computing` | `boolean` | Berechnung läuft |
| `elevationOrigin` | `number` | oz — addieren für absolute Höhe |
| `theme` | `"light" \| "dark"` | Farb-Theme |

### Berechnungslogik (`abwicklungUtils.ts`, `computeAbwicklung()`)

1. Polylinien-Segmente im Stationsbereich ± 5 m Puffer filtern
2. Für jedes Segment: Tangente `(tx,tz)`, Rechtsrichtung `(rx=-tz, rz=tx)` berechnen
3. **Stations-Buckets** aufbauen: 100-Meter-Buckets für O(1)-Projektion (`buildBuckets`)
4. Korridor-AABB im Weltkoordinatenraum (XZ) für Mesh-Breitband-Ablehnung aufbauen
5. Pro Mesh: Bounding-Sphere gegen Korridor-AABB testen → bei Miss: überspringen
6. Kanten aus `isEdge LineSegments`-Kind, alternativ **gecachter** `EdgesGeometry` (`mesh.userData.__abwkEdges`)
7. Pro Kante: Weltkoordinaten-Transformation via `mesh.matrixWorld`, dann `projectPoint(wx,wz,segs,buckets)` → `[station, lateral]`
8. Stationsbereich- und Lateralbereich-Filter → `AbwicklungLine[]`
9. Labels aus Mesh-Parent-Hierarchie (`userData.modelId`, `userData.ifcType`, `userData.name`) → `XSSyncObjectLabel[]`

**Performance-Optimierungen:**
- **EdgesGeometry-Cache**: `mesh.userData.__abwkEdges` — wird beim ersten Aufruf erzeugt und wiederverwendet; verhindert O(N)-Neu-Triangulierung bei jeder Bereichsänderung
- **Stations-Bucket-Lookup**: Stationsschätzung via Dot-Product → ±2-Bucket-Suche; Fallback auf Vollscan nur wenn kein Kandidat in Nachbar-Buckets; O(1) average statt O(N_segs)

**Koordinatensystem:** `projectPoint` gibt `[station, lateral]` zurück — lateral ist das vorzeichenbehaftete senkrechte Abstandsmaß zur Achse (+ = rechts, berechnet als `perpX*rx + perpZ*rz`).
