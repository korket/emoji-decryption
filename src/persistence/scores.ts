import type { DB } from './db';
import type { Score, LeaderboardEntry } from '../types/score';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ScoreInput = Omit<Score, 'id'>;

export function recordScore(db: DB, input: ScoreInput): Score {
  const info = db.prepare(`
    INSERT INTO scores (user_id, user_handle, session_id, round_id, points, timestamp)
    VALUES (@userId, @userHandle, @sessionId, @roundId, @points, @timestamp)
  `).run(input);
  return { id: Number(info.lastInsertRowid), ...input };
}

export function getSessionLeaderboard(
  db: DB,
  sessionId: string,
  limit: number = 5,
): LeaderboardEntry[] {
  const rows = db.prepare(`
    SELECT user_handle AS userHandle, SUM(points) AS points
    FROM scores
    WHERE session_id = ?
    GROUP BY user_id
    ORDER BY points DESC, MIN(timestamp) ASC
    LIMIT ?
  `).all(sessionId, limit) as LeaderboardEntry[];
  return rows;
}

export function getWeeklyLeaderboard(
  db: DB,
  asOf: number = Date.now(),
  limit: number = 5,
): LeaderboardEntry[] {
  const since = asOf - WEEK_MS;
  const rows = db.prepare(`
    SELECT user_handle AS userHandle, SUM(points) AS points
    FROM scores
    WHERE timestamp >= ?
    GROUP BY user_id
    ORDER BY points DESC, MIN(timestamp) ASC
    LIMIT ?
  `).all(since, limit) as LeaderboardEntry[];
  return rows;
}

export function purgeOldScores(db: DB, olderThan: number = Date.now() - 4 * WEEK_MS): number {
  const info = db.prepare('DELETE FROM scores WHERE timestamp < ?').run(olderThan);
  return Number(info.changes);
}
