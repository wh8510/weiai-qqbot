@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
if not exist "dist\server\index.js" (
  echo 还没有构建。请先运行 scripts\setup.ps1
  pause
  exit /b 1
)
node dist\server\index.js
if errorlevel 1 (
  echo.
  echo 程序退出，错误码 %errorlevel%。
  pause
)
