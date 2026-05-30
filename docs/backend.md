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
5. Liest räumliche Struktur (`getSpatialStructure`) → `SpatialNode`-Baum; löst anschließend `IfcRelAggregates`-Beziehungen auf, sodass `IfcElementAssembly`-Kinder korrekt als Unterknoten erscheinen
6. Sammelt alle Elemente nach IFC-Typ (`GetLineIDsWithType`) → `elementsByType`
7. Berechnet `BoundingBox`
8. Gibt `{ entry: IFCModelEntry, newWorldOrigin }` zurück

Fortschritts-Phasen: Initialisieren → Geometrie laden → Struktur lesen → Abschließen

### `loadIFCProperties(file, expressId)`

Lädt Eigenschaften **eines** Elements für das Properties-Panel. Nutzt `getOrOpenPropModel()` (gecachtes Modell-Handle).

Traversierungs-Reihenfolge:
1. **Direkte Attribute** via `getItemProperties()` — `{value, type}`-Objekte bleiben gewrappt, damit `isIfcRef()` im UI Handle-Referenzen (type=5) korrekt ausblendet
2. **Instanz-Psets** via `IsDefinedBy` → `IfcRelDefinesByProperties.RelatingPropertyDefinition`
3. **Typ-Psets** via `IsTypedBy` (IFC4/4.3) bzw. `IsDefinedBy` (IFC2X3) → `IfcRelDefinesByType.RelatingType`:
   - Standard-Pfad: `TypeObject.HasPropertySets`
   - Nicht-standard: Psets direkt am Typ-Objekt via `IfcRelDefinesByProperties` (manche Exporter)
4. **Vererbte Psets** via `IsDeclaredBy` → `IfcRelDefinesByObject.RelatingObject.IsDefinedBy` (IFC4/4.3)
5. **Aggregations-Fallback** (nur wenn keine Psets gefunden): `Decomposes` → `IfcRelAggregates.RelatingObject.IsDefinedBy` — deckt den Infrastruktur-Muster ab, wo Sub-Komponenten (z. B. `IfcBuildingElementProxy`) als Kinder eines Träger-Elements (z. B. `IfcFlowSegment`) modelliert werden, das alle Psets hält

`GetLine(inverse=true)` wird **einmal** pro Element aufgerufen und gecacht — beide Traversierungsschritte (Hauptlauf + Fallback) nutzen dasselbe Ergebnis.

Gibt `{ properties: Record<string,unknown>, psets: PropertySet[] }` zurück.

### `loadBasketProperties(file, expressIds)`

Batch-Laden für Auswahlkorb-Elemente (einmal Datei öffnen). Dieselbe Traversierungslogik wie `loadIFCProperties` inkl. Aggregations-Fallback.

- Gibt `Map<number, { properties: Record<string,unknown>; psets: PropertySet[] }>` zurück
- `properties` und `psets` bleiben getrennt (wird vom `BasketEditor` benötigt)

### `loadAllElementProperties(file, expressIds, onProgress)`

Batch-Laden für alle Elemente — optimierter O(R + P)-Algorithmus statt O(N × R).

**Vorgehen:**
1. Alle Element-Zeilen auf einmal via `GetLines()` (batch, kein inverser Aufruf)
2. Alle `IfcRelDefinesByProperties` einmal einlesen → `psetId → Set<expressId>` Index aufbauen
3. Jeden Pset genau einmal laden und auf alle zugehörigen Elemente verteilen
4. Analog für `IfcRelDefinesByType` → `TypeObject.HasPropertySets`

Gibt `Map<number, FlatElementProps>` zurück. Keys: direkte Attribute + `"PsetName.PropName"`-Namespace. Kurz-Alias: erster Pset gewinnt bei Kollision.

> Der Aggregations-Fallback (Decomposes) ist hier **nicht** implementiert — dieser Batch-Pfad läuft beim SQL-Export, wo die Parent-Element-Daten bereits als eigene Zeilen vorhanden sind.

### `getIfcApi()` *(exportiert)*

Singleton-`IfcAPI`-Instanz. Wird auch von `ifcWriter.ts` genutzt.

### WASM-Concurrency-Regel

