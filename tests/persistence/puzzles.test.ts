import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { insertPuzzle, getAllPuzzles, computePuzzleWeight, pickWeightedRandomPuzzle } from '../../src/persistence/puzzles';
import { PuzzleInput } from '../../src/types/puzzle';

const NOW = 2_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function freshDB() {
  return openDatabase(':memory:');
}

function addPuzzle(db: ReturnType<typeof freshDB>, category: 'movies' | 'songs' | 'tv', answer: string) {
  return insertPuzzle(db, PuzzleInput.parse({ category, emojis: '🎬', answer }));
}

// ─── computePuzzleWeight ──────────────────────────────────────────────────────

describe('computePuzzleWeight', () => {
  it('returns 1.0 for a never-used puzzle', () => {
    expect(computePuzzleWeight(null, NOW)).toBe(1.0);
  });

  it('returns 0.1 for a puzzle used within the last 24 hours', () => {
    expect(computePuzzleWeight(NOW - DAY + 1, NOW)).toBe(0.1);
    expect(computePuzzleWeight(NOW, NOW)).toBe(0.1);
  });

  it('returns 0.3 for a puzzle used 1–4 days ago', () => {
    expect(computePuzzleWeight(NOW - DAY, NOW)).toBe(0.3);
    expect(computePuzzleWeight(NOW - 3 * DAY, NOW)).toBe(0.3);
  });

  it('returns 1.0 for a puzzle used more than 4 days ago', () => {
    expect(computePuzzleWeight(NOW - 4 * DAY, NOW)).toBe(1.0);
    expect(computePuzzleWeight(NOW - 30 * DAY, NOW)).toBe(1.0);
  });
});

// ─── pickWeightedRandomPuzzle ─────────────────────────────────────────────────

describe('pickWeightedRandomPuzzle', () => {
  it('returns null for an empty pool', () => {
    const db = freshDB();
    expect(pickWeightedRandomPuzzle(db)).toBeNull();
    db.close();
  });

  it('returns the only puzzle when pool has one entry', () => {
    const db = freshDB();
    const p = addPuzzle(db, 'movies', 'Titanic');
    const result = pickWeightedRandomPuzzle(db);
    expect(result?.id).toBe(p.id);
    db.close();
  });

  it('excludeCategory filters out the given category', () => {
    const db = freshDB();
    addPuzzle(db, 'movies', 'Titanic');
    addPuzzle(db, 'movies', 'Inception');
    addPuzzle(db, 'songs', 'Hello');

    for (let i = 0; i < 20; i++) {
      const result = pickWeightedRandomPuzzle(db, { excludeCategory: 'movies' });
      expect(result?.category).toBe('songs');
    }
    db.close();
  });

  it('falls back to full pool when all puzzles are in the excluded category', () => {
    const db = freshDB();
    addPuzzle(db, 'movies', 'Titanic');
    addPuzzle(db, 'movies', 'Inception');

    const result = pickWeightedRandomPuzzle(db, { excludeCategory: 'movies' });
    expect(result).not.toBeNull();
    expect(result?.category).toBe('movies');
    db.close();
  });

  it('favours high-weight puzzles using a controlled random', () => {
    const db = freshDB();
    const recent = addPuzzle(db, 'movies', 'Recent');   // weight 0.1 after marking used
    const fresh  = addPuzzle(db, 'movies', 'Fresh');    // weight 1.0 (never used)

    // Mark 'Recent' as used just now
    db.prepare('UPDATE puzzles SET last_used = ? WHERE id = ?').run(NOW, recent.id);

    // A random value just below total weight picks 'Fresh' deterministically
    // total = 0.1 + 1.0 = 1.1; r = 0.15 → skips recent (0.1), lands on fresh
    const result = pickWeightedRandomPuzzle(db, { now: NOW, random: () => 0.15 / 1.1 });
    expect(result?.id).toBe(fresh.id);
    db.close();
  });

  it('respects the category filter alongside excludeCategory', () => {
    const db = freshDB();
    addPuzzle(db, 'movies', 'Titanic');
    addPuzzle(db, 'songs', 'Hello');
    addPuzzle(db, 'tv', 'Friends');

    const result = pickWeightedRandomPuzzle(db, { category: 'songs' });
    expect(result?.category).toBe('songs');
    db.close();
  });
});
