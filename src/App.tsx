import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AlignmentPanel } from "./alignment/AlignmentPanel";
import { v4 as uuidv4 } from "uuid";
import * as THREE from "three";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from "react-resizable-panels";

import { MainToolbar } from "./components/MainToolbar";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { ViewportContainer } from "./components/ViewportContainer";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { StatusBar } from "./components/StatusBar";
import { LandingOverlay } from "./components/LandingOverlay";
import { ClipPlaneControl } from "./components/ClipPlaneControl";
import { SQLPanel } from "./components/SQLPanel";
import { LensRulesPanel } from "./components/LensRulesPanel";
import { SmartViewsPanel } from "./components/SmartViewsPanel";
import { QuantityListPanel } from "./components/QuantityListPanel";
import { SelectionBasket } from "./components/SelectionBasket";
import { BasketWindow } from "./components/BasketWindow";
import { ModelInfoPanel } from "./components/ModelInfoPanel";
import { useBillingStore } from "./billing/billingStore";
import { Billing5DOverlay } from "./billing/Billing5DOverlay";
import { BatchPanel } from "./batch/BatchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { CollisionWindow } from "./components/CollisionWindow";

import { ProfileViewer } from "./alignment/ProfileViewer";
import { CrossSectionWindow } from "./alignment/CrossSectionWindow";
import { LongitudinalSectionWindow } from "./alignment/LongitudinalSectionWindow";
import { AbwicklungWindow } from "./alignment/AbwicklungWindow";
import { FaceCrossSectionPanel } from "./alignment/FaceCrossSectionPanel";
import { useAlignmentStore } from "./alignment/alignmentStore";
import { SecondaryWindow } from "./components/SecondaryWindow";
import { useModelStore } from "./store/modelStore";
import { loadIFCFile, loadIFCProperties, evictPropModelCache } from "./utils/ifcLoader";
import { SYNC_CHANNEL, CROSS_SECTION_CHANNEL, COLLISION_CHANNEL, LS_CHANNEL, ABWICKLUNG_CHANNEL, DEFAULT_CLASH_RULES, serializeState, openSecondaryWindow, openCollisionWindow, openBasketWindow } from "./utils/windowSync";
import type { SyncMsg, XSMsg, CollisionMsg, LSMsg, AbwicklungMsg, AbwicklungSyncState, ClashRule, ClashResult, XSSyncObjectLabel } from "./utils/windowSync";
import { collectElements, runRuleBasedDetection } from "./utils/collisionUtils";
import type { IFCModelEntry } from "./types/ifc";

// ── detect secondary / cross-section windows ─────────────────────────────────

const _params = new URLSearchParams(window.location.search);
const IS_SECONDARY = _params.has("secondary");
const SECONDARY_PANEL = _params.get("panel") ?? "hierarchy";
const IS_CROSS_SECTION = _params.has("cross-section");
const IS_LONG_SECTION  = _params.has("longitudinal-section");
const IS_COLLISION = _params.has("collision");
const IS_BASKET = _params.has("basket");
const IS_ABWICKLUNG = _params.has("abwicklung");

// ── root export (secondary windows skip the full app) ─────────────────────────

export default function App() {
  useEffect(() => {
    const { settings } = useModelStore.getState();
    document.documentElement.classList.toggle("dark", settings.theme !== "light");
    document.documentElement.setAttribute("data-font-size", settings.fontSize ?? "md");
  }, []);
  if (IS_COLLISION) return <CollisionWindow />;
  if (IS_SECONDARY) return <SecondaryWindow panel={SECONDARY_PANEL} />;
  if (IS_CROSS_SECTION) return <CrossSectionWindow />;
  if (IS_LONG_SECTION) return <LongitudinalSectionWindow />;
  if (IS_BASKET) return <BasketWindow />;
  if (IS_ABWICKLUNG) return <AbwicklungWindow />;
  return <MainApp />;
}

// ── main-window sync hook ─────────────────────────────────────────────────────