`web-ifc`'s WASM-Backend hält internen Zustand — niemals parallele async-Aufrufe (`Promise.all`). Alle WASM-Aufrufe sequentiell awaiten.

### Pset-Traversierungs-Übersicht

| Pfad | Beziehung | Schemas |
|---|---|---|
| Instanz | `IsDefinedBy` → `IfcRelDefinesByProperties` | 2x3, 4, 4.3 |
| Typ (standard) | `IsTypedBy` → `IfcRelDefinesByType` → `HasPropertySets` | 4, 4.3 |
| Typ (standard) | `IsDefinedBy` → `IfcRelDefinesByType` → `HasPropertySets` | 2x3 |
| Typ (nicht-standard) | wie oben → `TypeObj.IsDefinedBy` → `IfcRelDefinesByProperties` | 4, 4.3 |
| Vererbt | `IsDeclaredBy` → `IfcRelDefinesByObject` → `IsDefinedBy` | 4, 4.3 |
| Aggregations-Fallback | `Decomposes` → `IfcRelAggregates` → Parent-`IsDefinedBy` | alle |

### `parsePsetLine(pset)` *(intern)*

Parst eine beliebige IFC-Pset-Zeile schema-agnostisch:
- `HasProperties` → `IfcPropertySet` (IFC 2x3/4/4.3)
- `Quantities` → `IfcElementQuantity` / QuantitySet
- Fallback: direkte Attribute für `IfcPreDefinedPropertySet`-Subtypen (z.B. `IfcDoorLiningProperties`)

### `extractPropValue(prop)` *(intern)*

Extrahiert Werte aus allen IFC-Eigenschafts- und Mengentypen:
| IFC-Typ | Feld |
|---|---|
| `IfcPropertySingleValue` | `NominalValue` |
| `IfcQuantityLength/Area/Volume/Count/Weight/Time` | `LengthValue`, `AreaValue`, … |
| `IfcPropertyEnumeratedValue` | `EnumerationValues` (kommagetrennt) |
| `IfcPropertyBoundedValue` | `LowerBoundValue…UpperBoundValue` |
| `IfcPropertyListValue` | `ListValues` (kommagetrennt) |
| `IfcPropertyTableValue` | `DefiningValues` (kommagetrennt) |
| `IfcPropertyReferenceValue` | `PropertyReference` |

### `isPhysicalElementType(typeName)` *(intern)*

Filtert IFC-Typ-Namen dynamisch: gibt `true` zurück für physische Elemente/Räume/Annotationen,
`false` für Beziehungen, Property-Definitionen, Geometrie-Primitive, Einheiten, Metadaten usw.
Wird in `extractStructure()` verwendet, um `GetAllTypesOfModel()` zu filtern — kein Hardcoding von Klassen-Listen mehr.

### Element-Typ-Erkennung (dynamisch)

`extractStructure()` ruft `api.GetAllTypesOfModel(modelId)` auf statt eine statische Whitelist zu iterieren.
Jeder zurückgegebene Typ wird durch `isPhysicalElementType()` gefiltert. Als Label wird verwendet:
1. `ELEMENT_LABELS[typeID]` (deutsche Bezeichnung für bekannte Typen)
2. `IFC_TO_LABEL[typeName]` (Rückwärts-Lookup)
3. Der IFC-Klassenname selbst (Fallback für unbekannte/neue Typen)

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

## LandXML-Parser (`alignment/landXmlParser.ts`)

Rein clientseitiger Parser für LandXML 1.2-Achsendaten. Kein Server, kein WASM.

### Koordinaten-Konvention

| LandXML-Konvention | interne Speicherung (`AlignCoord`) | Three.js-Szene |
|---|---|---|
| Northing, Easting[, Elevation] | x = Easting, y = Northing, z = Elevation (oder null) | X = Easting−ox, Y = Elevation−oz, Z = −(Northing−oy) |

### Winkeleinheiten

`detectAngularUnit(root)` erkennt die Winkeleinheit pro Datei:
1. `<Units><Angle unit="...">` — LandXML-Standard
2. `angularUnit`-Attribut auf `<Metric>` oder `<Imperial>` — typisch für deutsche Software
3. Heuristik: `dir > 360` → Gon (nur NW-Quadrant erkennbar)

