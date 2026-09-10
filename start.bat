@echo off
chcp 936 >nul 2>&1
cd /d "%~dp0"

echo ================================================
echo    Casting Toolbox - starting...
echo    Server window is this one. Close it to stop.
echo ================================================
echo.

rem Start server directly in this window.
rem If an instance already runs, open browser to it and exit this window.
call "%~dp0serve.cmd"
