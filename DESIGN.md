# Emoguessr — Design Document

**Project:** [github.com/korket/Emoguessr](https://github.com/korket/Emoguessr)
**Operator:** korket
**Document version:** 2026-05-24

---

## 1. Project Overview

**Emoguessr** is a fully-automated viewer-interactive game broadcast on YouTube Shorts Live. Emoji puzzles (e.g., `🧊🚢🥶` = "Titanic") appear on a vertical 9:16 video stream; viewers guess in YouTube live chat; the system accepts only exact canonical answers, ignoring letter case only. The first correct guess ends the round and awards points based on the current phase. An on-screen leaderboard updates throughout the broadcast.

The application is **single-tenant**: it runs locally on the operator's own machine to power the operator's own personal YouTube channel. It is not distributed to other users, not operated as a service, and not accessed by any third party.

**Format constraints:**
- Vertical 9:16 layout for YouTube Shorts Live surfacing
- Scheduled 2-hour daily streams (not 24/7)
- Fully automated, no streamer on camera
- ~55 second average round; ~130 rounds per 2-hour block

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ YouTube Live Chat                                            │
│   ↓ poll every 5 seconds (youtube.liveChatMessages.list)     │
│ Chat Ingest Service                                          │
│   ↓ dedupe by message ID + exact answer check                 │
│ Game Engine  (Node.js + TypeScript)                          │
│   ├── Round state machine (REVEAL → SCORING → HINTS → END)   │
│   ├── Answer matcher (exact match, case-insensitive only)    │
│   ├── Scoring (first correct: 10 pts / 5 pts / 3 pts)        │
│   └── Leaderboard (session + 7-day rolling)                  │
│   ↓ WebSocket push                                           │
│ Overlay  (Svelte HTML/JS — rendered as OBS Browser Source)   │
│   ↓ composited into                                          │
│ OBS Studio                                                   │
│   ↓ RTMPS                                                    │
│ YouTube Live                                                 │
└──────────────────────────────────────────────────────────────┘
```

All components run on a single local desktop machine. No cloud infrastructure. No multi-tenant component. No external service accessed beyond the YouTube Data API.

---

## 3. YouTube API Integration

### 3.1 Endpoints used

| Endpoint | Frequency | Purpose |
|---|---|---|
| `youtube.channels.list` | Once at OAuth setup | Verify authenticated channel identity |
| `youtube.liveBroadcasts.list?mine=true` | Once per stream session start | Retrieve active broadcast ID and `liveChatId` |
| `youtube.liveChatMessages.list` | Every 5 seconds during stream | Fetch new chat messages since last `pageToken` |

No other YouTube APIs are used. No write operations of any kind are performed.

### 3.2 OAuth Scope

```
https://www.googleapis.com/auth/youtube.readonly
```

This is the minimum scope required to read live chat data. The application performs no writes against the YouTube API.

### 3.3 Authentication Model

- OAuth2 Desktop application flow.
- One-time interactive consent during initial setup performed by the operator (the channel owner — the only user of this client).
- Resulting refresh token stored locally in a gitignored file (`token.json`) on the operator's machine.
- Access tokens minted from the refresh token automatically before each stream session.
- No tokens transmitted off the operator's machine. No tokens shared with any third party.
- No end-users (stream viewers) ever authenticate with the application.

### 3.4 Quota Calculation

| Source | Units |
|---|---|
| `liveChatMessages.list` per call | 1 |
| Calls per minute @ 5s polling | 12 |
| Calls per 2-hour stream | 1,440 |
| Setup calls (`channels.list`, `liveBroadcasts.list`) per session | ~6 |
| **Steady-state daily usage (1 production stream/day)** | **~1,500** |
| Development testing buffer (5 sessions/day during build) | ~7,500 |
| Retry/burst headroom (2×) | — |
| **Daily target (production + dev peak)** | **~20,000** |
| **Requested quota** | **50,000** |

---

## 4. Data Model & Storage

All data is stored locally in a SQLite database file on the operator's machine. No data is stored in any cloud database or transmitted off the local machine (other than the original API calls to Google's own servers).

### 4.1 Schema

```sql
CREATE TABLE puzzles (
  id          INTEGER PRIMARY KEY,
  category    TEXT NOT NULL,
  emojis      TEXT NOT NULL,
  answer      TEXT NOT NULL,
  aliases     TEXT,                    -- Legacy puzzle metadata; ignored by matcher
  difficulty  INTEGER,
  last_used   INTEGER,                 -- Unix timestamp
  use_count   INTEGER DEFAULT 0
);

CREATE TABLE scores (
  user_id      TEXT,                   -- YouTube channel ID of chatter (public)
  user_handle  TEXT,                   -- Display name shown in chat (public)
  session_id   TEXT,
  round_id     TEXT,
  points       INTEGER,
  timestamp    INTEGER
);

CREATE TABLE api_usage_events (
  source       TEXT,                   -- YouTube endpoint estimate source
  units        INTEGER,
  timestamp    INTEGER,
  detail       TEXT
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  started_at    INTEGER,
  ended_at      INTEGER,
  total_rounds  INTEGER
);
```

### 4.2 Per-Chatter Data Stored

Only the following fields are persisted per chatter, and only when they earn points:

- YouTube channel ID (public)
- Display name as shown in live chat (public)
- Score totals derived from gameplay events

Chat message **text content is not persisted**. Messages are evaluated by the matcher in memory; correct guesses become score deltas; the raw message text is discarded.

### 4.3 Retention

| Data | Retention |
|---|---|
| Session leaderboard | Duration of the live broadcast (~2 hours) |
| Weekly leaderboard | 7-day rolling window; older entries purged automatically |
| Sessions metadata | 4 weeks maximum |
| Chat message text | Not retained (in-memory evaluation only) |

**No data retained beyond 4 weeks.** No all-time leaderboard in v1.

---

## 5. Privacy & Compliance

- All authenticated data remains on the operator's local machine. Nothing is uploaded to third-party servers.
- No data is sold, leased, transferred to advertisers, or used for any commercial purpose.
- The application uses the minimum OAuth scope required (`youtube.readonly`).
- Only public chat data is read; no private user data is accessed.
- Only the operator (channel owner) authenticates. No end-user authentication flow exists.
- Compliant with the YouTube API Services Terms of Service and Developer Policies.

---

## 6. Technical Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 22 + TypeScript |
| HTTP / WebSocket | Fastify + `ws` |
| YouTube API client | `googleapis` (official npm package) |
| Database | SQLite via `better-sqlite3` |
| Answer matching | Exact canonical answer, case-insensitive only |
| Validation | `zod` |
| Logging | `pino` (JSON output) |
| Overlay | Svelte + TypeScript (Vite) |
| Streaming software | OBS Studio (browser source → RTMPS) |
| Process management | PM2 (auto-restart) |

---

## 7. Operational Profile

- **Stream cadence:** one 2-hour scheduled live block per day. Not 24/7.
- **API activity outside stream windows:** none. The backend is idle and makes no API calls when no stream is active.
- **Failure handling:** PM2 auto-restarts the backend on crash; the system reconnects to YouTube and resumes mid-stream.
- **Credentials handling:** OAuth client secret and refresh token both gitignored; never committed to source control.

---

## 8. Repository

Source code: [https://github.com/korket/Emoguessr](https://github.com/korket/Emoguessr)

This design document lives at: [https://github.com/korket/Emoguessr/blob/main/DESIGN.md](https://github.com/korket/Emoguessr/blob/main/DESIGN.md)
