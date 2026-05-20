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
Main:       http://localhost:5173/
Sekundär:   http://localhost:5173/?secondary&panel=hierarchy
                                              panel=properties
                                              panel=lists
                                              panel=sql
                                              panel=qto
                                              panel=basket
Billing:    http://localhost:5173/?billing
QS-Viewer:  http://localhost:5173/?cross-section
Kollision:  http://localhost:5173/?collision
```

`main.tsx` erkennt `?billing` und rendert `<BillingApp>` statt `<App>`.
`App.tsx` erkennt (in Reihenfolge) `?collision`, `?secondary`, `?cross-section` und rendert die jeweilige Ansicht.

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

## Kollisions-Fenster-Protokoll

**Kanal:** `"infracore-collision"` (Konstante `COLLISION_CHANNEL`)

```typescript
type CollisionMsg =
  | { t: "state"; s: CollisionSyncState }   // Main → Popup: aktueller Zustand
  | { t: "req" }                             // Popup → Main: Initialzustand anfordern
  | { t: "run"; rules: ClashRule[] }         // Popup → Main: Prüfung starten
  | { t: "setStatus"; key: string; status }  // Popup → Main: Status eines Treffers ändern
```

### Ablauf
1. Popup sendet `{ t: "req" }`
2. Main antwortet mit vollem `CollisionSyncState` (Regeln, Ergebnisse, allTypes)
3. User startet Prüfung → Popup sendet `{ t: "run"; rules }` → Main läuft Detection, sendet Fortschritt-Updates
4. User ändert Status → Popup sendet `{ t: "setStatus" }` → Main aktualisiert und broadcastet neuen Zustand

### CollisionSyncState
```typescript
interface CollisionSyncState {
  rules: ClashRule[];
  results: ClashResult[];
  running: boolean;
  progress: number;   // 0..100
  allTypes: string[]; // alle IFC-Typen aus geladenen Modellen (für Rule-Editor)
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

### 3D-Schnittfläche

Wenn `showSectionSurface = true` und `crossSectionBasis` vorhanden ist, baut `ViewportContainer` aus `crossSectionPolygons` `THREE.ShapeGeometry`-Meshes und projiziert sie über `Matrix4.makeBasis(right, up, normal).setPosition(origin)` in den Weltkoordinatenraum. Die Meshes sind semi-transparent (`opacity 0.35`, `depthWrite: false`) und werden in der Gruppe `__xsSurface` gehalten.

## Checkliste bei neuen BillingMsg-Typen

1. `BillingMsg` Union in `src/billing/types.ts` erweitern
2. Sender implementieren (BillingPanel oder ViewportContainer)
3. Empfänger-Handler implementieren
4. `docs/window-system.md` aktualisieren (dieses Dokument)
