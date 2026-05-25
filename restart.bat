@echo off
echo Stopping existing server...
taskkill /F /IM node.exe /T >nul 2>&1

echo Starting backend server in idle mode...
start "Emoguessr Server" cmd /k "npm run dev"

echo Done. Backend running in new window. Use start-game.bat when ready.
