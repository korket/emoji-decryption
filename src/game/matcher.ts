import { distance } from 'fastest-levenshtein';

export type MatchKind = 'exact' | 'alias' | 'fuzzy' | 'none';

export interface MatchResult {
  kind: MatchKind;
  matchedAgainst: string | null;
  distance: number;
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

export function computeTolerance(normalizedLength: number): number {
  if (normalizedLength <= 3) return 0;
  if (normalizedLength <= 6) return 1;
  return 2;
}

const NO_MATCH: MatchResult = { kind: 'none', matchedAgainst: null, distance: Infinity };

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
    return { kind: 'exact', matchedAgainst: canonical, distance: 0 };
  }
  for (let i = 0; i < aliases.length; i++) {
    if (normalizedInput === aliasNorms[i]) {
      return { kind: 'alias', matchedAgainst: aliases[i]!, distance: 0 };
    }
  }

  const tolerance = computeTolerance(normalizedInput.length);
  if (tolerance === 0) return NO_MATCH;

  let bestDist = Infinity;
  let bestMatch: string | null = null;
  const targets: { original: string; normalized: string }[] = [
    { original: canonical, normalized: canonicalNorm },
    ...aliases.map((a, i) => ({ original: a, normalized: aliasNorms[i]! })),
  ];
  for (const t of targets) {
    if (t.normalized.length === 0) continue;
    const d = distance(normalizedInput, t.normalized);
    if (d < bestDist) {
      bestDist = d;
      bestMatch = t.original;
    }
  }

  if (bestDist <= tolerance && bestMatch !== null) {
    return { kind: 'fuzzy', matchedAgainst: bestMatch, distance: bestDist };
  }
  return { kind: 'none', matchedAgainst: null, distance: bestDist };
}
