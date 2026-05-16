# Frontend — Komponenten

## App.tsx

**Einstiegspunkt.** Erkennt anhand von URL-Parametern ob Main- oder Sekundär-Fenster.

```typescript
const IS_SECONDARY = new URLSearchParams(window.location.search).has("secondary");
const SECONDARY_PANEL = params.get("panel") ?? "hierarchy";
```

- Sekundär → `<SecondaryWindow panel={SECONDARY_PANEL} />`
- Main → `<MainApp />`

`MainApp` enthält das 3-spaltige Layout (HierarchyPanel | Viewport | PropertiesPanel) mit react-resizable-panels.

`main.tsx` erkennt `?billing` und rendert `<BillingApp>` statt `<App>`.

`MainApp` betreibt einen `BroadcastChannel("infracore-billing")`-Listener: antwortet auf `{ t: "ready" }` mit der aktuellen Elementliste und sendet bei Modellwechsel automatisch `{ t: "elements", list }`.

---

## 5D-Abrechnung (Billing-Modul)

### BillingApp (`src/billing/BillingApp.tsx`)

Standalone-Root-Komponente für das Billing-Fenster (`?billing`). Lauscht auf `{ t: "elements" }` über den Billing-Channel und übergibt die Liste an `<BillingPanel>`.

### BillingPanel (`src/billing/BillingPanel.tsx`)

Haupt-UI des Billing-Fensters.

Props:
```typescript
interface Props {
  elements: ElementInfo[];
}
```

Aufbau:
- **Header**: Titel, Visualisierungs-Toggle, Import-JSON-Button, Export-JSON-Button
- **Linke Spalte** (272px): Suchfeld + scrollbare Elementliste. Jede Zeile zeigt Status-Dot (nicht erfasst/in Bearbeitung/fertig), Elementname, IFC-Typ-Chip, Fortschrittsbalken. Hover zeigt „Hinzufügen"-Button für nicht erfasste Elemente. Klick auf eine Zeile löst auch `{ t: "selectEntry", key }` via BroadcastChannel aus (hebt Element im Viewport hervor).
- **Rechte Spalte**: Detailansicht des gewählten Elements:
  - Elementkopf: Name, Typ, GUID, ExpressId
  - **5D-Untermenü** (Kontextmenü): erscheint beim Hover über eine Elementzeile; Optionen: Grad 0–100 % in 10%-Schritten mit Farbcodierung (grau → orange → grün); „5D hinzufügen"; „Zum Viewer isolieren"
  - Tabelle der Abrechnungsstände (Nr, Bezeichnung, Datum, Grad%, Delta, Löschen-Button)
  - Formular für neuen Stand (Bezeichnung, Datum, Grad%, Notiz)
  - **Mengen-Sektion**:
    - **„Auto"**-Button (Calculator-Icon): sendet `{ t: "requestQuantities", key }` → ViewportContainer berechnet Volumen/BBox automatisch → antwortet mit `{ t: "quantities", key, data }`
    - **„Messen"**-Button (Ruler-Icon): sendet `{ t: "startInspection", key, elementName }` → aktiviert Geometrie-Inspektor im Viewer
    - Anzeige berechneter/manuell gespeicherter Mengen: Volumen (m³), Oberfläche (m²), Bounding Box X/Y/Z (m)
    - **„Speichern"**-Button: persistiert `liveQuantities` via `billingStore.setQuantities()`
  - Dokumentenliste mit Links
  - Formular für neues Dokument (Dok.-Nr., Titel, URL)

#### 5D-Untermenü-Verhalten

- Erscheint 120ms nach Hover (kein sofortiges Schließen beim Überqueren des Gaps zwischen Trigger und Flyout)
- `useLayoutEffect` misst gerenderte Submenu-Größe via `getBoundingClientRect()` und berechnet:
  - Horizontale Position: links oder rechts vom Trigger je nach verfügbarem Platz
  - Vertikale Verschiebung: nach oben wenn Submenu über Viewport-Unterkante ragt
- Bleibt immer innerhalb der Viewer-Container-Grenzen

---

## MainToolbar

**Datei:** `src/components/MainToolbar.tsx`

