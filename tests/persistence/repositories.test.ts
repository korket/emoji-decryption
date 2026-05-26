import { describe, it, expect } from 'vitest';
import { openDatabase, type DB } from '../../src/persistence/db';
import { PuzzleInput } from '../../src/types/puzzle';
import {
  insertPuzzle,
  getPuzzleById,
  getPuzzleCount,
  getAllPuzzles,
  pickWeightedRandomPuzzle,
  markPuzzleUsed,
  computePuzzleWeight,
} from '../../src/persistence/puzzles';
import {
  createSession,
  endSession,
  incrementSessionRounds,
  getSession,
} from '../../src/persistence/sessions';
import {
  recordScore,
  getSessionLeaderboard,
  getWeeklyLeaderboard,
} from '../../src/persistence/scores';

function fresh(): DB {
  return openDatabase(':memory:');
}

function seedAFewPuzzles(db: DB) {
  insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🦇👨', answer: 'Batman' }));
  insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🦁👑', answer: 'The Lion King' }));
  insertPuzzle(db, PuzzleInput.parse({ category: 'songs', emojis: '👋📞', answer: 'Hello' }));
}

describe('puzzles repo', () => {
  it('inserts and retrieves a puzzle with all fields', () => {
    const db = fresh();
    const inserted = insertPuzzle(
      db,
      PuzzleInput.parse({
        category: 'tv',
        emojis: '☕👯‍♀️🛋️',
        answer: 'Friends',
      }),
    );
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.category).toBe('tv');
    expect(inserted.answer).toBe('Friends');
    expect(inserted.difficulty).toBe(3);
    expect(inserted.lastUsed).toBeNull();
    expect(inserted.useCount).toBe(0);

    const fetched = getPuzzleById(db, inserted.id);
    expect(fetched).toEqual(inserted);
    db.close();
  });

  it('filters getAllPuzzles by category', () => {
    const db = fresh();
    seedAFewPuzzles(db);
    expect(getPuzzleCount(db)).toBe(3);
    expect(getAllPuzzles(db, 'movies')).toHaveLength(2);
    expect(getAllPuzzles(db, 'songs')).toHaveLength(1);
    expect(getAllPuzzles(db, 'foods')).toHaveLength(0);
    db.close();
  });

  it('markPuzzleUsed updates last_used and use_count', () => {
    const db = fresh();
    const p = insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🦇👨', answer: 'Batman' }));
    markPuzzleUsed(db, p.id, 1_000_000);
    markPuzzleUsed(db, p.id, 2_000_000);
    const updated = getPuzzleById(db, p.id)!;
    expect(updated.lastUsed).toBe(2_000_000);
    expect(updated.useCount).toBe(2);
    db.close();
  });
});

describe('computePuzzleWeight', () => {
  const now = 100_000_000_000;
  const HOUR = 60 * 60 * 1000;

  it('returns 1.0 for never-used puzzle', () => {
    expect(computePuzzleWeight(null, now)).toBe(1.0);
  });

  it('returns 0.1 within 24h', () => {
    expect(computePuzzleWeight(now - 12 * HOUR, now)).toBe(0.1);
  });

  it('returns 0.3 between 24h and 4 days', () => {
    expect(computePuzzleWeight(now - 2 * 24 * HOUR, now)).toBe(0.3);
  });

  it('returns 1.0 beyond 4 days', () => {
    expect(computePuzzleWeight(now - 10 * 24 * HOUR, now)).toBe(1.0);
  });
});

describe('pickWeightedRandomPuzzle', () => {
  it('returns null when pool is empty', () => {
    const db = fresh();
    expect(pickWeightedRandomPuzzle(db)).toBeNull();
    db.close();
  });

  it('picks the only available puzzle when there is one', () => {
    const db = fresh();
    const p = insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🦇👨', answer: 'Batman' }));
    const picked = pickWeightedRandomPuzzle(db);
    expect(picked?.id).toBe(p.id);
    db.close();
  });

  it('respects category filter', () => {
    const db = fresh();
    seedAFewPuzzles(db);
    for (let i = 0; i < 20; i++) {
      const picked = pickWeightedRandomPuzzle(db, { category: 'songs' });
      expect(picked?.category).toBe('songs');
    }
    db.close();
  });

  it('favors fresher puzzles via weighting', () => {
    const db = fresh();
    const stale = insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🦇👨', answer: 'Batman' }));
    const fresh2 = insertPuzzle(db, PuzzleInput.parse({ category: 'movies', emojis: '🦁👑', answer: 'The Lion King' }));
    const now = 100_000_000_000;
    markPuzzleUsed(db, stale.id, now - 1000);

    let staleCount = 0;
    let freshCount = 0;
    for (let i = 0; i < 1000; i++) {
      const picked = pickWeightedRandomPuzzle(db, { now });
      if (picked?.id === stale.id) staleCount++;
      else if (picked?.id === fresh2.id) freshCount++;
    }
    expect(freshCount).toBeGreaterThan(staleCount * 3);
    db.close();
  });
});

