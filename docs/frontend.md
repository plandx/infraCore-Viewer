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
  elements: ElementInfo[]; // Elementliste vom Main-Fenster
}
```

Aufbau:
- **Header**: Titel, Visualisierungs-Toggle, Import-JSON-Button, Export-JSON-Button
- **Linke Spalte** (272px): Suchfeld + scrollbare Elementliste. Jede Zeile zeigt Status-Dot (nicht erfasst/in Bearbeitung/fertig), Elementname, IFC-Typ-Chip, Fortschrittsbalken. Hover zeigt "Hinzufügen"-Button für nicht erfasste Elemente.
- **Rechte Spalte**: Detailansicht des gewählten Elements mit:
  - Elementkopf: Name, Typ, GUID, ExpressId
  - Tabelle der Abrechnungsstände (Nr, Bezeichnung, Datum, Grad%, Delta, Löschen-Button)
  - Formular für neuen Stand (Bezeichnung, Datum, Grad%, Notiz)
  - Dokumentenliste mit Links
  - Formular für neues Dokument (Dok.-Nr., Titel, URL)

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
  onFitTo: (id: string) => void;         // Kamera auf Modell
  onRemove: (id: string) => void;        // Modell entfernen
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
- **Mehrfachauswahl**: Shift+Klick fügt Elemente zur Auswahl hinzu; Shift+Klick auf zweites Element = Bereichsauswahl (alle sichtbaren Einträge zwischen Anker und Ziel in DFS-Reihenfolge)
- **Aktionsleiste** (erscheint bei ≥2 Auswahl): Alle ausblenden / Alle isolieren / **+Korb** (hinzufügen) / **=Korb** (Korb ersetzen) / Auswahl aufheben
- **Elternelement-Klick**: Klick auf einen nicht-blättrigen Knoten (mit Kindern) wählt **alle enthaltenen Blatt-Elemente** aus (rekursiv gesammelt via `collectSpatialElementKeys`)
- **Doppelklick-Zoom**: Doppelklick auf ein Element → `viewer:zoomToElement`-Event → Kamera zoomt auf das Element; bei Elternknoten werden alle Kind-Element-IDs gesammelt und die kombinierte Bounding Box verwendet
- Expand-State des Spatial-Baums ist nach oben gehoben, Default-offen: Tiefe 0 und 1
- **Externe Selektion** (Viewport-Klick, SQL, etc.) wird automatisch hervorgehoben: `activeKey` = `selectedElement`-Key wenn keine Mehrfachauswahl aktiv; zugehörige Knoten werden aufgeklappt und per `scrollIntoView` ins Bild gebracht (60 ms Verzögerung)
- `lastPanelClickRef` verhindert, dass eigene Panel-Klicks als externe Änderung interpretiert werden
- Alle Zeilen tragen `data-mid` / `data-eid` Attribute für querySelector-basiertes Scroll-Targeting

### `collectSpatialElementKeys(node, modelId)`

Interne Hilfsfunktion: Sammelt rekursiv alle Blatt-Knoten (Knoten ohne Kinder) eines Spatial-Baums als `"modelId:expressId"`-Keys. Blatt = `children.length === 0`.

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

---

## PropertiesPanel

**Datei:** `src/components/PropertiesPanel.tsx`

Zeigt Eigenschaften des selektierten Elements (`selectedElement` aus Store). Vier Tabs:

- **Attribute** — Direkte IFC-Attribute (Name, Typ, GUID, …)
- **Eigenschaften** — Property-Sets (ohne `Qto_`-Präfix)
- **Mengen** — Quantity-Sets (`Qto_`-Präfix)
- **`</>`** — Raw JSON-Ansicht mit Kopier-Button

### Inline-Bearbeitung

Jede Eigenschaftszeile hat einen Bearbeiten-Button (Stift-Icon, erscheint bei Hover):
- Öffnet ein Inline-Eingabefeld mit Wert + Typ-Dropdown
- **Typ-Dropdown**: STRING(1), REAL(14), INTEGER(16), BOOLEAN(18), TEXT(3), IDENTIFIER(2)
- Der erkannte IFC-Typ wird automatisch vorbelegt (aus `r.type` oder Wrapped-Value)
- Bestätigen mit `Enter` oder Haken-Button → `applyPropertyEdits()` im Store
- Abbrechen mit `Escape` oder X-Button
- Geänderte Werte werden amber hervorgehoben mit Stift-Icon und durchgestrichenem Originalwert

### Overrides-Banner

Erscheint wenn das aktuell selektierte Element Overrides hat:
- Zeigt Anzahl der geänderten Eigenschaften
- **IFC Export**-Button: exportiert das gesamte Modell mit allen Overrides als `.ifc`-Datei
  - Ruft `writeIFCWithOverrides()` + `downloadFile()` auf
  - Spinner während Export läuft

---

## LensRulesPanel

**Datei:** `src/components/LensRulesPanel.tsx`
**Shortcut:** `L` · **Sekundärfenster:** `"lists"`

Gruppenbasierte Farb- und Isolier-Ansicht:
- GroupBy-Selektor: IFC-Typ / Geschoss / Modell / Eigenschaft (beliebig)
- Farb-Swatches pro Gruppe (native Color-Picker)
- Sichtbarkeits-Toggle pro Gruppe
- Klick auf Gruppe → Isolieren; erneuter Klick oder `Esc` → Reset
- Buttons: **Einfärben** (→ `setColorGroups`), **Reset**, **CSV-Export**

---

## SmartViewsPanel

**Datei:** `src/components/SmartViewsPanel.tsx`
**Shortcut:** `V` · **Sekundärfenster:** `"smartviews"`

Regelbasierte mehrstufige Ansichten:
- Liste gespeicherter SmartViews mit Aktivieren / Bearbeiten / Löschen
- Jede SmartView zeigt kompakte Ebenen-Badges (Name, Aktion, Farbe oder Auto-Farbe-Schlüssel)
- Aktive SmartView zeigt **Farblegende** (max-h-32) mit Farb-Swatch + Label + Anzahl
- Inline-Editor (`SmartViewEditor`):
  - Name-Eingabe
  - Scrollbare Liste von `TierEditor`-Karten (max-h-[60vh])
  - „Ebene hinzufügen"-Button (gestrichelt)
  - Speichern disabled wenn Name leer oder keine Ebenen
- **TierEditor** (pro Ebene):
  - Header mit Name-Eingabe + Auf/Ab-Pfeil + Löschen-Button
  - Regel-Zeilen: `[Eigenschaft][Bedingung][Wert][×]`
  - AND / OR Logik (nur bei ≥2 Regeln sichtbar)
  - **Aktions-Dropdown** (`<select>` mit `<optgroup>`):
    - Sichtbarkeit: Hinzufügen / Entfernen / Andere entfernen
    - Farbe: Farbig einstellen / Auto-Farbe / Hinzufügen + Einfärben / Hinzufügen + Auto-Farbe
    - Transparenz: Durchsichtig / Undurchsichtig / Hinzufügen + Durchsichtig
  - Bei Farb-Aktionen: Farb-Swatch + Hidden Color Input
  - Bei Transparenz-Aktionen: zusätzlich Opacity-Slider (0–100%)
  - Bei Auto-Farbe-Aktionen: „Nach:"-Label + PropKeyPicker für `colorByKey`
- Doppelklick-Hinweis wenn SmartView staged

---

## QuantityListPanel

**Datei:** `src/components/QuantityListPanel.tsx`
**Shortcut:** `T` · **Sekundärfenster:** `"qto"`

Quantity Take-Off: Benutzer definieren benannte Listen mit Filterregeln und konfigurierbaren Spalten. Ausführen einer Liste filtert alle geladenen IFC-Elemente; Ergebnisse können als XLSX exportiert werden. Listen werden in `localStorage` persistiert.

### Layout

Zweispaltig:
- **Linke Spalte** (w-44): Liste gespeicherter Listen mit Neu-Button
- **Rechte Spalte**: Editor + Ergebnisstabelle

### Sub-Komponenten

**`PropKeyInput`** — Autocomplete-Eingabefeld für Eigenschafts-Schlüssel:
- Vorschläge: `_type`, `_name`, `_model` + alle `loadedPropKeys`
- Max 60 Treffer, Monospace-Font

**`FilterSection`** — Filterdefinition:
- Jede Filterzeile: `[Eigenschaft][Bedingung][Wert][×]`
- AND / OR Logik-Toggle (nur sichtbar wenn ≥2 Filter)
- Werteingabe entfällt bei Bedingungen ohne Wert (exists, is_true, …)

**`ColumnSection`** — Spaltenkonfiguration:
- Jede Spalte: `[Eigenschaft][Spaltenname][↑↓][×]`
- Automatische Beschriftung aus BUILTIN_LABELS wenn Schlüssel gewählt

**`PropertyLoader`** — Eingebettet im Editor; lädt alle IFC-Eigenschaften aller geladenen Modelle und zeigt Fortschritt in %. Aktiviert volle Eigenschaftsunterstützung im Filter- und Spalten-Picker (`loadedPropKeys`).

**`ResultsTable`** — Ergebnisanzeige:
- Sticky Header mit **Excel-artigen Spaltenfiltern**: Pro Spalte Dropdown mit Checkbox-Liste aller vorkommenden Werte; `(Alle)` mit Indeterminate-Zustand; Suchfeld im Dropdown
- Zeigt max. `MAX_VISIBLE = 500` Zeilen (gelber Hinweis wenn mehr)
- Info-Leiste zeigt Anzahl gefilterter Zeilen + Reset-Link wenn Filter aktiv
- Spaltenfilter werden beim erneuten Ausführen zurückgesetzt
- XLSX-Export enthält alle gefilterten Zeilen

### Datenfluss

```
handleRun()
  → iteriert models (status === "loaded")
  → baut FlatElementProps pro Element
  → evaluateRule() für jeden Filter
  → AND/OR-Logik über Filter-Treffer
  → Ergebnis-Rows mit col.id → Wert-Map
  → setResults(rows)
