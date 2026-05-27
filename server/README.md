# infraCore Python Server

Lokaler FastAPI-Companion-Server, der IfcOpenShell bereitstellt.  
Der Viewer überträgt die geladenen IFC-Modelle per HTTP an diesen Server;  
Skripte laufen in einem Python-Kontext mit direktem Zugriff auf die Modelle.

## Voraussetzungen

- Python 3.11+
- IfcOpenShell muss für die Python-Version verfügbar sein

## Start

```bash
# Im Projekt-Root
pip install -r server/requirements.txt
python server/server.py
```

Der Server startet auf **http://127.0.0.1:8765** und akzeptiert nur
Verbindungen von localhost (Vite Dev-Server Port 5173/4173).

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
walls = model.by_type("IfcWall")
for w in walls:
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
# Property setzen (nur im Server-Kontext, nicht zurück in den Viewer)
model = ifc_models["Gebäude.ifc"]
for wall in model.by_type("IfcWall"):
    wall.Name = (wall.Name or "") + "_geprüft"
print("Fertig")
```

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/health` | Serverstatus + geladene Modellnamen |
| GET | `/models` | Liste der Modellnamen |
| POST | `/upload` | IFC-Datei hochladen (multipart: `name` + `file`) |
| DELETE | `/models/{name}` | Modell entfernen |
| POST | `/execute` | Skript ausführen (`{"script": "..."}`) |
