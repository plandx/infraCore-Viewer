# Multi-Window-System

infraCore-Viewer unterstützt mehrere Browser-Fenster **innerhalb derselben App-Session**.
Die Fenster teilen keinen gemeinsamen Prozess — Kommunikation läuft über die **BroadcastChannel API**.

---

## Konzept

```
Main-Fenster                         Sekundär-Fenster
─────────────────────────────────────────────────────
Zustand-Store                        Zustand-Store (Kopie)
    │                                    │
    ├──── BroadcastChannel ─────────────►│  State-Push (80ms debounce)
    │◄─── BroadcastChannel ──────────────┤  State-Push (bidirektional)
    │                                    │
    └── applyingRef schützt Echo-Loop ───┘
```

Beide Fenster halten **je einen eigenen Zustand-Store**. Änderungen in einem Fenster werden als vollständiger Snapshot übertragen und im anderen angewendet.

---

## URL-Schema

```
Main:       http://localhost:5173/
Sekundär:   http://localhost:5173/?secondary&panel=hierarchy
                                              panel=properties
                                              panel=lists
                                              panel=sql
```

`App.tsx` erkennt `?secondary` und rendert `<SecondaryWindow panel={...}>` statt der vollen App.

---

## Nachrichten-Protokoll

**Kanal:** `"infracore-sync"` (Konstante `SYNC_CHANNEL`)

```typescript
type SyncMsg =
  | { t: "state"; s: SyncState }  // Vollständiger Zustand-Snapshot
  | { t: "req" }                   // Neues Fenster bittet um aktuellen Zustand
  | { t: "act"; a: SyncAction }   // Legacy: Einzelne Aktion (noch im Main-Fenster verarbeitet)
```

### Ablauf beim Öffnen eines Sekundär-Fensters
1. Sekundär-Fenster sendet `{ t: "req" }`
2. Main-Fenster antwortet mit `{ t: "state", s: serializeState(store) }`
3. Sekundär-Fenster wendet State an via `applyRemoteState()`

### Laufender Sync
- Jede Store-Änderung → 80ms-Debounce → `{ t: "state", s: ... }` senden
- Empfänger wendet State an → `applyRemoteState()` triggert erneut eine Store-Änderung
- **Echo wird verhindert** durch `applyingRef` (s.u.)

---

## Echo-Loop-Prävention

Zustand-Subscriptions feuern **synchron** während `set()`. Ohne Schutz würde jedes empfangene Update sofort zurückgesendet werden.

**Lösung: `applyingRef`-Flag**

```typescript
const applyingRef = useRef(false);

ch.onmessage = (e) => {
  if (e.data.t === "state") {
    applyingRef.current = true;     // Flag setzen
    applyRemoteState(e.data.s);     // set() → Subscription feuert → sieht Flag → skip
    applyingRef.current = false;    // sofort zurücksetzen (synchron!)
  }
};

useModelStore.subscribe(() => {
  if (applyingRef.current) return;  // Echo überspringen
  // ... debounce + senden
});
```

Das funktioniert weil Zustand-Subscriptions **synchron** innerhalb von `set()` ausgeführt werden — der Flag ist also noch gesetzt wenn die Subscription feuert.

---

## Serialisierung

**Datei:** `src/utils/windowSync.ts` — `serializeState(store)`

Erstellt einen structured-clone-sicheren Snapshot:

```typescript
interface SyncState {
  models: SyncModel[];           // Nur geladene Modelle (status === "loaded")
  selectedElement: SelectedElement | null;
  settings: ViewerSettings;
  hiddenElements: string[];      // Set<string> → Array
  isolatedElements: string[] | null;
  colorGroups: ColorGroup[] | null;
  smartViews: SmartView[];
  activeSmartViewId: string | null;
  loadedPropKeys: string[];
  selectionBasket: string[];     // Set<string> → Array
  basketMode: BasketMode | null;
}
```

### SyncModel (kein Three.js!)
```typescript
interface SyncModel {
  id: string;
  name: string;
  file: File;       // File ist structured-clone-fähig → kann über BroadcastChannel!
  visible: boolean;
  color: string;
  opacity: number;
  size: number;
  elementsByType: Record<string, ElementNode[]>;
  spatialTree: SpatialNode | null;
}
```

**`File`-Objekte** können per BroadcastChannel übertragen werden (structured clone). So können Sekundär-Fenster `loadIFCProperties()` selbst aufrufen.

Three.js-Objekte (`mesh`, `boundingBox`, `originOffset`) werden **nicht** serialisiert — `applyRemoteState` behält die vorhandenen Werte.

---

## `applyRemoteState` im Store

Wendet `SyncState` auf den lokalen Store an:
- Baut `models`-Map neu auf, **behält vorhandene** `mesh`, `boundingBox`, `originOffset`
- Neue Modelle erhalten leere Three.js-Objekte (`new THREE.Group()` etc.)
- Überschreibt: `selectedElement`, `settings`, `hiddenElements`, `isolatedElements`, `colorGroups`, `smartViews`, `activeSmartViewId`, `loadedPropKeys`, `selectionBasket`, `basketMode`

---

## Sekundär-Fenster öffnen

```typescript
// src/utils/windowSync.ts
export const PANEL_META: Record<PanelType, { label: string; w: number; h: number }> = {
  hierarchy:  { label: "Hierarchiebaum",      w: 380, h: 700 },
  properties: { label: "Eigenschaften",       w: 420, h: 600 },
  lists:      { label: "Listen & SmartViews", w: 480, h: 640 },
  sql:        { label: "SQL-Abfrage",         w: 760, h: 480 },
};

export function openSecondaryWindow(panel: PanelType) {
  const { w, h } = PANEL_META[panel];
  window.open(`?secondary&panel=${panel}`, `infracore-${panel}`, `width=${w},height=${h},resizable=yes`);
}
```

Aufruf aus `MainToolbar` via Dropdown.

---

## Einschränkungen

- BroadcastChannel funktioniert nur **same-origin** (gleiches Protokoll + Domain + Port)
- Sekundär-Fenster haben **kein 3D-Viewport** (kein `ViewportContainer`)
- `viewer:fitAll`, `viewer:fitTo` Events funktionieren nur im Main-Fenster
- IFC-Ladefortschritt läuft nur im Main-Fenster

---

## Checkliste bei neuen Store-Feldern

Damit der Multi-Window-Sync funktioniert, müssen neue Felder an **vier Stellen** eingetragen werden:

1. `ModelStore` Interface (`modelStore.ts`)
2. Initialwert in `create()` (`modelStore.ts`)
3. `SyncState` Interface (`types/ifc.ts`)
4. `serializeState()` (`windowSync.ts`)
5. `applyRemoteState()` (`modelStore.ts`)
6. `docs/state-management.md` + `docs/window-system.md` aktualisieren
