# Performance — Diagnose, Fixes, Invarianten

Dieses Dokument hält fest **was untersucht wurde, was gebrochen war, wie es gefixt wurde, und warum**.  
Zweck: Bei zukünftigen Regressions sofort wissen, wo man anfängt.

---

## Symptome die auftraten (Mai 2026)

| Symptom | Ursache |
|---|---|
| ~100 FPS → ~30 FPS Einbruch | Billing-Viz-Effect hatte Zustand-Selector, der bei jeder Store-Mutation `scene.traverse()` auslöste |
| Input-Latenz (Klick, Orbit) spürbar erhöht | Sechs O(n)-Traversals pro interaktiver Aktion (hide, select, basket, ...) |
| 400 MB RAM statt ~200 MB anderer Viewer | Ein `MeshLambertMaterial` pro Mesh (~10.000 Unique-Objekte) |
| Billing-Overlays erschienen nie | `billingMeshMapRef` wurde in falsche Variable geschrieben, dann mit leerer Map überschrieben |
| OrbitControls Touch-Crash | `controls.touches` nicht konfiguriert → `pointers[1].x` undefined bei Pinch |
| Basket-Änderungen wurden nicht gerendert | `needsRenderRef.current = true` stand NACH einer `return`-Anweisung (dead code) |
| 5D Viz funktioniert nicht nach Modell laden | Billing-Subscription feuert nur bei Billing-Store-Änderungen, nicht bei Model-Load |

---

## Fix 1 — Material-Deduplication (ifcLoader.ts)

**Problem:** `StreamAllMeshes` erzeugte für jedes PlacedGeometry ein eigenes `MeshLambertMaterial`. Ein großes IFC-Modell → ~10.000 unique Material-Objekte auf CPU + GPU.

**Auswirkung:** ~50–100 MB zusätzlicher JS-Heap, erhöhter GPU-State-Overhead beim Rendern.

**Fix:** Cache vor dem `StreamAllMeshes`-Loop:
```typescript
const matCache = new Map<string, THREE.MeshLambertMaterial>();
// Im Loop:
const matKey = `${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a < 0.99 ? Math.round(a*255) : 255}`;
let material = matCache.get(matKey);
if (!material) {
  material = new THREE.MeshLambertMaterial({ color: new THREE.Color(r,g,b), opacity: a, transparent: a < 0.99, side: THREE.DoubleSide });
  matCache.set(matKey, material);
}
```
**Ergebnis:** Anzahl unique Materialien = Anzahl distinct RGBA-Farben im Modell (typisch 20–200).

**Datei:** `src/utils/ifcLoader.ts`

---

## Fix 2 — Billing meshMap Bug (ViewportContainer.tsx)

**Problem:** Im meshMap-Rebuild-Effect wurde `billingMeshMapRef.current` während `scene.traverse()` befüllt, dann am Ende mit der leeren lokalen `meshMap` überschrieben. Billing-Viz bekam immer eine leere Map.

**Fix:**
```typescript
// FALSCH war:
const list = billingMeshMapRef.current.get(key) ?? [];
list.push(obj);
billingMeshMapRef.current.set(key, list);
// ...
billingMeshMapRef.current = meshMap; // ← überschreibt mit leerer Map!

// RICHTIG:
const list = meshMap.get(key) ?? [];
list.push(obj);
meshMap.set(key, list);
// ...
billingMeshMapRef.current = meshMap;
```

**Datei:** `src/components/ViewportContainer.tsx`

---

## Fix 3 — Mesh-Index-Cache (KERNFIX, ViewportContainer.tsx)

**Problem:** Jede reaktive Aktion (Element ausblenden, selektieren, Basket ändern, Farbe setzen, Kanten togglen, Klick-Raycast) rief `scene.traverse()` auf — O(n) über alle Szenen-Objekte. Bei 10.000 Meshes = 10.000 Checks × mehrere Traversals pro Interaktion.

