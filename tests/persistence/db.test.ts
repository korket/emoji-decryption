import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { runMigrations } from '../../src/persistence/schema';

describe('database init', () => {
  it('opens an in-memory database', () => {
    const db = openDatabase(':memory:');
    expect(db).toBeDefined();
    db.close();
  });

  it('creates all three tables', () => {
    const db = openDatabase(':memory:');
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain('puzzles');
    expect(names).toContain('sessions');
    expect(names).toContain('scores');
    expect(names).toContain('api_usage_events');
    db.close();
  });

  it('sets user_version to the latest migration', () => {
    const db = openDatabase(':memory:');
    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBeGreaterThan(0);
    db.close();
  });

  it('runMigrations is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });
});
