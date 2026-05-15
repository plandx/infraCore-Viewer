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
  color: string;        // hex, für color/transparent/opaque/addAnd*
  colorByKey: string;   // Attribut-Key für autoColor/addAndAutoColor
  opacity: number;      // 0–1, für transparent/addAndTransparent (Standard 0.15)
}
```

---

## Felder

### Modelle
| Feld | Typ | Beschreibung |
|---|---|---|
| `models` | `Map<string, IFCModelEntry>` | Alle geladenen IFC-Modelle, Key = UUID |
| `worldOrigin` | `THREE.Vector3 \| null` | Gemeinsamer Weltkoordinaten-Ursprung (erstes Modell setzt ihn) |

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
| `basketAutoAdd` | `boolean` | Wenn `true`: jeder Viewport-Klick fügt das Element automatisch zum Korb hinzu |

### Eigenschafts-Overrides
| Feld | Typ | Beschreibung |
|---|---|---|
| `propertyOverrides` | `Map<string, Map<number, Record<string, PropOverride>>>` | In-Session-Editierungen: modelId → expressId → key → PropOverride; **nicht** BroadcastChannel-synchronisiert |

### Schnittebenen
| Feld | Typ | Beschreibung |
|---|---|---|
| `sectionPlanes` | `SectionPlane[]` | Alle aktiven Schnittebenen (leer = kein Schnitt) |

### Werkzeuge & UI
| Feld | Typ | Beschreibung |
|---|---|---|
| `activeTool` | `ActiveTool` | `"select"` / `"measure"` / `"section"` |
| `settings` | `ViewerSettings` | Alle Viewer-Einstellungen (s.u.) |
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
| `stagedSmartViewId` | `string \| null` | Im Listen-Tab markierte Lens Rule (bereit für Doppelklick) |
| `preSmartViewState` | `PreSmartViewState \| null` | Gesicherter Zustand vor Lens-Rule-Anwendung |

### Properties-Cache
| Feld | Typ | Beschreibung |
|---|---|---|
| `loadedProperties` | `Map<string, Map<number, FlatElementProps>> \| null` | Batch-geladene Eigenschaften (modelId → expressId → props) |
| `loadedPropKeys` | `string[]` | Alle bekannten Eigenschafts-Schlüssel (für PropKeyPicker) |

---

## ViewerSettings

```typescript
interface ViewerSettings {
  background: string;          // Hex-Farbe der Szene
  grid: boolean;
  axes: boolean;
  edges: boolean;              // Kanten-Overlay (EdgesGeometry), Standard: true
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
  normal: [number, number, number];  // Einheitsvektor
  point: [number, number, number];   // Punkt auf der Ebene (World-Space)
  enabled: boolean;
  color: string;                     // Hex-Farbe für Visualisierung
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
isolateEntries(entries: Array<{ modelId: string; expressId: number }>): void  // modell-übergreifend
showAll(): void   // löscht hiddenElements + isolatedElements
```

### Auswahlkorb
```typescript
setBasket(basket: Set<string>): void      // Korb komplett ersetzen (=Korb)
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
  ifcType?: number;     // IFC-Typ-Code (optional)
}>): void
clearPropertyOverrides(): void
```

### SmartViews
```typescript
addSmartView(view: SmartView): void
updateSmartView(id, patch): void
removeSmartView(id): void
setStagedSmartViewId(id: string | null): void

applySmartView(id: string): void
// Iteriert über view.tiers top-to-bottom.  Aktionen pro Tier:
//   "add"              → matched aus newHidden entfernen (einblenden)
//   "remove"           → matched zu newHidden hinzufügen (ausblenden)
//   "removeOthers"     → alle nicht-matched ausblenden
//   "color"            → ColorGroup mit tier.color (opacity 1)
//   "transparent"      → ColorGroup mit tier.color + tier.opacity (< 1)
//   "opaque"           → ColorGroup mit tier.color + opacity 1
//   "autoColor"        → mehrere ColorGroups gruppiert nach tier.colorByKey
//   "addAndColor"      → add + color
//   "addAndTransparent"→ add + transparent
//   "addAndAutoColor"  → add + autoColor
// Setzt hiddenElements, colorGroups, sichert Vorzustand in preSmartViewState

deactivateSmartView(): void
// Stellt preSmartViewState wieder her
```

### Quantity Take-Off
```typescript
setQTOPanelOpen(open: boolean): void
addQTOList(list: QTOList): void                    // persistiert in localStorage
updateQTOList(id: string, patch: Partial<QTOList>): void
removeQTOList(id: string): void
```

`QTOList` enthält: `id`, `name`, `filters: QTOFilter[]`, `filterLogic: "AND" | "OR"`, `columns: QTOColumn[]`

`QTOFilter`: `{ id, key, condition: SmartCondition, value }`
`QTOColumn`: `{ id, key, label }`

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
const key = `${modelId}:${expressId}`;  // z.B. "550e8400-...:1234"
```

### Echo-Loop-Prävention (Multi-Window)
```typescript
// Subscriptions feuern SYNCHRON während set() — daher reicht ein einfaches Flag:
applyingRef.current = true;
applyRemoteState(msg.s);       // set() ruft Subscription auf → sieht Flag → skip
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
