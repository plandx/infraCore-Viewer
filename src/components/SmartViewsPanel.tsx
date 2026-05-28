import { useState, useRef, useCallback } from "react";
import {
  RefreshCw, ChevronDown, ChevronUp, Search, Plus, Pencil, Trash2, X, Check, Glasses, Play, Copy,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "../lib/utils";
import { useModelStore } from "../store/modelStore";
import { CONDITION_LABELS, CONDITIONS_WITHOUT_VALUE, PALETTE } from "../utils/smartViewUtils";
import type { SmartView, SmartTier, SmartRule, SmartCondition, TierAction } from "../types/ifc";

// ── built-in property keys ─────────────────────────────────────────────────────

const BUILTIN_KEYS = [
  { key: "_type",  label: "IFC-Typ" },
  { key: "_name",  label: "Name" },
  { key: "_model", label: "Modell" },
];

// ── property loader ────────────────────────────────────────────────────────────

function PropertyLoader() {
  const models                    = useModelStore((s) => s.models);
  const loadedProperties          = useModelStore((s) => s.loadedProperties);
  const loadedPropKeys            = useModelStore((s) => s.loadedPropKeys);
  const loadAllProperties         = useModelStore((s) => s.loadAllProperties);
  const loadingPropertiesProgress = useModelStore((s) => s.loadingPropertiesProgress);
  const loading = loadingPropertiesProgress !== null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
        onClick={() => loadAllProperties()}
        disabled={loading || models.size === 0}
      >
        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        <span>{loadedProperties ? "Neu laden" : "Properties laden"}</span>
      </button>
      {loading && (
        <>
          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden min-w-[60px]">
            <div className="h-full bg-primary rounded-full transition-all duration-150" style={{ width: `${loadingPropertiesProgress}%` }} />
          </div>
          <span className="text-muted-foreground text-[10px]">{loadingPropertiesProgress}%</span>
        </>
      )}
      {loadedProperties && !loading && (
        <span className="text-muted-foreground text-[10px]">{loadedPropKeys.length} Attribute</span>
      )}
    </div>
  );
}

// ── prop key picker ────────────────────────────────────────────────────────────

function PropKeyPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const loadedPropKeys = useModelStore((s) => s.loadedPropKeys);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allKeys = [...BUILTIN_KEYS.map((b) => b.key), ...loadedPropKeys];
  const filtered = search ? allKeys.filter((k) => k.toLowerCase().includes(search.toLowerCase())) : allKeys;
  const displayLabel = (k: string) => BUILTIN_KEYS.find((b) => b.key === k)?.label ?? k;

  return (
    <div className="relative flex-1">
      <button
        className="w-full flex items-center justify-between bg-background border border-border rounded px-2 py-1 text-left hover:border-primary/50 focus:outline-none text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? displayLabel(value) : "Attribut…"}</span>
        <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-md shadow-xl max-h-52 flex flex-col">
            <div className="p-1.5 border-b border-border shrink-0 flex items-center gap-1.5">
              <Search size={10} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-xs focus:outline-none text-foreground placeholder:text-muted-foreground"
                placeholder="Suchen…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {loadedPropKeys.length === 0 && (
              <div className="px-3 py-1.5 text-muted-foreground text-[10px] border-b border-border">
                Properties noch nicht geladen
              </div>
            )}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0
                ? <div className="px-3 py-2 text-muted-foreground text-[11px]">Keine Treffer</div>
                : filtered.map((k) => (
                  <button key={k}
                    className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-muted/60 truncate", k === value && "text-primary font-medium")}
                    onClick={() => { onChange(k); setOpen(false); setSearch(""); }}
                  >{displayLabel(k)}</button>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── constants ─────────────────────────────────────────────────────────────────

const CONDITION_OPTIONS = Object.entries(CONDITION_LABELS) as [SmartCondition, string][];

const TIER_BADGE_CLASSES: Record<TierAction, string> = {
  add:               "bg-emerald-500/20 text-emerald-400",
  remove:            "bg-red-500/20 text-red-400",
  removeOthers:      "bg-orange-500/20 text-orange-400",
  color:             "bg-blue-500/20 text-blue-400",
  transparent:       "bg-cyan-500/20 text-cyan-400",
  opaque:            "bg-muted text-muted-foreground",
  autoColor:         "bg-violet-500/20 text-violet-400",
  addAndColor:       "bg-blue-500/20 text-blue-300",
  addAndTransparent: "bg-cyan-500/20 text-cyan-300",
  addAndAutoColor:   "bg-violet-500/20 text-violet-300",
};

function emptyRule(): SmartRule {
  return { id: uuidv4(), property: "_type", condition: "eq", value: "" };
}

function emptyTier(index: number): SmartTier {
  return {
    id: uuidv4(), name: `Ebene ${index + 1}`,
    rules: [], logic: "AND", action: "color",
    color: PALETTE[index % PALETTE.length], colorByKey: "_type", opacity: 0.15,
  };
}

function emptyView(): SmartView {
  return { id: uuidv4(), name: "Neue SmartView", tiers: [emptyTier(0)] };
}

// ── TierEditor ────────────────────────────────────────────────────────────────

function TierEditor({
  tier, index, total, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  tier: SmartTier; index: number; total: number;
  onChange: (patch: Partial<SmartTier>) => void;
  onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  const colorRef = useRef<HTMLInputElement>(null);
  const noValueNeeded = (cond: SmartCondition) => CONDITIONS_WITHOUT_VALUE.includes(cond);
  const updRule = (id: string, patch: Partial<SmartRule>) =>
    onChange({ rules: tier.rules.map((r) => r.id === id ? { ...r, ...patch } : r) });

  return (
    <div className="border border-border rounded-md bg-card/20 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card/40 border-b border-border">
        <Glasses size={11} className="text-muted-foreground shrink-0" />
        <input
          className="flex-1 bg-transparent text-xs font-medium text-foreground focus:outline-none placeholder:text-muted-foreground min-w-0"
          placeholder={`Ebene ${index + 1}`}
          value={tier.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title="Nach oben" disabled={index === 0} onClick={onMoveUp}><ChevronUp size={12} /></button>
          <button className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title="Nach unten" disabled={index === total - 1} onClick={onMoveDown}><ChevronDown size={12} /></button>
          <button className="p-0.5 rounded text-muted-foreground/60 hover:text-destructive"
            title="Ebene löschen" onClick={onDelete}><X size={12} /></button>
        </div>
      </div>

      <div className="p-2 space-y-2">
        {/* Rules */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Regeln</span>
            <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ rules: [...tier.rules, emptyRule()] })}
            ><Plus size={10} />Hinzufügen</button>
          </div>
          {tier.rules.length === 0 && (
            <div className="text-[11px] text-muted-foreground/60 py-0.5">Keine Regeln — alle Elemente werden erfasst</div>
          )}
          {tier.rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-1">
              <div className="flex-1 min-w-0">
                <PropKeyPicker value={rule.property} onChange={(k) => updRule(rule.id, { property: k })} />
              </div>
              <select
                className="bg-background border border-border rounded px-1 py-1 text-xs text-foreground focus:outline-none shrink-0"
                value={rule.condition}
                onChange={(e) => updRule(rule.id, { condition: e.target.value as SmartCondition })}
              >
                {CONDITION_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
              {!noValueNeeded(rule.condition) && (
                <input
                  className="w-20 bg-background border border-border rounded px-1.5 py-1 text-xs focus:outline-none shrink-0"
                  placeholder="Wert" value={rule.value}
                  onChange={(e) => updRule(rule.id, { value: e.target.value })}
                />
              )}
              <button
                className="p-0.5 text-muted-foreground/60 hover:text-foreground shrink-0"
                title="Regel duplizieren"
                onClick={() => {
                  const idx = tier.rules.findIndex((r) => r.id === rule.id);
                  const copy = { ...rule, id: uuidv4() };
                  const next = [...tier.rules];
                  next.splice(idx + 1, 0, copy);
                  onChange({ rules: next });
                }}
              ><Copy size={11} /></button>
              <button className="p-0.5 text-muted-foreground/60 hover:text-destructive shrink-0"
                onClick={() => onChange({ rules: tier.rules.filter((r) => r.id !== rule.id) })}
              ><X size={11} /></button>
            </div>
          ))}
        </div>

        {/* Logic toggle */}
        {tier.rules.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Verknüpfung:</span>
            {(["AND", "OR"] as const).map((l) => (
              <button key={l}
                className={cn("px-2 py-0.5 rounded text-[11px] border transition-colors",
                  tier.logic === l ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}
                onClick={() => onChange({ logic: l })}
              >{l === "AND" ? "Alle (UND)" : "Eine (ODER)"}</button>
            ))}
          </div>
        )}

        {/* Action */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Aktion</span>
          <select
            className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none"
            value={tier.action}
            onChange={(e) => onChange({ action: e.target.value as TierAction })}
          >
            <optgroup label="Sichtbarkeit">
              <option value="add">Hinzufügen</option>
              <option value="remove">Entfernen</option>
              <option value="removeOthers">Andere entfernen</option>
            </optgroup>
            <optgroup label="Farbe">
              <option value="color">Farbig einstellen</option>
              <option value="autoColor">Auto-Farbe</option>
              <option value="addAndColor">Hinzufügen + Einfärben</option>
              <option value="addAndAutoColor">Hinzufügen + Auto-Farbe</option>
            </optgroup>
            <optgroup label="Transparenz">
              <option value="transparent">Durchsichtig einstellen</option>
              <option value="opaque">Undurchsichtig einstellen</option>
              <option value="addAndTransparent">Hinzufügen + Durchsichtig</option>
            </optgroup>
          </select>

          {(tier.action === "color" || tier.action === "transparent" || tier.action === "opaque" ||
            tier.action === "addAndColor" || tier.action === "addAndTransparent") && (
            <div className="flex items-center gap-2">
              <button className="w-5 h-5 rounded ring-1 ring-black/20 hover:ring-2 hover:ring-primary shrink-0"
                style={{ background: tier.color }} onClick={() => colorRef.current?.click()} />
              <input ref={colorRef} type="color" className="sr-only" value={tier.color}
                onChange={(e) => onChange({ color: e.target.value })} />
              <span className="text-[11px] text-muted-foreground">{tier.color}</span>
            </div>
          )}

          {(tier.action === "transparent" || tier.action === "addAndTransparent") && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground shrink-0 w-16">Deckkraft:</span>
              <input type="range" min={0} max={1} step={0.05} value={tier.opacity}
                className="flex-1 h-1.5 accent-primary"
                onChange={(e) => onChange({ opacity: parseFloat(e.target.value) })} />
              <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">
                {Math.round(tier.opacity * 100)}%
              </span>
            </div>
          )}

          {(tier.action === "autoColor" || tier.action === "addAndAutoColor") && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground shrink-0">Nach:</span>
              <PropKeyPicker value={tier.colorByKey} onChange={(k) => onChange({ colorByKey: k })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SmartView editor ──────────────────────────────────────────────────────────

function SmartViewEditor({
  initial, onSave, onCancel,
}: { initial: SmartView; onSave: (v: SmartView) => void; onCancel: () => void }) {
  const [view, setView] = useState<SmartView>(() => ({
    ...initial,
    tiers: initial.tiers.map((t) => ({ ...t, rules: t.rules.map((r) => ({ ...r })) })),
  }));

  const updTier = (tierId: string, patch: Partial<SmartTier>) =>
    setView((v) => ({ ...v, tiers: v.tiers.map((t) => t.id === tierId ? { ...t, ...patch } : t) }));
  const deleteTier = (tierId: string) =>
    setView((v) => ({ ...v, tiers: v.tiers.filter((t) => t.id !== tierId) }));
  const moveTier = (index: number, dir: -1 | 1) =>
    setView((v) => {
      const tiers = [...v.tiers];
      const target = index + dir;
      if (target < 0 || target >= tiers.length) return v;
      [tiers[index], tiers[target]] = [tiers[target], tiers[index]];
      return { ...v, tiers };
    });
  const addTier = () => setView((v) => ({ ...v, tiers: [...v.tiers, emptyTier(v.tiers.length)] }));
  const canSave = view.name.trim() !== "" && view.tiers.length > 0;

  return (
    <div className="flex flex-col gap-3 p-3 bg-card/30 border-b border-border">
      <input
        className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60"
        placeholder="Name" value={view.name}
        onChange={(e) => setView((v) => ({ ...v, name: e.target.value }))}
      />
      <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-0.5">
        {view.tiers.map((tier, i) => (
          <TierEditor key={tier.id} tier={tier} index={i} total={view.tiers.length}
            onChange={(patch) => updTier(tier.id, patch)}
            onDelete={() => deleteTier(tier.id)}
            onMoveUp={() => moveTier(i, -1)}
            onMoveDown={() => moveTier(i, 1)}
          />
        ))}
      </div>
      <button
        className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        onClick={addTier}
      ><Plus size={11} />Ebene hinzufügen</button>
      <div className="flex gap-2 pt-1">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={!canSave} onClick={() => onSave(view)}
        ><Check size={12} />Speichern</button>
        <button className="px-3 py-1.5 rounded text-[11px] border border-border text-muted-foreground hover:bg-muted/60"
          onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── main panel ─────────────────────────────────────────────────────────────────

export function SmartViewsPanel() {
  const smartViews = useModelStore((s) => s.smartViews);
  const activeSmartViewId = useModelStore((s) => s.activeSmartViewId);
  const stagedSmartViewId = useModelStore((s) => s.stagedSmartViewId);
  const colorGroups = useModelStore((s) => s.colorGroups);
  const addSmartView = useModelStore((s) => s.addSmartView);
  const updateSmartView = useModelStore((s) => s.updateSmartView);
  const removeSmartView = useModelStore((s) => s.removeSmartView);
  const setStagedSmartViewId = useModelStore((s) => s.setStagedSmartViewId);
  const applySmartView = useModelStore((s) => s.applySmartView);
  const deactivateSmartView = useModelStore((s) => s.deactivateSmartView);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftView, setDraftView] = useState<SmartView | null>(null);

  const startCreate = () => { setDraftView(emptyView()); setEditingId("new"); };
  const startEdit = (id: string) => {
    const v = smartViews.find((s) => s.id === id);
    if (v) {
      setDraftView({ ...v, tiers: v.tiers.map((t) => ({ ...t, rules: t.rules.map((r) => ({ ...r })) })) });
      setEditingId(id);
    }
  };
  const handleSave = (view: SmartView) => {
    if (editingId === "new") addSmartView(view);
    else updateSmartView(view.id, view);
    setEditingId(null); setDraftView(null);
  };
  const handleCancel = () => { setEditingId(null); setDraftView(null); };
  const handleApply = useCallback((id: string) => {
    if (activeSmartViewId === id) deactivateSmartView();
    else applySmartView(id);
  }, [activeSmartViewId, applySmartView, deactivateSmartView]);

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs select-none">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border shrink-0 bg-card/40 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">SmartViews</span>
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={startCreate} disabled={editingId !== null}
          ><Plus size={12} />Neu</button>
        </div>
        <PropertyLoader />
      </div>

      {/* Active hint */}
      {activeSmartViewId && (
        <div className="px-3 py-1.5 text-[10px] bg-primary/10 border-b border-primary/20 flex items-center justify-between shrink-0">
          <span className="text-primary font-medium">● SmartView aktiv</span>
          <button className="text-muted-foreground hover:text-foreground" onClick={deactivateSmartView}>
            <X size={11} />
          </button>
        </div>
      )}

      {/* Color legend */}
      {activeSmartViewId && colorGroups && colorGroups.length > 0 && (
        <div className="px-3 py-2 border-b border-border shrink-0 bg-muted/10">
          <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Farblegende</div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {colorGroups.map((g) => (
              <div key={g.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-black/20" style={{ background: g.color }} />
                <span className="text-[10px] text-foreground truncate flex-1" title={g.label}>{g.label}</span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{g.entries.length}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor (new) */}
      {editingId === "new" && draftView && (
        <SmartViewEditor initial={draftView} onSave={handleSave} onCancel={handleCancel} />
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {smartViews.filter((sv) => sv.id !== "__quick_filter__").length === 0 && editingId === null ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <span className="text-[11px] text-center px-6 leading-relaxed">
              Noch keine SmartViews. Erstelle eine regelbasierte Ansicht.
            </span>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] border border-border hover:bg-muted/60 text-foreground"
              onClick={startCreate}
            ><Plus size={12} />SmartView erstellen</button>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {smartViews.filter((sv) => sv.id !== "__quick_filter__").map((sv) => (
              <div key={sv.id}>
                <div
                  className={cn("flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/20 transition-colors",
                    stagedSmartViewId === sv.id && "bg-primary/5")}
                  onClick={() => setStagedSmartViewId(stagedSmartViewId === sv.id ? null : sv.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-[11px] font-medium truncate", activeSmartViewId === sv.id && "text-primary")}>
                        {sv.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {sv.tiers.length} Ebene{sv.tiers.length !== 1 ? "n" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {sv.tiers.map((tier) => (
                        <span key={tier.id} className={cn("flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-medium", TIER_BADGE_CLASSES[tier.action])}>
                          {tier.name}
                          {(tier.action === "color" || tier.action === "transparent" || tier.action === "opaque" ||
                            tier.action === "addAndColor" || tier.action === "addAndTransparent") && (
                            <span className="w-2 h-2 rounded-full inline-block ml-0.5 ring-1 ring-black/10" style={{ background: tier.color }} />
                          )}
                          {(tier.action === "autoColor" || tier.action === "addAndAutoColor") && tier.colorByKey && (
                            <span className="text-[8px] opacity-70 ml-0.5">/{tier.colorByKey.split(".").pop()}</span>
                          )}
                          {(tier.action === "transparent" || tier.action === "addAndTransparent") && (
                            <span className="text-[8px] opacity-70 ml-0.5">{Math.round(tier.opacity * 100)}%</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      className={cn("p-1 rounded text-[10px] transition-colors",
                        activeSmartViewId === sv.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary hover:bg-primary/10")}
                      title={activeSmartViewId === sv.id ? "Deaktivieren" : "Anwenden"}
                      onClick={(e) => { e.stopPropagation(); handleApply(sv.id); }}
                    ><Play size={11} /></button>
                    <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30"
                      title="Bearbeiten" disabled={editingId !== null}
                      onClick={(e) => { e.stopPropagation(); startEdit(sv.id); }}
                    ><Pencil size={10} /></button>
                    <button className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Löschen"
                      onClick={(e) => { e.stopPropagation(); removeSmartView(sv.id); }}
                    ><Trash2 size={10} /></button>
                  </div>
                </div>
                {editingId === sv.id && draftView && (
                  <SmartViewEditor initial={draftView} onSave={handleSave} onCancel={handleCancel} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {stagedSmartViewId && stagedSmartViewId !== activeSmartViewId && (
        <div className="px-3 py-2 border-t border-border shrink-0 bg-primary/5">
          <p className="text-[10px] text-primary/80 text-center">Doppelklick im 3D-Viewer zum Anwenden</p>
        </div>
      )}
    </div>
  );
}
