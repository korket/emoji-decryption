import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PuzzleInput } from '../types/puzzle';
import type { DB } from './db';
import { getPuzzleCount, insertPuzzle } from './puzzles';

const SeedFile = z.array(PuzzleInput);

const DEFAULT_SEED_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'seed',
  'puzzles.json',
);

export function seedPuzzlesIfEmpty(db: DB, seedPath: string = DEFAULT_SEED_PATH): number {
  if (getPuzzleCount(db) > 0) return 0;
  const raw = fs.readFileSync(seedPath, 'utf-8');
  const parsed = SeedFile.parse(JSON.parse(raw));
  let inserted = 0;
  db.transaction(() => {
    for (const p of parsed) {
      insertPuzzle(db, p);
      inserted++;
    }
  })();
  return inserted;
}
