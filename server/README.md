# infraCore Python Server

Lokaler FastAPI-Companion-Server, der IfcOpenShell bereitstellt.  
Der Viewer überträgt die geladenen IFC-Modelle per HTTP; Skripte laufen
in einem Python-Kontext mit direktem Zugriff auf die Modelle.

## Start

```bash
python server/server.py
```

**Beim ersten Start** werden alle Abhängigkeiten automatisch in `server/vendor/`
installiert (dauert ca. 30–60 Sekunden). Danach startet der Server sofort —
**kein manuelles `pip install` notwendig**.

Einzige Voraussetzung: **Python 3.10+** muss installiert sein.

## Im Skript verfügbare Objekte

| Name | Typ | Beschreibung |
|---|---|---|
| `ifc_models` | `dict[str, ifcopenshell.file]` | Alle vom Viewer übertragenen Modelle |
| `ifcopenshell` | Modul | Vollständiges ifcopenshell-Paket |
| `util` | Modul | `ifcopenshell.util.element` |

## Beispiele

```python
# Alle Wände eines Modells auflisten
model = ifc_models["Gebäude.ifc"]
for w in model.by_type("IfcWall"):
    print(w.GlobalId, w.Name)
```

```python
# Psets abfragen
model = ifc_models["Gebäude.ifc"]
slab = model.by_type("IfcSlab")[0]
psets = util.get_psets(slab)
print(psets)
```

```python
# Mengen auswerten
for name, model in ifc_models.items():
    for slab in model.by_type("IfcSlab"):
        q = util.get_psets(slab).get("Qto_SlabBaseQuantities", {})
        print(name, slab.Name, q.get("GrossArea"))
```

## Neuinstallation erzwingen

```bash
rm server/vendor/.bootstrap_ok
python server/server.py
```

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/health` | Serverstatus + geladene Modellnamen |
| GET | `/models` | Liste der Modellnamen |
| POST | `/upload` | IFC-Datei hochladen (multipart: `name` + `file`) |
| DELETE | `/models/{name}` | Modell entfernen |
| POST | `/execute` | Skript ausführen (`{"script": "..."}`) |
| GET | `/download/{name}` | (Modifiziertes) Modell als IFC-Bytes zurückgeben |

## Hinweis zur vendor/-Ablage

`server/vendor/` ist in `.gitignore` — plattformspezifische Binaries
(ifcopenshell enthält kompilierte C++-Bibliotheken) können nicht
sinnvoll plattformübergreifend ins Repo eingecheckt werden.
Der Bootstrap erledigt das automatisch für jede Plattform.