Oberste Toolbar-Leiste. Enthält:
- Datei öffnen / hinzufügen (File-Input, akzeptiert `.ifc`)
- Fit All (`F`)
- Werkzeug-Buttons: Auswahl (`S`), Messen (`M`), Schnitt (`C`)
- Ansichts-Toggles: Grid (Raster), Räume, **Kanten** (Box-Icon, `settings.edges`, Standard: ein), Orthografisch
- Theme-Toggle (Dark/Light)
- Kamera-Preset-Dropdown (Oben, Vorne, Links, …)
- Export: GLTF, Screenshot
- **Lens Rules**-Panel (`L`), **SmartViews**-Panel (`V`), SQL-Panel (`Q`), **Listen / Mengen**-Panel (`T`)
- **5D-Abrechnung**-Button (`BarChart2`-Icon + "5D") — öffnet Billing-Fenster via `openBillingWindow()`
- **Batch**-Button (`Sliders`-Icon) — öffnet `BatchPanel`-Modal über `onOpenBatch`-Prop
- Sekundär-Fenster öffnen (Dropdown mit 5 Panel-Typen)

---

## HierarchyPanel

**Datei:** `src/components/HierarchyPanel.tsx`

Zeigt alle geladenen Modelle in drei Ansichten:
- **Spatial** (Räumliche Struktur): Site → Building → Storey → Raum → Element
- **Type** (Nach IFC-Typ gruppiert)
- **Sichtbar** (Snapshot aller aktuell sichtbaren Elemente): Wird nur beim Tab-Wechsel aktualisiert (`captureVisibleSnapshot()`); berücksichtigt `hiddenElements` und `isolatedElements`; Doppelklick zoomt per `viewer:zoomToElement`

Props:
```typescript
interface Props {
  onFitTo: (id: string) => void;
  onRemove: (id: string) => void;
  onSelectElement: (modelId: string, expressId: number) => void;
  onHideOverride?: (modelId: string, expressId: number) => void;
  onShowAllOverride?: () => void;
  onIsolateOverride?: (modelId: string, expressId: number) => void;
}
```

Interne Features:
- Suchfeld (filtert Namen)
- Sichtbarkeits-Toggle pro Element (Auge-Icon)
- Ausblenden / Isolieren via Kontext-Buttons
- Farb-/Opazitäts-Regler pro Modell
- **Mehrfachauswahl**: Shift+Klick fügt Elemente zur Auswahl hinzu; Shift+Klick auf zweites Element = Bereichsauswahl
- **Aktionsleiste** (erscheint bei ≥2 Auswahl): Alle ausblenden / Alle isolieren / **+Korb** / **=Korb** / Auswahl aufheben
- **Elternelement-Klick**: wählt alle enthaltenen Blatt-Elemente rekursiv
- **Doppelklick-Zoom**: Kamera zoomt auf Element via `viewer:zoomToElement`
- **Externe Selektion** wird automatisch hervorgehoben und gescrollt (60ms Verzögerung)
- Namensänderungen durch Batch-Regeln (`key === "Name"`) werden sofort sichtbar — `applyPropertyEdits` patcht `elementsByType` + `spatialTree` im Store

### `collectSpatialElementKeys(node, modelId)`

Interne Hilfsfunktion: Sammelt rekursiv alle Blatt-Knoten eines Spatial-Baums als `"modelId:expressId"`-Keys.

---

## ViewportContainer

**Datei:** `src/components/ViewportContainer.tsx`

Three.js 3D-Viewport. Vollständige Beschreibung → `docs/viewer.md`.

Props:
```typescript
interface Props {
  onElementClick: (modelId: string, expressId: number) => void;
}
```

Enthält zusätzlich zur normalen Viewer-Logik die Inspektions-Zustandsverwaltung:

| State | Typ | Bedeutung |
|---|---|---|
| `inspSession` | `InspectionSession \| null` | Aktive Inspektions-Session |
| `inspPickMode` | `PickMode` | `"face"` oder `"edge"` |
| `inspFaces` | `InspFace[]` | Alle erkannten Flächen |
| `inspEdges` | `InspEdge[]` | Alle erkannten Kanten |
| `inspSelFaces` | `Set<number>` | Ausgewählte Flächen-IDs |
| `inspSelEdges` | `Set<number>` | Ausgewählte Kanten-IDs |

`pickerRef: React.MutableRefObject<FaceEdgePicker | null>` — aktiver Picker, null wenn kein Inspektor offen.

---

## PropertiesPanel

**Datei:** `src/components/PropertiesPanel.tsx`

