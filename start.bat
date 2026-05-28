@echo off
chcp 65001 >nul
title infraCore Viewer
cd /d "%~dp0"

echo ============================================================
echo  infraCore Viewer -- Start
echo ============================================================
echo.

:: ── 1. git pull (nur warnen, nicht abbrechen) ─────────────────
echo [1/4] Git aktualisieren...
git pull
if errorlevel 1 (
    echo WARNUNG: git pull hatte Probleme - starte mit lokalem Stand.
)
echo.

:: ── 2. Python Server in eigenem Fenster ──────────────────────
echo [2/4] Python Companion Server starten...
:: Alten Server-Prozess auf Port 8765 beenden, falls vorhanden
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8765 " ^| findstr "LISTENING"') do (
    echo   Beende alten Server-Prozess PID %%p...
    taskkill /PID %%p /F >nul 2>&1
)
start "Python Server" "%~dp0server\python-3.13.13-embed-amd64\python.exe" "%~dp0server\server.py"
echo.

:: ── 3. npm run build ─────────────────────────────────────────
echo [3/4] App bauen (vite build)...
cmd /c "npx vite build"
if errorlevel 1 (
    echo.
    echo FEHLER: Build fehlgeschlagen - siehe Fehlermeldung oben.
    pause
    exit /b 1
)
echo.

:: ── 4. Preview Server starten ────────────────────────────────
echo [4/4] Vorschau-Server starten...
start "Preview Server" cmd /k "cd /d "%~dp0" & npm run preview"

:: Browser nach kurzer Wartezeit oeffnen
echo Warte auf Server-Start...
timeout /t 4 /nobreak >nul
start "" "http://localhost:4173"

echo.
echo ============================================================
echo  App:           http://localhost:4173
echo  Python Server: http://127.0.0.1:8765
echo ============================================================
echo.
echo Dieses Fenster kann geschlossen werden.
pause
