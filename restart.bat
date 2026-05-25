@echo off
echo Stopping existing server...
taskkill /F /IM node.exe /T >nul 2>&1

echo Starting game server...
start "Emoguessr Server" cmd /k "npm run dev"

echo Done. Server running in new window.
