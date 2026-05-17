# State Management

**Bibliothek:** Zustand 5 (`zustand`)
**Datei:** `src/store/modelStore.ts`

Ein einziger globaler Store für den gesamten App-Zustand.

---

## Typen

### `PropOverride`

```typescript
interface PropOverride {
  value: string;      // Neuer Wert als String
  ifcType?: number;   // IFC-Typ-Code: 1=STRING, 2=IDENTIFIER, 3=TEXT,
                      //               14=REAL, 16=INTEGER, 18=BOOLEAN
}
```

### `TierAction`

```typescript
type TierAction =
  | "add"               // Hinzufügen: matched einblenden
  | "remove"            // Entfernen: matched ausblenden
  | "removeOthers"      // Andere entfernen: nicht-matched ausblenden
  | "color"             // Farbig einstellen: Flat-Color (opacity 1)
  | "transparent"       // Durchsichtig: Flat-Color + tier.opacity
  | "opaque"            // Undurchsichtig: Flat-Color + opacity 1
  | "autoColor"         // Auto-Farbe: Palette-Gruppen nach tier.colorByKey
  | "addAndColor"       // Hinzufügen + Einfärben
  | "addAndTransparent" // Hinzufügen + Durchsichtig
  | "addAndAutoColor";  // Hinzufügen + Auto-Farbe
```

### `SmartTier`

```typescript
interface SmartTier {
  id: string;
  name: string;
  rules: SmartRule[];
  logic: "AND" | "OR";
  action: TierAction;
  color: string;
  colorByKey: string;
  opacity: number;      // 0–1, für transparent/addAndTransparent (Standard 0.15)
}
```

---

## Felder

### Modelle
| Feld | Typ | Beschreibung |
|---|---|---|
| `models` | `Map<string, IFCModelEntry>` | Alle geladenen IFC-Modelle, Key = UUID |
| `worldOrigin` | `THREE.Vector3 \| null` | Gemeinsamer Weltkoordinaten-Ursprung |

### Selektion
| Feld | Typ | Beschreibung |
|---|---|---|
| `selectedElement` | `SelectedElement \| null` | Aktuell selektiertes Element inkl. Eigenschaften |

### Sichtbarkeit
| Feld | Typ | Beschreibung |
|---|---|---|
| `hiddenElements` | `Set<string>` | Keys im Format `"modelId:expressId"` |
| `isolatedElements` | `Set<string> \| null` | Wenn gesetzt: nur diese Elemente sichtbar |

### Auswahlkorb
| Feld | Typ | Beschreibung |
|---|---|---|
| `selectionBasket` | `Set<string>` | Akkumulierte Elementauswahl, Keys `"modelId:expressId"` |
| `basketMode` | `BasketMode \| null` | `"highlight"` / `"ghost"` / `"isolate"` |
| `basketAutoAdd` | `boolean` | Wenn `true`: jeder Viewport-Klick fügt Element automatisch zum Korb hinzu |

### Eigenschafts-Overrides
| Feld | Typ | Beschreibung |
|---|---|---|
| `propertyOverrides` | `Map<string, Map<number, Record<string, PropOverride>>>` | modelId → expressId → key → PropOverride; **nicht** BroadcastChannel-synchronisiert |

### Schnittebenen
| Feld | Typ | Beschreibung |
|---|---|---|
| `sectionPlanes` | `SectionPlane[]` | Alle aktiven Schnittebenen |

### Werkzeuge & UI
| Feld | Typ | Beschreibung |
|---|---|---|
| `activeTool` | `ActiveTool` | `"select"` / `"measure"` / `"section"` |
| `settings` | `ViewerSettings` | Alle Viewer-Einstellungen |
| `measurements` | `Measurement[]` | Gespeicherte Messungen |
| `sqlPanelOpen` | `boolean` | SQL-Panel sichtbar |
| `listPanelOpen` | `boolean` | Lens Rules-Panel sichtbar |
| `smartViewsPanelOpen` | `boolean` | SmartViews-Panel sichtbar |
| `qtoPanelOpen` | `boolean` | Quantity Take-Off Panel sichtbar |

### Quantity Take-Off Listen
| Feld | Typ | Beschreibung |
|---|---|---|
| `qtoLists` | `QTOList[]` | Alle gespeicherten QTO-Listen, persistiert in `localStorage` unter `"infracore-qto-lists"` |

