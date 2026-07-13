@echo off
setlocal
cd /d "%~dp0"
node bin\fwe.js --app examples\app.fwe.json --open %*
exit /b %ERRORLEVEL%
