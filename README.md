# emoji-decryption

A fully-automated YouTube Shorts Live game where viewers race to guess what emoji puzzles represent. Correct guesses score points within a 10-second bonus window; a live leaderboard shows the top players.

**Status:** Live and running.

## How it works

Emoji puzzles (e.g. `🧊🚢🥶` = "Titanic") appear on stream. Viewers type guesses in YouTube live chat. The system fuzzy-matches answers, awards points on a sliding scale, reveals letter hints if nobody wins, then moves to the next puzzle automatically.

- **Bonus window (0–10s):** 10 pts for the first correct guess
- **Open guessing (10–30s):** 5 pts
- **Hint 1 (30–50s):** 3 pts — first letter of each word revealed
- **Hint 2 (50–70s):** 3 pts — ~half the letters revealed
- Round ends automatically after 80s; next puzzle starts after a 10s inter-round screen

## Stack

- **Backend:** Node.js + TypeScript
- **Persistence:** SQLite (puzzles + session scores)
- **Overlay:** Svelte + Vite (browser source)
- **Transport:** WebSocket between backend and overlay
- **Chat:** YouTube Data API v3 live chat polling
- **Stream:** OBS Studio → RTMP → YouTube Live

## Repo layout

```
src/                  Backend (Node.js)
  game/               Round engine, game loop, session
  persistence/        SQLite: puzzles, scores
  types/              Shared type definitions (Zod)
  youtube/            Chat poller, OAuth
overlay/              Svelte frontend (OBS browser source)
  src/
    lib/store.ts      WebSocket client + reactive stores
    lib/sfx.ts        Sound effect helper
    App.svelte        Main overlay UI
bgm/                  Background music tracks (.mp3)
sfx/                  Sound effects (.mp3)
puzzles.json          Puzzle bank (135+ entries)
```

## Running locally

```bash
# Install dependencies
npm install
cd overlay && npm install && cd ..

# Configure (optional — defaults work out of the box)
cp .env.example .env

# Authenticate with YouTube (first run only)
npm run auth

# Start backend
npm start

# Start overlay dev server (separate terminal)
cd overlay && npm run dev
```

## Running with pm2 (production)

```bash
npm install -g pm2

# Start (auto-restarts on crash, logs to ./logs/)
pm2 start ecosystem.config.cjs

# View logs
pm2 logs emoji-decryption

# Stop
pm2 stop emoji-decryption

# Auto-start on system boot
pm2 startup
pm2 save
```

## OBS Setup

Add a **Browser Source** with these settings:

| Setting | Value |
|---|---|
| URL | `http://localhost:5173` |
| Width | 1080 |
| Height | 1920 |
| Custom CSS | *(leave empty)* |
| Shutdown source when not visible | unchecked |
| Refresh browser when scene becomes active | checked |

Set the OBS canvas to **1080×1920** (Vertical / 9:16 for YouTube Shorts Live).

In OBS → Settings → Stream, set service to YouTube and paste your stream key.