| Einheit | Konversion |
|---|---|
| Gon | 1 gon = 0,9°; 400 gon = 360° |
| Degree | Standard |
| Radian | direkt |

`azmToRad(value, unit)` konvertiert Azimut (CW von Nord) → Mathematikwinkel (CCW von Ost).
`absAngleToRad(value, unit)` konvertiert unsigned-Winkel (z. B. Bogendelta).

### Segment-Parser

**`parseLine`** — `<Line>`: Start/End-Koordinaten + optionaler `dir`-Azimut.

**`parseCurve`** — `<Curve>`:
- Center explizit: validiert Abstand center→start gegen `radius` (5 %+1 m Toleranz); bei Abweichung x/y-Swap versucht. Rotation immer aus Geometrie (`inferRot`). Sweep aus `sweepAngle(a0, a1, rot)`.
- Center nicht explizit: rot aus Attribut, `inferCenter()`, delta aus `delta`/`length`/Chord.

**`parseSpiral`** — `<Spiral>`:
- `k0`, `k1` (signierte Krümmungen in rad/m): `sign/radiusStart` bzw. `sign/radiusEnd`; `isInfR` → 0.
- `sign = rot === "cw" ? -1 : 1`.
- Rotation: zuerst Attribut `rot`, sonst geometrisch via `inferSpiralRot(start, end, entryTan)` (Kreuzprodukt Tangente × (start→end)).
- Exit-Tangente: `dirEnd`-Attribut bevorzugt; sonst `tangentStartRad + (k0+k1)/2 * length`.

**`fillSpiralCurvatures`** — füllt `k0`/`k1` nach, wenn beide = 0 (kein Radius im XML); benutzt die `rot` des benachbarten Bogens für das Vorzeichen.

### Clothoid-Sampling

`clothoidOffset(th0, k0, k1, L, s)` berechnet 2-D-Offset ∫₀ˢ (cos θ, sin θ) dt via Fresnel-Integral (Maclaurin-Reihe, 30 Terme).

Sonderfall: konstante Krümmung (`A ≈ 0, k0 ≠ 0`) → analytische Kreisformel.

### Stationsrechnung

Alle Stationen in Segmenten = **interne** Stationen. Anzeige-Stationen entstehen durch `StaEquation`-Einträge.

| Funktion | Richtung |
|---|---|
| `stationToDisplay(eqs, sta)` | intern → Anzeige |
| `displayToStation(eqs, disp)` | Anzeige → intern |

Aliases: `stationInternalToDisplay`, `stationDisplayToInternal`.

### Öffentliche API

| Funktion | Zweck |
|---|---|
| `parseLandXmlText(text, fileName, nextId)` | Parst XML-String → `ParsedLandXml` |
| `evaluateProfile(profileGeom, displaySta)` | Profil-Elevation an Anzeige-Station |
| `sampleAtDisplayStation(alignment, displaySta)` | XYZ + Tangente an Anzeige-Station (Clothoid-Sampling) |
| `buildRobustPolyline(alignment, arcSpacingM)` | Punktfolge ohne Clothoid: Geraden exakt, Bögen via Kreisformel, Spiralen als Chord (kein V-Kink) |
| `buildStationSeries(alignment, basePts)` | nicht-uniforme Stationsfolge (Spiralen ≥24 Pkt, Bögen ≥12) |
| `generateStationSeries(alignment, interval)` | uniforme Station alle `interval` m |

`ApproxPoint = { x, y, z, sta }` — Output-Typ von `buildRobustPolyline`.

---

## coordinateUtils.ts

**Pfad:** `src/utils/coordinateUtils.ts`

Kleine Hilfs-Funktionen:
- `formatBytes(bytes)` — formatiert Dateigröße (B / KB / MB / GB)
- `computeModelOffset` — berechnet Origin-Offset für World-Space-Normalisierung
- `generateModelColor` — generiert eindeutige Farbe je Modell-Index

---

## collisionUtils.ts

**Pfad:** `src/utils/collisionUtils.ts`

BVH-basierte Kollisionserkennung für das Kollisions-Popup-Fenster.

### `ElementRecord`

