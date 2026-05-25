import { describe, it, expect } from 'vitest';
import { normalize, matchAnswer } from '../../src/game/matcher';

describe('normalize', () => {
  it('lowercases', () => {
    expect(normalize('TITANIC')).toBe('titanic');
  });

  it('strips punctuation and exclamation', () => {
    expect(normalize('Titanic!!!')).toBe('titanic');
    expect(normalize("don't stop")).toBe('dont stop');
  });

  it('collapses internal whitespace', () => {
    expect(normalize('   Star    Wars  ')).toBe('star wars');
  });

  it('strips leading articles', () => {
    expect(normalize('The Lion King')).toBe('lion king');
    expect(normalize('A Goofy Movie')).toBe('goofy movie');
    expect(normalize('An Inconvenient Truth')).toBe('inconvenient truth');
  });

  it('does NOT strip articles in the middle', () => {
    expect(normalize('Pirates of the Caribbean')).toBe('pirates of the caribbean');
  });

  it('strips diacritics (despacito → despacito)', () => {
    expect(normalize('Despacíto')).toBe('despacito');
    expect(normalize('Pokémon')).toBe('pokemon');
  });

  it('keeps unicode letters and digits', () => {
    expect(normalize('Café 24')).toBe('cafe 24');
  });

  it('handles emoji and symbols by stripping them', () => {
    expect(normalize('🎬 Titanic 🚢')).toBe('titanic');
  });

  it('returns empty string for noise-only input', () => {
    expect(normalize('!!!???')).toBe('');
    expect(normalize('   ')).toBe('');
    expect(normalize('')).toBe('');
  });
});


describe('matchAnswer — exact', () => {
  it('matches canonical answer', () => {
    const r = matchAnswer('Titanic', 'Titanic');
    expect(r.kind).toBe('exact');
    expect(r.matchedAgainst).toBe('Titanic');
  });

  it('is case insensitive', () => {
    expect(matchAnswer('TITANIC', 'Titanic').kind).toBe('exact');
    expect(matchAnswer('titanic', 'Titanic').kind).toBe('exact');
  });

  it('strips leading article from input', () => {
    expect(matchAnswer('The Titanic', 'Titanic').kind).toBe('exact');
  });

  it('strips leading article from canonical', () => {
    expect(matchAnswer('Lion King', 'The Lion King').kind).toBe('exact');
  });

  it('ignores trailing punctuation', () => {
    expect(matchAnswer('Titanic!!!', 'Titanic').kind).toBe('exact');
    expect(matchAnswer('Titanic.', 'Titanic').kind).toBe('exact');
  });
});

describe('matchAnswer — alias', () => {
  it('matches an alias when input does not match the canonical', () => {
    const r = matchAnswer('lotr', 'The Lord of the Rings', ['lotr']);
    expect(r.kind).toBe('alias');
    expect(r.matchedAgainst).toBe('lotr');
  });

  it('matches a GOT alias for Game of Thrones', () => {
    const r = matchAnswer('got', 'Game of Thrones', ['got']);
    expect(r.kind).toBe('alias');
    expect(r.matchedAgainst).toBe('got');
  });

  it('prefers canonical when input normalizes to canonical (punctuation stripped)', () => {
    const r = matchAnswer('Spider-Man', 'Spider-Man', ['spiderman']);
    expect(r.kind).toBe('exact');
  });
});

describe('matchAnswer — spelling errors rejected', () => {
  it('rejects a single typo', () => {
    expect(matchAnswer('Titatnic', 'Titanic').kind).toBe('none');
    expect(matchAnswer('muana', 'Moana').kind).toBe('none');
  });

  it('rejects multiple typos', () => {
    expect(matchAnswer('Stairwy to Heavn', 'Stairway to Heaven').kind).toBe('none');
  });

  it('rejects any typo on short answers', () => {
    expect(matchAnswer('jasw', 'Jaws').kind).toBe('none');
    expect(matchAnswer('Op', 'Up').kind).toBe('none');
  });
});

describe('matchAnswer — no match', () => {
  it('rejects empty input', () => {
    expect(matchAnswer('', 'Titanic').kind).toBe('none');
    expect(matchAnswer('   ', 'Titanic').kind).toBe('none');
    expect(matchAnswer('!!!', 'Titanic').kind).toBe('none');
  });

  it('rejects unrelated words', () => {
    expect(matchAnswer('Hamburger', 'Titanic').kind).toBe('none');
  });

  it('rejects substrings (no partial matching)', () => {
    expect(matchAnswer('Nemo', 'Finding Nemo').kind).toBe('none');
    expect(matchAnswer('titanic of course', 'Titanic').kind).toBe('none');
  });
});

describe('matchAnswer — edge cases', () => {
  it('handles canonical containing punctuation', () => {
    expect(matchAnswer("Don't put eggs in one basket", "Don't put eggs in one basket").kind).toBe('exact');
    expect(matchAnswer('dont put eggs in one basket', "Don't put eggs in one basket").kind).toBe('exact');
  });

  it('handles diacritics in both input and canonical', () => {
    expect(matchAnswer('despacito', 'Despacíto').kind).toBe('exact');
    expect(matchAnswer('Pokemon', 'Pokémon').kind).toBe('exact');
  });

  it('skips empty aliases gracefully', () => {
    const r = matchAnswer('batman', 'Batman', ['', '   ']);
    expect(r.kind).toBe('exact');
  });
});
