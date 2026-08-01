@echo off
chcp 65001 >nul
title Convert videos to H.264 MP4
cd /d "%~dp0"

echo ==========================================================
echo  Convert every .mov / .mkv / .avi in videos\ to browser
echo  friendly H.264 MP4 (fixes "sound but no picture" / HEVC).
echo  Files that already have a same-named .mp4 are skipped.
echo ==========================================================
echo.

if not exist "ffmpeg.exe" goto :noffmpeg

for %%F in ("videos\*.mov" "videos\*.mkv" "videos\*.avi" "videos\*.MOV") do call :convert "%%~F"

echo.
echo Done. You can now pick the .mp4 files in the editor.
pause
exit /b

:convert
set "src=%~1"
set "dst=%~dpn1.mp4"
if exist "%dst%" echo [skip] %~nx1 already has mp4& goto :eof
echo [conv] %~nx1
ffmpeg.exe -y -i "%src%" -c:v libx264 -crf 21 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "%dst%" -loglevel error
goto :eof

:noffmpeg
echo ffmpeg.exe not found next to this file.
echo Please keep ffmpeg.exe in the quiz-race folder.
pause
exit /b
