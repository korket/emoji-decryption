import { z } from 'zod';
import { Category } from './puzzle';
import { LeaderboardEntry } from './score';

export const Phase = z.enum([
  'REVEAL',
  'SCORING_WINDOW',
  'OPEN_GUESSING',
  'HINT_1',
  'HINT_2',
  'RESOLVE',
]);
export type Phase = z.infer<typeof Phase>;

const PuzzleRevealEvent = z.object({
  type: z.literal('puzzle_reveal'),
  roundNumber: z.number().int().positive(),
  category: Category,
  emojis: z.string(),
  hintTemplate: z.string(),
});

const PhaseChangeEvent = z.object({
  type: z.literal('phase_change'),
  phase: Phase,
  remainingMs: z.number().int().nonnegative(),
});

const CorrectGuessEvent = z.object({
  type: z.literal('correct_guess'),
  userId: z.string(),
  userHandle: z.string(),
  points: z.number().int().positive(),
  rank: z.number().int().positive(),
});

const HintRevealEvent = z.object({
  type: z.literal('hint_reveal'),
  hintIndex: z.union([z.literal(1), z.literal(2)]),
  revealedLetters: z.string(),
});

const RoundEndEvent = z.object({
  type: z.literal('round_end'),
  answer: z.string(),
  winners: z.array(
    z.object({
      userHandle: z.string(),
      points: z.number().int(),
    }),
  ),
});

const LeaderboardUpdateEvent = z.object({
  type: z.literal('leaderboard_update'),
  session: z.array(LeaderboardEntry).max(5),
  weekly: z.array(LeaderboardEntry).max(5),
});

const PreGameEvent = z.object({
  type: z.literal('pre_game'),
  startsAt: z.number().int(), // Unix ms timestamp when the first round begins
});

const InterRoundEvent = z.object({
  type: z.literal('inter_round'),
  answer: z.string(),
  winners: z.array(z.object({ userHandle: z.string(), points: z.number().int() })),
  nextRoundAt: z.number().int(), // Unix ms timestamp when the next round begins
});

export const GameEvent = z.discriminatedUnion('type', [
  PreGameEvent,
  PuzzleRevealEvent,
  PhaseChangeEvent,
  CorrectGuessEvent,
  HintRevealEvent,
  RoundEndEvent,
  LeaderboardUpdateEvent,
  InterRoundEvent,
]);
export type GameEvent = z.infer<typeof GameEvent>;

export type PreGameEvent = z.infer<typeof PreGameEvent>;
export type PuzzleRevealEvent = z.infer<typeof PuzzleRevealEvent>;
export type PhaseChangeEvent = z.infer<typeof PhaseChangeEvent>;
export type CorrectGuessEvent = z.infer<typeof CorrectGuessEvent>;
export type HintRevealEvent = z.infer<typeof HintRevealEvent>;
export type RoundEndEvent = z.infer<typeof RoundEndEvent>;
export type LeaderboardUpdateEvent = z.infer<typeof LeaderboardUpdateEvent>;
export type InterRoundEvent = z.infer<typeof InterRoundEvent>;
