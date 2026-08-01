@echo off
title Quiz Race (Mobile / Internet Mode)
cd /d "%~dp0"

echo.
echo   ==========================================
echo      Quiz Race  -  Mobile / Internet Mode
echo      phones can join via 4G / 5G / any WiFi
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist "node_modules" call :install
if not exist "node_modules" goto :noinstall

if not exist "cloudflared.exe" call :getcf
if not exist "cloudflared.exe" goto :nocf

echo.
echo   Server + public tunnel are starting...
echo   The HOST screen opens in your browser automatically.
echo   Wait a few seconds: a PUBLIC link and QR code appear on the screen.
echo   Players scan that QR with their phones - any network works.
echo.
echo   * Close this black window to STOP the game. *
echo.
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:3000/host"
node server.js --tunnel
echo.
echo   Server stopped.
pause
exit /b 0

:install
echo   First run: installing dependencies, please wait...
call npm install
if not exist "node_modules" call npm install --strict-ssl=false
exit /b 0

:getcf
echo   Downloading cloudflared tunnel tool, one-time, please wait...
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 } catch {}; try { [System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true} } catch {}; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
exit /b 0

:nonode
echo   [ERROR] Node.js not found on this PC.
echo   Please install Node.js LTS from https://nodejs.org
echo   then double-click this file again.
echo.
pause
exit /b 1

:noinstall
echo.
echo   [ERROR] Dependency install failed. Check network and retry.
pause
exit /b 1

:nocf
echo.
echo   [ERROR] Failed to download cloudflared.
echo   Your network / firewall may block GitHub. Try another network,
echo   or download it manually and put cloudflared.exe in this folder:
echo   https://github.com/cloudflare/cloudflared/releases/latest
pause
exit /b 1
