@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
set DEMO_MODE=1
set BOT_PORT=18080
set BOT_DATA_DIR=data-demo
node dist\server\index.js
pause
