@echo off
setlocal
cd /d "%~dp0"

set "FWE_PORT=3219"
set "FWE_URL=http://127.0.0.1:%FWE_PORT%"
set "FWE_OPEN_ARG=--open"
if /I "%FWE_NO_BROWSER%"=="1" set "FWE_OPEN_ARG=--no-open"

netstat -ano | findstr /C:"127.0.0.1:%FWE_PORT%" | findstr /C:"LISTENING" >nul
if not errorlevel 1 (
  echo [fwe] Port %FWE_PORT% is already in use.
  echo [fwe] Opening existing server: %FWE_URL%
  if /I not "%FWE_NO_BROWSER%"=="1" explorer.exe "%FWE_URL%"
  exit /b 0
)

echo [fwe] Starting examples: %FWE_URL%
node ..\bin\fwe.js --app app.fwe.json --port %FWE_PORT% %FWE_OPEN_ARG%
