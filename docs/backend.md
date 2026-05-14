# Backend / Utilities

> Es gibt keinen Server. „Backend" bezeichnet hier die clientseitigen Utility-Schichten:
> IFC-Parser (WASM), SQL-Engine und Hilfs-Funktionen.

---

## ifcLoader.ts

**Pfad:** `src/utils/ifcLoader.ts`

Kernstück: wrапpt `web-ifc 0.0.77` (WASM).

### `loadIFCFile(file, modelIndex, currentOrigin, onProgress)`

Vollständiges Laden einer IFC-Datei:

1. Initialisiert `IfcAPI`, lädt WASM aus `/wasm/`
2. Öffnet Datei (`OpenModel`)
3. Streamt alle Meshes via `StreamAllMeshes` → baut `THREE.Group`
4. Wendet World-Origin-Offset an (verhindert Floating-Point-Fehler bei großen Koordinaten)
5. Liest räumliche Struktur (`getSpatialStructure`) → `SpatialNode`-Baum
6. Sammelt alle Elemente nach IFC-Typ (`GetLineIDsWithType`) → `elementsByType`
7. Berechnet `BoundingBox`
8. Gibt `{ entry: IFCModelEntry, newWorldOrigin }` zurück

Fortschritts-Phasen: Initialisieren → Geometrie laden → Struktur lesen → Abschließen

### `loadIFCProperties(file, expressId)`

Lädt Eigenschaften **eines** Elements (langsam, öffnet Datei neu):
- Direkte Attribute via `getItemProperties`
- Property-Sets via `getPropertySets`
- Gibt `{ properties: Record<string,unknown>, psets: PropertySet[] }` zurück

### `loadAllElementProperties(file, expressIds, onProgress)`

Batch-Laden für alle Elemente (einmal Datei öffnen, alle lesen):
- Gibt `Map<number, FlatElementProps>` zurück
- Keys: direkte Attribute + `"PsetName.PropName"` Namespaced-Keys
- Kurz-Aliases: erster Pset gewinnt bei Kollision
- Wird von `PropertyLoader` in `ListPanel` genutzt

**Wichtig:** `FlatElementProps = Record<string, unknown>` ist in `types/ifc.ts` definiert.

---

## sqlEngine.ts

**Pfad:** `src/utils/sqlEngine.ts`

Mini-SQL-Engine auf Basis von `alasql`. Kein echter SQL-Server.

### Tabelle `elements`

| Spalte | Typ | Beschreibung |
|---|---|---|
| `modelId` | string | UUID des Modells |
| `modelName` | string | Dateiname |
| `expressId` | number | IFC Express-ID |
| `type` | string | IFC-Typ (z.B. `IFCWALL`) |
| `name` | string | Element-Name |

### `rebuildElementTable(models)`

Baut die In-Memory-Tabelle neu auf. Wird jedes Mal aufgerufen wenn sich `models` im Store ändert (via `useEffect` in `SQLPanel`).

Dedupliziert Einträge nach `modelId:expressId`.

### `runSQL(query)`

Führt beliebige SQL gegen `alasql` aus. Gibt `SQLQueryResult` zurück:
```typescript
interface SQLQueryResult {
  columns: string[];
  rows: unknown[][];
  error?: string;
  executionTime: number;
}
```

Unterstützt: `SELECT`, `WHERE`, `GROUP BY`, `ORDER BY [DESC]`, `LIMIT`, `COUNT(*)`, `MIN`, `MAX`, `AVG`.

### `SAMPLE_QUERIES`

Array vordefinierter Beispiel-Abfragen für das SQL-Panel.

---

## smartViewUtils.ts

**Pfad:** `src/utils/smartViewUtils.ts`

Regelauswertung für SmartViews.

### `CONDITION_LABELS`
Map von `SmartCondition` → deutsches Label für die UI.

### `CONDITIONS_WITHOUT_VALUE`
Set von Bedingungen die kein Wert-Eingabefeld brauchen (`exists`, `not_exists`, `is_true`, `is_false`).

### `evaluateRule(rule, props)`
Wertet eine einzelne `SmartRule` gegen `FlatElementProps` aus.

14 Bedingungstypen:
- Gleichheit: `eq`, `neq`
- Text: `contains`, `not_contains`, `starts_with`, `ends_with`
- Numerisch: `gt`, `lt`, `gte`, `lte`
- Boolean: `is_true`, `is_false`
- Existenz: `exists`, `not_exists`

### `evaluateSmartView(view, props)`
Wertet alle Regeln einer SmartView aus. Respektiert `view.logic`:
- `AND` — alle Regeln müssen zutreffen
- `OR` — mindestens eine Regel muss zutreffen

---

## windowSync.ts

**Pfad:** `src/utils/windowSync.ts`

Vollständige Beschreibung → `docs/window-system.md`.

Kurzübersicht:
- `SYNC_CHANNEL` — BroadcastChannel-Name
- `serializeState(store)` — Store → strukturklonierbarer Snapshot
- `openSecondaryWindow(panel)` — öffnet neues Browser-Fenster
- `PANEL_META` — Label + Fenstergröße je Panel-Typ

---

## coordinateUtils.ts

**Pfad:** `src/utils/coordinateUtils.ts`

Kleine Hilfs-Funktionen:
- `formatBytes(bytes)` — formatiert Dateigröße (B / KB / MB / GB)
- Koordinaten-Formatierung für die UI
