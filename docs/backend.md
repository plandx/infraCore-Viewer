# Backend / Utilities

> Es gibt keinen Server. „Backend" bezeichnet hier die clientseitigen Utility-Schichten:
> IFC-Parser (WASM), IFC-Writer, SQL-Engine, Geometrie-Analyse und Hilfs-Funktionen.

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

Lädt Eigenschaften **eines** Elements (öffnet Datei neu):
- Direkte Attribute via `getItemProperties(modelId, expressId, false)`
- Instanz-Psets via `getPropertySets(modelId, expressId, recursive=true, includeType=false)`
- Typ-Psets via `getPropertySets(modelId, expressId, recursive=true, includeType=true)` (`.catch(() => [])`)
- Beide Aufrufe **sequentiell** (nicht parallel!) — WASM ist nicht concurrency-safe
- Gibt `{ properties: Record<string,unknown>, psets: PropertySet[] }` zurück

### `loadAllElementProperties(file, expressIds, onProgress)`

Batch-Laden für alle Elemente (einmal Datei öffnen, alle lesen):
- Gibt `Map<number, FlatElementProps>` zurück
- Keys: direkte Attribute + `"PsetName.PropName"` Namespaced-Keys
- Kurz-Aliases: erster Pset gewinnt bei Kollision
- Lädt ebenfalls instanz- und typ-level Psets (sequentiell)
- Wird von `BatchPanel` für datalist-Autocomplete und von `QuantityListPanel` (`PropertyLoader`) genutzt

**Wichtig:** `FlatElementProps = Record<string, unknown>` ist in `types/ifc.ts` definiert.

### `loadBasketProperties(file, expressIds)`

Batch-Laden für Auswahlkorb-Elemente (einmal Datei öffnen):
- Gibt `Map<number, { properties: Record<string,unknown>; psets: PropertySet[] }>` zurück
- Anders als `loadAllElementProperties` bleiben `properties` und `psets` getrennt
  (wird vom `BasketEditor` benötigt um direkte Attribute von Pset-Werten zu unterscheiden)
- Lädt ebenfalls instanz- und typ-level Psets (sequentiell)

### `getIfcApi()` *(exportiert)*

Gibt die gemeinsame `IfcAPI`-Instanz zurück (Singleton). Wird auch von `ifcWriter.ts` genutzt.

### WASM-Concurrency-Regel

`web-ifc`'s WASM-Backend hält internen Zustand und ist **nicht safe für parallele async-Aufrufe**. Niemals `Promise.all([getPropertySets(...), getPropertySets(...)])` verwenden — das korrumpiert den State und führt zu unvollständigen Attributen. Immer sequentiell awaiten:

```typescript
const instancePsets = await api.properties.getPropertySets(modelId, eid, true, false);
const typePsets     = await api.properties.getPropertySets(modelId, eid, true, true).catch(() => []);
```

### Pset-Lade-Strategie (instanz- vs. typ-level)

IFC kennt zwei Arten von PropertySets:
- **Instanz-Psets** (`IFCRELDEFINESBYPROPERTIES`): direkt am Element hängend → `includeType=false`
- **Typ-Psets** (`IfcTypeObject.HasPropertySets` via `IFCRELDEFINESBYTYPE`): am Typ-Objekt → `includeType=true`

Beide werden immer geladen und zusammengeführt (`[...instancePsets, ...typePsets]`).
`recursive=true` bei beiden Aufrufen ist zwingend, sonst enthält `HasProperties` nur Express-ID-Referenzen statt expandierter Objekte.

---

## ifcWriter.ts

**Pfad:** `src/utils/ifcWriter.ts`

Schreibt eine modifizierte IFC-Datei mit Eigenschafts-Overrides zurück.

### `ElementEditOverride`

```typescript
interface ElementEditOverride {
  expressId: number;
  overrides: Record<string, PropOverride>; // "AttrName" oder "PsetName.PropName" → Override
}
```

`PropOverride = { value: string; ifcType?: number }` aus `types/ifc.ts`.

### `writeIFCWithOverrides(file, elementOverrides)`

```typescript
async function writeIFCWithOverrides(
  file: File,
  elementOverrides: ElementEditOverride[]
): Promise<Uint8Array>
```

