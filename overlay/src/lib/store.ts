import { writable } from 'svelte/store';
import type { GameEvent } from '@shared/types/events';
import { playSfx } from './sfx';

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
  id: number;
  userHandle: string;
  points: number;
  rank: number;
}

export interface InterRoundDisplay {
  answer: string;
  winners: Array<{ userHandle: string; points: number }>;
  nextRoundAt: number;
}

export interface SessionEndDisplay {
  leaderboard: Array<{ userHandle: string; points: number }>;
}

let _flashId = 0;

export const round = writable<RoundDisplay | null>(null);
export const timer = writable<TimerState | null>(null);
export const hint = writable<string | null>(null);
export const hintTemplate = writable<string | null>(null);
export const leaderboard = writable<LeaderboardEntry[]>([]);
export const weeklyLeaderboard = writable<LeaderboardEntry[]>([]);
export const roundEndAnswer = writable<string | null>(null);
export const recentWinners = writable<WinnerFlash[]>([]);
export const connected = writable(false);
export const preGame = writable<{ startsAt: number } | null>(null);
export const interRound = writable<InterRoundDisplay | null>(null);
export const sessionEnd = writable<SessionEndDisplay | null>(null);

function applyEvent(event: GameEvent): void {
  switch (event.type) {
    case 'pre_game':
      preGame.set({ startsAt: event.startsAt });
      interRound.set(null);
      sessionEnd.set(null);
      break;
    case 'puzzle_reveal':
      preGame.set(null);
      interRound.set(null);
      round.set({ roundNumber: event.roundNumber, category: event.category, emojis: event.emojis });
      hint.set(null);
      hintTemplate.set(event.hintTemplate);
      roundEndAnswer.set(null);
      recentWinners.set([]);
      playSfx('round_start.mp3');
      break;
    case 'phase_change':
      timer.set({ phase: event.phase, remainingMs: event.remainingMs, updatedAt: Date.now() });
      if (event.phase === 'OPEN_GUESSING') playSfx('phase_change.mp3');
      break;
    case 'hint_reveal':
      hint.set(event.revealedLetters);
      playSfx('hint_reveal.mp3');
      break;
    case 'correct_guess': {
      const id = ++_flashId;
      recentWinners.update((ws) => [...ws, { id, userHandle: event.userHandle, points: event.points, rank: event.rank }]);
      setTimeout(() => {
        recentWinners.update((ws) => ws.filter((w) => w.id !== id));
      }, 3_000);
      playSfx('correct_guess.mp3');
      break;
    }
    case 'round_end':
      roundEndAnswer.set(event.answer);
      if (event.winners.length === 0) playSfx('round_end.mp3');
      break;
    case 'inter_round':
      setTimeout(() => {
        interRound.set({ answer: event.answer, winners: event.winners, nextRoundAt: event.nextRoundAt });
      }, 3_000);
      break;
    case 'leaderboard_update':
      leaderboard.set(event.session);
      weeklyLeaderboard.set(event.weekly);
      break;
    case 'session_end':
      sessionEnd.set({ leaderboard: event.leaderboard });
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