Zeigt Eigenschaften des selektierten Elements (`selectedElement` aus Store). Vier Tabs:

- **Attribute** — Direkte IFC-Attribute (Name, Typ, GUID, …)
- **Eigenschaften** — Property-Sets (ohne `Qto_`-Präfix)
- **Mengen** — Quantity-Sets (`Qto_`-Präfix)
- **`</>`** — Raw JSON-Ansicht mit Kopier-Button

### Inline-Bearbeitung

Jede Eigenschaftszeile hat einen Bearbeiten-Button:
- Öffnet Inline-Eingabefeld mit Wert + Typ-Dropdown
- **Typ-Dropdown**: STRING(1), REAL(14), INTEGER(16), BOOLEAN(18), TEXT(3), IDENTIFIER(2)
- Bestätigen mit `Enter` → `applyPropertyEdits()` im Store
- Geänderte Werte werden amber hervorgehoben

### Overrides-Banner

Erscheint wenn das aktuell selektierte Element Overrides hat:
- Zeigt Anzahl der geänderten Eigenschaften
- **IFC Export**-Button: exportiert das Modell mit allen Overrides

---

## LensRulesPanel

**Datei:** `src/components/LensRulesPanel.tsx`
**Shortcut:** `L` · **Sekundärfenster:** `"lists"`

Gruppenbasierte Farb- und Isolier-Ansicht:
- GroupBy-Selektor: IFC-Typ / Geschoss / Modell / Eigenschaft
- Farb-Swatches pro Gruppe (native Color-Picker)
- Sichtbarkeits-Toggle pro Gruppe
- Buttons: **Einfärben**, **Reset**, **CSV-Export**

---

## SmartViewsPanel

**Datei:** `src/components/SmartViewsPanel.tsx`
**Shortcut:** `V` · **Sekundärfenster:** `"smartviews"`

Regelbasierte mehrstufige Ansichten mit Inline-Editor (`SmartViewEditor`) und `TierEditor` pro Ebene. Vollständige Aktions-Typen: add, remove, removeOthers, color, transparent, opaque, autoColor und Kombinationen.

---

## QuantityListPanel

**Datei:** `src/components/QuantityListPanel.tsx`
**Shortcut:** `T` · **Sekundärfenster:** `"qto"`

Quantity Take-Off: Benutzer definieren benannte Listen mit Filterregeln und konfigurierbaren Spalten.

### Sub-Komponenten

**`PropKeyInput`** — Autocomplete-Eingabefeld für Eigenschafts-Schlüssel.

**`FilterSection`** — Filterdefinition mit AND/OR-Logik.

**`ColumnSection`** — Spaltenkonfiguration.

**`PropertyLoader`** — Lädt alle IFC-Eigenschaften aller geladenen Modelle via `loadAllElementProperties`, zeigt Fortschritt in %. Schreibt Ergebnis in `loadedPropKeys` Store-Feld.

**`ResultsTable`** — Sticky-Header, Excel-artige Spaltenfilter (Checkbox-Dropdown), max. 500 Zeilen, XLSX-Export.

---

## SQLPanel

**Datei:** `src/components/SQLPanel.tsx`

Mini-SQL-Interface: Textarea, Beispiel-Queries, Ergebnis-Tabelle, Ausführungszeit-Anzeige.

---

## SelectionBasket

**Datei:** `src/components/SelectionBasket.tsx`

Floating-Bar oben-links im Viewport (`absolute top-3 left-3 z-30`).

Operatoren: Auto-Hinzufügen-Toggle, `=` Korb setzen, `+` hinzufügen, `−` entfernen, `×` leeren, Bearbeiten-Button.

Darstellungsmodi (bei Korb > 0): **HV** (Hervorheben), **Geist** (Ghost), **ISO** (Isolieren).

Alle Korb-Elemente erhalten gelbe Kanten-Outlines (`EdgesGeometry`, `0xfbbf24`, `depthTest: false`, `renderOrder: 998`).

---

## BasketListPanel

**Datei:** `src/components/BasketListPanel.tsx`
**Sekundärfenster:** `"basket"` (380 × 600 px)

Scrollbare Liste aller Korb-Elemente. Pro Zeile: Modellfarbe, Name + Typ · Modellname, Zoom-Button, Entfernen-Button.

---

## BasketEditor

**Datei:** `src/components/BasketEditor.tsx`

