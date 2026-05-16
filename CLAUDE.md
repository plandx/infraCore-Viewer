# infraCore-Viewer — Claude Arbeitskontext

## Pflicht: Dokumentation aktuell halten

**Jedes Mal wenn Code geändert wird, müssen die betroffenen Docs-Dateien sofort mitgepflegt werden.**
Neue Features → Docs erweitern. Architektur geändert → Docs anpassen. Keine Ausnahmen.

| Datei | Inhalt |
|---|---|
| `docs/architecture.md` | Projektübersicht, Stack, Verzeichnisstruktur, Datenfluss |
| `docs/frontend.md` | Alle React-Komponenten, Props, Zuständigkeiten |
| `docs/backend.md` | IFC-Parser, SQL-Engine, Utility-Funktionen (kein Server) |
| `docs/state-management.md` | Zustand-Store: alle Felder, Aktionen, Selektoren |
| `docs/viewer.md` | Three.js Viewport: Szene, Materialien, Effekte, Events |
| `docs/window-system.md` | Multi-Window-Sync: BroadcastChannel-Protokoll, Serialisierung |

---

## Projekt auf einen Blick

**infraCore-Viewer** ist ein rein clientseitiger Web-IFC-Viewer (kein Backend).
Geöffnete IFC-Dateien bleiben im Browser-Speicher; WASM parst die Geometrie und Eigenschaften.

- **Branch:** `claude/ifc-viewer-web-PeYkM`
- **Dev-Server:** `npm run dev` (Vite, Port 5173)
- **Build:** `npm run build` → `dist/`
- **Type-Check:** `npx tsc --noEmit`

## Stack

| Schicht | Technologie |
|---|---|
| Framework | React 19 + TypeScript 6 |
| Build | Vite 8 |
| Styling | Tailwind CSS v4 (kein config-File, inline) |
| 3D | Three.js 0.184 + OrbitControls |
| IFC-Parser | web-ifc 0.0.77 (WASM) |
| State | Zustand 5 |
| Layout | react-resizable-panels 4 |
| SQL | alasql (Mini-Engine über `elementsByType`) |
| Icons | lucide-react 1.14 |

## Wichtige Konventionen

- **Keine Kommentare** außer wenn das „Warum" nicht offensichtlich ist
- **Kein Backend** — alle Daten leben im Browser
- `File`-Objekte können per BroadcastChannel übertragen werden (structured clone)
- Zustand-Subscriptions feuern **synchron** während `set()` — wichtig für Echo-Prävention
- Materialien bei Cleanup immer `.dispose()` aufrufen
- Neue Store-Felder immer auch in `serializeState()` und `applyRemoteState()` eintragen
- Nach jeder Änderung: `npx tsc --noEmit` muss fehlerfrei sein

## Keyboard-Shortcuts (Main-Fenster)

| Taste | Aktion |
|---|---|
| `F` | Alles einpassen |
| `S` | Auswahl-Werkzeug |
| `M` | Messen |
| `C` | Schnitt |
| `Q` | SQL-Panel togglen |
| `L` | Listen-Panel togglen |
| `H` → `H` | Ausgewähltes Element ausblenden (H+H Chord) |
| `H` → `I` | Ausgewähltes Element isolieren (H+I Chord) |
| `H` → `R` | Ausblenden/Isolieren zurücksetzen (H+R Chord) |
| `Shift+A` | Alles einblenden |
| `Delete/Backspace` | Ausgewähltes Element ausblenden |
| `Esc` | Werkzeug abbrechen / Auswahl aufheben |

**H-Chord:** `H` drücken → 1 Sekunde warten → zweite Taste drücken. Kein zweiter Tastendruck → H-Chord läuft ab ohne Aktion.
Schließe deine Aufgaben immer ab bevor die Credits aufgebraucht sind und Commit und Push.
