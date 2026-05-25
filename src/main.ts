import 'dotenv/config';
import { getAuthClient } from './youtube/auth.js';
import { findActiveBroadcast, ChatPoller } from './youtube/chat.js';
import { createServer } from './overlay-server/server.js';

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

const { fastify, processGuess, stopCurrentLoop } = await createServer({
  port:             envInt('PORT',             3000),
  maxRounds:        envInt('MAX_ROUNDS',       10),
  preGameMs:        envInt('PRE_GAME_MS',      20_000),
  interRoundMs:     envInt('INTER_ROUND_MS',   10_000),
  restartDelayMs:   envInt('RESTART_DELAY_MS', 30_000),
});

let poller: ChatPoller | null = null;
try {
  const auth = await getAuthClient();
  const { liveChatId } = await findActiveBroadcast(auth);
  poller = new ChatPoller(auth, liveChatId, (msg) => processGuess(msg, Date.now()));
  poller.start();
  console.log('Chat poller started. Game is live!\n');
} catch (err) {
  console.error('YouTube chat setup failed:', err instanceof Error ? err.message : String(err));
  console.error('Game is running without chat input.\n');
}

async function shutdown() {
  poller?.stop();
  stopCurrentLoop();
  await fastify.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
