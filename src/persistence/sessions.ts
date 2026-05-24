import type { DB } from './db';
import type { Session } from '../types/session';

interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  total_rounds: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    totalRounds: row.total_rounds,
  };
}

export function createSession(db: DB, id: string, now: number = Date.now()): Session {
  db.prepare(`
    INSERT INTO sessions (id, started_at, ended_at, total_rounds)
    VALUES (?, ?, NULL, 0)
  `).run(id, now);
  return { id, startedAt: now, endedAt: null, totalRounds: 0 };
}

export function endSession(db: DB, id: string, now: number = Date.now()): void {
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(now, id);
}

export function incrementSessionRounds(db: DB, id: string): void {
  db.prepare('UPDATE sessions SET total_rounds = total_rounds + 1 WHERE id = ?').run(id);
}

export function getSession(db: DB, id: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}
