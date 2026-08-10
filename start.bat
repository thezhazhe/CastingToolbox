@echo off
chcp 936 >nul 2>&1
cd /d "%~dp0"

echo ================================================
echo    Casting Toolbox - starting...
echo    Server window is this one. Close it to stop.
echo ================================================
echo.

rem 直接在本窗口启动服务器（不再另开最小化窗口）。
rem 若已有一个实例在运行，会自动打开浏览器到现有实例，然后本窗口退出。
call "%~dp0serve.cmd"
