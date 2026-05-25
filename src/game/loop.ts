import type { DB } from '../persistence/db';
import type { ChatMessage } from '../types/chat-message';
import type { GameEvent } from '../types/events';
import type { LeaderboardEntry } from '../types/score';
import type { Category } from '../types/puzzle';
import { GameSession } from './session';
import { pickWeightedRandomPuzzle } from '../persistence/puzzles';
import { getSessionLeaderboard } from '../persistence/scores';
import { TIMINGS } from './round';

const DEFAULT_INTER_ROUND_MS = TIMINGS.ROUND_END - TIMINGS.HINT_2_END; // 10 s
const DEFAULT_MAX_ROUNDS = 10;

export interface GameLoopOptions {
  preGameMs?: number;
  interRoundMs?: number;
  tickIntervalMs?: number;
  maxRounds?: number;
}

const DEFAULT_PRE_GAME_MS = 0;

export class GameLoop {
  private session: GameSession | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private roundNumber = 0;
  private active = false;
  private preGameEndsAt: number | null = null;
  private interRoundSnapshot: GameEvent[] | null = null;
  private sessionEndLeaderboard: LeaderboardEntry[] | null = null;
  private sessionEndNextSessionAt: number | null = null;
  private lastCategory: Category | null = null;

  constructor(
    private readonly db: DB,
    private readonly sessionId: string,
    private readonly onEvent: (e: GameEvent) => void,
    private readonly options: GameLoopOptions = {},
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.session = new GameSession(this.db, this.sessionId, (e) => this.handleEvent(e), Date.now());
    const { preGameMs = DEFAULT_PRE_GAME_MS, tickIntervalMs = 250 } = this.options;
    this.tickTimer = setInterval(() => this.session!.tick(Date.now()), tickIntervalMs);
    if (preGameMs > 0) {
      this.preGameEndsAt = Date.now() + preGameMs;
      this.onEvent({ type: 'pre_game', startsAt: this.preGameEndsAt });
      this.roundTimer = setTimeout(() => {
        this.preGameEndsAt = null;
        this.startNextRound();
      }, preGameMs);
    } else {
      this.startNextRound();
    }
  }

  stop(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.roundTimer) { clearTimeout(this.roundTimer); this.roundTimer = null; }
    if (this.session) { this.session.end(Date.now()); this.session = null; }
    this.active = false;
  }

  processGuess(msg: ChatMessage, now: number): void {
    this.session?.processGuess(msg, now);
  }

  getStatus(): { sessionId: string; round: number; active: boolean } {
    return { sessionId: this.sessionId, round: this.roundNumber, active: this.active };
  }

  getSnapshot(now: number): GameEvent[] {
    if (this.sessionEndLeaderboard !== null) {
      return [{ type: 'session_end', leaderboard: this.sessionEndLeaderboard, nextSessionAt: this.sessionEndNextSessionAt ?? now }];
    }
    if (this.interRoundSnapshot !== null) return this.interRoundSnapshot;
    if (this.preGameEndsAt !== null && now < this.preGameEndsAt) {
      return [{ type: 'pre_game', startsAt: this.preGameEndsAt }];
    }
    return this.session?.getSnapshot(now) ?? [];
  }

  private startNextRound(): void {
    const { maxRounds = DEFAULT_MAX_ROUNDS } = this.options;
    if (this.roundNumber >= maxRounds) {
      const leaderboard = getSessionLeaderboard(this.db, this.sessionId);
      const nextSessionAt = Date.now();
      this.sessionEndLeaderboard = leaderboard;
      this.sessionEndNextSessionAt = nextSessionAt;
      this.interRoundSnapshot = null;
      this.onEvent({ type: 'session_end', leaderboard, nextSessionAt });
      this.stop();
      return;
    }
    const puzzle = pickWeightedRandomPuzzle(this.db,
      this.lastCategory !== null ? { excludeCategory: this.lastCategory } : {},
    );
    if (!puzzle) { this.stop(); return; }
    this.lastCategory = puzzle.category;
    this.interRoundSnapshot = null;
    this.roundNumber++;
    this.session!.startRound(puzzle, this.roundNumber, Date.now());
  }

  private handleEvent(event: GameEvent): void {
    this.onEvent(event);
    if (event.type === 'round_end') {
      const { interRoundMs = DEFAULT_INTER_ROUND_MS } = this.options;
      const nextRoundAt = Date.now() + interRoundMs;
      const interRoundEv: GameEvent = { type: 'inter_round', answer: event.answer, winners: event.winners, nextRoundAt };
      this.onEvent(interRoundEv);
      this.interRoundSnapshot = [
        ...(this.session?.getSnapshot(Date.now()) ?? []),
        interRoundEv,
      ];
      this.roundTimer = setTimeout(() => this.startNextRound(), interRoundMs);
    }
  }
}
