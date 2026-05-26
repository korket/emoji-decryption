import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { insertPuzzle, getAllPuzzles, computePuzzleWeight, pickWeightedRandomPuzzle, markPuzzleUsed } from '../../src/persistence/puzzles';
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

  it('picks least-used puzzles before repeats', () => {
    const db = freshDB();
    const used1 = addPuzzle(db, 'movies', 'Used 1');
    const used2 = addPuzzle(db, 'songs', 'Used 2');
    const unused = addPuzzle(db, 'tv', 'Unused');
    markPuzzleUsed(db, used1.id, NOW);
    markPuzzleUsed(db, used2.id, NOW);

    for (let i = 0; i < 20; i++) {
      const result = pickWeightedRandomPuzzle(db, { now: NOW, random: () => i / 20 });
      expect(result?.id).toBe(unused.id);
    }
    db.close();
  });

  it('least-used priority overrides category exclusion', () => {
    const db = freshDB();
    const onlyUnused = addPuzzle(db, 'movies', 'Only Unused');
    const usedOtherCategory = addPuzzle(db, 'songs', 'Used Song');
    markPuzzleUsed(db, usedOtherCategory.id, NOW);

    const result = pickWeightedRandomPuzzle(db, { excludeCategory: 'movies' });

    expect(result?.id).toBe(onlyUnused.id);
    db.close();
  });

  it('favours less-recently-used puzzles within the same usage cycle', () => {
    const db = freshDB();
    const recent = addPuzzle(db, 'movies', 'Recent'); // weight 0.1 after marking used
    const old = addPuzzle(db, 'movies', 'Old');       // weight 1.0 after old use

    markPuzzleUsed(db, recent.id, NOW);
    markPuzzleUsed(db, old.id, NOW - 10 * DAY);

    // total = 0.1 + 1.0 = 1.1; r = 0.15 -> skips recent (0.1), lands on old
    const result = pickWeightedRandomPuzzle(db, { now: NOW, random: () => 0.15 / 1.1 });
    expect(result?.id).toBe(old.id);
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
