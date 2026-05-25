export type MatchKind = 'exact' | 'alias' | 'none';

export interface MatchResult {
  kind: MatchKind;
  matchedAgainst: string | null;
}

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

const NO_MATCH: MatchResult = { kind: 'none', matchedAgainst: null };

export function matchAnswer(
  input: string,
  canonical: string,
  aliases: readonly string[] = [],
): MatchResult {
  const normalizedInput = normalize(input);
  if (normalizedInput.length === 0) return NO_MATCH;

  const canonicalNorm = normalize(canonical);
  const aliasNorms = aliases.map(normalize).filter((s) => s.length > 0);

  if (normalizedInput === canonicalNorm) {
    return { kind: 'exact', matchedAgainst: canonical };
  }
  for (let i = 0; i < aliases.length; i++) {
    if (normalizedInput === aliasNorms[i]) {
      return { kind: 'alias', matchedAgainst: aliases[i]! };
    }
  }

  return NO_MATCH;
}