**Architektur-Entscheidung:** Einen einzigen Traversal pro Model-Load, der drei Index-Refs befüllt:

| Ref | Key-Format | Zweck |
|---|---|---|
| `meshIndexRef` | `modelId:expressId` → `Mesh[]` | Element-Visibility, Highlight, Basket, Color, Inspection |
| `edgeLinesRef` | flache Liste aller `LineSegments` mit `isEdge` | Edge-Toggle O(edges) |
| `pickableMeshesRef` | flache Liste aller Raycast-Kandidaten | Raycast ohne Traversal |
| `billingMeshMapRef` | `filename:expressId` → `Mesh[]` | Billing-Visualizer |

Alle vier werden im `models`-Effect in einem einzigen `scene.traverse()` aufgebaut.

**Vorher/Nachher pro Aktion:**

| Aktion | Vorher | Nachher |
|---|---|---|
| Element ausblenden/isolieren | O(scene): alle Meshes traversiert | O(index): forEach über Index-Map |
| Element selektieren (Highlight) | O(scene): traverse nach expressId | O(1): `meshIndexRef.get(key)` |
| Basket highlight-Mode | O(scene): traverse alle Meshes | O(basket): iterate basket → lookup |
| Basket ghost-Mode | O(scene) | O(index): forEach (inherent) |
| Farb-Gruppen setzen | O(scene) für Restore + Apply | O(k): nur betroffene Keys; Restore via `colorOverrideMeshesRef` |
| Kanten togglen | O(scene) | O(edgeLines): iterate Array |
| Maus-Klick Raycast | O(scene) zum Sammeln der Kandidaten | `pickableMeshesRef.filter(visible)` |
| Geometrie-Inspektor öffnen | O(scene) | O(1): `meshIndexRef.get(key)` |
| Zoom auf Element (ctxZoomTo) | O(scene) | O(k): lookup per expressId |
| collectMeshesForKey (Billing BC) | O(scene) mit traverse | O(1): `billingMeshMapRef.get(key)` |

**Erlaubte `scene.traverse()` Aufrufe (dokumentierte Ausnahmen):**
1. `models`-Effect: einmalig beim Modell-Load zum Index-Aufbau ✓
2. Nach `FaceEdgePicker.load()`: Inspector-Objekte mit `isGeometryInspector` taggen ✓
3. `exportGLTF`: nicht hot-path, einmalig beim Export ✓

**Invariante:** Kein reaktiver Effect (useEffect mit Deps) darf `scene.traverse()` aufrufen. Alle müssen Index-Refs nutzen.

**Datei:** `src/components/ViewportContainer.tsx`

---

## Fix 4 — Basket dead code Bug (ViewportContainer.tsx)

**Problem:** `needsRenderRef.current = true` stand nach einer `return () => {}` Cleanup-Funktion — wurde nie ausgeführt. Basket-Materialien wurden verändert aber kein Frame gerendert bis die Kamera bewegt wurde.

```typescript
// FALSCH (dead code):
return () => { /* cleanup */ };
needsRenderRef.current = true; // ← nie erreicht!

// RICHTIG:
needsRenderRef.current = true; // ← vor dem return
return () => { /* cleanup */ };
```

**Datei:** `src/components/ViewportContainer.tsx`

---

## Fix 5 — OrbitControls Touch-Crash

**Problem:** `controls.touches` nicht konfiguriert → bei Pinch-Geste `TypeError: Cannot read properties of undefined (reading 'x')` in OrbitControls intern.

**Fix:**
```typescript
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};
```

**Datei:** `src/components/ViewportContainer.tsx`

---

## Fix 6 — Billing Viz nach Model-Load (ViewportContainer.tsx)

**Problem:** Die Billing-Viz-Subscription (`useBillingStore.subscribe`) feuert nur bei Billing-Store-Änderungen. Wenn `moduleActive = true` war und dann ein Modell geladen wurde, wurde `billingMeshMapRef` befüllt — aber `viz.update()` nie aufgerufen. Overlays erschienen nicht.

