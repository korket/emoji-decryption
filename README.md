# emoji-decryption

A fully-automated YouTube Shorts Live game where viewers race to guess what emoji puzzles represent. Correct guesses score points within a 10-second window; a live leaderboard shows the top players.

**Status:** Planning / pre-implementation.

## Concept

Emoji puzzles (e.g. `🧊🚢🥶` = "Titanic") appear on stream. Viewers type guesses in YouTube live chat. The system fuzzy-matches answers, awards points on a sliding scale (10/8/6/4/2 in the first 10s, then 1pt for the next 20s), reveals letter hints if no one wins, and updates session + weekly leaderboards on-screen.

## Format

- Vertical 9:16 for YouTube Shorts Live
- Scheduled 2-hour daily blocks (not 24/7)
- Fully automated — no streamer on camera
- ~55s average round, ~130 rounds per stream

## Stack (planned)

- Node.js + TypeScript backend
- SQLite for puzzles + scores
- HTML/JS overlay rendered as OBS browser source
- WebSocket between backend and overlay
- YouTube Data API v3 for live chat ingestion
- OBS Studio → RTMP → YouTube Live

## Repo layout (to come)

Structure will be filled in as Phase 1 (engine) lands.