function useMainWindowSync(handleElementClick: (modelId: string, expressId: number, ctrlHeld?: boolean) => Promise<void>) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = ch;
    // Track loaded model IDs — when they change we must send full state including
    // elementsByType/spatialTree; otherwise use lite (skips expensive deep-clone).
    const prevModelsKeyRef = { current: "" };

    const getModelsKey = (st: ReturnType<typeof useModelStore.getState>) =>
      Array.from(st.models.values()).filter(m => m.status === "loaded").map(m => m.id).sort().join("|");

    ch.onmessage = async (e: MessageEvent<SyncMsg>) => {
      const msg = e.data;
      if (msg.t === "req") {
        const st = useModelStore.getState();
        prevModelsKeyRef.current = getModelsKey(st);
        ch.postMessage({ t: "state", s: serializeState(st) } satisfies SyncMsg);
      } else if (msg.t === "state") {
        // State broadcast from a secondary window — apply it and skip echoing
        applyingRef.current = true;
        useModelStore.getState().applyRemoteState(msg.s);
        applyingRef.current = false;
      } else if (msg.t === "act") {
        const store = useModelStore.getState();
        const a = msg.a;
        switch (a.k) {
          case "select":     await handleElementClick(a.modelId, a.expressId); break;
          case "hide":       store.hideElement(a.modelId, a.expressId); break;
          case "showAll":    store.showAll(); break;
          case "isolate":    store.isolateElement(a.modelId, a.expressId); break;
          case "colorGroups":       store.setColorGroups(a.groups); break;
          case "applySmartView":    store.applySmartView(a.id); break;
          case "deactivateSmartView": store.deactivateSmartView(); break;
          case "settings":   store.updateSettings(a.patch); break;
          case "fitAll":     window.dispatchEvent(new Event("viewer:fitAll")); break;
        }
      }
    };

    // Broadcast state on every store change (debounced); skip echo-induced changes.
    // Use lite mode (no elementsByType) when models haven't changed — saves structured-clone
    // cost on potentially MBs of element data on every selection/hide/show action.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useModelStore.subscribe(() => {
      if (applyingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!channelRef.current) return;
        const st = useModelStore.getState();
        const key = getModelsKey(st);
        const lite = key === prevModelsKeyRef.current;
        prevModelsKeyRef.current = key;
        channelRef.current.postMessage({
          t: "state",
          s: serializeState(st, lite),
        } satisfies SyncMsg);
      }, 80);
    });

    return () => {
      ch.close();
      channelRef.current = null;
      unsub();
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── cross-section window sync hook ───────────────────────────────────────────

function useCrossSectionSync() {
  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(CROSS_SECTION_CHANNEL); } catch { return; }

    const broadcast = () => {
      const store = useAlignmentStore.getState();
      const alignment = store.files.flatMap(f => f.alignments)
        .find(a => a.id === store.crossSectionAlignmentId);
      const modelStore   = useModelStore.getState();
      const firstIfcXS   = modelStore.models.values().next().value as import("./types/ifc").IFCModelEntry | undefined;
      // oz = elevation that maps worldY=0 back to absolute elevation;
      // origin[1] is worldY of the alignment axis, so absolute elevation = origin[1] + oz.
      const ozXS = firstIfcXS
        ? firstIfcXS.originOffset.y
        : (store.geoOrigin?.z ?? 0);
      ch.postMessage({
        t: "state", s: {
          station: store.crossSectionStation,
          alignmentId: store.crossSectionAlignmentId,
          alignmentName: alignment?.displayName ?? (store.faceCrossSectionActive ? "Flächen-QS" : ""),
          staStart: alignment?.staStart ?? 0,
          staEnd: alignment?.staEnd ?? 0,
          mode: store.crossSectionMode,
          lines: store.crossSectionLines,
          polygons: store.crossSectionPolygons,
          computing: store.crossSectionComputing,
          showSectionSurface: store.showSectionSurface,
          objectLabels: store.crossSectionObjectLabels,
          isFaceSection: store.faceCrossSectionActive,
          faceOffset: store.faceCrossSectionOffset,
          theme: modelStore.settings.theme,
          elevationOrigin: store.crossSectionBasis != null
            ? store.crossSectionBasis.origin[1] + ozXS
            : undefined,
          depthView: store.depthView,
          depthDistance: store.depthDistance,
          depthLines: store.depthLines,
        },
      } satisfies XSMsg);
    };

    ch.onmessage = (e: MessageEvent<XSMsg>) => {
      const store = useAlignmentStore.getState();
      const msg = e.data;
      if (msg.t === "req") {
        broadcast();
        // If face section is active but lines haven't arrived yet (window opened after
        // broadcast was already sent, or computation silently failed), re-trigger.
        const st = useAlignmentStore.getState();
        if (st.faceCrossSectionActive && st.crossSectionLines.length === 0 && !st.crossSectionComputing) {
          st.retriggerFaceSectionCompute();
        }
      } else if (msg.t === "setStation") {
        store.setCrossSectionStation(msg.alignmentId, msg.station);
      } else if (msg.t === "nextStation") {
        if (store.crossSectionStation != null && store.crossSectionAlignmentId != null) {
          const al = store.files.flatMap(f => f.alignments)
            .find(a => a.id === store.crossSectionAlignmentId);
          if (al) {
            const newSta = Math.max(al.staStart, Math.min(al.staEnd, store.crossSectionStation + msg.delta));
            store.setCrossSectionStation(store.crossSectionAlignmentId, newSta);
          }
        }
      } else if (msg.t === "setMode") {
        store.setCrossSectionMode(msg.mode);
      } else if (msg.t === "toggleSectionSurface") {
        store.setShowSectionSurface(!store.showSectionSurface);
      } else if (msg.t === "setFaceOffset") {
        store.setFaceCrossSectionOffset(msg.offset);
      } else if (msg.t === "setDepthView") {
        store.setDepthView(msg.enabled);
        if (msg.distance !== undefined) store.setDepthDistance(msg.distance);
      } else if (msg.t === "close") {
        if (store.faceCrossSectionActive) {
          store.closeFaceCrossSection();
        } else {
          store.closeCrossSection();
        }
        store.setShowSectionSurface(false);
      }
    };

    const unsub = useAlignmentStore.subscribe((state, prev) => {
      if (
        state.crossSectionLines         !== prev.crossSectionLines         ||
        state.crossSectionPolygons      !== prev.crossSectionPolygons      ||
        state.crossSectionStation       !== prev.crossSectionStation       ||
        state.crossSectionMode          !== prev.crossSectionMode          ||
        state.crossSectionComputing     !== prev.crossSectionComputing     ||
        state.showSectionSurface        !== prev.showSectionSurface        ||
        state.crossSectionObjectLabels  !== prev.crossSectionObjectLabels  ||
        state.faceCrossSectionActive    !== prev.faceCrossSectionActive    ||
        state.faceCrossSectionOffset    !== prev.faceCrossSectionOffset    ||
        state.crossSectionBasis         !== prev.crossSectionBasis         ||
        state.depthView                 !== prev.depthView                 ||
        state.depthDistance             !== prev.depthDistance             ||
        state.depthLines                !== prev.depthLines
      ) broadcast();
    });

    const unsubModel = useModelStore.subscribe((state, prev) => {
      if (state.settings.theme !== prev.settings.theme) broadcast();
    });

    return () => { ch.close(); unsub(); unsubModel(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface LoadState { phase: string; progress: number; fileName: string }

// ── longitudinal-section window sync hook ─────────────────────────────────────

function useLongitudinalSectionSync() {
  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(LS_CHANNEL); } catch { return; }

    // objectLabels cache — recomputed only when lsLines reference changes
    let cachedLsLines: import("./utils/windowSync").LSLineSync[] | null = null;
    let cachedObjectLabels: XSSyncObjectLabel[] = [];

    const broadcast = () => {
      const store = useAlignmentStore.getState();
      const alignment = store.files.flatMap(f => f.alignments)
        .find(a => a.id === store.lsAlignmentId);
      const modelStore  = useModelStore.getState();
      const firstIfc    = modelStore.models.values().next().value as import("./types/ifc").IFCModelEntry | undefined;
      // LS elevations are stored as absolute values (worldY + oz at compute time),
      // so no additional offset is needed at display time.
      const elevationOrigin = 0;

      if (store.lsLines !== cachedLsLines) {
        cachedLsLines = store.lsLines;
        const uniqueKeys = new Set(store.lsLines.filter(l => l.objectKey).map(l => l.objectKey!));
        cachedObjectLabels = [];
        for (const key of uniqueKeys) {
          const [modelId, eidStr] = key.split(":");
          const eid = parseInt(eidStr);
          const model = modelStore.models.get(modelId);
          if (!model) { cachedObjectLabels.push({ key, name: key, type: "—", props: {} }); continue; }
          let name = key, type = "—", props: Record<string, string> = {};
          for (const [itype, els] of Object.entries(model.elementsByType)) {
            const el = (els as import("./types/ifc").ElementNode[]).find(e => e.expressId === eid);
            if (el) { name = el.name || key; type = itype; break; }
          }
          const ifcProps = (model.properties as Record<number, import("./types/ifc").IFCProperties>)[eid];
          if (ifcProps?.properties) {
            for (const p of ifcProps.properties)
              if (typeof p.value === "string" || typeof p.value === "number") props[p.name] = String(p.value);
          }
          cachedObjectLabels.push({ key, name, type, props });
        }
      }

      ch.postMessage({
        t: "state", s: {
          alignmentId:      store.lsAlignmentId,
          alignmentName:    alignment?.displayName ?? "",
          staStart:         store.lsStaStart ?? 0,
          staEnd:           store.lsStaEnd   ?? 0,
          lines:            store.lsLines,
          profile:          store.lsProfile,
          computing:        store.lsComputing,
          theme:            modelStore.settings.theme,
          elevationOrigin,
          objectLabels:     cachedObjectLabels,
          depthLines:       store.lsDepthLines,
          depthView:        store.lsDepthView,
          depthDistance:    store.lsDepthDistance,
        },
      } satisfies LSMsg);
    };

    ch.onmessage = (e: MessageEvent<LSMsg>) => {
      const store = useAlignmentStore.getState();
      const msg = e.data;
      if (msg.t === "req") {
        broadcast();
        if (store.lsOpen && store.lsLines.length === 0 && !store.lsComputing &&
            store.lsStaStart !== null && store.lsStaEnd !== null) {
          store.setLSRange(store.lsStaStart, store.lsStaEnd);
        }
      } else if (msg.t === "setRange") {
        if (store.lsAlignmentId !== null)
          store.setLSRange(msg.staStart, msg.staEnd);
      } else if (msg.t === "setDepthView") {
        store.setLSDepthView(msg.enabled, msg.distance);
      } else if (msg.t === "close") {
        store.closeLongSection();
      }
    };

    const unsub = useAlignmentStore.subscribe((state, prev) => {
      if (state.lsLines        !== prev.lsLines        ||
          state.lsProfile      !== prev.lsProfile      ||
          state.lsStaStart     !== prev.lsStaStart     ||
          state.lsStaEnd       !== prev.lsStaEnd       ||
          state.lsComputing    !== prev.lsComputing    ||
          state.lsOpen         !== prev.lsOpen         ||
          state.lsDepthLines   !== prev.lsDepthLines   ||
          state.lsDepthView    !== prev.lsDepthView    ||
          state.lsDepthDistance!== prev.lsDepthDistance) broadcast();
    });
    const unsubModel = useModelStore.subscribe((s, p) => {
      if (s.settings.theme !== p.settings.theme) broadcast();
    });
    return () => { ch.close(); unsub(); unsubModel(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── abwicklung window sync hook ────────────────────────────────────────────────

function useAbwicklungSync() {
  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(ABWICKLUNG_CHANNEL); } catch { return; }

    const broadcast = () => {
      const store = useAlignmentStore.getState();
      const alignment = store.files.flatMap(f => f.alignments)
        .find(a => a.id === store.abwicklungAlignmentId);
      const theme = useModelStore.getState().settings.theme;
      const s: AbwicklungSyncState = {
        alignmentId:     store.abwicklungAlignmentId,
        alignmentName:   alignment?.displayName ?? "",
        staStart:        store.abwicklungStaStart ?? 0,
        staEnd:          store.abwicklungStaEnd   ?? 0,
        leftOffset:      store.abwicklungLeftOffset,
        rightOffset:     store.abwicklungRightOffset,
        lines:           store.abwicklungLines,
        computing:       store.abwicklungComputing,
        theme,
        elevationOrigin: store.abwicklungElevationOrigin,
      };
      ch.postMessage({ t: "state", s } satisfies AbwicklungMsg);
    };

    ch.onmessage = (e: MessageEvent<AbwicklungMsg>) => {
      const store = useAlignmentStore.getState();
      const msg = e.data;
      if (msg.t === "req") {
        broadcast();
        if (store.abwicklungOpen && store.abwicklungLines.length === 0 &&
            !store.abwicklungComputing &&
            store.abwicklungStaStart !== null && store.abwicklungStaEnd !== null) {
          store.setAbwicklungRange(store.abwicklungStaStart, store.abwicklungStaEnd);
        }
      } else if (msg.t === "setRange") {
        store.setAbwicklungRange(msg.staStart, msg.staEnd);
      } else if (msg.t === "setOffsets") {
        store.setAbwicklungOffsets(msg.left, msg.right);
      } else if (msg.t === "close") {
        store.closeAbwicklung();
      }
    };

    const unsub = useAlignmentStore.subscribe((state, prev) => {
      if (state.abwicklungLines      !== prev.abwicklungLines      ||
          state.abwicklungComputing  !== prev.abwicklungComputing  ||
          state.abwicklungOpen       !== prev.abwicklungOpen       ||
          state.abwicklungStaStart   !== prev.abwicklungStaStart   ||
          state.abwicklungStaEnd     !== prev.abwicklungStaEnd     ||
          state.abwicklungLeftOffset !== prev.abwicklungLeftOffset ||
          state.abwicklungRightOffset!== prev.abwicklungRightOffset) broadcast();
    });
    const unsubModel = useModelStore.subscribe((s, p) => {
      if (s.settings.theme !== p.settings.theme) broadcast();
    });
    return () => { ch.close(); unsub(); unsubModel(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── collision window sync hook ─────────────────────────────────────────────────

function useCollisionSync() {
  useEffect(() => {
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(COLLISION_CHANNEL); } catch { return; }

    // allTypes is expensive to recompute (iterates all elementsByType) — cache it.
    let cachedAllTypes: string[] = [];
    let cachedAllTypesKey = "";
    const getAllTypes = (st: ReturnType<typeof useModelStore.getState>) => {
      const key = Array.from(st.models.keys()).sort().join("|");
      if (key !== cachedAllTypesKey) {
        const s = new Set<string>();
        for (const [, m] of st.models) for (const t of Object.keys(m.elementsByType)) s.add(t);
        cachedAllTypes = Array.from(s).sort();
        cachedAllTypesKey = key;
      }
      return cachedAllTypes;
    };

    const broadcast = (rules: ClashRule[], results: ClashResult[], running: boolean, progress: number) => {
      const st = useModelStore.getState();
      ch.postMessage({ t: "state", s: { rules, results, running, progress, allTypes: getAllTypes(st), loadedPropKeys: st.loadedPropKeys, theme: st.settings.theme } } satisfies CollisionMsg);
    };

    let currentRules: ClashRule[] = DEFAULT_CLASH_RULES;
    let currentResults: ClashResult[] = [];

    ch.onmessage = async (e: MessageEvent<CollisionMsg>) => {
      const msg = e.data;
      if (msg.t === "req") {
        broadcast(currentRules, currentResults, false, 0);
      } else if (msg.t === "run") {
        currentRules = msg.rules;
        broadcast(currentRules, currentResults, true, 0);
        const elements = collectElements(useModelStore.getState().models);
        const results = await runRuleBasedDetection(elements, currentRules, (pct: number) => {
          broadcast(currentRules, currentResults, true, pct);
        });
        currentResults = results;
        broadcast(currentRules, currentResults, false, 100);
      } else if (msg.t === "setStatus") {
        currentResults = currentResults.map(r => {
          const key = `${r.ruleId}|${r.modelIdA}:${r.expressIdA}|${r.modelIdB}:${r.expressIdB}`;
          return key === msg.key ? { ...r, status: msg.status } : r;
        });
        broadcast(currentRules, currentResults, false, 100);
      } else if (msg.t === "isolate") {
        useModelStore.getState().isolateEntries([
          { modelId: msg.modelIdA, expressId: msg.expressIdA },
          { modelId: msg.modelIdB, expressId: msg.expressIdB },
        ]);
      }
    };

    const unsubTheme = useModelStore.subscribe((state, prev) => {
      if (state.settings.theme !== prev.settings.theme)
        broadcast(currentRules, currentResults, false, currentResults.length > 0 ? 100 : 0);
    });

    return () => { ch.close(); unsubTheme(); };
  }, []);
}

function MainApp() {
  const [loadStates, setLoadStates]           = useState<Map<string, LoadState>>(new Map());
  const [batchPanelOpen, setBatchPanelOpen]   = useState(false);
  const {
    addModel, removeModel, updateModel, setWorldOrigin, setSelected,
    models, settings, activeTool, setActiveTool, sqlPanelOpen, setSqlPanelOpen,
    hideElement, showAll, selectedElement, clearMeasurements,
    listPanelOpen, setListPanelOpen,
    smartViewsPanelOpen, setSmartViewsPanelOpen,
    qtoPanelOpen, setQTOPanelOpen,
    billing5DPanelOpen, setBilling5DPanelOpen,
    profilePanelOpen, setProfilePanelOpen,
    settingsPanelOpen,
    keyBindings,
  } = useModelStore();

  const alignmentPanelOpen = useAlignmentStore(s => s.panelOpen);
  const toggleAlignmentPanel = useAlignmentStore(s => s.togglePanel);

  const leftPanelRef  = useRef<PanelImperativeHandle | null>(null);
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [leftCollapsed, setLeftCollapsed]   = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const activeLoads = loadStates.size;
  const hasModels = models.size > 0;

  // Apply theme + fontSize
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-font-size", settings.fontSize ?? "md");
  }, [settings.fontSize]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // H-chord state: pressing H arms a 1-second window for H+H / H+I / H+R
  const hChordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hChordArmedRef = useRef(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Always handle Escape
      if (e.key === "Escape") {
        setSelected(null);
        if (activeTool === "measure") {
          window.dispatchEvent(new Event("viewer:clearMeasure"));
          clearMeasurements();
          setActiveTool("select");
        }
        if (activeTool === "fly") setActiveTool("select");
        return;
      }

      // In fly mode all shortcuts except Escape are handled by ViewportContainer's WASD handler
      if (activeTool === "fly") return;

      if (isInput) return; // don't intercept typing in inputs

      const key = e.key.toLowerCase();
      const withShift = e.shiftKey ? `shift+${key}` : key;

      const kb = useModelStore.getState().keyBindings;

      if (withShift === kb.fitAll || key === kb.fitAll) {
        e.preventDefault();
        window.dispatchEvent(new Event("viewer:fitAll"));
        return;
      }
      if (key === kb.select) { setActiveTool("select"); return; }
      if (key === kb.measure) {
        if (activeTool === "measure") {
          window.dispatchEvent(new Event("viewer:clearMeasure"));
          clearMeasurements();
          setActiveTool("select");
        } else setActiveTool("measure");
        return;
      }
      if (key === kb.section) {
        const st = useModelStore.getState();
        if (st.activeTool === "section" || st.sectionPlanes.length > 0) {
          st.clearSectionPlanes(); setActiveTool("select");
        } else setActiveTool("section");
        return;
      }
      if (key === kb.sqlPanel)     { setSqlPanelOpen(!sqlPanelOpen); return; }
      if (key === kb.listPanel)    { setListPanelOpen(!listPanelOpen); return; }
      if (key === kb.smartViews)   { setSmartViewsPanelOpen(!smartViewsPanelOpen); return; }
      if (key === kb.qtoPanel)     { setQTOPanelOpen(!qtoPanelOpen); return; }
      if (key === kb.profilePanel) { setProfilePanelOpen(!profilePanelOpen); return; }
      if (key === kb.flyMode) {
        const cur = useModelStore.getState().activeTool;
        setActiveTool(cur === "fly" ? "select" : "fly"); return;
      }
      if (key === kb.faceSectionTool) {
        setActiveTool(activeTool === "face-section" ? "select" : "face-section"); return;
      }
      if (key === "delete" || key === "backspace") {
        if (selectedElement) hideElement(selectedElement.modelId, selectedElement.expressId);
        return;
      }
      if (withShift === kb.showAll || (e.shiftKey && key === "a")) { showAll(); return; }

      // H-chord (hide / isolate / reset)
      if (key === "h") {
        if (hChordArmedRef.current) {
          hChordArmedRef.current = false;
          if (hChordTimerRef.current) clearTimeout(hChordTimerRef.current);
          const ms = useModelStore.getState().multiSelection;
          if (ms.size > 0) {
            for (const k of ms) {
              const [mId, eId] = k.split(":");
              hideElement(mId, parseInt(eId));
            }
          } else if (selectedElement) {
            hideElement(selectedElement.modelId, selectedElement.expressId);
          }
        } else {
          hChordArmedRef.current = true;
          if (hChordTimerRef.current) clearTimeout(hChordTimerRef.current);
          hChordTimerRef.current = setTimeout(() => { hChordArmedRef.current = false; }, 1000);
        }
        return;
      }
      if (key === "i" && hChordArmedRef.current) {
        hChordArmedRef.current = false;
        if (hChordTimerRef.current) clearTimeout(hChordTimerRef.current);
        if (selectedElement) useModelStore.getState().isolateElement(selectedElement.modelId, selectedElement.expressId);
        return;
      }
      if (key === "r" && hChordArmedRef.current) {
        hChordArmedRef.current = false;
        if (hChordTimerRef.current) clearTimeout(hChordTimerRef.current);
        showAll();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTool, selectedElement, sqlPanelOpen, listPanelOpen, smartViewsPanelOpen, qtoPanelOpen,
      profilePanelOpen, setActiveTool, setSelected, clearMeasurements, setSqlPanelOpen, setListPanelOpen,
      setSmartViewsPanelOpen, setQTOPanelOpen, setProfilePanelOpen, hideElement, showAll, keyBindings]);

  // ── File loading ──────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = uuidv4();
      const placeholder: IFCModelEntry = {
        id, name: file.name, file,
        mesh: new THREE.Group(),
        visible: true, color: "#7aa2f7", opacity: 1,
        boundingBox: new THREE.Box3(),
        originOffset: new THREE.Vector3(),
        properties: {}, loadedAt: new Date(),
        size: file.size, status: "loading",
        spatialTree: null, elementsByType: {},
      };
      addModel(placeholder);
      setLoadStates(p => new Map(p).set(id, { phase: "Initialisieren", progress: 0, fileName: file.name }));

      try {
        const currentOrigin = useModelStore.getState().worldOrigin;
        const modelIndex = useModelStore.getState().models.size;

        const { entry, newWorldOrigin } = await loadIFCFile(
          file, modelIndex, currentOrigin,
          (p) => setLoadStates(prev => new Map(prev).set(id, { ...p, fileName: file.name }))
        );

        if (!currentOrigin) setWorldOrigin(newWorldOrigin);
        updateModel(id, { ...entry, id, status: "loaded" });
      } catch (err) {
        console.error("[IFC Loader] Fehler beim Laden:", file.name, err);
        updateModel(id, { status: "error", error: String(err) });
      } finally {
        setLoadStates(p => { const n = new Map(p); n.delete(id); return n; });
      }
    }
  }, [addModel, updateModel, setWorldOrigin]);

  const handleRemove = useCallback((id: string) => {
    const model = useModelStore.getState().models.get(id);
    if (model?.file) evictPropModelCache(model.file);
    removeModel(id);
  }, [removeModel]);

  const handleFitTo = useCallback((id: string) => {
    const model = useModelStore.getState().models.get(id);
    if (!model) return;
    window.dispatchEvent(new CustomEvent("viewer:fitTo", { detail: model.boundingBox }));
  }, []);

  const handleElementClick = useCallback(async (modelId: string, expressId: number, ctrlHeld = false) => {
    const model = useModelStore.getState().models.get(modelId);
    if (!model) return;

    const key = `${modelId}:${expressId}`;
    const st = useModelStore.getState();

    if (ctrlHeld) {
      const next = new Set(st.multiSelection);
      if (next.has(key)) {
        next.delete(key);
        st.setMultiSelection(next);
        if (next.size === 0) {
          setSelected(null);
        } else if (st.selectedElement?.modelId === modelId && st.selectedElement?.expressId === expressId) {
          const lastKey = Array.from(next).at(-1)!;
          const [lmId, leId] = lastKey.split(":");
          setSelected({ modelId: lmId, expressId: parseInt(leId), properties: {}, psets: [] });
        }
        return;
      }
      next.add(key);
      st.setMultiSelection(next);
    } else {
      st.setMultiSelection(new Set([key]));
      if (st.basketAutoAdd) st.addToBasket(modelId, expressId);
    }

    setSelected({ modelId, expressId, properties: {}, psets: [] });

    try {
      const { properties, psets } = await loadIFCProperties(model.file, expressId);
      setSelected({ modelId, expressId, properties, psets });
    } catch {
      // keep empty properties
    }
  }, [setSelected]);

  useMainWindowSync(handleElementClick);
  useCrossSectionSync();
  useLongitudinalSectionSync();
  useAbwicklungSync();
  useCollisionSync();

  // Billing window element-list provider
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel("infracore-billing"); } catch { return; }

    function sendElements() {
      const list: import("./billing/types").ElementInfo[] = [];
      const store = useModelStore.getState();
      store.models.forEach((m, modelId) => {
        if (m.status !== "loaded") return;
        for (const [ifcType, elements] of Object.entries(m.elementsByType)) {
          for (const el of elements as Array<{ expressId: number; name: string; guid?: string }>) {
            list.push({
              key: el.guid ?? `${m.name}:${el.expressId}`,
              guid: el.guid ?? "",
              expressId: el.expressId,
              modelId,
              name: el.name || `${ifcType} #${el.expressId}`,
              ifcType,
            });
          }
        }
      });
      bc?.postMessage({ t: "elements", list } satisfies import("./billing/types").BillingMsg);
    }

    bc.addEventListener("message", (ev) => {
      const msg = ev.data as import("./billing/types").BillingMsg;
      if (msg.t === "ready") sendElements();
      if (msg.t === "isolateTracked") {
        const entries = useBillingStore.getState().entries;
        const models = useModelStore.getState().models;
        // Resolve IFC GlobalId → current session modelId + expressId
        const list: { modelId: string; expressId: number }[] = [];
        for (const e of Object.values(entries)) {
          const guid = e.guid;
          if (!guid) continue;
          models.forEach((m, modelId) => {
            for (const els of Object.values(m.elementsByType)) {
              const found = (els as Array<{ expressId: number; guid?: string }>).find(el => el.guid === guid);
              if (found) { list.push({ modelId, expressId: found.expressId }); break; }
            }
          });
        }
        if (list.length > 0) useModelStore.getState().isolateEntries(list);
      }
    });

    const unsub = useModelStore.subscribe((s, prev) => {
      if (s.models !== prev.models) sendElements();
      // Forward 3D element selection to billing window
      if (s.selectedElement !== prev.selectedElement && s.selectedElement) {
        const el = s.selectedElement;
        const model = s.models.get(el.modelId);
        if (model) {
          for (const els of Object.values(model.elementsByType)) {
            const found = (els as Array<{ expressId: number; guid?: string }>).find(e => e.expressId === el.expressId);
            if (found?.guid) {
              bc?.postMessage({ t: "selectEntry", key: found.guid } satisfies import("./billing/types").BillingMsg);
              break;
            }
          }
        }
      }
    });

    return () => { bc?.close(); unsub(); };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Toolbar */}
      <MainToolbar
        onOpenFiles={handleFiles}
        onFitAll={() => window.dispatchEvent(new Event("viewer:fitAll"))}
        loading={activeLoads > 0}
        onOpenBatch={() => setBatchPanelOpen(true)}
        onToggleLeftPanel={() => leftCollapsed ? leftPanelRef.current?.expand() : leftPanelRef.current?.collapse()}
        onToggleRightPanel={() => rightCollapsed ? rightPanelRef.current?.expand() : rightPanelRef.current?.collapse()}
        leftPanelVisible={!leftCollapsed}
        rightPanelVisible={!rightCollapsed}
      />

      {/* Loading bars */}
      {activeLoads > 0 && (
        <div className="flex flex-col gap-px shrink-0">
          {Array.from(loadStates.entries()).map(([id, s]) => (
            <div key={id} className="relative h-0.5 bg-border">
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-all duration-200"
                style={{ width: `${s.progress}%` }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Main 3-column layout */}
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" className="h-full">

          <Panel
            defaultSize={20} minSize={12} collapsible
            panelRef={leftPanelRef}
            onResize={(s) => setLeftCollapsed(s.asPercentage === 0)}
          >
            <div className="h-full overflow-hidden border-r border-border">
              {alignmentPanelOpen ? (
                <AlignmentPanel onClose={toggleAlignmentPanel} />
              ) : (listPanelOpen || smartViewsPanelOpen) ? (
                <PanelGroup orientation="vertical" className="h-full">
                  <Panel defaultSize={50} minSize={15}>
                    <div className="h-full overflow-hidden">
                      <HierarchyPanel
                        onFitTo={handleFitTo}
                        onRemove={handleRemove}
                        onSelectElement={handleElementClick}
                        onToggleCollapse={() => leftPanelRef.current?.collapse()}
                      />
                    </div>
                  </Panel>
                  <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-row-resize" />
                  <Panel defaultSize={50} minSize={20}>
                    <PanelGroup orientation="vertical" className="h-full">
                      {listPanelOpen && (
                        <>
                          <Panel defaultSize={34} minSize={15}>
                            <div className="h-full overflow-hidden">
                              <LensRulesPanel />
                            </div>
                          </Panel>
                          {smartViewsPanelOpen && (
                            <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-row-resize" />
                          )}
                        </>
                      )}
                      {smartViewsPanelOpen && (
                        <Panel defaultSize={34} minSize={15}>
                          <div className="h-full overflow-hidden">
                            <SmartViewsPanel />
                          </div>
                        </Panel>
                      )}
                    </PanelGroup>
                  </Panel>
                </PanelGroup>
              ) : (
                <HierarchyPanel
                  onFitTo={handleFitTo}
                  onRemove={handleRemove}
                  onSelectElement={handleElementClick}
                  onToggleCollapse={() => leftPanelRef.current?.collapse()}
                />
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

          <Panel defaultSize={58} minSize={30}>
            <div className="h-full relative overflow-hidden flex flex-col">
              {/* 3D Viewport */}
              <div className="flex-1 relative overflow-hidden min-h-0">
                <ViewportContainer onElementClick={handleElementClick} />
                {/* Floating sidebar expand buttons */}
                {leftCollapsed && (
                  <button
                    className="absolute left-2 top-2 z-20 bg-card/80 backdrop-blur-sm border border-border rounded p-1 text-muted-foreground hover:text-foreground hover:bg-card shadow-md transition-colors"
                    onClick={() => leftPanelRef.current?.expand()}
                    title="Linke Leiste einblenden"
                  >
                    <ChevronRight size={13} />
                  </button>
                )}
                {rightCollapsed && (
                  <button
                    className="absolute right-2 top-2 z-20 bg-card/80 backdrop-blur-sm border border-border rounded p-1 text-muted-foreground hover:text-foreground hover:bg-card shadow-md transition-colors"
                    onClick={() => rightPanelRef.current?.expand()}
                    title="Rechte Leiste einblenden"
                  >
                    <ChevronLeft size={13} />
                  </button>
                )}
                <ClipPlaneControl />

                {/* Selection basket — floating top-left */}
                <div className="absolute top-3 left-3 z-30 pointer-events-auto">
                  <SelectionBasket onOpenEditor={openBasketWindow} />
                </div>

                {/* Face cross-section controls */}
                <FaceCrossSectionPanel />

                {/* 5D overlay — bottom-left */}
                {billing5DPanelOpen && (
                  <Billing5DOverlay onClose={() => setBilling5DPanelOpen(false)} />
                )}

                {!hasModels && activeLoads === 0 && (
                  <LandingOverlay onOpenFiles={handleFiles} loading={false} />
                )}

                {activeLoads > 0 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-none">
                    {Array.from(loadStates.entries()).map(([id, s]) => (
                      <div key={id} className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2.5 shadow-xl text-xs min-w-[280px]">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
                          <span className="text-foreground font-medium truncate">{s.fileName}</span>
                          <span className="text-muted-foreground ml-auto shrink-0">{s.progress}%</span>
                        </div>
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${s.progress}%` }} />
                        </div>
                        <p className="text-muted-foreground mt-1">{s.phase}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Längenschnitt-Viewer (bottom of viewport column) */}
              {profilePanelOpen && (
                <div className="h-56 shrink-0 border-t border-border">
                  <ProfileViewer />
                </div>
              )}

              {/* SQL Panel (bottom of viewport column) */}
              {sqlPanelOpen && (
                <div className="h-64 shrink-0 border-t border-border">
                  <SQLPanel />
                </div>
              )}

              {/* QTO / Quantity Take-Off Panel (bottom of viewport column) */}
              {qtoPanelOpen && (
                <div className="h-96 shrink-0 border-t border-border">
                  <QuantityListPanel />
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

          <Panel
            defaultSize={22} minSize={14} collapsible
            panelRef={rightPanelRef}
            onResize={(s) => setRightCollapsed(s.asPercentage === 0)}
          >
            <div className="h-full overflow-hidden border-l border-border panel-container flex flex-col">
              <div className="shrink-0 flex items-center justify-end px-2 py-0.5 border-b border-border/30 bg-muted/10">
                <button
                  onClick={() => rightPanelRef.current?.collapse()}
                  className="text-muted-foreground/50 hover:text-foreground p-0.5 rounded transition-colors"
                  title="Leiste ausblenden"
                >
                  <ChevronRight size={11} />
                </button>
              </div>
              <ModelInfoPanel />
              <div className="flex-1 min-h-0 overflow-hidden">
                <PropertiesPanel />
              </div>
            </div>
          </Panel>

        </PanelGroup>
      </div>

      <StatusBar />

      {batchPanelOpen && (
        <BatchPanel onClose={() => setBatchPanelOpen(false)} />
      )}

      {settingsPanelOpen && <SettingsPanel />}
    </div>
  );
}
