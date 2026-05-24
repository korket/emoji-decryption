import { describe, it, expect } from 'vitest';
import {
  TIMINGS,
  computePhase,
  computePoints,
  generateHint,
  RoundEngine,
} from '../../src/game/round';
import type { GameEvent } from '../../src/types/events';
import type { Puzzle } from '../../src/types/puzzle';
import type { ChatMessage } from '../../src/types/chat-message';

// ─── helpers ────────────────────────────────────────────────────────────────

const BASE = 1_000_000; // arbitrary epoch for "round starts at"

function puzzle(overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    id: 1, category: 'movies', emojis: '🎬🚢', answer: 'Titanic',
    aliases: [], difficulty: 3, lastUsed: null, useCount: 0,
    ...overrides,
  };
}

function msg(userId: string, text: string): ChatMessage {
  return { id: `${userId}-msg`, userId, userHandle: userId, text, receivedAt: 0 };
}

function capture(): { events: GameEvent[]; onEvent: (e: GameEvent) => void } {
  const events: GameEvent[] = [];
  return { events, onEvent: (e) => events.push(e) };
}

// ─── computePhase ────────────────────────────────────────────────────────────

describe('computePhase', () => {
  it('returns SCORING_WINDOW from t=0', () => {
    expect(computePhase(BASE, BASE)).toBe('SCORING_WINDOW');
    expect(computePhase(BASE, BASE + 9_999)).toBe('SCORING_WINDOW');
  });

  it('transitions to OPEN_GUESSING at 10 s', () => {
    expect(computePhase(BASE, BASE + TIMINGS.SCORING_WINDOW_END)).toBe('OPEN_GUESSING');
    expect(computePhase(BASE, BASE + 29_999)).toBe('OPEN_GUESSING');
  });

  it('transitions to HINT_1 at 30 s', () => {
    expect(computePhase(BASE, BASE + TIMINGS.OPEN_GUESSING_END)).toBe('HINT_1');
    expect(computePhase(BASE, BASE + 49_999)).toBe('HINT_1');
  });

  it('transitions to HINT_2 at 50 s', () => {
    expect(computePhase(BASE, BASE + TIMINGS.HINT_1_END)).toBe('HINT_2');
    expect(computePhase(BASE, BASE + 69_999)).toBe('HINT_2');
  });

  it('transitions to RESOLVE at 70 s', () => {
    expect(computePhase(BASE, BASE + TIMINGS.HINT_2_END)).toBe('RESOLVE');
    expect(computePhase(BASE, BASE + 200_000)).toBe('RESOLVE');
  });
});

// ─── computePoints ───────────────────────────────────────────────────────────

describe('computePoints — first winner', () => {
  it('earns 10 pts in the first 2 s', () => {
    expect(computePoints(0, true)).toBe(10);
    expect(computePoints(1_999, true)).toBe(10);
  });

  it('earns 8 pts at 2 s', () => {
    expect(computePoints(2_000, true)).toBe(8);
    expect(computePoints(3_999, true)).toBe(8);
  });

  it('earns 6 pts at 4 s', () => {
    expect(computePoints(4_000, true)).toBe(6);
  });

  it('earns 4 pts at 6 s', () => {
    expect(computePoints(6_000, true)).toBe(4);
  });

  it('earns 2 pts at 8 s (and stays 2 until window closes)', () => {
    expect(computePoints(8_000, true)).toBe(2);
    expect(computePoints(9_999, true)).toBe(2);
  });

  it('drops to 1 pt once the scoring window closes', () => {
    expect(computePoints(TIMINGS.SCORING_WINDOW_END, true)).toBe(1);
  });
});

describe('computePoints — all other guessers', () => {
  it('always earns 1 pt inside the round', () => {
    expect(computePoints(0, false)).toBe(1);
    expect(computePoints(5_000, false)).toBe(1);
    expect(computePoints(TIMINGS.OPEN_GUESSING_END, false)).toBe(1);
    expect(computePoints(TIMINGS.HINT_1_END, false)).toBe(1);
    expect(computePoints(TIMINGS.HINT_2_END - 1, false)).toBe(1);
  });

  it('earns 0 pts at RESOLVE', () => {
    expect(computePoints(TIMINGS.HINT_2_END, false)).toBe(0);
    expect(computePoints(TIMINGS.HINT_2_END, true)).toBe(0);
  });

  it('earns 0 pts for negative elapsed', () => {
    expect(computePoints(-1, false)).toBe(0);
    expect(computePoints(-1, true)).toBe(0);
  });
});

