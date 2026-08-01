@echo off
chcp 65001 >nul
title Quiz Race (ngrok / Internet Mode)
cd /d "%~dp0"

echo.
echo   ==========================================
echo      Quiz Race  -  ngrok Internet Mode (443)
echo      works even when Cloudflare port 7844 is blocked
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist "node_modules\@ngrok\ngrok" call :getngrok
if not exist "node_modules\@ngrok\ngrok" goto :nongrok

node -e "const fs=require('fs');let t='';try{const r=fs.readFileSync('ngrok-token.txt','utf8').replace(/^﻿/,'');t=r.split(/\r?\n/).map(s=>s.trim()).find(s=>s&&!s.startsWith('#'))||'';}catch(e){}if(t==='在此粘贴你的ngrok-token')t='';process.exit(t?0:1)"
if errorlevel 1 goto :notoken

echo   Server + ngrok tunnel are starting...
echo   Wait a few seconds for a PUBLIC https link + QR on the HOST screen.
echo   Players scan that QR with phones - any network / mobile data works.
echo.
echo   * Close this black window to STOP the game. *
echo.
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:3000/host"
node server.js --ngrok
echo.
echo   Server stopped.
pause
exit /b 0

:getngrok
echo   First run: installing ngrok module, please wait...
call npm install @ngrok/ngrok --save --strict-ssl=false
exit /b 0

:notoken
echo.
echo   [!] ngrok token not set yet.
echo   Open "ngrok-token.txt", paste your token from
echo   https://dashboard.ngrok.com/get-started/your-authtoken
echo   save it, then run this file again.
echo.
pause
exit /b 1

:nongrok
echo.
echo   [ERROR] Failed to install @ngrok/ngrok. Check network and retry.
pause
exit /b 1

:nonode
echo   [ERROR] Node.js not found on this PC.
echo   Please install Node.js LTS from https://nodejs.org
echo   then double-click this file again.
echo.
pause
exit /b 1
