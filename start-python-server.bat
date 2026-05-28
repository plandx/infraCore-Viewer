@echo off
chcp 65001 >nul
echo infraCore Python Server wird gestartet...
echo.
"%~dp0server\python-3.13.13-embed-amd64\python.exe" "%~dp0server\server.py"
pause
