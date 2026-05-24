import type { DB } from './db';

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE puzzles (
    id          INTEGER PRIMARY KEY,
    category    TEXT NOT NULL,
    emojis      TEXT NOT NULL,
    answer      TEXT NOT NULL,
    aliases     TEXT NOT NULL DEFAULT '[]',
    difficulty  INTEGER NOT NULL DEFAULT 3,
    last_used   INTEGER,
    use_count   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_puzzles_category  ON puzzles(category);
  CREATE INDEX idx_puzzles_last_used ON puzzles(last_used);

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    total_rounds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE scores (
    id          INTEGER PRIMARY KEY,
    user_id     TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    round_id    TEXT NOT NULL,
    points      INTEGER NOT NULL,
    timestamp   INTEGER NOT NULL
  );
  CREATE INDEX idx_scores_session   ON scores(session_id);
  CREATE INDEX idx_scores_timestamp ON scores(timestamp);
  CREATE INDEX idx_scores_user      ON scores(user_id);
  `,
];

export function runMigrations(db: DB): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i];
    if (!migration) continue;
    db.transaction(() => {
      db.exec(migration);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
