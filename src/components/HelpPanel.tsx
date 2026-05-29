import { useState } from "react";
import {
  X, Rocket, MousePointer2, Wrench, LayoutGrid, Navigation2,
  BarChart2, Keyboard, Lightbulb, Info, ChevronRight,
  Eye, Database, List, Glasses, Table2, Scissors, Ruler,
  FolderOpen, Layers, Tag, Gamepad2, AppWindow, Download,
  BoxSelect, TrendingUp,
} from "lucide-react";
import { cn } from "../lib/utils";

type Section = "quickstart" | "navigation" | "tools" | "panels" | "achsen" | "5d" | "shortcuts" | "tips";

interface NavItem { id: Section; label: string; icon: React.ReactNode }

const NAV: NavItem[] = [
  { id: "quickstart",  label: "Schnellstart",     icon: <Rocket size={13} /> },
  { id: "navigation",  label: "3D-Navigation",    icon: <MousePointer2 size={13} /> },
  { id: "tools",       label: "Werkzeuge",         icon: <Wrench size={13} /> },
  { id: "panels",      label: "Panels & Leisten",  icon: <LayoutGrid size={13} /> },
  { id: "achsen",      label: "Achsen & Trassen",  icon: <Navigation2 size={13} /> },
  { id: "5d",          label: "5D-Abrechnung",     icon: <BarChart2 size={13} /> },
  { id: "shortcuts",   label: "Tastenkürzel",      icon: <Keyboard size={13} /> },
  { id: "tips",        label: "Tipps & Tricks",    icon: <Lightbulb size={13} /> },
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<Section>("quickstart");

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-[8px] shadow-[0_2px_8px_rgba(0,0,0,0.12)] w-full max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden" style={{ fontFamily: '"Segoe UI Variable","Segoe UI",system-ui,sans-serif' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0 bg-muted/10">
          <svg width="22" height="22" viewBox="0 0 32 32" className="shrink-0 rounded-[4px]">
            <rect width="32" height="32" rx="5" fill="#E8312A"/>
            <text x="16" y="23" fontFamily="Arial,Helvetica,sans-serif" fontSize="16" fontWeight="bold" fill="white" textAnchor="middle" letterSpacing="-0.5">iC</text>
          </svg>
          <div>
            <div className="font-bold text-sm">infraCore Hilfe</div>
            <div className="text-[10px] text-muted-foreground">Alle Funktionen — schnell erklärt</div>
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-[4px] hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* Left nav */}
          <nav className="w-44 shrink-0 border-r border-border overflow-y-auto py-1 bg-muted/5">
            {NAV.map(item => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-4 py-2 text-xs text-left transition-colors",
                  active === item.id
                    ? "bg-primary/10 text-primary font-semibold border-r-2 border-r-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A]"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 text-sm">
            {active === "quickstart"  && <QuickstartSection />}
            {active === "navigation"  && <NavigationSection />}
            {active === "tools"       && <ToolsSection />}
            {active === "panels"      && <PanelsSection />}
            {active === "achsen"      && <AchsenSection />}
            {active === "5d"          && <FiveDSection />}
            {active === "shortcuts"   && <ShortcutsSection />}
            {active === "tips"        && <TipsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper Components ─────────────────────────────────────────────────────────

function SH({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground mb-4">{children}</h2>;
}

function SH2({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[12px] font-semibold text-foreground mb-2.5 mt-5 first:mt-0">{children}</h3>;
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground leading-relaxed mb-3">{children}</p>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="w-5 h-5 rounded-[3px] bg-muted border border-border text-foreground text-[10px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <div className="text-xs font-semibold text-foreground mb-0.5">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center bg-muted border border-border rounded-[3px] px-1.5 py-0.5 text-[10px] font-mono text-foreground leading-none mx-0.5">
      {children}
    </kbd>
  );
}

function NoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-muted/30 border border-border rounded-[4px] p-3 text-xs text-foreground/80 mb-4 leading-relaxed">
      <Info size={12} className="text-primary shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-muted/20 border border-border rounded-[4px] p-3 text-xs text-foreground/80 mb-4 leading-relaxed">
      <Lightbulb size={12} className="text-amber-400 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start py-2 border-b border-border/30 last:border-b-0">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div className="w-28 shrink-0 text-xs font-medium text-foreground">{label}</div>
      <div className="text-xs text-muted-foreground leading-relaxed flex-1">{children}</div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (React.ReactNode)[][] }) {
  return (
    <table className="w-full text-xs border-collapse mb-4">
      <thead>
        <tr className="border-b border-border">
          {headers.map((h, i) => (
            <th key={i} className="text-left py-1.5 pr-4 text-[11px] font-semibold text-foreground">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border/30 hover:bg-[#E5E5E5]/30 dark:hover:bg-[#3A3A3A]/30">
            {row.map((cell, j) => (
              <td key={j} className="py-1.5 pr-4 text-muted-foreground align-top">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Section: Schnellstart ─────────────────────────────────────────────────────

function QuickstartSection() {
  return (
    <div>
      <SH>Schnellstart</SH>
      <NoteBox>
        infraCore läuft vollständig im Browser — keine Installation, kein Server, keine Datenübertragung.
        IFC-Dateien verbleiben lokal auf deinem Gerät.
      </NoteBox>

      <SH2>IFC-Modell laden</SH2>
      <Step n={1} title="Datei öffnen">
        Klicke oben links auf <strong>Öffnen</strong> (Ordner-Icon) oder ziehe eine oder mehrere
        <strong> .ifc-Dateien</strong> direkt in das 3D-Fenster. Mehrere Modelle können gleichzeitig geladen sein.
      </Step>
      <Step n={2} title="Modell navigieren">
        Drehe das Modell mit <strong>linker Maustaste + Ziehen</strong>, verschiebe es mit
        <strong> mittlerer Maustaste</strong>, zoome mit dem <strong>Mausrad</strong>.
        <Kbd>F</Kbd> passt die Kamera auf alle Modelle an.
      </Step>
      <Step n={3} title="Element auswählen">
        Klicke auf ein Bauteil im 3D-Viewer. Die <strong>Eigenschaften</strong> erscheinen in der
        rechten Seitenleiste (IFC-Typ, Attribute, Properties, Mengen).
      </Step>
      <Step n={4} title="Elemente ausblenden oder isolieren">
        Drücke <Kbd>H</Kbd> <Kbd>I</Kbd> um das ausgewählte Element zu isolieren (alles andere ausblenden),
        oder <Kbd>H</Kbd> <Kbd>H</Kbd> um es auszublenden. Mit <Kbd>Shift</Kbd><Kbd>A</Kbd> alles wieder einblenden.
      </Step>
      <Step n={5} title="Mehrere Modelle verwalten">
        In der linken Leiste (Projektstruktur) siehst du alle geladenen Modelle. Klicke auf ein Modell
        um es auf- oder zuzuklappen. Augensymbol = ein-/ausblenden, Mülleimer = entfernen.
      </Step>

      <SH2>Typische Workflows</SH2>
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: <Eye size={13}/>, title: "Qualitätsprüfung", desc: "SQL oder SmartViews nutzen um Elemente ohne bestimmte Properties farblich hervorzuheben" },
          { icon: <Ruler size={13}/>, title: "Abstandsmessung", desc: "Werkzeug Messen (M) → zwei Punkte anklicken → Distanz wird angezeigt" },
          { icon: <Scissors size={13}/>, title: "Schnittansicht", desc: "Schnittebene (C) setzen und mit Pfeilen in der 3D-Ansicht verschieben" },
          { icon: <Download size={13}/>, title: "Eigenschaften exportieren", desc: "Rechte Sidebar → Eigenschaft bearbeiten → IFC Export mit allen Änderungen" },
        ].map((w, i) => (
          <div key={i} className="border border-border rounded-[6px] p-3 bg-muted/10">
            <div className="flex items-center gap-2 mb-1.5 text-foreground font-medium text-xs">
              <span className="text-primary">{w.icon}</span>{w.title}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{w.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section: Navigation ───────────────────────────────────────────────────────

function NavigationSection() {
  return (
    <div>
      <SH>3D-Navigation</SH>

      <SH2>Maussteuerung</SH2>
      <Table
        headers={["Aktion", "Maus", "Beschreibung"]}
        rows={[
          ["Drehen / Orbit",     <><strong>LMT</strong> + Ziehen</>,        "Modell um den Fokuspunkt drehen"],
          ["Verschieben / Pan",  <><strong>MMT</strong> oder <strong>RMT</strong> + Ziehen</>,  "Kamera seitwärts/vertikal bewegen"],
          ["Zoomen",            "Mausrad",                                    "Kamera vor-/zurückbewegen"],
          ["Auf Element zoomen","Doppelklick auf Bauteil",                   "Kamerafokus auf dieses Element setzen"],
          ["Element auswählen", "Einfachklick",                               "Bauteil markieren → Eigenschaften rechts"],
        ]}
      />

      <SH2>Kamera-Tastenkürzel</SH2>
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: "F", desc: "Alle einpassen" },
          { key: "S", desc: "Auswahl-Tool" },
          { key: "N", desc: "Fly-Mode" },
          { key: "B", desc: "Drohne" },
          { key: "Esc", desc: "Abbrechen" },
        ].map(s => (
          <div key={s.key} className="flex items-center gap-1.5 bg-muted/20 border border-border rounded-[4px] px-2 py-1">
            <Kbd>{s.key}</Kbd>
            <span className="text-[11px] text-muted-foreground">{s.desc}</span>
          </div>
        ))}
      </div>

      <SH2>Kamera-Presets</SH2>
      <Para>
        Im Ribbon-Tab <strong>Start → Kamera → Ansicht ▾</strong> kannst du schnell zu Standardansichten
        wechseln: Draufsicht, Vorderansicht, Seitenansicht, Untersicht usw.
        Umschalten zwischen perspektivisch und orthografisch: <strong>Start → Kamera → Ortho/Perspektive</strong>.
      </Para>

      <SH2>Fly-Mode <Kbd>N</Kbd></SH2>
      <Para>
        Im Fly-Mode bewegst du dich frei durch das Modell wie in einem Ego-Shooter.
      </Para>
      <Table
        headers={["Taste", "Aktion"]}
        rows={[
          [<Kbd>W</Kbd>, "Vorwärts"],
          [<Kbd>S</Kbd>, "Rückwärts"],
          [<Kbd>A</Kbd>, "Links"],
          [<Kbd>D</Kbd>, "Rechts"],
          [<Kbd>Q</Kbd>, "Nach unten"],
          [<Kbd>E</Kbd>, "Nach oben"],
          ["Maus bewegen", "Blickrichtung (Drag)"],
          [<Kbd>Esc</Kbd>, "Fly-Mode beenden"],
        ]}
      />

      <SH2>Drohnen-Kamera <Kbd>B</Kbd></SH2>
      <Para>
        Die Drohnen-Kamera simuliert ein physikalisches Flugverhalten mit Trägheit und Dämpfung.
        Steuerung wie Fly-Mode (WASD) oder per Gamepad. Ideal für Präsentationsflüge durch das Modell.
      </Para>
    </div>
  );
}

// ── Section: Werkzeuge ────────────────────────────────────────────────────────

function ToolsSection() {
  return (
    <div>
      <SH>Werkzeuge</SH>
      <Para>Alle Werkzeuge sind im Ribbon-Tab <strong>Start</strong> oder per Tastenkürzel erreichbar.</Para>

      <div className="space-y-1 mb-5">
        <Row icon={<MousePointer2 size={14}/>} label={<span>Auswahl <Kbd>S</Kbd></span> as any}>
          Standard-Werkzeug. Klick auf ein Bauteil wählt es aus und zeigt die Eigenschaften in der rechten Leiste.
          Klick in leeren Bereich hebt die Auswahl auf.
        </Row>
        <Row icon={<Ruler size={14}/>} label={<span>Messen <Kbd>M</Kbd></span> as any}>
          Klicke zwei Punkte im 3D-Modell an — die Distanz wird als beschriftete Linie eingeblendet.
          Mehrere Messungen bleiben gespeichert. Werkzeug erneut klicken oder <Kbd>Esc</Kbd> zum Beenden.
        </Row>
        <Row icon={<Scissors size={14}/>} label={<span>Schnittebene <Kbd>C</Kbd></span> as any}>
          Setzt eine horizontale Schnittebene. Anschließend erscheinen Pfeile im Viewer zum Verschieben der Ebene.
          Werkzeug oder <Kbd>C</Kbd> erneut drücken entfernt den Schnitt.
        </Row>
        <Row icon={<BoxSelect size={14}/>} label={<span>Flächen-Querschnitt <Kbd>X</Kbd></span> as any}>
          Klicke auf eine Fläche eines IFC-Elements → der Querschnitt senkrecht zu dieser Fläche
          wird in einem separaten 2D-Fenster geöffnet. Ideal für Trassierungsquerschnitte.
        </Row>
        <Row icon={<Navigation2 size={14}/>} label={<span>Fly-Mode <Kbd>N</Kbd></span> as any}>
          Freie Kamerabewegung durch das Modell. WASD-Steuerung + Mauslook.
          Erneut drücken → zurück zum Orbit-Modus.
        </Row>
        <Row icon={<Gamepad2 size={14}/>} label={<span>Drohne <Kbd>B</Kbd></span> as any}>
          Physikalisch simulierte Drohnenkamera. Unterstützt Gamepad (Joystick/Gamepad API) und WASD-Tastatur.
          Schwebender Flug mit Trägheit.
        </Row>
      </div>

      <SH2>Sichtbarkeit (H-Chord)</SH2>
      <NoteBox>
        Das H-Chord-System erlaubt Zwei-Tasten-Kürzel: <Kbd>H</Kbd> drücken und innerhalb 1 Sekunde
        eine zweite Taste. Kein zweiter Tastendruck → Chord läuft ab ohne Aktion.
      </NoteBox>
      <Table
        headers={["Chord", "Aktion"]}
        rows={[
          [<><Kbd>H</Kbd> → <Kbd>H</Kbd></>, "Ausgewähltes Element ausblenden"],
          [<><Kbd>H</Kbd> → <Kbd>I</Kbd></>, "Ausgewähltes Element isolieren (alles andere ausblenden)"],
          [<><Kbd>H</Kbd> → <Kbd>R</Kbd></>, "Alle Ausblendungen/Isolierungen zurücksetzen"],
          [<Kbd>Del</Kbd>, "Ausgewähltes Element ausblenden (Kurzform)"],
          [<><Kbd>Shift</Kbd><Kbd>A</Kbd></>, "Alles einblenden"],
        ]}
      />
    </div>
  );
}

// ── Section: Panels ───────────────────────────────────────────────────────────

function PanelsSection() {
  return (
    <div>
      <SH>Panels & Leisten</SH>

      <SH2>Linke Leiste — Projektstruktur</SH2>
      <Para>
        Zeigt alle geladenen Modelle in einer Baumstruktur. Oben-Links-Pfeil (←) blendet die
        Leiste aus; kleiner Pfeil am Viewport-Rand blendet sie wieder ein.
      </Para>
      <Table
        headers={["Ansicht", "Beschreibung"]}
        rows={[
          ["Räumlich",   "Hierarchische Struktur: Site → Gebäude → Stockwerk → Raum → Elemente"],
          ["Nach Typ",   "Elemente gruppiert nach IFC-Typ (IfcWall, IfcBeam, …)"],
          ["Sichtbar",   "Nur aktuell sichtbare Elemente (Momentaufnahme, Refresh-Button oben)"],
        ]}
      />
      <TipBox>
        <strong>Multi-Selektion:</strong> <Kbd>Shift</Kbd> + Klick wählt einen Bereich aus.
        Danach erscheint eine Aktionsleiste: alle ausblenden, isolieren oder zum Auswahlkorb hinzufügen.
      </TipBox>
      <Para>
        Jede Zeile hat hover-Buttons: <Eye size={11} className="inline"/> Ein-/Ausblenden,
        <span className="font-mono text-[11px]"> ⌖</span> Isolieren.
        Auf Modell-Ebene zusätzlich: Zoom, Entfernen.
      </Para>

      <SH2>Rechte Leiste — Eigenschaften</SH2>
      <Para>
        Zeigt IFC-Daten des ausgewählten Elements. Oben-Rechts-Pfeil (→) blendet die Leiste aus.
      </Para>
      <Table
        headers={["Tab", "Inhalt"]}
        rows={[
          ["Attribute",      "Grundeigenschaften: Name, GlobalId, IFC-Typ, Beschreibung"],
          ["Eigenschaften",  "Alle Property Sets (Pset_WallCommon, Pset_BeamCommon, …)"],
          ["Mengen",         "Quantity Sets (Qto_WallBaseQuantities, Fläche, Volumen, …)"],
          ["</>",            "Rohe JSON-Ausgabe aller IFC-Daten — ideal für Entwickler/Debugging"],
        ]}
      />
      <TipBox>
        <strong>Eigenschaft inline bearbeiten:</strong> Hover über einen Wert → Stift-Icon →
        Wert eingeben → Enter. Geänderte Werte erscheinen in Amber markiert.
        Über <strong>IFC Export</strong> werden alle Änderungen in eine neue .ifc-Datei geschrieben.
      </TipBox>
      <Para>
        <strong>Filter:</strong> Auf eine Zeile klicken → Aktionsleiste mit „Isolieren" und „Ausblenden"
        erscheint. Damit werden alle Elemente mit demselben Wert für dieses Attribut gefiltert
        (erfordert geladene Properties via <em>Analyse → Properties laden</em>).
      </Para>

      <SH2>Bottom-Panels (Analyse-Tab)</SH2>
      <div className="space-y-1">
        <Row icon={<Database size={13}/>} label={<span>SQL <Kbd>Q</Kbd></span> as any}>
          Mini-SQL-Engine über alle IFC-Elemente. Beispiel:
          <code className="block bg-muted/60 rounded px-2 py-1 mt-1 text-[11px] font-mono">
            SELECT name, ifcType FROM model WHERE ifcType = &apos;IFCWALL&apos;
          </code>
        </Row>
        <Row icon={<List size={13}/>} label={<span>Lens Rules <Kbd>L</Kbd></span> as any}>
          Regelbasierte Filter mit Farbcodierung. Regeln werden auf alle geladenen Modelle angewendet
          und im Viewer visualisiert. Ideal für Qualitätsprüfungen.
        </Row>
        <Row icon={<Glasses size={13}/>} label={<span>SmartViews <Kbd>V</Kbd></span> as any}>
          Gespeicherte Ansichten mit Property-basierten Farbgruppen. Properties zuerst laden
          (Analyse → Properties laden), dann SmartViews definieren und speichern.
        </Row>
        <Row icon={<Table2 size={13}/>} label={<span>Mengen <Kbd>T</Kbd></span> as any}>
          Mengenermittlung: Volumen, Fläche, Länge aus IFC-Properties oder 3D-Geometrie berechnet.
          Elemente über den Auswahlkorb oder SmartViews zuordnen.
        </Row>
      </div>

      <SH2>Auswahlkorb</SH2>
      <Para>
        Oben links im Viewer (erscheint wenn Elemente im Korb sind). Sammle Elemente aus
        mehreren Modellen, dann → Mengen berechnen oder Batch-Export. Auto-Add-Modus:
        jedes angeklickte Element wird automatisch in den Korb gelegt.
      </Para>

      <SH2>Panels in neuem Fenster öffnen</SH2>
      <Para>
        Über das <AppWindow size={11} className="inline"/> Icon oben rechts in der Toolbar
        können Projektstruktur, Eigenschaften, SQL, Lens, SmartViews, Mengen und Auswahlkorb
        in separaten Browser-Fenstern geöffnet werden.
        Alle Fenster synchronisieren automatisch über BroadcastChannel.
      </Para>
    </div>
  );
}

// ── Section: Achsen ───────────────────────────────────────────────────────────

function AchsenSection() {
  return (
    <div>
      <SH>Achsen & Trassierung</SH>
      <Para>
        infraCore unterstützt LandXML-Dateien mit Horizontal- und Vertikalachsen (Gradiente).
        Alle Achsen-Funktionen sind im Ribbon-Tab <strong>Achsen</strong> gebündelt.
      </Para>

      <SH2>LandXML laden</SH2>
      <Step n={1} title="Achsen-Panel öffnen">
        Klicke im Ribbon-Tab <strong>Achsen</strong> auf den Button <strong>Achsen</strong>.
        Das Achsen-Panel öffnet sich in der linken Leiste.
      </Step>
      <Step n={2} title="LandXML-Datei laden">
        Im Achsen-Panel: Datei per Drag &amp; Drop in die gestrichelte Zone ziehen oder
        auf die Zone klicken → Datei-Dialog. Unterstützt: <code>.xml</code>, <code>.landxml</code>.
      </Step>
      <Step n={3} title="Achsen verwalten">
        Jede geladene Datei zeigt ihre Achsen mit Sichtbarkeits-Toggle (Auge),
        Farbindikator, Stationierungsbereich und Länge. „Z"-Indikator = Gradiente vorhanden.
      </Step>

      <SH2>Längenschnitt <Kbd>P</Kbd></SH2>
      <Para>
        Zeigt die <strong>Gradiente</strong> (Vertikalachse) der gewählten Achse — Stationierung (x)
        gegen Höhe NN (y). <em>Kein Schnitt durch IFC-Geometrie</em>, sondern die konstruierte
        Gradientenlinie aus dem LandXML.
      </Para>
      <Table
        headers={["Interaktion", "Aktion"]}
        rows={[
          ["Mausrad", "Horizontal zoomen (um Mausposition)"],
          ["LMT + Ziehen", "Profil verschieben (Pan)"],
          ["Hover", "Stationierung und Höhe an Mauscursor lesen"],
          ["Klick auf Profil", "Querschnitt an dieser Station öffnen"],
          ["Reset-Button", "Zoom zurücksetzen"],
        ]}
      />

      <SH2>Querschnitt (2D-Fenster)</SH2>
      <Para>
        Öffnet sich automatisch beim Klick im Längenschnitt oder über <strong>Flächen-Querschnitt</strong>
        <Kbd>X</Kbd>. Zeigt den IFC-Schnitt an der gewählten Station als 2D-SVG.
      </Para>
      <Table
        headers={["Werkzeug", "Beschreibung"]}
        rows={[
          ["Messen", "Zwei Punkte im Schnittbild anklicken → Distanz + Linie"],
          ["Punkt X/Y", "Setzt Maßlinien (Querabstand R/L + Höhenabstand +/−) vom Achspunkt"],
          ["Fang", "Vertex-Fang (Eckpunkte) und Kanten-Fang für präzise Messungen"],
          ["Objekte", "Zeigt IFC-Elementnamen oder Properties als Beschriftungen im Schnitt"],
        ]}
      />

      <SH2>Stationierung &amp; Beschriftung</SH2>
      <Para>
        Achsen-Tab → <strong>Stationierung</strong>: automatische Beschriftung der Achse im 3D-Viewer
        in konfigurierbarem Intervall (10 – 1000 m). Das Intervall ist über das Dropdown neben dem Button wählbar.
      </Para>

      <SH2>Absetzmass</SH2>
      <Para>
        Achsen-Tab → <strong>Absetzmass</strong>: Klicke auf eine IFC-Fläche →
        Werkzeug berechnet die Station des Fußpunkts auf der Achse und den vorzeichenbehafteten
        horizontalen Querabstand (+ rechts, − links). Ergebnis als 3D-Linie + Label im Viewer.
      </Para>
    </div>
  );
}

// ── Section: 5D ───────────────────────────────────────────────────────────────

function FiveDSection() {
  return (
    <div>
      <SH>5D-Abrechnung</SH>
      <Para>
        Das 5D-Modul verknüpft IFC-Elemente mit Fertigstellungsgraden und Abrechnungsinformationen —
        für die bauprozessbegleitende Abrechnung direkt am Modell.
      </Para>

      <SH2>Vorgehen</SH2>
      <Step n={1} title="5D-Fenster öffnen">
        Ribbon-Tab <strong>5D</strong> → Button <strong>5D-Fenster</strong>.
        Ein separates Browser-Fenster öffnet sich und synchronisiert automatisch.
      </Step>
      <Step n={2} title="Elemente zuordnen">
        Im Hauptfenster ein Element im 3D-Viewer anklicken → im 5D-Fenster auf
        <strong> „Zu 5D hinzufügen"</strong> klicken. Das Element ist jetzt erfasst.
      </Step>
      <Step n={3} title="Fertigstellungsgrad verbuchen">
        Im 5D-Fenster: Element auswählen → Fertigstellungsgrad (%) + Datum + Bezeichnung eingeben.
        Mehrere Stände pro Element möglich (Verlaufskurve).
      </Step>
      <Step n={4} title="Visualisierung im 3D-Viewer">
        5D-Tab → <strong>Overlay AN</strong>: Elemente werden farblich nach Fertigstellungsgrad
        eingefärbt (0 % = Rot, 100 % = Grün).
      </Step>
      <Step n={5} title="Isolieren und Exportieren">
        <strong>Isolieren</strong>: Nur 5D-Elemente im Viewer anzeigen. <br/>
        <strong>Export</strong>: Download-Menü → JSON (alle Daten) oder XLSX (Monatsbericht mit Δ-Werten).
      </Step>

      <TipBox>
        5D-Elemente werden über den IFC <strong>GlobalId</strong> identifiziert —
        das Modell kann neu geladen werden ohne die Abrechnungsdaten zu verlieren.
      </TipBox>
    </div>
  );
}

// ── Section: Tastenkürzel ─────────────────────────────────────────────────────

function ShortcutsSection() {
  const groups: { label: string; rows: [React.ReactNode, string][] }[] = [
    {
      label: "Kamera",
      rows: [
        [<Kbd>F</Kbd>, "Alle Modelle einpassen (Fit All)"],
        [<Kbd>N</Kbd>, "Fly-Mode ein-/ausschalten"],
        [<Kbd>B</Kbd>, "Drohnen-Kamera ein-/ausschalten"],
      ],
    },
    {
      label: "Werkzeuge",
      rows: [
        [<Kbd>S</Kbd>, "Auswahl-Werkzeug"],
        [<Kbd>M</Kbd>, "Messen (erneut drücken = zurücksetzen)"],
        [<Kbd>C</Kbd>, "Schnittebene setzen / entfernen"],
        [<Kbd>X</Kbd>, "Flächen-Querschnitt"],
        [<Kbd>Esc</Kbd>, "Werkzeug abbrechen / Auswahl aufheben"],
      ],
    },
    {
      label: "Sichtbarkeit",
      rows: [
        [<><Kbd>H</Kbd> → <Kbd>H</Kbd></>, "Auswahl ausblenden (H-Chord)"],
        [<><Kbd>H</Kbd> → <Kbd>I</Kbd></>, "Auswahl isolieren (H-Chord)"],
        [<><Kbd>H</Kbd> → <Kbd>R</Kbd></>, "Alle einblenden (H-Chord)"],
        [<Kbd>Del</Kbd>, "Auswahl ausblenden (Kurzform)"],
        [<><Kbd>Shift</Kbd><Kbd>A</Kbd></>, "Alle einblenden"],
      ],
    },
    {
      label: "Panels",
      rows: [
        [<Kbd>Q</Kbd>, "SQL-Panel öffnen/schließen"],
        [<Kbd>L</Kbd>, "Lens Rules Panel"],
        [<Kbd>V</Kbd>, "SmartViews Panel"],
        [<Kbd>T</Kbd>, "Mengen / QTO Panel"],
        [<Kbd>P</Kbd>, "Längenschnitt-Viewer"],
      ],
    },
  ];

  return (
    <div>
      <SH>Tastenkürzel</SH>
      <NoteBox>
        Tastenkürzel sind nicht aktiv wenn der Cursor in einem Eingabefeld steht.
        Alle Kürzel sind in den Einstellungen (⚙) anpassbar.
      </NoteBox>
      <div className="grid grid-cols-2 gap-x-8 gap-y-0">
        {groups.map(g => (
          <div key={g.label}>
            <SH2>{g.label}</SH2>
            {g.rows.map(([k, desc], i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-b-0">
                <div className="w-24 shrink-0">{k}</div>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <SH2 >H-Chord erklärt</SH2>
      <Para>
        <Kbd>H</Kbd> drücken startet ein 1-Sekunden-Zeitfenster.
        Innerhalb dieser Zeit eine zweite Taste drücken (<Kbd>H</Kbd>, <Kbd>I</Kbd> oder <Kbd>R</Kbd>)
        → Aktion wird ausgeführt. Läuft das Zeitfenster ab ohne zweite Taste → kein Effekt.
      </Para>
    </div>
  );
}

// ── Section: Tipps ────────────────────────────────────────────────────────────

function TipsSection() {
  return (
    <div>
      <SH>Tipps &amp; Tricks</SH>

      <SH2>Performance</SH2>
      <TipBox>
        Bei großen Modellen (&gt; 100 MB): Erst laden, dann Properties laden (Analyse-Tab).
        Properties-Laden liest alle IFC-Attribute ins RAM — kann einige Sekunden dauern.
      </TipBox>

      <SH2>Multi-Window-Workflow</SH2>
      <Para>
        Das <AppWindow size={11} className="inline mx-0.5"/> Icon öffnet ein Dropdown mit allen
        verfügbaren Panels. Jedes Panel kann als eigenes Browser-Fenster auf einem zweiten Monitor
        laufen. Alle Fenster sind vollständig synchron — Element auswählen im 3D-Viewer
        öffnet sofort die Eigenschaften im separaten Fenster.
      </Para>

      <SH2>SmartViews für Qualitätsprüfung</SH2>
      <Para>
        Workflow: <strong>1.</strong> Properties laden (Analyse → Properties laden) →
        <strong> 2.</strong> SmartViews öffnen (<Kbd>V</Kbd>) →
        <strong> 3.</strong> Neue SmartView erstellen → Regeln definieren (z.B. <em>Pset_WallCommon.FireRating ≠ leer</em>) →
        <strong> 4.</strong> SmartView aktivieren → Elemente werden im 3D-Viewer farbig eingefärbt.
      </Para>

      <SH2>SQL-Abfragen</SH2>
      <Para>
        Der SQL-Editor (<Kbd>Q</Kbd>) erlaubt direkte Abfragen über alle geladenen Elemente:
      </Para>
      <div className="space-y-1.5 mb-4">
        {[
          "SELECT name, ifcType FROM model WHERE ifcType = 'IFCWALL'",
          "SELECT ifcType, COUNT(*) as anzahl FROM model GROUP BY ifcType",
          "SELECT name FROM model WHERE name LIKE '%Beton%'",
        ].map((q, i) => (
          <code key={i} className="block bg-muted/60 rounded px-3 py-1.5 text-[11px] font-mono text-foreground/80">
            {q}
          </code>
        ))}
      </div>

      <SH2>Eigenschaften bearbeiten &amp; exportieren</SH2>
      <Para>
        Eigenschaften können direkt im Browser bearbeitet werden (rechte Sidebar → Tab „Attribute" oder
        „Eigenschaften" → Hover → Stift-Icon). Geänderte Werte sind amber markiert.
        Über <strong>IFC Export</strong> wird eine neue .ifc-Datei mit allen Änderungen erzeugt —
        die Originaldatei bleibt unverändert.
      </Para>

      <SH2>Auswahlkorb für Massenermittlung</SH2>
      <Para>
        Elemente aus dem Baum (linke Sidebar) oder per Shift-Klick im 3D-Viewer sammeln →
        in den Auswahlkorb legen → Tab Mengen (<Kbd>T</Kbd>) → Volumen, Fläche und Länge
        werden für den Korb berechnet.
      </Para>

      <SH2>Batch-Änderungen</SH2>
      <Para>
        Über <strong>Start → Datei → Batch</strong> können Properties für viele Elemente
        gleichzeitig geändert werden — z.B. alle Wände eines Typs umbenennen oder
        ein Property Set ergänzen. Ergebnis als modifizierte IFC-Datei exportierbar.
      </Para>

      <TipBox>
        <strong>Koordinatensysteme:</strong> infraCore unterstützt große Koordinatenwerte
        (bis ±20 km). Modelle werden automatisch auf einen gemeinsamen Ursprung verschoben —
        Messungen und Stationierungen bleiben in echten Weltkoordinaten.
      </TipBox>

      <SH2>Seitenleisten-Tastatur-Tipp</SH2>
      <Para>
        Die linke und rechte Leiste können jederzeit über den Pfeil-Button in ihrem Header
        ausgeblendet werden. Ein kleiner Pfeil-Button am Rand des Viewports öffnet sie wieder —
        ideal für maximale 3D-Ansicht während einer Präsentation.
      </Para>

      <div className="mt-6 pt-4 border-t border-border/50 text-center">
        <p className="text-[11px] text-muted-foreground">
          infraCore IFC Viewer — basiert auf web-ifc 0.0.77 + Three.js<br/>
          by iC consulenten ZT GmbH · VDC
        </p>
      </div>
    </div>
  );
}
