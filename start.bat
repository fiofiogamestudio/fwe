@echo off
setlocal
pushd "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo [FWE] Node.js 18 or newer is required. Install Node.js and reopen this launcher.
  set "FWE_START_EXIT=1"
  goto failed
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 18 ? 1 : 0)" >nul 2>nul
if errorlevel 1 (
  echo [FWE] Node.js 18 or newer is required. Update Node.js and reopen this launcher.
  set "FWE_START_EXIT=1"
  goto failed
)
node bin\start.js %*
set "FWE_START_EXIT=%ERRORLEVEL%"
if not "%FWE_START_EXIT%"=="0" goto failed
popd
exit /b 0
:failed
echo [FWE] Startup failed. See the error above.
if not defined FW_START_NO_PAUSE pause
popd
exit /b %FWE_START_EXIT%
