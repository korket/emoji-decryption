import type { Puzzle } from '../types/puzzle';
import type { ChatMessage } from '../types/chat-message';
import type { GameEvent, Phase } from '../types/events';
import { matchAnswer } from './matcher';

export const TIMINGS = {
  SCORING_WINDOW_END: 10_000,   // 0–10 s: first correct answer gets big points
  OPEN_GUESSING_END: 30_000,    // 10–30 s: anyone gets 1 pt; hint 1 revealed at 30 s
  HINT_1_END: 50_000,           // 30–50 s: hint 2 revealed at 50 s
  HINT_2_END: 70_000,           // 50–70 s: answer revealed (RESOLVE) at 70 s
  ROUND_END: 80_000,            // 80 s: round fully over
} as const;

export function computePhase(startedAt: number, now: number): Phase {
  const elapsed = now - startedAt;
  if (elapsed < TIMINGS.SCORING_WINDOW_END) return 'SCORING_WINDOW';
  if (elapsed < TIMINGS.OPEN_GUESSING_END) return 'OPEN_GUESSING';
  if (elapsed < TIMINGS.HINT_1_END) return 'HINT_1';
  if (elapsed < TIMINGS.HINT_2_END) return 'HINT_2';
  return 'RESOLVE';
}

// Only the first correct guesser earns big points (10/8/6/4/2 in 2-second buckets).
// Everyone else — and any guesser after the scoring window — earns 1 pt.
export function computePoints(elapsedMs: number, isFirstWinner: boolean): number {
  if (elapsedMs < 0 || elapsedMs >= TIMINGS.HINT_2_END) return 0;
  if (isFirstWinner && elapsedMs < TIMINGS.SCORING_WINDOW_END) {
    const bucket = Math.min(4, Math.floor(elapsedMs / 2_000));
    return 10 - bucket * 2; // 10, 8, 6, 4, 2
  }
  return 1;
}

// Mask letters for the overlay. Spaces and non-letter runs are preserved as-is.
// Level 1: only the first letter of each word is shown.
// Level 2: first letter + every even-indexed character (reveals ~half).
export function generateHint(answer: string, level: 1 | 2): string {
  return answer
    .split(' ')
    .map((word) => {
      if (word.length <= 1) return word;
      return word
        .split('')
        .map((ch, i) => {
          if (i === 0) return ch;
          if (level === 2 && i % 2 === 0) return ch;
          return '_';
        })
        .join('');
    })
    .join(' ');
}

interface GuesserRecord {
  userId: string;
  userHandle: string;
  points: number;
  rank: number;
}

export interface RoundState {
  puzzle: Puzzle;
  roundNumber: number;
  startedAt: number;
  guessers: GuesserRecord[];
}

function phaseRemainingMs(phase: Phase, startedAt: number, now: number): number {
  const end =
    phase === 'SCORING_WINDOW' ? startedAt + TIMINGS.SCORING_WINDOW_END
    : phase === 'OPEN_GUESSING' ? startedAt + TIMINGS.OPEN_GUESSING_END
    : phase === 'HINT_1' ? startedAt + TIMINGS.HINT_1_END
    : phase === 'HINT_2' ? startedAt + TIMINGS.HINT_2_END
    : startedAt + TIMINGS.ROUND_END; // RESOLVE / REVEAL
  return Math.max(0, end - now);
}

export class RoundEngine {
  private state: RoundState | null = null;
  private lastPhase: Phase | null = null;
  private hintEmitted = new Set<1 | 2>();
  private roundEndEmitted = false;

  constructor(private readonly onEvent: (e: GameEvent) => void) {}

  start(puzzle: Puzzle, roundNumber: number, now: number): void {
    this.state = { puzzle, roundNumber, startedAt: now, guessers: [] };
    this.lastPhase = 'SCORING_WINDOW';
    this.hintEmitted = new Set();
    this.roundEndEmitted = false;

    this.onEvent({ type: 'puzzle_reveal', roundNumber, category: puzzle.category, emojis: puzzle.emojis });
    this.onEvent({ type: 'phase_change', phase: 'SCORING_WINDOW', remainingMs: TIMINGS.SCORING_WINDOW_END });
  }

  // Drive phase transitions and hint/resolve events. Call from setInterval or fake timers in tests.
  tick(now: number): void {
    const s = this.state;
    if (!s) return;

    const elapsed = now - s.startedAt;
    const phase = computePhase(s.startedAt, now);

    if (phase !== this.lastPhase) {
      this.onEvent({ type: 'phase_change', phase, remainingMs: phaseRemainingMs(phase, s.startedAt, now) });
      this.lastPhase = phase;
    }

    if (elapsed >= TIMINGS.OPEN_GUESSING_END && !this.hintEmitted.has(1)) {
      this.hintEmitted.add(1);
      this.onEvent({ type: 'hint_reveal', hintIndex: 1, revealedLetters: generateHint(s.puzzle.answer, 1) });
    }

    if (elapsed >= TIMINGS.HINT_1_END && !this.hintEmitted.has(2)) {
      this.hintEmitted.add(2);
      this.onEvent({ type: 'hint_reveal', hintIndex: 2, revealedLetters: generateHint(s.puzzle.answer, 2) });
    }

    if (phase === 'RESOLVE' && !this.roundEndEmitted) {
      this.roundEndEmitted = true;
      const winners = [...s.guessers]
        .sort((a, b) => b.points - a.points)
        .map(({ userHandle, points }) => ({ userHandle, points }));
      this.onEvent({ type: 'round_end', answer: s.puzzle.answer, winners });
    }
  }

  processGuess(msg: ChatMessage, now: number): void {
    const s = this.state;
    if (!s) return;

    if (computePhase(s.startedAt, now) === 'RESOLVE') return;
    if (s.guessers.some((g) => g.userId === msg.userId)) return;

    const result = matchAnswer(msg.text, s.puzzle.answer, s.puzzle.aliases);
    if (result.kind === 'none') return;

    const isFirstWinner = s.guessers.length === 0;
    const elapsed = now - s.startedAt;
    const points = computePoints(elapsed, isFirstWinner);
    if (points === 0) return;

    const rank = s.guessers.length + 1;
    s.guessers.push({ userId: msg.userId, userHandle: msg.userHandle, points, rank });

    this.onEvent({ type: 'correct_guess', userId: msg.userId, userHandle: msg.userHandle, points, rank });
  }

  getState(): RoundState | null {
    return this.state;
  }

  reset(): void {
    this.state = null;
    this.lastPhase = null;
    this.hintEmitted = new Set();
    this.roundEndEmitted = false;
  }
}
