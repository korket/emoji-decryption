import type { DB } from '../persistence/db';
import type { ChatMessage } from '../types/chat-message';
import type { GameEvent } from '../types/events';
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

const DEFAULT_PRE_GAME_MS = 20_000;

export class GameLoop {
  private session: GameSession | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private roundNumber = 0;
  private active = false;
  private preGameEndsAt: number | null = null;

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
    this.preGameEndsAt = Date.now() + preGameMs;
    this.onEvent({ type: 'pre_game', startsAt: this.preGameEndsAt });
    this.roundTimer = setTimeout(() => {
      this.preGameEndsAt = null;
      this.startNextRound();
    }, preGameMs);
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

  getSnapshot(now: number): GameEvent[] {
    if (this.preGameEndsAt !== null && now < this.preGameEndsAt) {
      return [{ type: 'pre_game', startsAt: this.preGameEndsAt }];
    }
    return this.session?.getSnapshot(now) ?? [];
  }

  private startNextRound(): void {
    const { maxRounds = DEFAULT_MAX_ROUNDS } = this.options;
    if (this.roundNumber >= maxRounds) {
      const leaderboard = getSessionLeaderboard(this.db, this.sessionId);
      this.onEvent({ type: 'session_end', leaderboard });
      this.stop();
      return;
    }
    const puzzle = pickWeightedRandomPuzzle(this.db);
    if (!puzzle) { this.stop(); return; }
    this.roundNumber++;
    this.session!.startRound(puzzle, this.roundNumber, Date.now());
  }

  private handleEvent(event: GameEvent): void {
    this.onEvent(event);
    if (event.type === 'round_end') {
      const { interRoundMs = DEFAULT_INTER_ROUND_MS } = this.options;
      const nextRoundAt = Date.now() + interRoundMs;
      this.onEvent({ type: 'inter_round', answer: event.answer, winners: event.winners, nextRoundAt });
      this.roundTimer = setTimeout(() => this.startNextRound(), interRoundMs);
    }
  }
}
