import { z } from 'zod';

export const Category = z.enum(['movies', 'songs', 'tv', 'idioms', 'foods', 'places', 'sports', 'videogames']);
export type Category = z.infer<typeof Category>;

export const PuzzleInput = z.object({
  category: Category,
  emojis: z.string().min(1),
  answer: z.string().min(1),
  difficulty: z.number().int().min(1).max(5).default(3),
});
export type PuzzleInput = z.infer<typeof PuzzleInput>;

export interface Puzzle {
  id: number;
  category: Category;
  emojis: string;
  answer: string;
  difficulty: number;
  lastUsed: number | null;
  useCount: number;
}