```typescript
interface ElementRecord {
  modelId: string;
  expressId: number;
  name: string;
  type: string;
  geometry: THREE.BufferGeometry; // World-space merged geometry (BVH gebaut)
  box: THREE.Box3;                // World-space AABB für schnellen Vorfilter
  props: Record<string, string>;  // Flache Eigenschafts-Map
}
```

### `collectElements(models)`

Baut `ElementRecord[]` aus allen geladenen Modellen:
- Filtert Overlay-Flags (`isHighlight`, `isBillingOverlay`, `isEdge`, …) heraus
- Mergt alle Meshes je Element zu einer World-Space-Geometrie via `StaticGeometryGenerator`
- Baut BVH (`MeshBVH`) auf die zusammengeführte Geometrie für O(log T) Dreieckstests

### `disposeElements(elements)`

Gibt alle `BufferGeometry`-Objekte frei.

### `matchesPropConditions(props, conditions)` / `matchesFilter(el, filter)`

Filtert Elemente nach Typ, Modell-ID und Eigenschaftsbedingungen (für Clash-Regeln).

### `runRuleBasedDetection(elements, rules, onProgress, signal)`

Hauptalgorithmus:
1. Sortiert Elemente in Mengen A und B je Regel
2. AABB-Vorfilter (`aabbSignedGap < tolerance`)
3. Exakter BVH-Dreieck-Intersektionstest (`geometriesIntersect`)
4. Dedupliziert Paare (A:B = B:A)
5. Läuft in `setTimeout`-Batches (kein Web-Worker-Overhead), meldet Fortschritt via `onProgress(0..100)`
6. Gibt `ClashResult[]` zurück; max. 500 Treffer je Regel

**Abhängigkeit:** `three-mesh-bvh` muss auf `THREE.Mesh.prototype.raycast` gepatcht sein (geschieht in `ifcLoader.ts`).

---

## ifcClassNames.ts

**Pfad:** `src/utils/ifcClassNames.ts`

```typescript
export const IFC_CLASS_NAMES: Record<number, string>
```

Automatisch aus dem web-ifc IFC-Schema generiert. Deckt IFC2x3, IFC4 und IFC4x3 ab.

Wird für die Typanzeige in Panels genutzt: `IFC_CLASS_NAMES[typeCode] ?? "Unknown"`. Keine eigene Logik — reines Nachschlagewerk.

---

## crossSectionUtils.ts

**Pfad:** `src/alignment/crossSectionUtils.ts`

Geometrie-Werkzeuge für den 2D-Querschnitt.

### Interfaces

```typescript
SectionLine    { x1, y1, x2, y2, color, objectKey? }
SectionPolygon { points, color, objectKey?, minX, minY, maxX, maxY }  // AABB für schnelle Vorablehnung
```

### Funktionen

| Funktion | Beschreibung |
|---|---|
| `sliceScene(meshes, origin, normal, right, up)` | Schneidet vorgefiltertes Mesh-Array mit einer Ebene; gibt projizierte 2D-Segmente zurück |
| `buildSectionPolygons(lines, eps?)` | Rekonstruiert geschlossene Polygone; berechnet AABB in einem Durchlauf mit dem Shoelace-Test |
| `pointInPolygon(px, py, polygon)` | Ray-Casting-Test: gibt `true` zurück wenn Punkt (px, py) innerhalb des Polygons liegt |

**Performance-Eigenschaften von `sliceScene`:**
- Nimmt `THREE.Mesh[]` statt `THREE.Scene` — kein `scene.traverse` im Aufrufpfad, Caller verwendet `pickableMeshesRef.current`
- Pro Mesh: alle Vertices einmalig als `Float32Array` in den Weltkoordinaten transformiert (Matrix-Elemente direkt, kein `Vector3.applyMatrix4`)
- Dreiecksschleife: vollständig inlineierte Kantenintersektion ohne Closures, ohne Array-Allokation, ohne `Vector3`-Objekte → JIT-freundlich
- Bounding-Sphere-Vorfilter: vollständig per skalarer Arithmetik

