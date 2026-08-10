@echo off
chcp 936 >nul 2>&1
cd /d "%~dp0"

rem ==== Locate Node.js (use absolute path to avoid PATH issues) ====
set "NODE="
where node >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%P in ('where node') do (
    if not defined NODE set "NODE=%%P"
  )
)
if not defined NODE (
  for %%D in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LocalAppData%\Programs\nodejs\node.exe"
    "D:\PROGRAM FILES\nodejs\node.exe"
    "C:\Program Files\nodejs\node.exe"
    "C:\nodejs\node.exe"
  ) do (
    if exist "%%~D" if not defined NODE set "NODE=%%~D"
  )
)
if not defined NODE (
  echo.
  echo  [ERROR] Node.js not found.
  echo  Please install Node.js first: https://nodejs.org
  echo  Then double-click start.bat again.
  echo.
  pause
  exit /b 1
)

echo  Casting Toolbox server (Node.js)...
echo    %NODE%
echo  Press Ctrl+C in this window to stop the server.
echo.
"%NODE%" "%~dp0serve.js"

echo.
echo  Server stopped.
pause