- Öffnet die IFC-Datei via `api.OpenModel(data)`
- **Direkte Attribute** (kein `.` im Key): modifiziert das Element-Line-Objekt via `GetLine` / `WriteLine`
  - Wenn `ifcType` angegeben: `{ type: ifcType, value: nativeValue }` setzen
  - Sonst: vorhandene Struktur beibehalten oder `{ type: 1, value }` als Fallback
- **Pset-Eigenschaften** (`"PsetName.PropName"`): navigiert via `getPropertySets` zum
  `IFCPROPERTYSINGLEVALUE`, modifiziert `NominalValue`, schreibt via `WriteLine`
  - Pset-Abruf ebenfalls sequentiell (instanz- dann typ-level)
- Fehler bei einzelnen Properties werden übersprungen (best-effort)
- Gibt mit `api.SaveModel(modelId)` die vollständige modifizierte IFC als `Uint8Array` zurück

### `toNativeValue(override)`

Interne Hilfsfunktion: Wandelt den String-Wert in den nativen JS-Typ um:
- `ifcType === 14` (REAL) → `parseFloat`
- `ifcType === 16` (INTEGER) → `parseInt`
- `ifcType === 18` (BOOLEAN) → `=== "true"`
- Sonst → String

### `downloadFile(data, filename, mimeType?)`

Hilfsfunktion für Browser-Download eines `Uint8Array`.

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

## quantityUtils.ts

**Pfad:** `src/billing/quantityUtils.ts`

Berechnet geometrische Kennzahlen aus Three.js-Meshes für das 5D-Modul.

### `computeQuantities(meshes: THREE.Mesh[]): ElementQuantities`

Nimmt alle Meshes eines IFC-Elements entgegen und berechnet:

| Kenngröße | Algorithmus |
|---|---|
| **Volumen (m³)** | Divergenz-Theorem: `Σ a·(b×c) / 6` über alle Dreiecke in World-Space |
| **Oberfläche (m²)** | `Σ |ab × ac| / 2` (Kreuzprodukt-Fläche) pro Dreieck |
| **Bounding Box X/Y/Z (m)** | `THREE.Box3.setFromObject()` auf allen Meshes |

Alle Berechnungen in **World-Space** (`vertex.applyMatrix4(mesh.matrixWorld)`).

```typescript
interface ElementQuantities {
  volume:      number;  // m³
  surfaceArea: number;  // m²
  bboxX:       number;  // m (Breite)
  bboxY:       number;  // m (Höhe)
  bboxZ:       number;  // m (Tiefe)
  computedAt:  string;  // ISO 8601 Timestamp
}
```

---

## GeometryAnalyzer.ts

**Pfad:** `src/geometry-inspector/GeometryAnalyzer.ts`

Analysiert Three.js-Geometrie eines isolierten IFC-Elements in logische Flächen und Kanten.

### Konstanten

| Konstante | Wert | Bedeutung |
|---|---|---|
| `COPLANAR_DOT` | `cos(10°) ≈ 0.985` | Maximale Normalenabweichung zweier koplanarer Dreiecke |
| `HARD_EDGE_DOT` | `cos(25°) ≈ 0.906` | Diederwinkel-Schwelle für harte Kanten |
| `PREC` | `4000` | Quantisierungsfaktor für Vertex-Hashing |

### `analyze(meshes: THREE.Mesh[]): AnalyzeResult`

Vollständige Pipeline:

1. **Dreiecks-Sammlung**: Alle Vertices in World-Space transformieren; Dreiecke mit Normalen und Kanten-Map aufbauen
2. **Kanten-Map**: `edgeMap: Map<string, { triIndices, va, vb }>` — je Kante (kanonischer Schlüssel `min:max`) alle angrenzenden Dreiecke
3. **BFS-Flood-Fill**: Startdreieck → Nachbarn via `edgeMap` → spread wenn `n0 · n1 >= COPLANAR_DOT` → `triToFace Int32Array` befüllt
4. **Flächen-Stats**: Gewichteter Normalendurchschnitt, flächengewichteter Mittelpunkt, Gesamtfläche
5. **Hard-Edge-Extraktion**:
   - Randkanten (nur ein Dreieck) → immer hard edge
   - Innenkanten zwischen verschiedenen Face-Gruppen → hard edge wenn `n0 · n1 <= HARD_EDGE_DOT`
