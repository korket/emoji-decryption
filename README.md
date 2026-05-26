# Emoguessr

A fully-automated YouTube Shorts Live game where viewers race to be first to guess what emoji puzzles represent. The first exact correct guess scores points; a live leaderboard shows the top players.

**Status:** Live and running.

## How it works

Emoji puzzles (e.g. `🧊🚢🥶` = "Titanic") appear on stream. Viewers type guesses in YouTube live chat. The system accepts only exact canonical answers, ignoring letter case only. The first correct guess ends the round, awards points based on the current phase, then moves to the next puzzle after the result screen.

- **Bonus window (0–10s):** first exact correct guess earns 10 pts
- **Open guessing (10–30s):** first exact correct guess earns 5 pts
- **Hint 1 (30–50s):** first exact correct guess earns 3 pts; first letter of each word is revealed
- **Hint 2 (50–70s):** first exact correct guess earns 3 pts; ~half the letters are revealed
- If nobody guesses correctly, the answer is revealed at 70s; next puzzle starts after a 10s inter-round screen

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
puzzles.json          Puzzle bank (259 entries)
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

# Start the Windows control panel
./start-control-gui.bat
```

The control panel starts/stops the backend and overlay, shows embedded logs, checks YouTube API/quota status, and starts/stops the game. The backend starts idle by default so you can prepare OBS and the stream first. `Start Game` attaches to the active YouTube live chat, then starts the pre-game countdown. `Stop Game` returns the overlay to the waiting state.

The backend checks YouTube API status once on startup; later GUI status refreshes read cached backend state and do not repeatedly call YouTube. The GUI also shows estimated YouTube API units used by the current backend process.

Run `npm run puzzles:check` to validate the seed puzzle bank and report strict-matching risks such as ignored aliases, punctuation-sensitive answers, duplicate answers, or missing categories.

## Running with pm2 (production)

```bash
npm install -g pm2

# Start (auto-restarts on crash, logs to ./logs/)
pm2 start ecosystem.config.cjs

# View logs
pm2 logs emoguessr

# Stop
pm2 stop emoguessr

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
