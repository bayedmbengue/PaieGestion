@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
node server.js
if errorlevel 1 (
  echo.
  echo PaieGestion s'est arrete avec une erreur. Faites une capture de ce message.
  pause
)
