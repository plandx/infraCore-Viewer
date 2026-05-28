@echo off
chcp 65001 >nul
echo infraCore Python Server wird gestartet...
echo.
Python-3.12.13\python.exe server\server.py
pause