// ─── generateHint ────────────────────────────────────────────────────────────

describe('generateHint', () => {
  it('level 1: shows first letter, masks rest', () => {
    expect(generateHint('Titanic', 1)).toBe('T______');
    expect(generateHint('Up', 1)).toBe('U_');
  });

  it('level 2: shows first letter + even-indexed chars', () => {
    // T(0)i(1)t(2)a(3)n(4)i(5)c(6) → T_t_n_c
    expect(generateHint('Titanic', 2)).toBe('T_t_n_c');
  });

  it('preserves single-character words', () => {
    expect(generateHint('I Am Legend', 1)).toBe('I A_ L_____');
    expect(generateHint('I Am Legend', 2)).toBe('I A_ L_g_n_');
  });

  it('handles multi-word titles', () => {
    expect(generateHint('The Lion King', 1)).toBe('T__ L___ K___');
    // T(0)h(1)e(2)  L(0)i(1)o(2)n(3)  K(0)i(1)n(2)g(3)
    // lvl2: T_e  L_o_  K_n_
    expect(generateHint('The Lion King', 2)).toBe('T_e L_o_ K_n_');
  });

  it('handles two-character words correctly', () => {
    expect(generateHint('Up', 2)).toBe('U_');
    expect(generateHint('It', 2)).toBe('I_');
  });
});

// ─── RoundEngine ─────────────────────────────────────────────────────────────

describe('RoundEngine — start', () => {
  it('emits puzzle_reveal then phase_change(SCORING_WINDOW)', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'puzzle_reveal', roundNumber: 1, emojis: '🎬🚢' });
    expect(events[1]).toMatchObject({ type: 'phase_change', phase: 'SCORING_WINDOW', remainingMs: TIMINGS.SCORING_WINDOW_END });
  });
});

describe('RoundEngine — tick phase transitions', () => {
  it('emits OPEN_GUESSING at 10 s', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.tick(BASE + TIMINGS.SCORING_WINDOW_END);
    const pc = events.find((e) => e.type === 'phase_change');
    expect(pc).toMatchObject({ type: 'phase_change', phase: 'OPEN_GUESSING' });
  });

  it('emits HINT_1 phase_change + hint_reveal(1) at 30 s', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.tick(BASE + TIMINGS.OPEN_GUESSING_END);
    expect(events.some((e) => e.type === 'phase_change' && e.phase === 'HINT_1')).toBe(true);
    const hint = events.find((e) => e.type === 'hint_reveal');
    expect(hint).toMatchObject({ type: 'hint_reveal', hintIndex: 1, revealedLetters: 'T______' });
  });

  it('emits HINT_2 phase_change + hint_reveal(2) at 50 s', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.tick(BASE + TIMINGS.HINT_1_END);
    expect(events.some((e) => e.type === 'phase_change' && e.phase === 'HINT_2')).toBe(true);
    const hint = events.find((e) => e.type === 'hint_reveal' && e.hintIndex === 2);
    expect(hint).toMatchObject({ type: 'hint_reveal', hintIndex: 2, revealedLetters: 'T_t_n_c' });
  });

  it('emits RESOLVE phase_change + round_end at 70 s', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.tick(BASE + TIMINGS.HINT_2_END);
    expect(events.some((e) => e.type === 'phase_change' && e.phase === 'RESOLVE')).toBe(true);
    expect(events.some((e) => e.type === 'round_end')).toBe(true);
  });

  it('does not re-emit round_end on subsequent ticks', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);

    engine.tick(BASE + TIMINGS.HINT_2_END);
    engine.tick(BASE + TIMINGS.HINT_2_END + 5_000);
    expect(events.filter((e) => e.type === 'round_end')).toHaveLength(1);
  });

  it('emits both hints even if a tick jumps from SCORING_WINDOW to RESOLVE', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.tick(BASE + TIMINGS.HINT_2_END + 1_000); // jump straight to RESOLVE
    const hints = events.filter((e) => e.type === 'hint_reveal');
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatchObject({ hintIndex: 1 });
    expect(hints[1]).toMatchObject({ hintIndex: 2 });
  });
});