### Farben
| Feld | Typ | Beschreibung |
|---|---|---|
| `colorGroups` | `ColorGroup[] \| null` | Aktive Farb-Gruppen aus Listen-Tab |

### SmartViews / Lens Rules
| Feld | Typ | Beschreibung |
|---|---|---|
| `smartViews` | `SmartView[]` | Alle gespeicherten Lens Rules |
| `activeSmartViewId` | `string \| null` | Aktuell angewendete Lens Rule |
| `stagedSmartViewId` | `string \| null` | Im Listen-Tab markierte Lens Rule |
| `preSmartViewState` | `PreSmartViewState \| null` | Gesicherter Zustand vor Lens-Rule-Anwendung |

### Properties-Cache
| Feld | Typ | Beschreibung |
|---|---|---|
| `loadedProperties` | `Map<string, Map<number, FlatElementProps>> \| null` | Batch-geladene Eigenschaften |
| `loadedPropKeys` | `string[]` | Alle bekannten Eigenschafts-Schlüssel (für PropKeyPicker) |

---

## ViewerSettings

```typescript
interface ViewerSettings {
  background: string;
  grid: boolean;
  axes: boolean;
  edges: boolean;              // Standard: true
  shadows: boolean;
  fog: boolean;
  logDepthBuffer: boolean;
  theme: "light" | "dark";
  showSpaces: boolean;
  orthographic: boolean;
}
```

## SectionPlane

```typescript
interface SectionPlane {
  id: string;
  name: string;
  normal: [number, number, number];
  point: [number, number, number];
  enabled: boolean;
  color: string;
}
```

---

## Aktionen

### Modell-Verwaltung
```typescript
addModel(model: IFCModelEntry): void
removeModel(id: string): void
updateModel(id: string, patch: Partial<IFCModelEntry>): void
setWorldOrigin(origin: THREE.Vector3): void
```

### Selektion
```typescript
setSelected(element: SelectedElement | null): void
```

### Sichtbarkeit
```typescript
hideElement(modelId, expressId): void
hideElements(modelId, expressIds[]): void
showElement(modelId, expressId): void
showElements(modelId, expressIds[]): void
isolateElement(modelId, expressId): void
isolateElements(modelId, expressIds[]): void
isolateEntries(entries: Array<{ modelId: string; expressId: number }>): void
showAll(): void
```

### Auswahlkorb
```typescript
setBasket(basket: Set<string>): void
addToBasket(modelId, expressId): void
removeFromBasket(modelId, expressId): void
clearBasket(): void
setBasketMode(mode: BasketMode | null): void
```

### Eigenschafts-Overrides
```typescript
applyPropertyEdits(edits: Array<{
  modelId: string;
  expressId: number;
  key: string;          // "AttrName" oder "PsetName.PropName"
  value: string;
  ifcType?: number;
}>): void
clearPropertyOverrides(): void
```

**Sonderfall `key === "Name"`:** Zusätzlich zu `propertyOverrides` werden auch `models.elementsByType[type][i].name` und alle passenden `SpatialNode`-Namen im `spatialTree` rekursiv gepatcht. Dadurch re-rendert `HierarchyPanel` sofort mit dem neuen Namen ohne Seiten-Reload.

### SmartViews
```typescript
addSmartView(view: SmartView): void
updateSmartView(id, patch): void
removeSmartView(id): void
setStagedSmartViewId(id: string | null): void

applySmartView(id: string): void
// Iteriert über view.tiers, setzt hiddenElements + colorGroups, sichert Vorzustand

deactivateSmartView(): void
// Stellt preSmartViewState wieder her
```

### Quantity Take-Off
```typescript
setQTOPanelOpen(open: boolean): void
addQTOList(list: QTOList): void
updateQTOList(id: string, patch: Partial<QTOList>): void
removeQTOList(id: string): void
```

### Schnittebenen
```typescript
addSectionPlane(plane: SectionPlane): void
updateSectionPlane(id: string, patch: Partial<SectionPlane>): void
removeSectionPlane(id: string): void
clearSectionPlanes(): void
```

### Sonstiges
```typescript
updateSettings(patch: Partial<ViewerSettings>): void
setActiveTool(tool: ActiveTool): void
addMeasurement(m: Measurement): void
clearMeasurements(): void
setSqlPanelOpen(open: boolean): void
setColorGroups(groups: ColorGroup[] | null): void
setListPanelOpen(open: boolean): void
setSmartViewsPanelOpen(open: boolean): void
setLoadedProperties(props, keys): void
applyRemoteState(state: SyncState): void   // nur in Sekundär-Fenstern
```

