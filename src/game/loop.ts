import type { DB } from '../persistence/db';
import type { ChatMessage } from '../types/chat-message';
import type { GameEvent } from '../types/events';
import { GameSession } from './session';
import { pickWeightedRandomPuzzle } from '../persistence/puzzles';
import { TIMINGS } from './round';

const DEFAULT_INTER_ROUND_MS = TIMINGS.ROUND_END - TIMINGS.HINT_2_END; // 10 s

export interface GameLoopOptions {
  interRoundMs?: number;
  tickIntervalMs?: number;
}

export class GameLoop {
  private session: GameSession | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private roundNumber = 0;
  private active = false;

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
    const { tickIntervalMs = 250 } = this.options;
    this.tickTimer = setInterval(() => this.session!.tick(Date.now()), tickIntervalMs);
    this.startNextRound();
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
    return this.session?.getSnapshot(now) ?? [];
  }

  private startNextRound(): void {
    const puzzle = pickWeightedRandomPuzzle(this.db);
    if (!puzzle) { this.stop(); return; }
    this.roundNumber++;
    this.session!.startRound(puzzle, this.roundNumber, Date.now());
  }

  private handleEvent(event: GameEvent): void {
    this.onEvent(event);
    if (event.type === 'round_end') {
      const { interRoundMs = DEFAULT_INTER_ROUND_MS } = this.options;
      this.roundTimer = setTimeout(() => this.startNextRound(), interRoundMs);
    }
  }
}
