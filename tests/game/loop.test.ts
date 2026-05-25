import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { seedPuzzlesIfEmpty } from '../../src/persistence/seed';
import { GameLoop } from '../../src/game/loop';
import { TIMINGS } from '../../src/game/round';
import type { GameEvent } from '../../src/types/events';

// Small values so tests don't advance 70+ seconds per assertion
const PRE_GAME_MS = 100;
const INTER_ROUND_MS = 100;
const TICK_MS = 50;

// Advance enough time to complete N full rounds and reach session_end.
// Each round: HINT_2_END ms to trigger round_end + INTER_ROUND_MS to fire startNextRound.
// The pre-game adds PRE_GAME_MS up front.
function roundsMs(n: number): number {
  return PRE_GAME_MS + n * (TIMINGS.HINT_2_END + INTER_ROUND_MS);
}

function setup(maxRounds = 2) {
  const db = openDatabase(':memory:');
  seedPuzzlesIfEmpty(db);
  const events: GameEvent[] = [];
  const loop = new GameLoop(db, `test-session-${Math.random()}`, (e) => events.push(e), {
    preGameMs: PRE_GAME_MS,
    interRoundMs: INTER_ROUND_MS,
    tickIntervalMs: TICK_MS,
    maxRounds,
  });
  function cleanup() { loop.stop(); db.close(); }
  return { db, loop, events, cleanup };
}

describe('GameLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ─── startup ──────────────────────────────────────────────────────────────

  it('emits pre_game immediately on start', () => {
    const { loop, events, cleanup } = setup();
    loop.start();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'pre_game' });
    cleanup();
  });

  it('start() is idempotent — second call is a no-op', () => {
    const { loop, events, cleanup } = setup();
    loop.start();
    loop.start();
    expect(events).toHaveLength(1);
    cleanup();
  });

  it('starts round 1 after preGameMs elapses', () => {
    const { loop, events, cleanup } = setup();
    loop.start();
    vi.advanceTimersByTime(PRE_GAME_MS + TICK_MS);
    expect(events.some((e) => e.type === 'puzzle_reveal')).toBe(true);
    const reveal = events.find((e) => e.type === 'puzzle_reveal');
    expect(reveal).toMatchObject({ type: 'puzzle_reveal', roundNumber: 1 });
    cleanup();
  });

  // ─── snapshots ────────────────────────────────────────────────────────────

  it('snapshot during pre-game returns pre_game event', () => {
    const { loop, cleanup } = setup();
    loop.start();
    const snap = loop.getSnapshot(Date.now());
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ type: 'pre_game' });
    cleanup();
  });

  it('snapshot during a round includes puzzle_reveal', () => {
    const { loop, cleanup } = setup();
    loop.start();
    vi.advanceTimersByTime(PRE_GAME_MS + TICK_MS);
    const snap = loop.getSnapshot(Date.now());
    expect(snap.some((e) => e.type === 'puzzle_reveal')).toBe(true);
    cleanup();
  });

  it('snapshot during inter-round includes inter_round event', () => {
    const { loop, cleanup } = setup(2);
    loop.start();
    // Advance past round 1 but stop before inter-round timer fires
    vi.advanceTimersByTime(PRE_GAME_MS + TIMINGS.HINT_2_END + TICK_MS);
    const snap = loop.getSnapshot(Date.now());
    expect(snap.some((e) => e.type === 'inter_round')).toBe(true);
    cleanup();
  });

  it('snapshot after session ends returns session_end', () => {
    const { loop, cleanup } = setup(1);
    loop.start();
    vi.advanceTimersByTime(roundsMs(1) + TICK_MS);
    const snap = loop.getSnapshot(Date.now());
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ type: 'session_end' });
    cleanup();
  });

  // ─── round sequencing ─────────────────────────────────────────────────────

  it('emits inter_round after each round_end', () => {
    const { loop, events, cleanup } = setup(2);
    loop.start();
    vi.advanceTimersByTime(PRE_GAME_MS + TIMINGS.HINT_2_END + TICK_MS);
    expect(events.some((e) => e.type === 'inter_round')).toBe(true);
    cleanup();
  });

  it('emits session_end after maxRounds complete', () => {
    const { loop, events, cleanup } = setup(1);
    loop.start();
    vi.advanceTimersByTime(roundsMs(1) + TICK_MS);
    expect(events.some((e) => e.type === 'session_end')).toBe(true);
    cleanup();
  });

  it('runs exactly maxRounds puzzle_reveal events', () => {
    const { loop, events, cleanup } = setup(3);
    loop.start();
    vi.advanceTimersByTime(roundsMs(3) + TICK_MS);
    const reveals = events.filter((e) => e.type === 'puzzle_reveal');
    expect(reveals).toHaveLength(3);
    cleanup();
  });

  it('round numbers increment correctly', () => {
    const { loop, events, cleanup } = setup(3);
    loop.start();
    vi.advanceTimersByTime(roundsMs(3) + TICK_MS);
    const reveals = events
      .filter((e) => e.type === 'puzzle_reveal') as Extract<GameEvent, { type: 'puzzle_reveal' }>[];
    expect(reveals.map((e) => e.roundNumber)).toEqual([1, 2, 3]);
    cleanup();
  });

  // ─── category variety ─────────────────────────────────────────────────────

  it('never picks the same category in consecutive rounds', () => {
    const { loop, events, cleanup } = setup(6);
    loop.start();
    vi.advanceTimersByTime(roundsMs(6) + TICK_MS);
    const reveals = events
      .filter((e) => e.type === 'puzzle_reveal') as Extract<GameEvent, { type: 'puzzle_reveal' }>[];
    expect(reveals).toHaveLength(6);
    for (let i = 1; i < reveals.length; i++) {
      expect(reveals[i]!.category).not.toBe(reveals[i - 1]!.category);
    }
    cleanup();
  });

  // ─── getStatus ────────────────────────────────────────────────────────────

  it('getStatus reflects current state', () => {
    const { loop, cleanup } = setup(2);
    expect(loop.getStatus()).toMatchObject({ round: 0, active: false });
    loop.start();
    expect(loop.getStatus()).toMatchObject({ active: true });
    vi.advanceTimersByTime(PRE_GAME_MS + TICK_MS);
    expect(loop.getStatus()).toMatchObject({ round: 1, active: true });
    cleanup();
  });
});
