# State Management

**Bibliothek:** Zustand 5 (`zustand`)
**Datei:** `src/store/modelStore.ts`

Ein einziger globaler Store für den gesamten App-Zustand.

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
| `propertyOverrides` | `Map<string, Map<number, Record<string,string>>>` | In-Session-Editierungen (modelId → expressId → key → Wert); **nicht** synchronisiert |

### Werkzeuge & UI
| Feld | Typ | Beschreibung |
|---|---|---|
| `activeTool` | `ActiveTool` | `"select"` / `"measure"` / `"section"` |
| `settings` | `ViewerSettings` | Alle Viewer-Einstellungen (s.u.) |
| `measurements` | `Measurement[]` | Gespeicherte Messungen |
| `sqlPanelOpen` | `boolean` | SQL-Panel sichtbar |
| `listPanelOpen` | `boolean` | Listen-Panel sichtbar |

### Farben
| Feld | Typ | Beschreibung |
|---|---|---|
| `colorGroups` | `ColorGroup[] \| null` | Aktive Farb-Gruppen aus Listen-Tab |

### SmartViews
| Feld | Typ | Beschreibung |
|---|---|---|
| `smartViews` | `SmartView[]` | Alle gespeicherten SmartViews |
| `activeSmartViewId` | `string \| null` | Aktuell angewendete SmartView |
| `stagedSmartViewId` | `string \| null` | Im Listen-Tab markierte SmartView (bereit für Doppelklick) |
| `preSmartViewState` | `PreSmartViewState \| null` | Gesicherter Zustand vor SmartView-Anwendung |

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
  edges: boolean;
  shadows: boolean;
  fog: boolean;
  logDepthBuffer: boolean;
  clipPlanes: boolean;         // Schnittebene aktiv
  clipNormal: [number, number, number];   // Richtungsvektor
  clipPoint: [number, number, number];    // Punkt auf der Ebene
  theme: "light" | "dark";
  showSpaces: boolean;
  orthographic: boolean;
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
showAll(): void   // löscht hiddenElements + isolatedElements
```

### Auswahlkorb
```typescript
setBasket(basket: Set<string>): void      // Korb komplett ersetzen
addToBasket(modelId, expressId): void
removeFromBasket(modelId, expressId): void
clearBasket(): void
setBasketMode(mode: BasketMode | null): void
// Eigenschafts-Overrides (nicht synchronisiert)
applyPropertyEdits(edits: Array<{modelId, expressId, key, value}>): void
clearPropertyOverrides(): void
```

### SmartViews
```typescript
addSmartView(view: SmartView): void
updateSmartView(id, patch): void
removeSmartView(id): void
setStagedSmartViewId(id: string | null): void

applySmartView(id: string): void
// Evaluiert alle Regeln → setzt hiddenElements/isolatedElements/colorGroups
// Sichert vorherigen Zustand in preSmartViewState

deactivateSmartView(): void
// Stellt preSmartViewState wieder her
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
4. In `SyncState` (types/ifc.ts) ergänzen
5. In `serializeState()` (windowSync.ts) serialisieren
6. In `applyRemoteState()` deserialisiern
7. `docs/state-management.md` aktualisieren
