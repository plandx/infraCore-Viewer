# Frontend — Komponenten

## App.tsx

**Einstiegspunkt.** Erkennt anhand von URL-Parametern ob Main- oder Sekundär-Fenster.

Neue Komponenten in `MainApp`:
- `<SettingsPanel />` — Modal für Schriftgröße + Tastenkürzel (öffnet wenn `settingsPanelOpen`)
- `<CollisionPanel />` — Kollisionsprüfungs-Dialog (Legacy-Inline-Panel, bleibt im Render-Tree für Rückwärtskompatibilität)
- `<DroneOverlay />` — Drohnen-HUD wenn `activeTool === "drone"`
- `<FaceCrossSectionPanel />` — Flächen-QS-Steuerung (floating, wenn `faceCrossSectionActive`)

Tastenkürzel aus `keyBindings` (Zustand-Store, localStorage-persistent) gelesen; `activeTool === "fly" || "drone"` deaktiviert alle Shortcuts außer Escape.

URL-Erkennung (in Reihenfolge):
- `?collision` → `<CollisionWindow />` (Popup-Fenster für Kollisionsprüfung)
- `?secondary&panel=…` → `<SecondaryWindow panel={…} />`
- `?cross-section` → `<CrossSectionWindow />`
- sonst → `<MainApp />`

`MainApp` enthält das 3-spaltige Layout (HierarchyPanel | Viewport | PropertiesPanel) mit react-resizable-panels.

**Sidebar-Collapse-UX:** Beide Seitenbereiche können ein- und ausgeklappt werden:
- `leftCollapsed` / `rightCollapsed` — lokale State-Variablen
- `leftPanelRef` / `rightPanelRef` — `PanelImperativeHandle`-Refs (importiert aus `react-resizable-panels`), ermöglichen imperatives `collapse()` / `expand()`
- Jedes `<Panel>` erhält `panelRef={...}` und `onResize` zum Tracking des Collapse-Status
- Die linke Seitenleiste zeigt oben einen `ChevronLeft`-Button (lucide-react); die rechte Seitenleiste entsprechend einen `ChevronRight`-Button
- Wenn eine Seitenleiste eingeklappt ist, erscheinen im Center-Panel floating Expand-Buttons (`ChevronRight` links / `ChevronLeft` rechts), die die jeweilige Seite wieder aufklappen

**Linke Seitenleiste:** Wird angezeigt, wenn `listPanelOpen || smartViewsPanelOpen`. `AlignmentPanel` ist nicht mehr Teil der linken Sidebar-Gruppe in `App.tsx` (wird separat eingebunden).

**Bisheriges Verhalten (vor Refactor):** Die linke Seitenleiste hatte die Bedingung `listPanelOpen || smartViewsPanelOpen || alignmentPanelOpen`; `AlignmentPanel` war direkt als Sub-Panel in der inneren `PanelGroup` enthalten. Beides wurde entfernt.

`main.tsx` erkennt `?billing` und rendert `<BillingApp>` statt `<App>`.

`MainApp` betreibt einen `BroadcastChannel("infracore-billing")`-Listener: antwortet auf `{ t: "ready" }` mit der aktuellen Elementliste und sendet bei Modellwechsel automatisch `{ t: "elements", list }`.

`MainApp` betreibt außerdem `useCollisionSync()`: einen `BroadcastChannel("infracore-collision")`-Listener, der Prüfungsanfragen vom Kollisions-Popup entgegennimmt, die Detection in Web-Worker-ähnlichen `setTimeout`-Batches läuft und Fortschritt/Ergebnisse zurücksendet.

---

## 5D-Abrechnung (Billing-Modul)

### BillingApp (`src/billing/BillingApp.tsx`)

Standalone-Root-Komponente für das Billing-Fenster (`?billing`). Lauscht auf `{ t: "elements" }` über den Billing-Channel und übergibt die Liste an `<BillingPanel>`.

### BillingPanel (`src/billing/BillingPanel.tsx`)

Haupt-UI des Billing-Fensters. Vollständig neu gestaltet mit Tab-Layout und erweiterter Mengenerfassung.

Props:
```typescript
interface Props {
  elements: ElementInfo[];
}
```