describe('sessions repo', () => {
  it('creates and ends a session', () => {
    const db = fresh();
    const s = createSession(db, 'sess-1', 1000);
    expect(s.startedAt).toBe(1000);
    expect(s.endedAt).toBeNull();
    expect(s.totalRounds).toBe(0);

    endSession(db, 'sess-1', 5000);
    const fetched = getSession(db, 'sess-1')!;
    expect(fetched.endedAt).toBe(5000);
    db.close();
  });

  it('increments rounds', () => {
    const db = fresh();
    createSession(db, 'sess-1', 1000);
    incrementSessionRounds(db, 'sess-1');
    incrementSessionRounds(db, 'sess-1');
    expect(getSession(db, 'sess-1')!.totalRounds).toBe(2);
    db.close();
  });

  it('returns null for unknown session', () => {
    const db = fresh();
    expect(getSession(db, 'nope')).toBeNull();
    db.close();
  });
});

describe('scores repo', () => {
  it('records a score', () => {
    const db = fresh();
    const s = recordScore(db, {
      userId: 'u1',
      userHandle: 'alice',
      sessionId: 'sess',
      roundId: 'r1',
      points: 10,
      timestamp: 1000,
    });
    expect(s.id).toBeGreaterThan(0);
  });

  it('session leaderboard sums points per user', () => {
    const db = fresh();
    recordScore(db, { userId: 'u1', userHandle: 'alice', sessionId: 's', roundId: 'r1', points: 10, timestamp: 1000 });
    recordScore(db, { userId: 'u1', userHandle: 'alice', sessionId: 's', roundId: 'r2', points: 8, timestamp: 2000 });
    recordScore(db, { userId: 'u2', userHandle: 'bob', sessionId: 's', roundId: 'r1', points: 6, timestamp: 1500 });
    const lb = getSessionLeaderboard(db, 's');
    expect(lb).toEqual([
      { userHandle: 'alice', points: 18 },
      { userHandle: 'bob', points: 6 },
    ]);
  });

  it('session leaderboard ignores scores from other sessions', () => {
    const db = fresh();
    recordScore(db, { userId: 'u1', userHandle: 'alice', sessionId: 'A', roundId: 'r1', points: 10, timestamp: 1000 });
    recordScore(db, { userId: 'u1', userHandle: 'alice', sessionId: 'B', roundId: 'r1', points: 99, timestamp: 1000 });
    const lb = getSessionLeaderboard(db, 'A');
    expect(lb).toEqual([{ userHandle: 'alice', points: 10 }]);
  });

  it('weekly leaderboard excludes entries older than 7 days', () => {
    const db = fresh();
    const now = 100_000_000_000;
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    recordScore(db, { userId: 'u1', userHandle: 'fresh', sessionId: 's', roundId: 'r', points: 5, timestamp: now - 1000 });
    recordScore(db, { userId: 'u2', userHandle: 'stale', sessionId: 's', roundId: 'r', points: 99, timestamp: now - WEEK - 1000 });
    const lb = getWeeklyLeaderboard(db, now);
    expect(lb).toEqual([{ userHandle: 'fresh', points: 5 }]);
  });

  it('respects limit', () => {
    const db = fresh();
    for (let i = 0; i < 10; i++) {
      recordScore(db, {
        userId: `u${i}`,
        userHandle: `user${i}`,
        sessionId: 's',
        roundId: `r${i}`,
        points: 10 - i,
        timestamp: 1000 + i,
      });
    }
    const lb = getSessionLeaderboard(db, 's', 3);
    expect(lb).toHaveLength(3);
    expect(lb[0]!.points).toBeGreaterThanOrEqual(lb[1]!.points);
  });
});
