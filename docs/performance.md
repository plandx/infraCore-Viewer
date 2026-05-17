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
