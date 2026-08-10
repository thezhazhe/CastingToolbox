@echo off
chcp 936 >nul 2>&1
cd /d "%~dp0"

echo ================================================
echo   Build Casting Toolbox single-file EXE (SEA)
echo   Requires Node.js + npm (first build downloads postject)
echo ================================================
echo.

rem ==== Locate Node.js ====
set "NODE="
where node >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%P in ('where node') do ( if not defined NODE set "NODE=%%P" )
)
if not defined NODE (
  for %%D in ("%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe" "%LocalAppData%\Programs\nodejs\node.exe" "D:\PROGRAM FILES\nodejs\node.exe" "C:\Program Files\nodejs\node.exe" "C:\nodejs\node.exe") do (
    if exist "%%~D" if not defined NODE set "NODE=%%~D"
  )
)
if not defined NODE ( echo [ERROR] Node.js not found. & pause & exit /b 1 )

echo   Node: %NODE%
echo.

rem ==== 1. 生成 sea-prep.blob ====
"%NODE%" --experimental-sea-config sea-config.json
if errorlevel 1 ( echo [ERROR] sea-config failed & pause & exit /b 1 )

rem ==== 2. 复制 node.exe 作为 EXE 底座（放到项目根，与 index.html 同级） ====
"%NODE%" -e "require('fs').copyFileSync(process.execPath, 'CastingToolbox.exe')"

rem ==== 2.5 生成并嵌入品牌图标（快捷方式显示用）
rem      注意：必须在 postject 注入 blob 之前设图标 —— rcedit 遇 SEA blob 会卡死（实测）。
rem      首次会联网拉取 rcedit；失败只警告，不中断构建。
if not exist "dist\apk\CastingToolbox.ico" (
  python "dist\apk\gen_icons.py" >nul 2>&1
)
node "scripts\set_exe_icon.cjs" "CastingToolbox.exe" "dist\apk\CastingToolbox.ico"
if errorlevel 1 echo   [WARN] 图标设置失败（可忽略，仅影响快捷方式图标） & echo.

rem ==== 3. 注入 blob（postject，首次联网下载） ====
call npx --yes postject CastingToolbox.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 ( echo [ERROR] postject failed - check npm/network & pause & exit /b 1 )

del sea-prep.blob 2>nul
echo.
echo   Build OK: CastingToolbox.exe
echo   Double-click CastingToolbox.exe to run (it starts the local server
echo   and opens the browser automatically).
pause