Aufbau:
- **Header**: Titel, Prüffenster-Toggle (ClipboardCheck, nur sichtbar wenn Einträge mit Fingerabdruck vorhanden), Isolieren-Button, Visualisierungs-Toggle, Import-JSON-Button, Export-JSON-Button
- **Linke Spalte** (272px): Suchfeld + IFC-Typ-Dropdown + „Nur erfasste"-Toggle + Sortierbutton (Modell/Datum↓/Datum↑) + scrollbare Elementliste.
- **Rechte Spalte** — vier Tabs: **Mengen** | **Fertigstellungsgrad** | **Dokumente** | **ID**

**Mengen-Tab:**
- Toolbar mit vier farbcodierten Aktions-Buttons:
  - **[IFC-Extrakt]** (sky) — sendet `{ t: "requestIfcQuantities", key }` → ViewportContainer lädt IFC-Psets async → antwortet `{ t: "ifcQuantities", key, items }` → `mergeQuantityItems(key, items, "ifc")`
  - **[Geometrie]** (violet) — sendet `{ t: "requestQuantities", key }` → antwortet `{ t: "quantities", key, data }` → konvertiert `ElementQuantities` in `QuantityItem[]` → `mergeQuantityItems(key, items, "geometry")`
  - **[Messen]** (amber) — sendet `{ t: "startInspection", key, elementName }` → aktiviert Geometrie-Inspektor
  - **[Stückzahl +1]** (emerald) — fügt direkt `count`-Item (source: manual) hinzu
- Inhalt: `<QuantitySetPanel>` (siehe unten)

**Fertigstellungsgrad-Tab:** Tabelle der Abrechnungsstände (Nr, Bezeichnung, Datum, Grad%, Delta, Löschen); Formular für neuen Stand.

**Dokumente-Tab:** Dokumentenliste mit Links; Formular für neues Dokument.

**ID-Tab (Fingerabdruck):**
- Zeigt IFC-GUID des Eintrags
- Fingerabdruck-Sektion: Volumen, Schwerpunkt X/Y/Z, Abmessungen X/Y/Z, Erfassungszeitpunkt
- Buttons: „Erfassen" / „Neu erfassen" (löst `requestQuantities` aus, speichert als `ElementIdentity`) und „Prüfen" (vergleicht aktuelle Geometrie mit gespeichertem Fingerabdruck)
- Prüfergebnis-Sektion: CheckRows für GUID, Volumen, Lage (Δ m), Abmessungen

**Auto-Snapshot:** Beim Anlegen eines neuen Eintrags via „In 5D-Liste aufnehmen" (`handleAddEntry`) wird sofort ein `requestQuantities`-BC-Aufruf gesendet und `pendingSnapshotRef` gesetzt. Wenn die Geometriemengen zurückkommen, wird der Fingerabdruck automatisch gespeichert.

**GUID-basiertes Import-Remapping:** Beim JSON-Import sucht `handleImport` für jeden Eintrag mit `guid` nach einem aktuell geladenen Element mit derselben GUID. Wird eines gefunden, wird der `key` des Eintrags auf den aktuellen Key remapped. Damit funktioniert der Vergleich auch bei unterschiedlichen Dateinamen zwischen Bauleiter und Bauüberwachung.

**Prüffenster (`CheckPanel`):**
- Overlay über dem gesamten Panel-Body (`absolute inset-0 z-10`)
- Listet alle Einträge mit `identity` auf
- Für jeden Eintrag: Status-Dot (grün/rot/gelb/grau), Elementname, GUID, Abweichungsdetails
- Buttons: „Anzeigen" (sendet `{ t: "focusElement", modelId, expressId }` → Hauptfenster zoomt auf das Element), „Prüfen" (einzelner Check)
- Header: Gesamtstatus, „Alle prüfen"-Button
- Elemente die nicht im aktuellen Modell sind (null-quantities) werden sofort als „nicht gefunden" markiert

### QuantitySetPanel (`src/billing/QuantitySetPanel.tsx`)

Zeigt alle `QuantityItem[]` eines Elements nach Quelle gruppiert an.