---

## applyRemoteState

Wird in Sekundär-Fenstern aufgerufen um eingehende Zustands-Snapshots anzuwenden.

**Wichtig:** Bestehende Three.js-Objekte (`mesh`, `boundingBox`, `originOffset`) werden beibehalten — nur serialisierbare Felder werden überschrieben.

```typescript
applyRemoteState: (state: SyncState) => set((s) => {
  // Rebuilds models map, preserving existing mesh/boundingBox/originOffset
  // Overwrites: selectedElement, settings, hiddenElements, isolatedElements,
  //             colorGroups, smartViews, activeSmartViewId, loadedPropKeys,
  //             selectionBasket, basketMode
})
```

---

## Wichtige Patterns

### Element-Key Format
```typescript
const key = `${modelId}:${expressId}`;
```

### Echo-Loop-Prävention (Multi-Window)
```typescript
applyingRef.current = true;
applyRemoteState(msg.s);
applyingRef.current = false;
```

### Neue Felder hinzufügen
Checkliste:
1. `ModelStore` Interface erweitern
2. Initialwert in `create()` setzen
3. Aktion implementieren
4. In `SyncState` (types/ifc.ts) ergänzen *(wenn synchronisierbar)*
5. In `serializeState()` (windowSync.ts) serialisieren
6. In `applyRemoteState()` deserialisieren
7. `docs/state-management.md` aktualisieren

**Hinweis:** `propertyOverrides` wird bewusst **nicht** synchronisiert — Eigenschafts-Editierungen sind session-lokal.

---

## Billing-Store (`src/billing/billingStore.ts`)

Separater Zustand-Store ausschließlich für das 5D-Abrechnungsmodul. **Unabhängig vom Model-Store.**

### Felder

| Feld | Typ | Bedeutung |
|---|---|---|
| `entries` | `Record<string, BillingEntry>` | Alle erfassten Elemente, Key = `filename:expressId` (stabil über Sessions) |
| `moduleActive` | `boolean` | 3D-Visualisierung ein/aus |

### BillingEntry

```typescript
interface BillingEntry {
  key:          string;
  guid:         string;
  expressId:    number;
  modelId:      string;
  elementName:  string;
  ifcType:      string;
  stages:       BillingStage[];
  documents:    DocumentRef[];
  quantities?:  ElementQuantities;  // legacy (backward compat)
  quantitySet?: QuantitySet;        // erweitertes Mengenmodell (neu)
  createdAt:    string;
}
```

### QuantitySet & QuantityItem (erweitertes Mengenmodell)

```typescript
// src/billing/quantityTypes.ts
type QuantityType =
  | "length" | "area" | "volume" | "perimeter" | "count"
  | "weight" | "height" | "width" | "thickness" | "slope"
  | "openingArea" | "netArea" | "netVolume" | "axisLength";

type QuantityUnit = "m" | "m²" | "m³" | "Stk" | "kg" | "t" | "%";
type QuantitySource = "ifc" | "geometry" | "measured" | "manual";

interface QuantityItem {
  id:           string;
  type:         QuantityType;
  label:        string;
  value:        number;
  unit:         QuantityUnit;
  source:       QuantitySource;
  note?:        string;
  isDeduction?: boolean;
}

interface QuantitySet {
  items:     QuantityItem[];
  updatedAt: string;
}
```

**Quellen:**
- `ifc` — extrahiert aus IFC-Psets/Qtos (via `IfcQuantityExtractor`)
- `geometry` — berechnet aus Three.js-Geometrie (Divergenz-Theorem, BBox)
- `measured` — manuell gemessen im Geometrie-Inspektor
- `manual` — manuell eingegeben im BillingPanel

**Abgeleitete Größen** (werden nicht gespeichert, aus `items` berechnet):
- `netArea` = Σ area − Σ openingArea
- `netVolume` = Σ volume − Σ area·thickness (wenn vorhanden)

### ElementIdentity (Fingerabdruck)

```typescript
interface ElementIdentity {
  guid:         string;   // IFC GlobalId
  bboxCenterX:  number;   // Weltkoordinaten Mittelpunkt m
  bboxCenterY:  number;
  bboxCenterZ:  number;
  bboxSizeX:    number;   // BBox-Abmessungen m
  bboxSizeY:    number;
  bboxSizeZ:    number;
  volume:       number;   // m³
  capturedAt:   string;   // ISO 8601
}
```

