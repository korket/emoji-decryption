import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { seedPuzzlesIfEmpty } from '../../src/persistence/seed';
import { getPuzzleCount, getAllPuzzles } from '../../src/persistence/puzzles';

describe('seedPuzzlesIfEmpty', () => {
  it('inserts all puzzles from the seed file into an empty DB', () => {
    const db = openDatabase(':memory:');
    const inserted = seedPuzzlesIfEmpty(db);
    expect(inserted).toBeGreaterThanOrEqual(50);
    expect(getPuzzleCount(db)).toBe(inserted);
    db.close();
  });

  it('does nothing on a non-empty DB', () => {
    const db = openDatabase(':memory:');
    const firstInsert = seedPuzzlesIfEmpty(db);
    const count = getPuzzleCount(db);
    const secondInsert = seedPuzzlesIfEmpty(db);
    expect(firstInsert).toBeGreaterThan(0);
    expect(secondInsert).toBe(0);
    expect(getPuzzleCount(db)).toBe(count);
    db.close();
  });

  it('seeds cover all categories', () => {
    const db = openDatabase(':memory:');
    seedPuzzlesIfEmpty(db);
    const categories = new Set(getAllPuzzles(db).map((p) => p.category));
    expect(categories).toEqual(new Set(['movies', 'songs', 'tv', 'idioms', 'foods', 'places', 'sports', 'videogames']));
    db.close();
  });
});
