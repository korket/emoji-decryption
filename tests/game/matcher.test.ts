import { describe, it, expect } from 'vitest';
import { normalize, matchAnswer } from '../../src/game/matcher';

describe('normalize — strict case-insensitive matching only', () => {
  it('lowercases input', () => {
    expect(normalize('TITANIC')).toBe('titanic');
  });

  it('preserves punctuation, whitespace, articles, and diacritics', () => {
    expect(normalize('Titanic!!!')).toBe('titanic!!!');
    expect(normalize('  Star Wars  ')).toBe('  star wars  ');
    expect(normalize('The Matrix')).toBe('the matrix');
    expect(normalize('Pokémon')).toBe('pokémon');
  });
});

describe('matchAnswer — strict exact match except casing', () => {
  it('matches the canonical answer exactly', () => {
    const r = matchAnswer('Titanic', 'Titanic');
    expect(r.kind).toBe('exact');
    expect(r.matchedAgainst).toBe('Titanic');
  });

  it('is case-insensitive', () => {
    expect(matchAnswer('TITANIC', 'Titanic').kind).toBe('exact');
    expect(matchAnswer('titanic', 'Titanic').kind).toBe('exact');
  });

  it('does not trim or collapse whitespace', () => {
    expect(matchAnswer(' Titanic', 'Titanic').kind).toBe('none');
    expect(matchAnswer('Titanic ', 'Titanic').kind).toBe('none');
    expect(matchAnswer('Star  Wars', 'Star Wars').kind).toBe('none');
  });

  it('does not strip punctuation', () => {
    expect(matchAnswer('Titanic!!!', 'Titanic').kind).toBe('none');
    expect(matchAnswer('spiderman', 'Spider-Man').kind).toBe('none');
    expect(matchAnswer('spider man', 'Spider-Man').kind).toBe('none');
    expect(matchAnswer('spider-man', 'Spider-Man').kind).toBe('exact');
  });

  it('does not strip leading articles', () => {
    expect(matchAnswer('Matrix', 'The Matrix').kind).toBe('none');
    expect(matchAnswer('Lion King', 'The Lion King').kind).toBe('none');
  });

  it('does not normalize diacritics', () => {
    expect(matchAnswer('Pokemon', 'Pokémon').kind).toBe('none');
    expect(matchAnswer('pokémon', 'Pokémon').kind).toBe('exact');
  });

  it('does not match aliases', () => {
    expect(matchAnswer('lotr', 'The Lord of the Rings').kind).toBe('none');
  });

  it('rejects unrelated or partial input', () => {
    expect(matchAnswer('', 'Titanic').kind).toBe('none');
    expect(matchAnswer('Nemo', 'Finding Nemo').kind).toBe('none');
    expect(matchAnswer('titanic of course', 'Titanic').kind).toBe('none');
  });
});
