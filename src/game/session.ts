import type { DB } from '../persistence/db';
import type { Puzzle } from '../types/puzzle';
import type { ChatMessage } from '../types/chat-message';
import type { GameEvent } from '../types/events';
import { RoundEngine } from './round';
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
    }

    if (event.type === 'round_end') {
      incrementSessionRounds(this.db, this.sessionId);
      const session = getSessionLeaderboard(this.db, this.sessionId);
      const weekly = getWeeklyLeaderboard(this.db, this.currentNow);
      this.onEvent({ type: 'leaderboard_update', session, weekly });
    }
  }
}