Modales Fenster für XLSX-Export und -Import der Korb-Eigenschaften. Export mit `GlobalId`-Schlüsselspalte, Import matched per `GlobalId` und schreibt `propertyOverrides`.

---

## SectionPanel

**Datei:** `src/components/SectionPanel.tsx`

Floating-Overlay für das Schnittebenen-System. Achsen-Presets, Box-Schnitt, Offset-Slider, Flip-Button, Kamera-Ausrichten je Ebene.

---

## Batch-Änderungen (Batch-Modul)

### BatchPanel (`src/batch/BatchPanel.tsx`)

Modal-Overlay-UI für massenhafte Eigenschaftsänderungen. Wird über den „Batch"-Button in der Toolbar geöffnet.

Props:
```typescript
interface Props { onClose: () => void; }
```

Aufbau (zwei Spalten):
- **Linke Spalte** (256px): Regelliste + „Neue Regel"-Button
- **Rechte Spalte**: Regeleditor mit Bezeichnung, Filter, Operationen, Vorschau-Button, Anwenden-Button

#### „Properties laden"-Button

Lädt alle Property-Keys und IFC-Typen aus allen geladenen IFC-Dateien:
- Ruft `loadAllElementProperties(m.file, expressIds, progressCb)` für jedes Modell auf
- Zeigt Fortschritt: „Lade… 42%"
- Nach Abschluss: „312 Properties" (Anzahl einzigartiger Keys)
- Schreibt Ergebnis in `batchStore` (`setLoadedProperties`)

#### datalist-Autocomplete

Zwei `<datalist>`-Elemente werden im BatchPanel-Root gerendert:
- `id="batch-prop-keys"` — alle geladenen Property-Keys (inkl. Pset-Schlüssel)
- `id="batch-ifc-types"` — alle vorkommenden IFC-Typen

Alle Property-Key-Eingabefelder referenzieren `list="batch-prop-keys"`, IFC-Typ-Inputs `list="batch-ifc-types"`. Autocomplete funktioniert nativ ohne zusätzliche Bibliothek.

### Filterarten (`TargetFilter`)

| `kind` | Beschreibung |
|---|---|
| `all` | Alle geladenen Elemente |
| `ifcType` | Nur Elemente eines bestimmten IFC-Typs |
| `propCondition` | Eigenschaft erfüllt Bedingung (`eq`, `neq`, `contains`, `regex`, `empty`, `notEmpty`) |
| `basket` | Nur Elemente im Auswahlkorb |

### Operationsarten (`BatchOperation`)

| `type` | Beschreibung |
|---|---|
| `set_property` | Setzt Eigenschaft auf festen Wert (mit IFC-Werttyp) |
| `template` | Wert aus Template-String mit `{Schlüssel}`-Platzhaltern |
| `copy_property` | Kopiert Wert von einer Eigenschaft zur anderen |
| `find_replace` | Suchen & Ersetzen (optional Regex) |
| `name_to_prop` | Schreibt Elementname in eine Eigenschaft |
| `prop_to_name` | Setzt Elementname aus einer Eigenschaft |

### Namensänderungen und HierarchyPanel

Wenn `key === "Name"` in `applyPropertyEdits()`:
1. `models.elementsByType[type][i].name` wird gepatcht (neue Map-Referenz)
2. `spatialTree` wird rekursiv durchlaufen und alle Knoten mit passender expressId erhalten den neuen Namen
3. Zustand-Store-Subscription löst sofortiges Re-Render von HierarchyPanel aus → Änderung sofort sichtbar

### BatchExecutor (`src/batch/BatchExecutor.ts`)

Pure Funktionen ohne React-Abhängigkeit:
- `buildElementRows(models, propMap)` → `ElementRow[]`
- `executeRule(rule, rows, basketKeys, maxChanges?)` → `PreviewResult`
- `collectEdits(rule, rows, basketKeys)` → Flat-Liste für `applyPropertyEdits`

### batchStore (`src/batch/batchStore.ts`)

In-Memory-Zustand-Store (kein localStorage, kein BroadcastChannel). Felder: `rules[]`, `selectedRuleId`, `previewResult`, `isPreviewing`, `isApplying`, `loadedProperties`, `loadedPropKeys`, `loadedIfcTypes`. Aktionen: `addRule`, `duplicateRule`, `removeRule`, `updateRule`, `selectRule`, `setPreviewResult`, `setIsPreviewing`, `setIsApplying`, `setLoadedProperties`.