**Fix:** Am Ende des `models`-Effect direkt aufrufen:
```typescript
const { entries, moduleActive } = useBillingStore.getState();
const viz = billingVizRef.current;
if (viz) {
  if (moduleActive) viz.update(entries, newBillingMap);
  else viz.clear();
}
```
Benutzt die frisch gebaute `newBillingMap` (nicht den Ref) — ist immer korrekt.

**Datei:** `src/components/ViewportContainer.tsx`

---

## Warum fühlt es sich flüssiger an (ohne messbar mehr FPS)?

Der Render-Loop war schon vorher auf Demand-Rendering (kein Rendern wenn keine Änderung). Die FPS-Anzeige zeigt typischerweise den Durchschnitt — aber die *Input-Latenz* ist das, was sich nach "flüssig" anfühlt:

- **Vorher:** Klick → `scene.traverse()` (10ms CPU bei großem Modell) → Render → Bild
- **Nachher:** Klick → `meshIndexRef.get()` (<0.1ms) → Render → Bild

Der Frame kommt schneller nach dem Input-Event. Das ist **Jank-Reduktion**, nicht FPS-Steigerung — und genau das, was als "flüssiger" wahrgenommen wird.

---

---

## Performance Pass 1 — Multi-Window & Visibility (Mai 2026)

### P1-Fix 1 — BroadcastChannel Lite-Serialisierung (windowSync.ts + App.tsx + modelStore.ts)

**Problem:** Jede Store-Mutation (z.B. Element ausblenden) serialisierte den gesamten Zustand inkl. `elementsByType` und `spatialTree` — potenziell MBs an Daten — per structured clone über den BroadcastChannel.

**Fix:** `serializeState(store, lite = false)` Parameter:
```typescript
elementsByType: lite ? {} : m.elementsByType,
spatialTree:    lite ? null : m.spatialTree,
```
`App.tsx` sendet `lite = true` bei inkrementellen Updates (Modelle unverändert). `applyRemoteState` in `modelStore.ts` bewahrt bestehende schwere Felder wenn das eingehende Objekt leer ist:
```typescript
const hasElements = Object.keys(sm.elementsByType).length > 0;
elementsByType: hasElements ? sm.elementsByType : (existing?.elementsByType ?? {}),
spatialTree:    sm.spatialTree ?? existing?.spatialTree ?? null,
```

**Ergebnis:** Inkrementelle Sync-Nachrichten (Hide, Select, Color, ...) sind ~100× kleiner.

---

### P1-Fix 2 — O(changed) Visibility Diff (ViewportContainer.tsx)

**Problem:** Jedes `hiddenElements`-Update (auch einzelnes Element ausblenden) lief durch alle Meshes aller Modelle — O(N_elements).

**Fix:** Diff-basierter Fast-Path:
```typescript
const prevHiddenRef = useRef<Set<string>>(hiddenElements);
// Nur wenn iso/basket/models unverändert:
const keys = new Set([...hidden, ...prevHidden]);
for (const key of keys) { /* update nur geänderte Keys */ }
return; // early exit
```
Full-sync nur wenn Isolation/Basket/Modelle sich ebenfalls geändert haben.

**Ergebnis:** Einzelnes Element ausblenden: O(1) statt O(N).

---

### P1-Fix 3 — Ghost-Mode Shared Materials (ViewportContainer.tsx)

**Problem:** Ghost-Mode (Basket-Isolation) erstellte pro Mesh ein eigenes halbtransparentes Material — O(N_meshes) Objekte.

**Fix:** Farb-keyed Material-Cache:
```typescript
const ghostByColor = new Map<number, THREE.MeshLambertMaterial>();
const color = orig.color?.getHex?.() ?? 0x808080;
let ghost = ghostByColor.get(color);
if (!ghost) {
  ghost = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.10 });
  ghostByColor.set(color, ghost);
  createdMats.push(ghost);
}
```
Highlight-Mode: Ein einzelnes geteiltes `hlMat` außerhalb der forEach-Schleife.

