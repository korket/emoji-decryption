import type { DB } from '../persistence/db';
import type { Puzzle } from '../types/puzzle';
import type { ChatMessage } from '../types/chat-message';
import type { GameEvent } from '../types/events';
import { RoundEngine, computePhase, generateHint, generateBlankHint, phaseRemainingMs, TIMINGS } from './round';
import { markPuzzleUsed } from '../persistence/puzzles';
import { createSession, endSession, incrementSessionRounds } from '../persistence/sessions';
import {
  recordScore,
  getSessionLeaderboard,
  getWeeklyLeaderboard,
  purgeOldScores,
} from '../persistence/scores';

const FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000;

export class GameSession {
  private engine: RoundEngine;
  private currentNow = 0;
  private currentRoundId: string | null = null;

  constructor(
    private readonly db: DB,
    private readonly sessionId: string,
    private readonly onEvent: (e: GameEvent) => void,
    now: number,
  ) {
    createSession(db, sessionId, now);
    this.engine = new RoundEngine((event) => this.handleEvent(event));
  }

  startRound(puzzle: Puzzle, roundNumber: number, now: number): void {
    this.currentNow = now;
    this.currentRoundId = `${this.sessionId}:r${roundNumber}`;
    markPuzzleUsed(this.db, puzzle.id, now);
    this.engine.start(puzzle, roundNumber, now);
  }

  tick(now: number): void {
    this.currentNow = now;
    this.engine.tick(now);
  }

  processGuess(msg: ChatMessage, now: number): void {
    this.currentNow = now;
    this.engine.processGuess(msg, now);
  }

  end(now: number): void {
    endSession(this.db, this.sessionId, now);
    purgeOldScores(this.db, now - FOUR_WEEKS_MS);
  }

  getRoundState() {
    return this.engine.getState();
  }

  getSnapshot(now: number): GameEvent[] {
    const roundState = this.engine.getState();
    if (!roundState) return [];

    const { puzzle, roundNumber, startedAt, guessers } = roundState;
    const elapsed = now - startedAt;
    const phase = computePhase(startedAt, now);
    const events: GameEvent[] = [];

    events.push({ type: 'puzzle_reveal', roundNumber, category: puzzle.category, emojis: puzzle.emojis, hintTemplate: generateBlankHint(puzzle.answer) });
    events.push({ type: 'phase_change', phase, remainingMs: phaseRemainingMs(phase, startedAt, now) });

    if (elapsed >= TIMINGS.OPEN_GUESSING_END) {
      events.push({ type: 'hint_reveal', hintIndex: 1, revealedLetters: generateHint(puzzle.answer, 1) });
    }
    if (elapsed >= TIMINGS.HINT_1_END) {
      events.push({ type: 'hint_reveal', hintIndex: 2, revealedLetters: generateHint(puzzle.answer, 2) });
    }
    if (phase === 'RESOLVE') {
      const winners = [...guessers]
        .sort((a, b) => b.points - a.points)
        .map(({ userHandle, points }) => ({ userHandle, points }));
      events.push({ type: 'round_end', answer: puzzle.answer, winners });
    }

    events.push({
      type: 'leaderboard_update',
      session: getSessionLeaderboard(this.db, this.sessionId),
      weekly: getWeeklyLeaderboard(this.db, now),
    });

    return events;
  }

  private handleEvent(event: GameEvent): void {
    this.onEvent(event);

    if (event.type === 'correct_guess' && this.currentRoundId !== null) {
      recordScore(this.db, {
        userId: event.userId,
        userHandle: event.userHandle,
        sessionId: this.sessionId,
        roundId: this.currentRoundId,
        points: event.points,
        timestamp: this.currentNow,
      });
      const session = getSessionLeaderboard(this.db, this.sessionId);
      const weekly = getWeeklyLeaderboard(this.db, this.currentNow);
      this.onEvent({ type: 'leaderboard_update', session, weekly });
    }

    if (event.type === 'round_end') {
      incrementSessionRounds(this.db, this.sessionId);
      const session = getSessionLeaderboard(this.db, this.sessionId);
      const weekly = getWeeklyLeaderboard(this.db, this.currentNow);
      this.onEvent({ type: 'leaderboard_update', session, weekly });
    }
  }
}
