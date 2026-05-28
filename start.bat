@echo off
chcp 65001 >nul
title infraCore Viewer — Start
cd /d "%~dp0"

echo ============================================================
echo  infraCore Viewer — Start
echo ============================================================
echo.

:: ── 1. git pull ──────────────────────────────────────────────
echo [1/4] Git aktualisieren...
git pull
if errorlevel 1 (
    echo.
    echo FEHLER: git pull fehlgeschlagen.
    echo Bitte Konflikt manuell loesen oder Netzwerk pruefen.
    pause
    exit /b 1
)
echo.

:: ── 2. Python Server ─────────────────────────────────────────
echo [2/4] Python Companion Server starten...
start "infraCore — Python Server" "%~dp0server\python-3.13.13-embed-amd64\python.exe" "%~dp0server\server.py"
echo.

:: ── 3. npm run build ─────────────────────────────────────────
echo [3/4] App bauen (kann 30-60 Sekunden dauern)...
call npm run build
if errorlevel 1 (
    echo.
    echo FEHLER: Build fehlgeschlagen.
    echo Bitte Fehlermeldung pruefen (TypeScript-Fehler oder fehlende Abhaengigkeiten).
    pause
    exit /b 1
)
echo.

:: ── 4. Preview Server + Browser ──────────────────────────────
echo [4/4] Vorschau-Server starten und Browser oeffnen...
start "infraCore — Preview Server" cmd /k "npm run preview -- --port 4173 && pause"
timeout /t 2 /nobreak >nul
start http://localhost:4173

echo.
echo ============================================================
echo  infraCore Viewer laeuft unter: http://localhost:4173
echo  Python Server:                  http://127.0.0.1:8765
echo  Fenster schliessen beendet die Server.
echo ============================================================
echo.
pause
