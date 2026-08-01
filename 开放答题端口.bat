@echo off
chcp 65001 >nul
title Open Quiz Race port 3000 (Firewall)

rem 需要管理员权限：若非管理员，自动申请提权后重跑本脚本
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 正在申请管理员权限（请在弹窗点“是”）...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo   给「竞速答题」放行 3000 端口的入站（一次性设置）...
netsh advfirewall firewall delete rule name="Quiz Race 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Quiz Race 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.
echo   已放行。现在同一热点下的手机就能连到这台电脑了。
echo   接着双击 run.bat 开始，手机连同一个热点后扫码即可。
echo.
pause