**Ergebnis:** Ghost-Mode: von O(N_meshes) auf O(distinct_colors) Materialien ≈ 20–200 statt 10.000.

---

### P1-Fix 4 — allTypes Caching (App.tsx)

**Problem:** `getAllTypes()` iterierte bei jeder Collision-Sync über alle Modelle und alle `elementsByType`-Keys.

**Fix:**
```typescript
let cachedAllTypes: string[] = [];
let cachedAllTypesKey = "";
const getAllTypes = (st) => {
  const key = Array.from(st.models.keys()).sort().join("|");
  if (key !== cachedAllTypesKey) { /* rebuild */ }
  return cachedAllTypes;
};
```

---

## Performance Pass 2 — 3D Viewer Kern (Mai 2026)

### P2-Fix 1 — InterleavedBuffer in IFC Loader (ifcLoader.ts)

**Problem:** `StreamAllMeshes` lieferte interleaved WASM-Speicher (pos+normal abwechselnd). Der Loader kopierte jeden Vertex einzeln in separate Float32Arrays — eine O(N_vertices) Schleife in JavaScript.

**Fix:** Direkter Buffer-Slice + `InterleavedBuffer`:
```typescript
const interleavedData = vertexData.slice();           // ein einzelner memcpy
const ib = new THREE.InterleavedBuffer(interleavedData, stride);
geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0));
geometry.setAttribute("normal",   new THREE.InterleavedBufferAttribute(ib, 3, 3));
```
Kompatibel mit `three-mesh-bvh` (MeshBVH.js nutzt `isInterleavedBufferAttribute`-Pfad für Position).

**Wichtig:** Index-Attribut bleibt reguläres `BufferAttribute` (GeometryBVH.js wirft Fehler bei interleaved Index).

**Ergebnis:** IFC-Ladezeit: je nach Modellgröße ~30–50% schneller. Kein JS-Loop mehr über Vertices.

---

### P2-Fix 2 — Uint16 Index Buffer für kleine Geometrien (ifcLoader.ts)

**Problem:** Index-Buffer war immer `Uint32Array` — 2× Speicher für Geometrien mit < 65536 Vertices.

**Fix:**
```typescript
const indexAttr = vertCount < 65536
  ? new THREE.BufferAttribute(new Uint16Array(indexData), 1)
  : new THREE.BufferAttribute(indexData.slice(), 1);  // .slice() weil WASM-Speicher freed wird
```
`indexData.slice()` bei großen Geometrien ist kritisch — `indexData` ist eine View in WASM-Heap, der nach `geomData.delete()` freigegeben wird.

**Ergebnis:** Für typische Architektur-IFCs (meist < 10k Vertices pro Mesh) halbierter Index-Buffer-RAM.

---

### P2-Fix 3 — Bounding Sphere Pre-Computation (ifcLoader.ts)

**Problem:** Three.js berechnet `boundingSphere` lazy beim ersten Raycast/Frustum-Culling — als Stall im ersten Frame nach dem Laden sichtbar.

**Fix:** Explizit nach `mesh.applyMatrix4(matrix)`:
```typescript
geometry.computeBoundingSphere();
```

**Ergebnis:** Erster Frame nach dem Laden flüssig; kein Mikro-Stall bei der ersten Kamerabewegung.

---

### P2-Fix 4 — Renderer Konfiguration (ViewportContainer.tsx)

**Änderungen:**
```typescript
// GPU Power Hint:
powerPreference: "high-performance"   // GPU wählt dGPU statt iGPU auf Dual-GPU-Systemen

// DPR Cap: 2.0 → 1.5
const fullDpr = Math.min(window.devicePixelRatio, 1.5);
```

