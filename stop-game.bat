@echo off
echo Stopping Emoguessr game...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/game/stop' -ContentType 'application/json' -Body '{}' | ConvertTo-Json -Depth 5 } catch { Write-Error $_; exit 1 }"
if errorlevel 1 (
  echo Failed to stop game.
  pause
  exit /b 1
)
echo Game stop requested.
pause
