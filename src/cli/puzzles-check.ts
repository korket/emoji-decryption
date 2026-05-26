import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Category, PuzzleInput } from '../types/puzzle.js';

const SeedFile = z.array(PuzzleInput);

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'persistence',
  'seed',
  'puzzles.json',
);

const raw = fs.readFileSync(seedPath, 'utf-8');
const parsed = SeedFile.safeParse(JSON.parse(raw));

if (!parsed.success) {
  console.error('Puzzle seed file failed schema validation.');
  console.error(parsed.error.message);
  process.exit(1);
}

const puzzles = parsed.data;
const errors: string[] = [];
const warnings: string[] = [];
const answers = new Map<string, number[]>();
const categories = new Set<string>();

for (let i = 0; i < puzzles.length; i++) {
  const p = puzzles[i]!;
  const label = `#${i + 1} ${p.category} / ${p.answer}`;
  categories.add(p.category);

  if (p.emojis.length === 0) errors.push(`${label}: missing emojis`);
  if (p.answer.length === 0) errors.push(`${label}: missing answer`);
  if (p.answer !== p.answer.trim()) errors.push(`${label}: answer has leading/trailing whitespace`);
  if (/\s{2,}/.test(p.answer)) warnings.push(`${label}: answer contains repeated whitespace; strict matching requires viewers to type it exactly`);
  if (/[^\p{L}\p{N}\s]/u.test(p.answer)) warnings.push(`${label}: answer contains punctuation/symbols; strict matching requires them exactly`);
  if (/^(the|a|an)\s+/i.test(p.answer)) warnings.push(`${label}: leading article is required under strict matching`);

  const key = p.answer.toLowerCase();
  answers.set(key, [...(answers.get(key) ?? []), i + 1]);
}

for (const [answer, indexes] of answers) {
  if (indexes.length > 1) errors.push(`Duplicate answer "${answer}" at puzzle rows ${indexes.join(', ')}`);
}

for (const category of Category.options) {
  if (!categories.has(category)) errors.push(`Missing category: ${category}`);
}

console.log(`Checked ${puzzles.length} puzzles.`);
console.log(`Categories: ${[...categories].sort().join(', ')}`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);

if (errors.length > 0) {
  console.log('\nErrors:');
  for (const error of errors) console.log(`- ${error}`);
}

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const warning of warnings.slice(0, 100)) console.log(`- ${warning}`);
  if (warnings.length > 100) console.log(`- ...and ${warnings.length - 100} more warning(s)`);
}

if (errors.length > 0) process.exit(1);
