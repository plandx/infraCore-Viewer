@echo off
chcp 65001 >nul
echo infraCore Python Server wird gestartet...
echo.
"%~dp0server\Python-3.12.13\python.exe" "%~dp0server\server.py"
pause