`buildSectionPolygons` gruppiert Segmente nach Farbe, baut eine Adjazenz-Map mit quantisierten Endpunkten (Standard `eps = 1e-3 m`) und verfolgt Ketten greedy. AABB und Shoelace-Fläche werden in einem einzigen Pass berechnet. Nur geschlossene Ketten mit ≥ 3 Punkten und Fläche ≥ 0,01 m² werden übernommen.

### Verdeckungsalgorithmus (Tiefenlinien im Querschnitt)

`pointInPolygon` wird in `ViewportContainer.tsx → computeDepthLines` verwendet:

1. Nach dem Schnitt (`sliceScene`) werden die Schnittlinien mit `buildSectionPolygons` zu geschlossenen 2D-Polygonen je Element aufgebaut.
2. Für jede Tiefenlinie-Kante wird der 2D-Mittelpunkt gegen alle Schnittpolygone **anderer** Elemente getestet.
3. Liegt der Mittelpunkt innerhalb eines fremden Polygons → `hidden = true` (das Bauteilmaterial am Schnitt verdeckt diese Kante).
4. Andernfalls → `hidden = false` (Ansichtslinie, direkt sichtbar).

Diese Per-Kanten-Methode ersetzt die frühere Per-Mesh-Raycast-Näherung und liefert korrektes Ergebnis auch bei partiell verdeckten Bauteilen.

---

## longitudinalSectionUtils.ts

**Pfad:** `src/alignment/longitudinalSectionUtils.ts`

Geometrie-Werkzeuge für den 2D-Längenschnitt.

### Interfaces

```typescript
LSLine      { sta1, elev1, sta2, elev2, color, objectKey? }  // Schnittlinie (Station + Höhe)
LSDepthLine { sta1, elev1, sta2, elev2, hidden, color }      // Tiefenlinie mit Sichtbarkeits-Flag
LSSegmentPlane { origin, normal, right, staA, staDiff, hLen }// Segment-Ebene der Trasse
```

### Funktionen

| Funktion | Beschreibung |
|---|---|
| `sliceSceneLS(meshes, segs, staStart, staEnd)` | Schneidet vorgefiltertes Mesh-Array mit Segment-Ebenen-Serie; gibt projizierte 2D-Linien zurück |
| `computeLSDepthLines(meshes, segs, staStart, staEnd, maxDist)` | Berechnet Tiefenlinien mit AABB-Verdeckungstest (kein Raycast) |

**Performance-Eigenschaften:**
- Beide Funktionen nehmen `THREE.Mesh[]` statt `THREE.Scene` — kein zweifaches `scene.traverse` (Caller baut die Liste einmal)
- `sliceSceneLS`: gleiche Float32Array-Optimierung wie in der vorherigen Version

### Verdeckungsalgorithmus (Tiefenlinien im Längenschnitt)

`computeLSDepthLines` arbeitet in zwei Phasen, **vollständig ohne Raycasting**:

**Phase 1 — Mesh-Metadaten:** Für jedes sichtbare Mesh werden berechnet:
- Nächste Segmentebene + Abstand (`absN`)
- Exakter Welt-AABB via 8-Ecken-Transformation (korrekt für beliebige Rotationen)
- XZ-Mittelpunkt für Tiefenprojektion
- Kanten-Buffer (vorberechnete `isEdge`-Children oder temporäre `EdgesGeometry`)

**Phase 2 — Per-Kanten-AABB-Test:** Für jede Kante:
1. Kanten-Mittelpunkt: `mSignedN` (vorzeichenbehaftete Tiefe von Schnittebene), `mrMid` (laterale r-Koordinate), `mElev` (Höhe)
2. Für jeden anderen Mesh: Prüfe ob Verdeckter auf gleicher Seite + näher (Tiefenvergleich) + Elevations-Überschneidung + r-Bereich-Überschneidung (XZ-AABB projiziert auf `edgeSeg.right`)
3. Alle Projektionen im Koordinatensystem der Kante (korrekt für gekrümmte Trassen)

**Komplexität:** O(M × V/mesh) für Phase 1 + O(E × M) für Phase 2  
**Vorher:** O(E × M × T) mit Raycast (E=Kanten, M=Meshes, T=Dreiecke/Mesh)  
**Speedup:** Faktor T ohne BVH (100–10.000×), Faktor log(T) mit BVH (7–14×)
