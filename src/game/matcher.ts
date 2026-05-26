export type MatchKind = 'exact' | 'none';

export interface MatchResult {
  kind: MatchKind;
  matchedAgainst: string | null;
}

export function normalize(input: string): string {
  return input.toLowerCase();
}

const NO_MATCH: MatchResult = { kind: 'none', matchedAgainst: null };

export function matchAnswer(
  input: string,
  canonical: string,
): MatchResult {
  const normalizedInput = normalize(input);
  const canonicalNorm = normalize(canonical);

  if (normalizedInput === canonicalNorm) {
    return { kind: 'exact', matchedAgainst: canonical };
  }

  return NO_MATCH;
}
