@echo off
setlocal

rem Run from repo root (directory of this .bat)
cd /d "%~dp0"

if /I "%1"=="dev" (
  echo [CloudCLI] Starting server in dev mode...
  call npm run server:dev
  goto :eof
)

if /I "%1"=="platform" (
  set "VITE_IS_PLATFORM=true"
)

if "%SERVER_PORT%"=="" set "SERVER_PORT=3001"

echo [CloudCLI] Starting server on port %SERVER_PORT%...
call npm run server

endlocal