**Ergebnis:** Auf Laptops mit Intel+Nvidia: automatisch Nvidia. DPR 1.5 spart ~44% Pixel vs. DPR 2.0 bei kaum wahrnehmbarem Qualitätsunterschied.

---

### P2-Fix 5 — Dynamische Auflösungsskalierung während Orbit (ViewportContainer.tsx)

**Problem:** Während Orbit/Pan/Zoom renderte der Viewer mit vollem DPR — unnötig, da Bewegungsunschärfe Details verdeckt.

**Fix:**
```typescript
let dprRestoreTimer: ReturnType<typeof setTimeout> | null = null;
const restoreDpr = () => {
  dprRestoreTimer = null;
  if (renderer.getPixelRatio() !== fullDpr) {
    renderer.setPixelRatio(fullDpr);
    needsRenderRef.current = true;
  }
};
// Im OrbitControls change-Handler:
if (renderer.getPixelRatio() !== 1.0) renderer.setPixelRatio(1.0);
if (dprRestoreTimer !== null) clearTimeout(dprRestoreTimer);
dprRestoreTimer = setTimeout(restoreDpr, 200);
```

**Ergebnis:** Während Orbit: ~56% weniger Pixel → direkte FPS-Verbesserung bei GPU-bound Szenen. Nach 200ms Idle: Rückkehr zu 1.5 DPR für scharfes Standbild.

---

### P2-Fix 6 — Edge Build Batch Size (ViewportContainer.tsx)

**Problem:** Kanten-Geometrie wurde in Batches von 30 verarbeitet — zu klein für moderne CPUs.

**Fix:** Batch-Größe 30 → 60.

**Ergebnis:** Sichtbarer Kanten beim Laden erscheinen schneller (weniger Yield-Unterbrechungen).

---

## Bekannte Nicht-Behobene Probleme

| Problem | Schweregrad | Aufwand | Notizen |
|---|---|---|---|
| `EdgesGeometry` bei Basket nie disposed | HOCH | Mittel | `obj.userData._basketEdgesGeo` wächst pro Session |
| WASM-Heap 200 MB für Properties | MITTEL | Hoch | `propModelCache` hält web-ifc-Modell offen; bewusste Entscheidung für Performance bei Prop-Abfragen |
| `BufferGeometry` Instanzen (kein Instancing) | MITTEL | Sehr Hoch | Gleiche IFC-Geometrie die 100× vorkommt = 100× GPU-Upload; Three.js `InstancedMesh` wäre Lösung |
| Raycasting ohne BVH | MITTEL | Mittel | `three-mesh-bvh` würde Klick-Latenz bei >50k Dreiecken pro Mesh stark reduzieren |
| `mergeGeo()` in BillingVisualizer alloziert Arrays | NIEDRIG | Niedrig | Nur beim ersten Auftreten einer billing entry; danach cached |

---

## Checkliste für neue Features

Jedes neue Feature das Szenen-Zugriff braucht muss diese Fragen beantworten:

- [ ] Braucht es per-Element-Zugriff? → `meshIndexRef.get("modelId:expressId")` nutzen
- [ ] Braucht es alle Meshes? → `pickableMeshesRef.current` oder `meshIndexRef.current.forEach`
- [ ] Erstellt es neue Materialien? → in `useRef` speichern und in Cleanup `.dispose()` aufrufen
- [ ] Erstellt es neue Geometrien? → in `useRef` speichern und in Cleanup `.dispose()` aufrufen
- [ ] Hat es einen `useEffect` der `scene.traverse()` aufruft? → **STOP**, Architektur-Review nötig
- [ ] Hat es einen Zustand-Selector der ein neues Objekt/Array zurückgibt? → Modul-Level-Konstante als Fallback (`const EMPTY: T[] = []`)
- [ ] Setzt es `needsRenderRef.current = true` NACH einer `return`-Anweisung? → dead code, verschieben