describe('RoundEngine — processGuess', () => {
  it('first correct answer at t=0 earns 10 pts', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.processGuess(msg('u1', 'Titanic'), BASE);
    expect(events[0]).toMatchObject({ type: 'correct_guess', userId: 'u1', points: 10, rank: 1 });
  });

  it('first correct answer at 5 s earns 6 pts', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.processGuess(msg('u1', 'Titanic'), BASE + 5_000);
    expect(events[0]).toMatchObject({ type: 'correct_guess', points: 6 });
  });

  it('second correct answer earns 1 pt with rank 2', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);

    engine.processGuess(msg('u1', 'Titanic'), BASE);
    events.length = 0;

    engine.processGuess(msg('u2', 'titanic'), BASE + 3_000);
    expect(events[0]).toMatchObject({ type: 'correct_guess', userId: 'u2', points: 1, rank: 2 });
  });

  it('deduplicates — same user cannot score twice', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);

    engine.processGuess(msg('u1', 'Titanic'), BASE);
    const before = events.length;
    engine.processGuess(msg('u1', 'Titanic'), BASE + 1_000);
    expect(events.length).toBe(before); // no new event
  });

  it('accepts fuzzy guess (single typo)', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.processGuess(msg('u1', 'Titatnic'), BASE); // transposed letters
    expect(events[0]).toMatchObject({ type: 'correct_guess' });
  });

  it('accepts alias', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle({ aliases: ['titanic ship'] }), 1, BASE);
    events.length = 0;

    engine.processGuess(msg('u1', 'titanic ship'), BASE);
    expect(events[0]).toMatchObject({ type: 'correct_guess' });
  });

  it('ignores wrong answers', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.processGuess(msg('u1', 'Avengers'), BASE);
    expect(events).toHaveLength(0);
  });

  it('ignores guesses during RESOLVE', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    events.length = 0;

    engine.processGuess(msg('u1', 'Titanic'), BASE + TIMINGS.HINT_2_END);
    expect(events.filter((e) => e.type === 'correct_guess')).toHaveLength(0);
  });

  it('ignores guesses when no round is active', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.processGuess(msg('u1', 'Titanic'), BASE);
    expect(events).toHaveLength(0);
  });
});

describe('RoundEngine — round_end winners', () => {
  it('round_end contains winners sorted by points desc', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);

    engine.processGuess(msg('u1', 'Titanic'), BASE);       // rank 1 → 10 pts
    engine.processGuess(msg('u2', 'titanic'), BASE + 1_000); // rank 2 → 1 pt
    engine.processGuess(msg('u3', 'titanic'), BASE + 2_000); // rank 3 → 1 pt

    engine.tick(BASE + TIMINGS.HINT_2_END);
    const re = events.find((e) => e.type === 'round_end');
    expect(re).toMatchObject({
      type: 'round_end',
      answer: 'Titanic',
      winners: [
        { userHandle: 'u1', points: 10 },
        { userHandle: 'u2', points: 1 },
        { userHandle: 'u3', points: 1 },
      ],
    });
  });

  it('round_end with no winners has empty winners array', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    engine.tick(BASE + TIMINGS.HINT_2_END);
    const re = events.find((e) => e.type === 'round_end');
    expect(re).toMatchObject({ type: 'round_end', winners: [] });
  });
});

describe('RoundEngine — reset', () => {
  it('ignores ticks and guesses after reset', () => {
    const { events, onEvent } = capture();
    const engine = new RoundEngine(onEvent);
    engine.start(puzzle(), 1, BASE);
    engine.reset();
    events.length = 0;

    engine.tick(BASE + TIMINGS.HINT_2_END);
    engine.processGuess(msg('u1', 'Titanic'), BASE);
    expect(events).toHaveLength(0);
  });
});
