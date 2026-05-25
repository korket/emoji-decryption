@echo off
echo Starting overlay dev server...
start "Emoguessr Overlay" cmd /k "cd overlay && npm run dev"
echo Done. Overlay running at http://localhost:5173