Sub-Komponenten:
- **`ItemRow`**: Inline-editierbare Zeile. Hover-Aktionen (Stift/Mülleimer). Edit nur für `source === "manual"`. Derived-Items (`id.startsWith("__")`) zeigen keine Aktionen.
- **`SourceGroup`**: Collapsible Gruppe (IFC/GEO/MESS/MAN) mit Chevron-Toggle. Zeigt Anzahl Positionen.
- **`AddManualForm`**: Dropdown Typ-Selektor + Wert + Bezeichnung + Notiz. Fügt `source: "manual"` Items hinzu.
- **`SummaryBar`**: Footer-Leiste mit aggregierten Summen: ∑ Fläche, − Öffnungen, ∑ Nettofläche, ∑ Volumen, ∑ Länge, ∑ Stückzahl.

Props:
```typescript
interface Props {
  entry: BillingEntry;
  onAddItem(item: Omit<QuantityItem, "id">): void;
  onUpdateItem(id: string, patch: Partial<QuantityItem>): void;
  onRemoveItem(id: string): void;
}
```

### IfcQuantityExtractor (`src/billing/IfcQuantityExtractor.ts`)

Extrahiert `QuantityItem[]` aus IFC-PropertySets. Priorität: `Qto_` > `BaseQuantities` > `PSet_`. Mappt 40+ IFC-Eigenschaftsnamen auf `QuantityType`. Dedupliziert: ein Item pro (type, name).

```typescript
export function extractQuantitiesFromPsets(psets: PropertySet[]): QuantityItem[]
```

Name-Mapping (Auswahl):
| IFC-Name | QuantityType |
|---|---|
| GrossArea, NetArea | area |
| GrossVolume, NetVolume | volume |
| Length, GrossLength | length |
| Height, GrossHeight | height |
| Width, GrossWidth | width |
| Perimeter | perimeter |
| NumberOfItems | count |
| Slope | slope |

### quantityTypes.ts (`src/billing/quantityTypes.ts`)

Alle Typdefinitionen, Metadaten und Hilfsfunktionen für das erweiterte Mengenmodell.

```typescript
export const QUANTITY_META: Record<QuantityType, { label: string; unit: QuantityUnit; description: string }>
export const SOURCE_LABEL: Record<QuantitySource, string>
export const SOURCE_COLOR: Record<QuantitySource, string>  // Tailwind-Klassen für Badges

export function qid(): string                              // Eindeutige ID
export function fmtQty(value: number, unit: QuantityUnit): string  // Formatierung mit Komma
export function computeDerivedQuantities(items: QuantityItem[]): QuantityItem[]  // netArea, netVolume
```

#### 5D-Untermenü-Verhalten (Elementliste)

- Erscheint 120ms nach Hover (kein sofortiges Schließen beim Überqueren des Gaps)
- `useLayoutEffect` misst gerenderte Submenu-Größe und passt Position an
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

**Stacking-Kontext:** Der äußere `<div>` trägt `relative z-[100]`, damit Dropdowns (z.B. Kamera-Presets, Sekundärfenster-Menü) korrekt über dem Three.js-Canvas gerendert werden.

