@echo off
echo Starting Emoguessr game...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/game/start' -ContentType 'application/json' -Body '{}' | ConvertTo-Json -Depth 5 } catch { Write-Error $_; exit 1 }"
if errorlevel 1 (
  echo Failed to start game.
  pause
  exit /b 1
)
echo Game start requested.
pause
