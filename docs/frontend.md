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
- **Lens Rules**-Panel (`L`), **SmartViews**-Panel (`V`), SQL-Panel (`Q`)
- Sekundär-Fenster öffnen (Dropdown mit 4 Panel-Typen)

---

## HierarchyPanel

**Datei:** `src/components/HierarchyPanel.tsx`

Zeigt alle geladenen Modelle in zwei Ansichten:
- **Spatial** (Räumliche Struktur): Site → Building → Storey → Raum → Element
- **Type** (Nach IFC-Typ gruppiert)

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
- `=` — Korb = aktuell selektiertes Element
- `+` — Element hinzufügen (disabled wenn bereits drin)
- `−` — Element entfernen (disabled wenn nicht drin)
- `×` — Korb leeren + Modus deaktivieren
- **Bearbeiten** — öffnet `BasketEditor` (Table2-Icon, nur sichtbar wenn Korb > 0)

Darstellungsmodi (nur sichtbar wenn Korb > 0):
- **HV** (Hervorheben) — amber Material-Override auf Korb-Elementen
- **Geist** — Nicht-Korb-Elemente auf 10% Opacity
- **ISO** (Isolieren) — Nicht-Korb-Elemente ausgeblendet

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

## ClipPlaneControl

**Datei:** `src/components/ClipPlaneControl.tsx`

Overlay-Steuerung für die Schnittebene (erscheint wenn `settings.clipPlanes === true`):
- Richtung spiegeln
- Schnitt deaktivieren

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

Enthält `SyncIndicator` (Verbindungs-Status-Punkt in der Titelleiste).
