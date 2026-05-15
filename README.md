# infraCore-Viewer

A fully client-side web IFC viewer — no backend, no server, no data leaves the browser.

## Features

- **IFC loading** — drag-and-drop or file-open, multiple models simultaneously
- **3D Viewport** — Three.js renderer with OrbitControls, render-on-demand (no wasted frames)
- **Hierarchy Panel** — three views: spatial tree (Site → Building → Storey → Element), by IFC type, and visible-elements snapshot
- **Properties Panel** — inspect and inline-edit element properties; export modified model as IFC
- **SQL Panel** — query `elementsByType` with plain SQL (`SELECT * FROM IfcWall WHERE Name LIKE '%Stahl%'`)
- **Lens Rules** — define filter rules to highlight, hide, or colorize elements by property
- **Smart Views** — save and restore named combinations of visibility + color states
- **Quantity Take-Off** — automatic area/volume/length aggregation per type
- **Selection Basket** — collect elements across models; zoom, filter, or export as a group
- **Measurement tool** — click-to-click distance measurement in 3D
- **Section plane** — interactive clip plane with axis-aligned presets
- **Multi-window sync** — open any panel (hierarchy, properties, SQL, …) in a separate browser window; state stays in sync via BroadcastChannel
- **Theme** — dark/light toggle

## Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| 3D | Three.js + OrbitControls |
| IFC parser | web-ifc 0.0.77 (WASM) |
| State | Zustand 5 |
| Layout | react-resizable-panels |
| SQL | alasql |
| Icons | lucide-react |

## Getting started

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/
npx tsc --noEmit   # type-check
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `F` | Fit all models into view |
| `S` | Selection tool |
| `M` | Measurement tool |
| `C` | Section plane tool |
| `Q` | Toggle SQL panel |
| `L` | Toggle Lens Rules panel |
| `V` | Toggle Smart Views panel |
| `T` | Toggle Quantity Take-Off panel |
| `H` | Hide selected element |
| `Shift+A` | Show all hidden elements |
| `Delete / Backspace` | Hide selected element |
| `Esc` | Cancel active tool / clear selection |

## Architecture

Everything runs in the browser. IFC geometry is streamed via web-ifc WASM into Three.js meshes. Properties are loaded on demand per element. The Zustand store is the single source of truth; secondary windows receive serialized state snapshots over BroadcastChannel.

```
Browser
├── Main window (React)
│   ├── MainToolbar
│   ├── HierarchyPanel  ←→  Zustand Store  ←→  BroadcastChannel
│   ├── ViewportContainer (Three.js)                ↕
│   ├── PropertiesPanel                    Secondary window(s)
│   ├── LensRulesPanel / SmartViewsPanel
│   ├── SQLPanel / QuantityListPanel
│   └── SelectionBasket
└── web-ifc WASM
```

See [`docs/`](./docs/) for detailed documentation on each subsystem.
