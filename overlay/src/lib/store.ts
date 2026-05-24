import { writable } from 'svelte/store';
import type { GameEvent } from '@shared/types/events';

export interface RoundDisplay {
  roundNumber: number;
  category: string;
  emojis: string;
}

export interface TimerState {
  phase: string;
  remainingMs: number;
  updatedAt: number; // client timestamp when the phase_change arrived
}

export interface LeaderboardEntry {
  userHandle: string;
  points: number;
}

export interface WinnerFlash {
  userHandle: string;
  points: number;
  rank: number;
}

export const round = writable<RoundDisplay | null>(null);
export const timer = writable<TimerState | null>(null);
export const hint = writable<string | null>(null);
export const leaderboard = writable<LeaderboardEntry[]>([]);
export const roundEndAnswer = writable<string | null>(null);
export const recentWinners = writable<WinnerFlash[]>([]);
export const connected = writable(false);

function applyEvent(event: GameEvent): void {
  switch (event.type) {
    case 'puzzle_reveal':
      round.set({ roundNumber: event.roundNumber, category: event.category, emojis: event.emojis });
      hint.set(null);
      roundEndAnswer.set(null);
      recentWinners.set([]);
      break;
    case 'phase_change':
      timer.set({ phase: event.phase, remainingMs: event.remainingMs, updatedAt: Date.now() });
      break;
    case 'hint_reveal':
      hint.set(event.revealedLetters);
      break;
    case 'correct_guess':
      recentWinners.update((ws) => [...ws, { userHandle: event.userHandle, points: event.points, rank: event.rank }]);
      break;
    case 'round_end':
      roundEndAnswer.set(event.answer);
      break;
    case 'leaderboard_update':
      leaderboard.set(event.session);
      break;
  }
}

export function connectWS(url = 'ws://localhost:3000/overlay'): () => void {
  let ws: WebSocket | null = null;
  let reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => connected.set(true);

    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as GameEvent;
        applyEvent(event);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      connected.set(false);
      if (!stopped) {
        reconnectHandle = setTimeout(connect, 2_000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectHandle !== null) clearTimeout(reconnectHandle);
    ws?.close();
  };
}
