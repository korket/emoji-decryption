import type { DB } from './db';
import type { Puzzle, PuzzleInput, Category } from '../types/puzzle';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_PENALTY_WINDOW_MS = DAY_MS;
const COOLDOWN_WINDOW_MS = 4 * DAY_MS;

interface PuzzleRow {
  id: number;
  category: string;
  emojis: string;
  answer: string;
  difficulty: number;
  last_used: number | null;
  use_count: number;
}

function rowToPuzzle(row: PuzzleRow): Puzzle {
  return {
    id: row.id,
    category: row.category as Category,
    emojis: row.emojis,
    answer: row.answer,
    difficulty: row.difficulty,
    lastUsed: row.last_used,
    useCount: row.use_count,
  };
}

export function insertPuzzle(db: DB, input: PuzzleInput): Puzzle {
  const stmt = db.prepare(`
    INSERT INTO puzzles (category, emojis, answer, difficulty)
    VALUES (@category, @emojis, @answer, @difficulty)
  `);
  const info = stmt.run({
    category: input.category,
    emojis: input.emojis,
    answer: input.answer,
    difficulty: input.difficulty,
  });
  const id = Number(info.lastInsertRowid);
  return getPuzzleById(db, id)!;
}

export function getPuzzleById(db: DB, id: number): Puzzle | null {
  const row = db.prepare('SELECT * FROM puzzles WHERE id = ?').get(id) as PuzzleRow | undefined;
  return row ? rowToPuzzle(row) : null;
}

export function getPuzzleCount(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM puzzles').get() as { n: number };
  return row.n;
}

export function getAllPuzzles(db: DB, category?: Category): Puzzle[] {
  const rows = (
    category
      ? db.prepare('SELECT * FROM puzzles WHERE category = ?').all(category)
      : db.prepare('SELECT * FROM puzzles').all()
  ) as PuzzleRow[];
  return rows.map(rowToPuzzle);
}

export function computePuzzleWeight(lastUsed: number | null, now: number): number {
  if (lastUsed === null) return 1.0;
  const age = now - lastUsed;
  if (age < RECENT_PENALTY_WINDOW_MS) return 0.1;
  if (age < COOLDOWN_WINDOW_MS) return 0.3;
  return 1.0;
}

export interface PickPuzzleOptions {
  category?: Category;
  excludeCategory?: Category;
  now?: number;
  random?: () => number;
}

function getLeastUsedPool(pool: Puzzle[]): Puzzle[] {
  const minUseCount = Math.min(...pool.map((p) => p.useCount));
  return pool.filter((p) => p.useCount === minUseCount);
}

export function pickWeightedRandomPuzzle(db: DB, opts: PickPuzzleOptions = {}): Puzzle | null {
  const all = getAllPuzzles(db, opts.category);
  if (all.length === 0) return null;

  let pool = getLeastUsedPool(all);
  if (opts.excludeCategory) {
    const filtered = pool.filter((p) => p.category !== opts.excludeCategory);
    if (filtered.length > 0) pool = filtered;
  }
  const now = opts.now ?? Date.now();
  const random = opts.random ?? Math.random;
  const weights = pool.map((p) => computePuzzleWeight(p.lastUsed, now));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return pool[Math.floor(random() * pool.length)] ?? null;
  let r = random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!;
  }
  return pool[pool.length - 1] ?? null;
}

export function markPuzzleUsed(db: DB, id: number, now: number = Date.now()): void {
  db.prepare(`
    UPDATE puzzles
    SET last_used = ?, use_count = use_count + 1
    WHERE id = ?
  `).run(now, id);
}
