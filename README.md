# infraCore-Viewer

A fully client-side web IFC viewer — no backend, no server, no data leaves the browser.

## Features

### Viewer & Navigation
- **IFC loading** — drag-and-drop or file-open, multiple models simultaneously
- **3D Viewport** — Three.js renderer with OrbitControls, render-on-demand (no wasted frames)
- **Hierarchy Panel** — three views: spatial tree (Site → Building → Storey → Element), by IFC type, and visible-elements snapshot
- **Properties Panel** — inspect and inline-edit element properties; export modified model as IFC
- **Measurement tool** — click-to-click 3D distance measurement
- **Section plane** — interactive clip plane with axis-aligned presets and cap rendering

### Data & Queries
- **SQL Panel** — query loaded models with plain SQL (`SELECT * FROM IfcWall WHERE Name LIKE '%Stahl%'`)
- **Lens Rules** — define filter rules to highlight, hide, or colorize elements by property
- **Smart Views** — save and restore named combinations of visibility + color states
- **Quantity Take-Off** — automatic area/volume/length aggregation per IFC type
- **Selection Basket** — collect elements across models; highlight, ghost, or isolate as a group

### 5D Billing Module
- **5D-Abrechnung** — opens in a dedicated popup window (`?billing`)
- Track completion degree (0–100 %) per element with dated billing stages
- 3D fill-level overlay: colour-coded per element from grey → orange → green
- Document linking (doc-ID, title, URL) per entry
- **Mengen**: auto-calculation of volume + surface area from geometry; manual face/edge selection via Geometrie-Inspektor
- JSON export / import (session-stable keys based on filename:expressId)
- Monthly XLSX report (all stages in the last calendar month)
- Right-click context menu: add to 5D, set completion degree (10 % steps with colour coding)
- Isolate tracked elements in viewer

### LandXML / Alignment
- **Achsen-Panel** — load LandXML files, toggle individual alignments on/off with custom colours, stationing tool, resolution selector, longitudinal profile chart
- Accessible via the **Achsen** tab; the panel is no longer embedded as a sub-panel in the left sidebar
- Annotation sub-panel: automatic stationing labels, place named points on the alignment, compute horizontal offset to IFC geometry

### Batch Changes Module
- **Batch-Änderungen** — modal panel for bulk property editing across many elements at once
- **6 operation types**: set property, template formula (`{Name}`, `{Pset.Prop}`), copy property, find & replace (regex), name → property, property → name
- **4 filter kinds**: all elements, IFC type, property condition (eq/neq/contains/regex/empty/notEmpty), selection basket
- Preview table (first 50 changes) before applying
- All changes feed into the IFC export via `propertyOverrides`
- **Properties laden** button: reads all property keys and IFC types from the IFC file for autocomplete suggestions in all key fields
- Name changes are reflected immediately in the Hierarchy Panel

### Geometry Inspector Module
- Interactive face and edge selection on any isolated IFC element
- Detected faces (coplanar triangle groups) shown as clickable colour overlays
- Hard edges between faces shown as selectable lines
- Click to select, **Ctrl+click** for multi-select — sum of selected faces/edges displayed
- Saves selected area and edge lengths directly into the 5D billing entry

### General
- **Multi-window sync** — open any panel in a separate browser window; state syncs via BroadcastChannel
- **IFC export** — write modified IFC file with all property overrides applied
- **Theme** — dark/light toggle
- **Collapsible sidebars** — left and right panels can be collapsed via chevron buttons; floating expand buttons appear in the center viewport when a sidebar is hidden

## Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| 3D | Three.js 0.184 + OrbitControls |
| IFC parser | web-ifc 0.0.77 (WASM) |
| State | Zustand 5 |
| Layout | react-resizable-panels |
| SQL | alasql |
| XLSX | SheetJS (xlsx 0.18) |
| Icons | lucide-react |

## Getting started

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/
npx tsc --noEmit   # type-check
```

## Project layout

```
src/
├── App.tsx                  Main entry — routing, billing BC provider
├── main.tsx                 ?billing → BillingApp, else App
├── billing/                 5D billing module
│   ├── types.ts             BillingEntry, BillingMsg, ElementQuantities
│   ├── billingStore.ts      Zustand store + localStorage + BroadcastChannel
│   ├── BillingVisualizer.ts Three.js fill-level overlays
│   ├── BillingPanel.tsx     Billing window UI
│   ├── BillingApp.tsx       Root for ?billing window
│   └── quantityUtils.ts     Volume + surface area from Three.js geometry
├── batch/                   Batch changes module
│   ├── types.ts             BatchRule, BatchOperation, FilterOp, PreviewResult
│   ├── batchStore.ts        In-memory Zustand store (no persistence)
│   ├── BatchExecutor.ts     buildElementRows, executeRule, collectEdits
│   └── BatchPanel.tsx       Modal UI with rule editor and preview
├── geometry-inspector/      Interactive face/edge selection module
│   ├── types.ts             InspFace, InspEdge, InspectionSession
│   ├── GeometryAnalyzer.ts  BFS face grouping + hard edge extraction
│   ├── FaceEdgePicker.ts    Three.js overlays + raycasting interaction
│   └── GeometryInspectorPanel.tsx  Floating React panel
├── components/
│   ├── ViewportContainer.tsx  Three.js scene, all viewer interaction
│   ├── MainToolbar.tsx        Top toolbar (tools, export, 5D, Batch buttons)
│   ├── HierarchyPanel.tsx     Spatial / type / visible views
│   ├── PropertiesPanel.tsx    Element property editor
│   ├── SQLPanel.tsx           SQL query UI
│   ├── LensRulesPanel.tsx     Filter rule editor
│   ├── SmartViewsPanel.tsx    Named view snapshots
│   ├── QuantityListPanel.tsx  QTO table
│   └── SelectionBasket.tsx    Basket sidebar
├── store/
│   └── modelStore.ts          Central Zustand store
├── utils/
│   ├── ifcLoader.ts           web-ifc WASM geometry + property loading
│   ├── ifcWriter.ts           IFC export with property overrides
│   ├── windowSync.ts          BroadcastChannel helpers
│   └── sqlEngine.ts           alasql wrapper
└── section/                   Section plane module (SectionModule + CapGenerator)
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
| `H` → `H` | Hide selected element (H-chord) |
| `H` → `I` | Isolate selected element (H-chord) |
| `H` → `R` | Reset hide/isolate (H-chord) |
| `Shift+A` | Show all hidden elements |
| `Delete / Backspace` | Hide selected element |
| `Esc` | Cancel active tool / clear selection + highlight |

## Architecture

Everything runs in the browser. IFC geometry is streamed via web-ifc WASM into Three.js meshes. Properties are loaded on demand per element. The Zustand store is the single source of truth; secondary windows receive state over BroadcastChannel.

```
Browser
├── Main window (React)
│   ├── MainToolbar           ← tools, export, 5D button, Batch button
│   ├── HierarchyPanel ←──┐
│   ├── ViewportContainer  │  Zustand Store ←→ BroadcastChannel
│   ├── PropertiesPanel ←──┤                        ↕
│   ├── SQLPanel           │              5D window (?billing)
│   ├── LensRulesPanel     │              Secondary panel windows
│   ├── QuantityListPanel  │
│   ├── SelectionBasket ←──┘
│   ├── BatchPanel (modal)
│   └── GeometryInspectorPanel (overlay)
└── web-ifc WASM
```

See [`docs/`](./docs/) for detailed documentation on each subsystem.
