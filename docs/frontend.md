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
- Ansichts-Toggles: Grid, Achsen, Kanten, Schatten, Räume, Orthografisch
- Theme-Toggle (Dark/Light)
- Kamera-Preset-Dropdown (Oben, Vorne, Links, …)
- Export: GLTF, Screenshot
- Listen-Panel (`L`), SQL-Panel (`Q`)
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
  onHideOverride?: (modelId: string, expressId: number) => void;   // optional für Sekundär-Fenster
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
- **Aktionsleiste** (erscheint bei ≥2 Auswahl): Alle ausblenden / Alle isolieren / In Auswahlkorb / Auswahl aufheben
- Expand-State des Spatial-Baums ist nach oben gehoben (für Bereichsauswahl nötig), Default-offen: Tiefe 0 und 1
- **Externe Selektion** (Viewport-Klick, SQL, etc.) wird automatisch hervorgehoben: `activeKey` = `selectedElement`-Key wenn keine Mehrfachauswahl aktiv; zugehörige Knoten werden aufgeklappt und per `scrollIntoView` ins Bild gebracht (60 ms Verzögerung nach React-Flush)
- `lastPanelClickRef` verhindert, dass eigene Panel-Klicks als externe Änderung interpretiert werden
- Alle Zeilen tragen `data-mid` / `data-eid` Attribute für querySelector-basiertes Scroll-Targeting

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

Zeigt Eigenschaften des selektierten Elements (`selectedElement` aus Store):
- Direkte IFC-Attribute (Name, Typ, GUID, …)
- Alle Property-Sets (aufklappbar)
- Leer-Zustand wenn nichts selektiert

---

## ListPanel

**Datei:** `src/components/ListPanel.tsx`

Zwei Tabs:

### Tab „Listen"
- GroupBy-Selektor: IFC-Typ / Geschoss / Modell / Eigenschaft (beliebig)
- Farb-Swatches pro Gruppe (native Color-Picker)
- Sichtbarkeits-Toggle pro Gruppe
- Buttons: **Farben anwenden** (→ `setColorGroups`), **Reset**, **CSV-Export**

### Tab „SmartViews"
- Liste gespeicherter SmartViews mit Aktivieren / Bearbeiten / Löschen
- Inline-Editor (`SmartViewEditor`):
  - Regel-Zeilen: `[Eigenschaft][Bedingung][Wert][×]`
  - AND / OR Logik
  - Aktion: Anzeigen / Ausblenden / Farbe
  - Farb-Picker für Color-Aktion
- Doppelklick-Hinweis wenn SmartView staged

### PropertyLoader (intern)
Shared-Komponente: Lädt alle IFC-Eigenschaften batch-weise in den Store (`loadedProperties`).
Zeigt Fortschrittsbalken.

### PropKeyPicker (intern)
Durchsuchbares Dropdown für Eigenschafts-Schlüssel:
- Built-ins: `_type`, `_name`, `_model`
- Alle geladenen Pset-Schlüssel im Format `"PsetName.PropName"`

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

Floating-Bar unten-links im Viewport (`absolute bottom-4 left-3 z-30`).

Operatoren:
- `=` — Korb = aktuell selektiertes Element
- `+` — Element hinzufügen (disabled wenn bereits drin)
- `−` — Element entfernen (disabled wenn nicht drin)
- `×` — Korb leeren + Modus deaktivieren

Darstellungsmodi (nur sichtbar wenn Korb > 0):
- **HV** (Hervorheben) — amber Overlay-Meshes auf Korb-Elementen
- **Geist** — Nicht-Korb-Elemente auf 12% Opacity
- **ISO** (Isolieren) — Nicht-Korb-Elemente ausgeblendet

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
- `lists` → `<ListPanel>`
- `sql` → `<SQLPanel>`

Enthält `SyncIndicator` (Verbindungs-Status-Punkt in der Titelleiste).