Toleranzen bei `runIdentityCheck`: GUID exakt, Volumen ±1%, Lage ±5cm, Abmessungen ±1cm je Achse.

### ElementQuantities (legacy)

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

Wird weiterhin von `requestQuantities`/`quantities` BC-Flow genutzt und beim Geometry-Inspector-Auto-Modus. Neue Flows nutzen `QuantitySet`.

### Aktionen

| Aktion | Signatur | Beschreibung |
|---|---|---|
| `setIdentity` | `(key, identity: ElementIdentity) => void` | Fingerabdruck persistieren |
| `clearAll` | `() => void` | Alle Einträge löschen (auch localStorage + Broadcast) |
| `addEntry` | `(info) => void` | Erstellt neuen Eintrag (kein Duplikat, idempotent) |
| `removeEntry` | `(key) => void` | Entfernt Eintrag inkl. Phasen/Dokumente |
| `addStage` | `(key, stage) => void` | Fügt Abrechnungsstand hinzu |
| `updateStage` | `(key, stageId, patch) => void` | Aktualisiert Felder eines Stands |
| `removeStage` | `(key, stageId) => void` | Entfernt Stand |
| `addDocument` | `(key, doc) => void` | Verknüpft Dokument |
| `updateDocument` | `(key, docId, patch) => void` | Aktualisiert Dokumentfelder |
| `removeDocument` | `(key, docId) => void` | Entfernt Dokument |
| `setQuantities` | `(key, q: ElementQuantities) => void` | Legacy-Mengen speichern |
| `setQuantitySet` | `(key, set: QuantitySet) => void` | Gesamtes QuantitySet ersetzen |
| `addQuantityItem` | `(key, item: Omit<QuantityItem, "id">) => void` | Einzelne Position hinzufügen |
| `updateQuantityItem` | `(key, itemId, patch) => void` | Position aktualisieren |
| `removeQuantityItem` | `(key, itemId) => void` | Position entfernen |
| `mergeQuantityItems` | `(key, items, source) => void` | Alle Items der Quelle ersetzen, andere behalten (idempotenter Upsert per Quelle) |
| `importData` | `(BillingExport) => void` | Merged Import-JSON in bestehende Einträge |
| `exportData` | `() => BillingExport` | Gibt alle Einträge als JSON-Snapshot zurück |
| `setModuleActive` | `(active) => void` | Schaltet 3D-Visualisierung |
| `_applySync` | `(entries) => void` | Interner Sync-Empfang (kein Broadcast zurück) |

### Persistenz & Sync

- **localStorage**: Key `infracore-billing-v1` — alle Writes persistieren sofort
- **BroadcastChannel** `"infracore-billing"`: Jede Mutation sendet `{ t: "dataSync", entries }` an alle anderen Fenster
- Empfangene `dataSync`-Nachrichten werden via `_applySync()` angewendet (ohne erneutes Broadcast)

### Zustand-Snapshot-Pitfall

Nach `addEntry()` / `set()` muss **erneut** `useBillingStore.getState()` aufgerufen werden um den frischen Zustand zu lesen — Zustand-Subscriptions feuern synchron, aber das alte `store`-Objekt ist veraltet, weil Zustand den State-Objekt bei jedem `set()` ersetzt.

---

## Geometrie-Inspektor State (ViewportContainer-lokal)

Diese Zustände sind **React-State** in `ViewportContainer`, nicht im Zustand-Store. Sie leben nur solange der Inspektor aktiv ist und werden beim Schließen zurückgesetzt.

| State | Typ | Bedeutung |
|---|---|---|
| `inspSession` | `InspectionSession \| null` | Aktive Session: modelId, expressId, elementName, billingKey |
| `inspPickMode` | `PickMode` | Aktueller Auswahlmodus: `"face"` oder `"edge"` |
| `inspFaces` | `InspFace[]` | Alle erkannten logischen Flächen |
| `inspEdges` | `InspEdge[]` | Alle erkannten harten Kanten |
| `inspSelFaces` | `Set<number>` | IDs der ausgewählten Flächen |
| `inspSelEdges` | `Set<number>` | IDs der ausgewählten Kanten |

`pickerRef: React.MutableRefObject<FaceEdgePicker | null>` — Three.js-Interaktionsobjekt, außerhalb des React-State-Zyklus.