**Ribbon-Strip:** Das innere `<div>` der Toolbar-Leiste verwendet `overflow-visible` (zuvor `overflow-x-auto overflow-y-hidden`), damit Dropdown-Menüs über den Rand der Leiste hinaus sichtbar bleiben.

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
  onToggleCollapse?: () => void;
}
```

Der interne `Header`-Sub-Komponent akzeptiert dieselbe `onToggleCollapse`-Prop und zeigt einen `ChevronLeft`-Button (lucide-react), der beim Klick den linken Sidebar-Bereich einklappt.

Interne Features:
- Suchfeld (filtert Namen)
- Sichtbarkeits-Toggle pro Element (Auge-Icon)
- Ausblenden / Isolieren via Kontext-Buttons
- Farb-/Opazitäts-Regler pro Modell
- **Mehrfachauswahl**: Shift+Klick fügt Elemente zur Auswahl hinzu; Shift+Klick auf zweites Element = Bereichsauswahl
- **Aktionsleiste** (erscheint bei ≥2 Auswahl): Alle ausblenden / Alle isolieren / **+Korb** / **=Korb** / Auswahl aufheben
- **Elternelement-Klick**: wählt alle enthaltenen Blatt-Elemente rekursiv
- **Doppelklick-Zoom**: Kamera zoomt auf Element via `viewer:zoomToElement`
- **VisibleView virtualisiert** (`@tanstack/react-virtual`): rendert nur die im Scroll-Viewport sichtbaren Zeilen — bleibt auch bei 10k+ Elementen flüssig
- **TypeGroup-Cap**: Typ-Gruppen zeigen initial max. 150 Elemente; „+ N weitere anzeigen"-Button lädt den Rest — verhindert DOM-Explosion bei großen Gruppen (z.B. 2000× IFCBEAM)
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

## CollisionWindow

**Datei:** `src/components/CollisionWindow.tsx`

Popup-Fenster (`?collision`) für regelbasierte Kollisionsprüfung. Kommuniziert ausschließlich via `BroadcastChannel("infracore-collision")`.

- Auf Mount: sendet `{ t: "req" }` um aktuellen Zustand vom Main-Fenster zu laden
- Zeigt Regelliste (links), Ergebnisliste (Mitte), Rule-Editor (rechts, optional)
- "Prüfung starten": sendet `{ t: "run", rules }` → Main führt Detection durch
- Statusänderungen: sendet `{ t: "setStatus", key, status }` → Main aktualisiert und broadcastet
- Regel-Edits sind lokal bis zum nächsten "Prüfung starten"
- Kein Zugriff auf Three.js/Modell-Daten direkt — alles läuft über BroadcastChannel

Props: keine

---

## StatusBar

**Datei:** `src/components/StatusBar.tsx`

Unterste Zeile: Anzahl Modelle, Gesamt-Dreiecke, JS-Heap, FPS-Zähler (farbcodiert), Version.

---

## HelpPanel

**Datei:** `src/components/HelpPanel.tsx`

Vollständige In-App-Hilfe. Ersetzt das frühere `InfoModal` in `MainToolbar`.
Wird über den **ⓘ**-Button in der Toolbar geöffnet.

### Aufbau

Linke Navigation (8 Abschnitte) + scrollbarer Inhaltsbereich rechts:

| Abschnitt | Inhalt |
|---|---|
| Schnellstart | Step-by-Step: IFC laden, navigieren, auswählen, ausblenden |
| 3D-Navigation | Mausbelegung, Kamera-Presets, Fly-Mode, Drohne |
| Werkzeuge | Auswahl, Messen, Schnittebene, Flächen-QS, Fly, Drohne, H-Chord |
| Panels & Leisten | Projektstruktur, Eigenschaften, SQL, Lens, SmartViews, Mengen, Auswahlkorb |
| Achsen & Trassen | LandXML laden, Längenschnitt, Querschnitt, Stationierung, Absetzmass |
| 5D-Abrechnung | 5D-Fenster, Elemente, Fertigstellungsgrade, Visualisierung, Export |
| Tastenkürzel | Vollständige Referenztabelle aller Kürzel |
| Tipps & Tricks | Multi-Window, SmartViews-Workflow, SQL-Beispiele, Batch, Koordinaten |

### Props

| Prop | Typ | Beschreibung |
|---|---|---|
| `onClose` | `() => void` | Schließt das Panel |

### Helper-Komponenten (intern)

`Step`, `Kbd`, `NoteBox`, `TipBox`, `Row`, `Table` — rein darstellend, keine externe State-Abhängigkeit.

---

## AlignmentPanel

**Datei:** `src/alignment/AlignmentPanel.tsx`

Panel für LandXML-Trassen. Öffnet sich als **vollständiger Ersatz** der linken Leiste (nicht als Sub-Panel),
wenn `alignmentPanelOpen` im `useAlignmentStore` `true` ist. Enthält:
- Drag-&-Drop-Upload für `.xml`/`.landxml`
- Achsen-Liste pro Datei (ein-/ausblendbar, farbig, Stationierungsbereich)
- Stationierungswerkzeug + Auflösungswähler
- Profil-Mini-Chart für die ausgewählte Achse
- `<AlignmentAnnotations />` Unterabschnitt

| Prop | Typ | Beschreibung |
|---|---|---|
| `onClose?` | `() => void` | Optional — zeigt X-Button im Header zum Schließen des Panels |

> **Hinweis:** `AlignmentPanel` ist nicht mehr direkt in der linken Sidebar-Gruppe von `App.tsx` eingebunden. Es wird über den **Achsen**-Tab zugänglich gemacht (wird in einem späteren Refactor-Schritt wieder eingehängt). `alignmentPanelOpen` aus dem `useAlignmentStore` wird in `App.tsx` nicht mehr für die Sidebar-Sichtbarkeitsbedingung verwendet.

---

## AlignmentAnnotations

**Datei:** `src/alignment/AlignmentAnnotations.tsx`

Neuer Beschriftungs-Unterbereich im Achsen-Panel mit drei Funktionen:
1. **Stationierungsintervalle** – automatische Beschriftung der Achse im gewählten Abstand (10–1000 m). Labels werden als CSS-Overlay in den Viewport projiziert.
2. **Punkt setzen** – Tool zum Klicken auf die Achse; speichert Beschriftung mit X/Y/Z (Echtkoordinaten) und Stationierung. Anzeige als positioniertes Info-Overlay.
3. **Absetzmass** – Tool zum Klicken auf IFC-Geometrie; berechnet Station des Fußpunkts und vorzeichenbehafteten horizontalen Querabstand (+ = rechts, − = links). Visualisierung als gestrichelte 3D-Linie + Label.

State in `useAlignmentStore`: `stationLabelVisible`, `stationLabelInterval`, `labelToolActive`, `offsetToolActive`, `placedLabels`, `offsetMeasurements`.

---

## CrossSectionWindow

**Datei:** `src/alignment/CrossSectionWindow.tsx`

Eigenständiges Popup-Fenster (`?cross-section`) für die 2D-Querschnittsdarstellung. Empfängt Schnittdaten über `BroadcastChannel("infracore-cross-section")` und rendert ein SVG-Koordinatensystem mit Schnittlinien, Hatch-Füllung und Bemaßungen.

### Werkzeuge

| Werkzeug | Button | Beschreibung |
|---|---|---|
| Messen | Ruler-Icon (blau) | Klick-Klick-Messung: misst Abstand zwischen zwei Punkten im Schnittbild, zeigt Linie + Maßtext |
| Punkt X/Y | MapPin-Icon (violett) | Setzt eine Bemaßungs-Annotation mit Querabstand (R/L) und Höhenabstand (+/−) vom Achspunkt als Maßlinien |
| Fang | Magnet-Icon (himmelblau) | Aktiviert Snap-Modus: Vertex-Fang (Priorität, 14px-Schwelle) dann Kanten-Fang (Lot auf Segment) |
| Objekte | Tag-Icon (grün) | Schaltet Objektbeschriftung ein; Dropdown wählt das Anzeigeattribut (Name, Typ, beliebige geladene Property) |
| Tiefe | Eye-Icon (grün) | Aktiviert Tiefenansicht: projiziert alle Kanten im Sichtbereich hinter dem Schnitt (default 3 m) — sichtbare Kanten solid, verdeckte Kanten gestrichelt |

### Objektbeschriftung

- `state.objectLabels: XSSyncObjectLabel[]` — vom Hauptfenster nach jedem Schnitt gesendet; enthält `{ key, name, type, props }` pro geschnittenem IFC-Element
- `buildLabelPositions(objectLabels, lines, propKey, xs, ys)` — gruppiert Segmente nach `objectKey`, berechnet Schwerpunkt, schätzt Boxbreite aus Textlänge
- `deOverlapLabels(labels)` — 60-Iterationen Force-Repulsion in Y-Richtung; bricht ab sobald keine Überlappung mehr besteht
- Leader-Line: gestrichelte Linie in Objektfarbe vom Schwerpunkt zur nächsten Box-Kante
- Verfügbare Attribute: "Name" + "Typ" immer vorhanden; weitere Properties nur wenn für das Element bereits via Klick/Selektion geladen


### Fangmodus (Snap)

- `computeSnap(wx, wy, segs, scale)` — sucht nächsten Vertex oder Kantenpunkt; Schwelle in Weltkoordinaten = `14 / scale` (px/m)
- `snapRef` — synchroner Ref, in `handleMouseMove` aktualisiert, von `handleMouseUp` gelesen (vermeidet veraltete Closures)
- `snapActiveRef` — via `useEffect` aus `snapActive`-State aktualisiert
- `snapDisplay` — State für SVG-Rendering: bernsteinfarbene Raute (Vertex) oder Kreis (Kante)
- `effW` — wirksame Weltkoordinate für alle Werkzeuge: Snap-Punkt wenn Fang aktiv, sonst Rohkoordinate

### Punkt-Beschriftung (PtLabel)

- `ptLabelMode: boolean` — Toggle-State
- `pointLabels: PtLabel[]` — gespeicherte Punkte `{ id, x, y }` in Achskoordinaten
- SVG-Darstellung: horizontale Maßlinie auf Höhe des Punkts (zeigt X-Abstand, R/L), vertikale Maßlinie an X-Position des Punkts (zeigt Y-Abstand +/−); Texte mit Hintergrundrechtecken

### Tiefenansicht (Depth View)

- **Toggle + Distanzfeld** in der Werkzeugleiste; Distanz default 3 m, min 0,1 m
- **`computeDepthLines(origin3, normalVec, rightDir, upDir)`** in `ViewportContainer.tsx`:
  - Iteriert `pickableMeshesRef.current` (alle sichtbaren IFC-Meshes)
  - Bounding-Sphere-Check gegen den Tiefenbereich `[0, depthDistance]` entlang der Normalen
  - Sichtbarkeitsprüfung: 1 Raycast je Element vom Schnittbild-Projektionspunkt in Normalenrichtung; trifft ein Objekt vorher → `hidden = true`
  - Kantensegmente aus vorhandenem `isEdge`-Kind oder neu erzeugter `EdgesGeometry` (wird sofort `dispose()`d)
  - Ergebnis in `alignmentStore.depthLines: XSSyncDepthLine[]` gespeichert
- **`computeDepthLinesFromBasis()`**: wird bei Änderung von `depthView`/`depthDistance` ohne neuen Schnitt aufgerufen
- **`XSSyncDepthLine`**: `{ x1, y1, x2, y2, hidden: boolean, color: string }` in 2D-Schnittkoordinaten
- **SVG-Rendering**: getrennte `<path>`-Elemente für sichtbare (solid, 55 % Opazität) und verdeckte Linien (gestrichelt 3,3, 35 % Opazität), unter den Schnittlinien gezeichnet

### SVG-Aufbau

1. Achsenkreuz + Tick-Labels (cm-Genauigkeit, 2 Dezimalstellen)
2. `<clipPath>` begrenzt Schnittlinien und Hatch-Füllung auf Darstellungsbereich
3. Tiefenansichts-Kanten (gestrichelt verdeckt, solid sichtbar) — Ebene unterhalb der Schnittlinien
4. Schnittlinien (`<polyline>`) + Hatch-Füllung (`<polygon>` mit SVG-Pattern)
5. Bemaßungen: Mess-Linie (blau gestrichelt), Punkt-Beschriftungs-Maßlinien (lila)
6. Vorschau-Dot bei aktivem Werkzeug
7. Snap-Indikator (außerhalb Clip-Gruppe, immer sichtbar)

---

## LongitudinalSectionWindow (`src/alignment/LongitudinalSectionWindow.tsx`)

Eigenständiges Popup-Fenster für den Längenschnitt. Wird über `?longitudinal-section` URL-Parameter erkannt und von `App.tsx` als Root-Komponente gerendert.

### Props
Keine — empfängt alles über BroadcastChannel (`LS_CHANNEL`).

### State
| Feld | Typ | Bedeutung |
|---|---|---|
| `state` | `LSSyncState` | Zuletzt empfangener Zustand vom Hauptfenster |
| `size` | `{ w, h }` | Container-Größe (ResizeObserver) |
| `viewSta` | `[number, number] \| null` | Gezoomter Stationsbereich (null = Vollauschnitt) |
| `viewElev` | `[number, number] \| null` | Gezoomter Höhenbereich (null = 1:1-Ausgangsansicht) |
| `vExag` | `number` | Vertikale Überhöhung (default 1 = physikalisch 1:1) |
| `hoverSta` | `number \| null` | Aktuelle Hover-Station |
| `isDragging` | `boolean` | Pan-Modus aktiv |
| `rangeInput` | `{ start, end }` | Rohwert-Inputs für den Stationsbereich |

### Koordinatenskalierung
- **Startskalierung 1:1**: Beim ersten Öffnen (und nach Reset) wird `viewElev = null` gesetzt. Der Fallback berechnet dann den sichtbaren Höhenbereich so, dass gilt: `(vEMax − vEMin) / chartH = (vMax − vMin) / chartW` — also 1 Meter in X entspricht 1 Meter in Y auf dem Bildschirm.
- **Überhöhung (vExag)**: Komprimiert den Rohhöhenbereich um Faktor `1/vExag`. Bei `vExag = 1` bleibt die 1:1-Physik erhalten; bei `vExag = 5` erscheint die Y-Achse 5× gestreckt. Zoom und Überhöhung sind unabhängig voneinander.
- **Reset**: `setViewElev(null)` beim Alignment-Wechsel und bei Datenänderung → kehrt zur 1:1-Ansicht zurück.

### Features
- **X-Achse**: Stationsticks im km+m Format, gleiche `computeTicks`-Logik wie ProfileViewer
- **Y-Achse**: Höhe in Metern (Three.js world Y = LandXML Höhe − origin Z)
- **IFC-Schnittlinien**: `lines: LSLineSync[]` werden als farbige Segmente gezeichnet (`<line>`)
- **Gradiente** (Planprofil): `profile: LSProfilePt[]` als gestrichelter grüner Pfad (`stroke="#4ade80"`, `strokeDasharray="6,3"`)
- **Zoom**: Mausrad an Cursor-Position, beide Achsen gleichzeitig; Achslock-Buttons "Sta" / "Höhe"
- **Pan**: Linke Maustaste + Ziehen
- **Überhöhung**: Preset-Buttons 1×/2×/5×/10×/20× + freies Zahlenfeld; Y-Achsentitel zeigt Faktor wenn aktiv
- **Tiefenlinien (Depth View)**: Kanten von Objekten innerhalb `maxDist` der Trasse werden projiziert und als transparente Linien gezeichnet
- **Stationsbereich-Eingabe**: Zwei Inputs oben; bei Enter/Blur wird `{ t: "setRange" }` Nachricht gesendet
- **SVG-Export**: `Download`-Button → `XMLSerializer` → `<a download>`
- **Theme**: Erbt `theme: "light" | "dark"` aus `LSSyncState`; Default dunkel

### Kommunikation
Auf `LS_CHANNEL` (BroadcastChannel):
- Sendet `{ t: "req" }` beim Mount
- Empfängt `{ t: "state"; s: LSSyncState }` → update `state`
- Sendet `{ t: "setRange"; staStart; staEnd }` bei Benutzer-Eingabe
- Sendet `{ t: "close" }` beim Schließen

## ProfileViewer — Längenschnitt-Erweiterung

### Neue State-Felder
| Feld | Typ | Bedeutung |
|---|---|---|
| `lsMode` | `boolean` | LS-Auswahlmodus aktiv (Toggle-Button) |
| `lsRange` | `[number, number] \| null` | Ausgewählter Stationsbereich |
| `lsRangeRef` | `Ref<{ start, end } \| null>` | Synchroner Ref für Mouse-Handler |
| `lsDragRef` | `Ref<{ startSta } \| null>` | Drag-Start-Station |
| `lsModeRef` | `Ref<boolean>` | Synchroner Ref für lsMode |

### Interaktion
- **LS-Mode Toggle**: "LS"-Button in der Kopfzeile (Slice-Icon); wechselt `lsMode`, löscht `lsRange` beim Deaktivieren
- **Bereich ziehen**: `lsMode` aktiv oder `Shift`-Taste gedrückt → Drag definiert `[staStart, staEnd]`
- **Visuelles Feedback**: Blau gestricheltes Rechteck (`fillOpacity=0.12`) über dem gewählten Bereich
- **"Längenschnitt" Button**: Erscheint wenn `lsRange` gesetzt; ruft `openLongSection(id, start, end)` + `openLongitudinalSectionWindow()` auf