6. **Kollineare Kantenverschmelzung** (`mergeCollinear()`): iterativ — Valenz-2-Vertices wo `d0 · d1 < -0.999` (entgegengesetzte Richtungen = kollinear) → Kanten zusammenführen; wiederholen bis keine Änderung

Gibt zurück:
```typescript
interface AnalyzeResult {
  faces:          InspFace[];          // Erkannte logische Flächen
  edges:          InspEdge[];          // Harte Kanten nach Verschmelzung
  faceVertArrays: Float32Array[];      // Vertex-Daten je Fläche (für Overlay-Geometrie)
}
```

### Typen

```typescript
export interface InspFace {
  id:     number;
  area:   number;              // m²
  normal: [number, number, number];
  center: [number, number, number];
}

export interface InspEdge {
  id:     number;
  length: number;              // m
  start:  [number, number, number];
  end:    [number, number, number];
}

export type PickMode = "face" | "edge";

export interface InspectionSession {
  modelId:     string;
  expressId:   number;
  elementName: string;
  billingKey:  string | null;
}
```

---

## FaceEdgePicker.ts

**Pfad:** `src/geometry-inspector/FaceEdgePicker.ts`

Three.js-Interaktionsschicht des Geometrie-Inspektors. Erstellt visuelle Overlays und verarbeitet Maus-Events.

### Farb-Konstanten

| Konstante | Hex | Verwendung |
|---|---|---|
| `C_FACE_HOVER` | `0x4488ff` | Fläche unter Maus (blau) |
| `C_FACE_SELECT` | `0x22cc88` | Ausgewählte Fläche (grün) |
| `C_EDGE_DEFAULT` | `0xaaaaaa` | Nicht-aktive Kante (grau) |
| `C_EDGE_HOVER` | `0x88ccff` | Kante unter Maus (hellblau) |
| `C_EDGE_SELECT` | `0x44ff88` | Ausgewählte Kante (hellgrün) |

`FACE_OFFSET = 0.001` m — Flächen-Overlays werden 1mm entlang der Flächennormalen versetzt (Z-Fighting vermeiden).

### `load(meshes: THREE.Mesh[])`

Baut alle Overlay-Objekte auf:
- **Flächen**: `MeshBasicMaterial(transparent, DoubleSide, renderOrder=10)` je Fläche; Geometrie aus `faceVertArrays` + 1mm Normalversatz
- **Kanten**: `LineSegments(renderOrder=11)` für sichtbare Linien
- **Pick-Boxen**: `BoxGeometry(0.025, length, 0.025)` je Kante, ausgerichtet entlang der Kante, unsichtbar (`visible=false`) — für zuverlässiges Raycasting gegen dünne Linien

### `onMouseMove(ndc: THREE.Vector2, camera: THREE.Camera)`

Raycast gegen Flächen-Meshes + Edge-Pick-Boxen, aktualisiert Hover-Zustand, ruft `updateColors()`.

### `onClick(ndc, camera, ctrl: boolean, mode: PickMode)`

- `mode="face"`: trifft Flächen-Mesh → bei `ctrl`: toggle; ohne `ctrl`: ersetze Auswahl
- `mode="edge"`: trifft Edge-Pick-Box → gleiche Logik
- Gibt `{ selectedFaceIds: Set<number>, selectedEdgeIds: Set<number> }` über Callbacks zurück

### `updateColors()`

Aktualisiert Opacity + Color aller Flächen-Materialien und Kanten-Linien-Materialien nach aktuellem Hover/Auswahl-Zustand.

### `dispose()`

Entfernt alle Overlay-Objekte aus der Szene, disposes Geometrien + Materialien.

---

## smartViewUtils.ts

**Pfad:** `src/utils/smartViewUtils.ts`

Regelauswertung für SmartViews / Lens Rules.

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
- `computeModelOffset` — berechnet Origin-Offset für World-Space-Normalisierung
- `generateModelColor` — generiert eindeutige Farbe je Modell-Index