```

### XLSX-Export

Nutzt `xlsx`-Paket (`XLSX.utils.aoa_to_sheet`, `XLSX.writeFile`). Spaltenbreite 22 Zeichen je Spalte. Sheet-Name = Listenname (max 31 Zeichen, Excel-Limit).

---

## SQLPanel

**Datei:** `src/components/SQLPanel.tsx`

Mini-SQL-Interface über `alasql`:
- Textarea für SQL-Eingabe (`Ctrl+Enter` = Ausführen)
- Beispiel-Queries Dropdown
- Ergebnis-Tabelle mit Scroll
- Ausführungszeit-Anzeige
- Basis-Tabelle: `elements` mit Spalten `modelId, modelName, expressId, type, name`

---

## SelectionBasket

**Datei:** `src/components/SelectionBasket.tsx`

Floating-Bar oben-links im Viewport (`absolute top-3 left-3 z-30`).

Props:
```typescript
{ onOpenEditor?: () => void }
```

Operatoren:
- **Auto** — Auto-Hinzufügen-Toggle (MousePointerClick-Icon, amber wenn aktiv): jeder Viewport-Klick fügt das geklickte Element automatisch zum Korb hinzu
- `=` — Korb = aktuell selektiertes Element
- `+` — Element hinzufügen (disabled wenn bereits drin)
- `−` — Element entfernen (disabled wenn nicht drin)
- `×` — Korb leeren + Modus deaktivieren
- **Bearbeiten** — öffnet `BasketEditor` (Table2-Icon, nur sichtbar wenn Korb > 0)
- **Auto** (`MousePointerClick`-Icon) — Auto-Hinzufügen-Toggle (`basketAutoAdd`): amber hervorgehoben wenn aktiv; jeder Viewport-Klick fügt dann automatisch hinzu

Darstellungsmodi (nur sichtbar wenn Korb > 0):
- **HV** (Hervorheben) — amber Material-Override auf Korb-Elementen
- **Geist** — Nicht-Korb-Elemente auf 10% Opacity
- **ISO** (Isolieren) — Nicht-Korb-Elemente ausgeblendet

Alle Korb-Elemente erhalten im Viewport gelbe Kanten-Outlines (EdgesGeometry, `0xfbbf24`, `depthTest: false`, `renderOrder: 998`) unabhängig vom aktiven Darstellungsmodus.

---

## BasketListPanel

**Datei:** `src/components/BasketListPanel.tsx`
**Sekundärfenster:** `"basket"` (380 × 600 px)

Zeigt alle Elemente im Auswahlkorb als scrollbare Liste.

Props:
```typescript
{ onSelectElement?: (modelId: string, expressId: number) => void }
```

Pro Zeile:
- Farb-Dot (Modellfarbe)
- Name (oder IFC-Typ als Fallback) + Typ · Modellname
- **Zoom**-Button (`Focus`-Icon) — dispatcht `viewer:zoomToElement`-Event
- **Entfernen**-Button (`X`-Icon) — `removeFromBasket()`

Header: Elementanzahl + „Alle entfernen"-Button (leert Korb + setzt Modus zurück).

Leer-Zustand: Hinweistext wenn Korb leer.

---

## BasketListPanel

**Datei:** `src/components/BasketListPanel.tsx`

Listenansicht aller Elemente im Auswahlkorb. Verfügbar als Sekundärfenster (`"basket"`).

Props:
```typescript
{ onSelectElement?: (modelId: string, expressId: number) => void }
```

Features:
- Header mit Elementanzahl und „Alle entfernen"-Button
- Scrollbare Liste: pro Element Modell-Farbe, Name (oder Typ), Typ · Modellname
- Hover-Aktionen: Zoom auf Element (`viewer:zoomToElement`-Event), Aus Korb entfernen
- Aktuell selektiertes Element hervorgehoben (`bg-primary/10`)
- Leerzustand mit Hinweis-Text

---

## BasketEditor

**Datei:** `src/components/BasketEditor.tsx`

Modales Fenster für XLSX-Export und -Import der Korb-Eigenschaften.

Props:
```typescript
{ onClose: () => void }
```

Workflow:
1. **Als XLSX exportieren** → erzeugt Datei `auswahlkorb_eigenschaften.xlsx`
   - Erste Spalte `🔑 GlobalId` (Schlüssel, nicht ändern)
   - Danach: Name, Typ, Modell, alle direkten IFC-Attribute, alle Pset-Eigenschaften
   - Erste Zeile + erste Spalte eingefroren (Freeze-Panes)
2. **User bearbeitet** die Datei in Excel / LibreOffice
3. **XLSX importieren** → parst die Datei, matched Zeilen per `GlobalId`
   - Nur geänderte Werte werden als `propertyOverrides` im Store gespeichert
   - Ergebnis-Banner zeigt: Elemente aktualisiert / übersprungen / nicht gefunden

Vorschau-Tabelle (read-only): zeigt aktuelle Werte mit sticky Info-Spalten.

---

## SectionPanel

**Datei:** `src/components/SectionPanel.tsx`

Floating-Overlay für das Schnittebenen-System (erscheint wenn `sectionPlanes.length > 0 || activeTool === "section"`). Kommuniziert mit dem **SectionModule** (`src/section/`) über den Zustand-Store und Window-Events.

- **Achsen-Presets**: +X −X +Y −Y +Z −Z — fügen eine Schnittebene mit der entsprechenden Normalen mittig durch die Szene hinzu
- **Box-Schnitt**: Erzeugt 6 Ebenen als Box um ausgewähltes Element (Fallback: Szenen-BBox); alle teilen eine `boxId`
- **Sichtbarkeits-Toggle**: dispatcht `viewer:sectionVisualsHidden` → SectionModule blendet Gizmos aus; Clipping bleibt aktiv
- **Pro-Ebene-Zeile**: Farb-Dot, Name, Offset-Slider, Flip-Button, Kamera-Ausrichten, Sichtbarkeits-Toggle, Löschen
- **Offset-Slider**: `offset = dot(P − sceneCenter, N)` → `P = sceneCenter + offset * N`
- **Kamera-Ausrichten**: dispatcht `viewer:alignToPlane` → SectionModule positioniert Kamera auf `P − N*dist`
- **Alle löschen**: `clearSectionPlanes()` + `setActiveTool("select")`
- Lazy: liefert `null` wenn kein Schnitt aktiv

### SectionModule (`src/section/`)

Eigenständiges Paket — vollständig vom Viewer-Core getrennt. Für Details siehe `docs/viewer.md` → Schnittebenen-System.

---

## LandingOverlay

**Datei:** `src/components/LandingOverlay.tsx`

Leerer-Zustand-Overlay über dem Viewport: Drag-and-Drop-Zone + „Datei öffnen"-Button.
Verschwindet sobald Modelle geladen sind.

---

## StatusBar

**Datei:** `src/components/StatusBar.tsx`

Unterste Zeile:
- Anzahl geladener Modelle
- Gesamt-Dreiecke (berechnet aus Mesh-Geometrien)
- JS-Heap-Speicher (Chrome API)
- FPS-Zähler (farbcodiert: grün ≥ 50, gelb 30–49, rot < 30)
- Version

---

## SecondaryWindow

**Datei:** `src/components/SecondaryWindow.tsx`

Wrapper für Sekundär-Fenster. Nutzt `useSecondarySync()` für bidirektionalen Sync.

Rendert je nach `panel`-Parameter:
- `hierarchy` → `<HierarchyPanel>` (onFitTo = no-op, keine Overrides)
- `properties` → `<PropertiesPanel>`
- `lists` → `<LensRulesPanel>`
- `smartviews` → `<SmartViewsPanel>`
- `sql` → `<SQLPanel>`
- `qto` → `<QuantityListPanel>`
- `basket` → `<BasketListPanel>` mit `onSelectElement=handleElementClick`

Enthält `SyncIndicator` (Verbindungs-Status-Punkt in der Titelleiste).
