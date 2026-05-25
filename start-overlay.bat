@echo off
echo Starting overlay dev server...
start "Emoji Decryption Overlay" cmd /k "cd overlay && npm run dev"
echo Done. Overlay running at http://localhost:5173
