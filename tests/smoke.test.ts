import { describe, it, expect } from 'vitest';
import { GameEvent, Phase } from '../src/types/events';

describe('scaffold smoke', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('event schema validates a phase_change event', () => {
    const result = GameEvent.safeParse({
      type: 'phase_change',
      phase: 'SCORING_WINDOW',
      remainingMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('event schema rejects an invalid event', () => {
    const result = GameEvent.safeParse({
      type: 'phase_change',
      phase: 'NOT_A_REAL_PHASE',
      remainingMs: 5000,
    });
    expect(result.success).toBe(false);
  });

  it('Phase enum includes RESOLVE', () => {
    expect(Phase.options).toContain('RESOLVE');
  });
});