---

## Geometrie-Inspektor (Geometry Inspector Modul)

### GeometryInspectorPanel (`src/geometry-inspector/GeometryInspectorPanel.tsx`)

Floating-Overlay über dem Viewport (`absolute top-4 right-4 z-40 w-72`). Erscheint wenn eine Inspektions-Session aktiv ist.

Props:
```typescript
interface Props {
  elementName:         string;
  billingKey:          string | null;
  expressId:           number;
  modelId:             string;
  ifcType:             string;
  faces:               InspFace[];
  boundaries:          InspFaceBoundary[];
  edges:               InspEdge[];
  selectedFaceIds:     Set<number>;
  selectedBoundaryIds: Set<number>;
  selectedEdgeIds:     Set<number>;
  pickMode:            PickMode;
  onPickModeChange:    (m: PickMode) => void;
  showMesh:            boolean;
  onToggleShowMesh:    () => void;
  onClose:             () => void;
}
```

Aufbau:
- **Header**: Elementname, „Geometrie-Inspektor"-Label, Schließen-Button
- **Sichtbarkeits-Toggle**: Volle Breite, schaltet IFC-Objekt ein/aus (standardmäßig ausgeblendet)
- **Mode-Tabs**: Flächen / Umrandungen / Kanten (jeweils mit Anzahl)
- **Hinweis**: Klick-Anleitung je nach Modus; `Strg`+Klick für Mehrfachauswahl
- **Liste**: Alle Flächen/Umrandungen/Kanten mit Maßangabe; Ausgewählte hervorgehoben
- **Zusammenfassung**: Gesamtfläche (grün, `#22cc88`), Umrandungslängen, einzelne Kantenlängen + Summe aller ausgewählten Kanten (orange, `#ff8800`) wenn ≥2 Kanten gewählt
- **„In 5D-Eintrag speichern"**-Button (nur wenn `billingKey` vorhanden und etwas ausgewählt):
  - `surfaceArea` = Summe ausgewählter Flächen
  - `bboxX/Y/Z` = Länge der ersten 3 ausgewählten Umrandungen / Kanten
  - `volume` = vorhandener Wert aus Store (wird nicht überschrieben)
  - **Upsert**: erstellt fehlenden 5D-Eintrag automatisch (nutzt `expressId`, `modelId`, `ifcType`)
  - 2s grüne Bestätigungs-Anzeige nach Speichern

### Aktivierungs-Flow

1. User klickt „Messen" in `BillingPanel`
2. `{ t: "startInspection", key, elementName }` via BroadcastChannel `"infracore-billing"`
3. `ViewportContainer` BC-Listener:
   - Sammelt alle Meshes mit `userData.expressId === expressId` und passendem Modell
   - `isolateEntries([{ modelId, expressId }])` → Element allein sichtbar
   - `GeometryAnalyzer.analyze(meshes)` → faces, edges, faceVertArrays
   - `pickerRef.current = new FaceEdgePicker(scene); picker.load(meshes)`
   - `setInspSession({ modelId, expressId, elementName, billingKey: key, ifcType })`
4. `GeometryInspectorPanel` erscheint
5. Maus-Events (`handleMouseMove`, `handleClick`) werden an `pickerRef.current` weitergeleitet
6. `onClose`: `picker.dispose()`, `showAll()`, `setInspSession(null)`

---

## SecondaryWindow

**Datei:** `src/components/SecondaryWindow.tsx`

Wrapper für Sekundär-Fenster. Rendert je nach `panel`-Parameter:
- `hierarchy` → `<HierarchyPanel>`
- `properties` → `<PropertiesPanel>`
- `lists` → `<LensRulesPanel>`
- `smartviews` → `<SmartViewsPanel>`
- `sql` → `<SQLPanel>`
- `qto` → `<QuantityListPanel>`
- `basket` → `<BasketListPanel>` mit `onSelectElement=handleElementClick`

---

## LandingOverlay

**Datei:** `src/components/LandingOverlay.tsx`

Drag-and-Drop-Zone + „Datei öffnen"-Button. Verschwindet sobald Modelle geladen sind.

---

## StatusBar

**Datei:** `src/components/StatusBar.tsx`

Unterste Zeile: Anzahl Modelle, Gesamt-Dreiecke, JS-Heap, FPS-Zähler (farbcodiert), Version.
