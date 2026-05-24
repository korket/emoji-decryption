import { z } from 'zod';

export const ChatMessage = z.object({
  id: z.string(),
  userId: z.string(),
  userHandle: z.string(),
  text: z.string(),
  receivedAt: z.number().int(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
