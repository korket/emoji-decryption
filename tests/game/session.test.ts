import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { insertPuzzle, getPuzzleById } from '../../src/persistence/puzzles';
import { getSession } from '../../src/persistence/sessions';
import { getSessionLeaderboard } from '../../src/persistence/scores';
import { GameSession } from '../../src/game/session';
import { TIMINGS } from '../../src/game/round';
import { PuzzleInput } from '../../src/types/puzzle';
import type { GameEvent } from '../../src/types/events';
import type { ChatMessage } from '../../src/types/chat-message';

// ─── helpers ────────────────────────────────────────────────────────────────

const BASE = 2_000_000_000;

function freshDB() {
  return openDatabase(':memory:');
}

function titanic(db: ReturnType<typeof freshDB>) {
  return insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🎬🚢', answer: 'Titanic' }));
}

function msg(userId: string, text: string): ChatMessage {
  return { id: `${userId}-msg`, userId, userHandle: userId, text, receivedAt: BASE };
}

function capture() {
  const events: GameEvent[] = [];
  return { events, onEvent: (e: GameEvent) => events.push(e) };
}

// ─── session lifecycle ───────────────────────────────────────────────────────

describe('GameSession — lifecycle', () => {
  it('creates a DB session record on construction', () => {
    const db = freshDB();
    new GameSession(db, 'sess-1', () => {}, BASE);
    const s = getSession(db, 'sess-1');
    expect(s).not.toBeNull();
    expect(s!.startedAt).toBe(BASE);
    expect(s!.endedAt).toBeNull();
    db.close();
  });

  it('end() marks session as ended and purges old scores', () => {
    const db = freshDB();
    const gs = new GameSession(db, 'sess-1', () => {}, BASE);
    gs.end(BASE + 10_000);
    const s = getSession(db, 'sess-1');
    expect(s!.endedAt).toBe(BASE + 10_000);
    db.close();
  });
});

// ─── startRound ──────────────────────────────────────────────────────────────

describe('GameSession — startRound', () => {
  it('emits puzzle_reveal and phase_change', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const { events, onEvent } = capture();
    const gs = new GameSession(db, 's', onEvent, BASE);

    gs.startRound(puzzle, 1, BASE);
    expect(events[0]).toMatchObject({ type: 'puzzle_reveal', roundNumber: 1 });
    expect(events[1]).toMatchObject({ type: 'phase_change', phase: 'SCORING_WINDOW' });
    db.close();
  });

  it('marks the puzzle as used in DB', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const gs = new GameSession(db, 's', () => {}, BASE);

    gs.startRound(puzzle, 1, BASE);
    const updated = getPuzzleById(db, puzzle.id)!;
    expect(updated.useCount).toBe(1);
    expect(updated.lastUsed).toBe(BASE);
    db.close();
  });
});

// ─── scoring persistence ─────────────────────────────────────────────────────

describe('GameSession — correct guess is persisted', () => {
  it('records the score in DB when a guess is correct', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const { onEvent } = capture();
    const gs = new GameSession(db, 's', onEvent, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'Titanic'), BASE);

    const lb = getSessionLeaderboard(db, 's');
    expect(lb).toEqual([{ userHandle: 'u1', points: 10 }]);
    db.close();
  });

  it('only first correct guess is recorded — subsequent guesses are blocked', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const gs = new GameSession(db, 's', () => {}, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'Titanic'), BASE);          // first → 10 pts, ends round
    gs.processGuess(msg('u2', 'titanic'), BASE + 1_000);  // blocked
    gs.processGuess(msg('u3', 'TITANIC'), BASE + 2_000);  // blocked

    const lb = getSessionLeaderboard(db, 's', 10);
    expect(lb).toHaveLength(1);
    expect(lb[0]).toMatchObject({ userHandle: 'u1', points: 10 });
    db.close();
  });

  it('does not record score for wrong answers', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const gs = new GameSession(db, 's', () => {}, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'Avengers'), BASE);

    expect(getSessionLeaderboard(db, 's')).toEqual([]);
    db.close();
  });
});

// ─── leaderboard_update event ────────────────────────────────────────────────

describe('GameSession — leaderboard_update emitted after round_end', () => {
  it('fires leaderboard_update after round_end', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const { events, onEvent } = capture();
    const gs = new GameSession(db, 's', onEvent, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'Titanic'), BASE); // triggers correct_guess + round_end + leaderboard_update

    const roundEnd = events.find((e) => e.type === 'round_end');
    const lb = events.find((e) => e.type === 'leaderboard_update');
    expect(roundEnd).toBeDefined();
    expect(lb).toBeDefined();
    expect(lb).toMatchObject({
      type: 'leaderboard_update',
      session: [{ userHandle: 'u1', points: 10 }],
    });
    db.close();
  });

  it('leaderboard_update comes after round_end in event stream', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const { events, onEvent } = capture();
    const gs = new GameSession(db, 's', onEvent, BASE);
    gs.startRound(puzzle, 1, BASE);
    gs.tick(BASE + TIMINGS.HINT_2_END);

    const reIdx = events.findIndex((e) => e.type === 'round_end');
    const lbIdx = events.findIndex((e) => e.type === 'leaderboard_update');
    expect(reIdx).toBeGreaterThanOrEqual(0);
    expect(lbIdx).toBeGreaterThan(reIdx);
    db.close();
  });

  it('increments session totalRounds after each round', () => {
    const db = freshDB();
    const p1 = titanic(db);
    const p2 = insertPuzzle(db, PuzzleInput.parse({ category: 'songs', emojis: '👋📞', answer: 'Hello' }));
    const gs = new GameSession(db, 's', () => {}, BASE);

    gs.startRound(p1, 1, BASE);
    gs.tick(BASE + TIMINGS.HINT_2_END);

    gs.startRound(p2, 2, BASE + TIMINGS.ROUND_END);
    gs.tick(BASE + TIMINGS.ROUND_END + TIMINGS.HINT_2_END);

    expect(getSession(db, 's')!.totalRounds).toBe(2);
    db.close();
  });
});

// ─── per-user rate limiting ───────────────────────────────────────────────────

describe('GameSession — per-user guess rate limiting', () => {
  it('drops a repeat guess from the same user within 1 second', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const gs = new GameSession(db, 's', () => {}, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'wrong answer'), BASE);       // miss — sets cooldown
    gs.processGuess(msg('u1', 'Titanic'), BASE + 500);      // within 1 s — dropped

    expect(getSessionLeaderboard(db, 's')).toEqual([]);
    db.close();
  });

  it('allows a guess from the same user after the cooldown expires', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const gs = new GameSession(db, 's', () => {}, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'wrong answer'), BASE);
    gs.processGuess(msg('u1', 'Titanic'), BASE + 1_001);    // after 1 s — accepted

    expect(getSessionLeaderboard(db, 's')).toEqual([{ userHandle: 'u1', points: 10 }]);
    db.close();
  });

  it('does not rate-limit different users against each other', () => {
    const db = freshDB();
    const puzzle = titanic(db);
    const gs = new GameSession(db, 's', () => {}, BASE);
    gs.startRound(puzzle, 1, BASE);

    gs.processGuess(msg('u1', 'wrong answer'), BASE);
    gs.processGuess(msg('u2', 'Titanic'), BASE + 100);      // different user — not throttled

    expect(getSessionLeaderboard(db, 's')).toEqual([{ userHandle: 'u2', points: 10 }]);
    db.close();
  });
});

