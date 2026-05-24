import { z } from 'zod';

export interface Score {
  id: number;
  userId: string;
  userHandle: string;
  sessionId: string;
  roundId: string;
  points: number;
  timestamp: number;
}

export const LeaderboardEntry = z.object({
  userHandle: z.string(),
  points: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;
