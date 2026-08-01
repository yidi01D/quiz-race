@echo off
title Quiz Race Server
cd /d "%~dp0"

echo.
echo   ==================================
echo      Quiz Race  -  One-Click Start
echo   ==================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found on this PC.
  echo   Please install Node.js LTS from https://nodejs.org
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First run: installing dependencies, please wait...
  call npm install
  if not exist "node_modules" (
    echo   Retry with corporate-network compatible mode...
    call npm install --strict-ssl=false
  )
  if not exist "node_modules" (
    echo.
    echo   [ERROR] Dependency install failed. Check network and retry.
    pause
    exit /b 1
  )
)

echo.
echo   Server is starting...
echo   The HOST screen will open in your browser automatically.
echo   Players: scan the QR code on the big screen with your phone.
echo   (Phone and this PC must be on the SAME WiFi / LAN.)
echo.
echo   * Close this black window to STOP the game. *
echo.

start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:3000/host"

node server.js

echo.
echo   Server stopped.
pause
