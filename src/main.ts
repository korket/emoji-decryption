import { getAuthClient } from './youtube/auth.js';
import { findActiveBroadcast, ChatPoller } from './youtube/chat.js';
import { createServer } from './overlay-server/server.js';

// Start the game server immediately so the overlay can connect
const { fastify, loop } = await createServer();

// YouTube chat setup — if this fails the game keeps running, just without chat input
let poller: ChatPoller | null = null;
try {
  const auth = await getAuthClient();
  const { liveChatId } = await findActiveBroadcast(auth);
  poller = new ChatPoller(auth, liveChatId, (msg) => {
    loop.processGuess(msg, Date.now());
  });
  poller.start();
  console.log('Chat poller started. Game is live!\n');
} catch (err) {
  console.error('YouTube chat setup failed:', err instanceof Error ? err.message : String(err));
  console.error('Game is running without chat input.\n');
}

async function shutdown() {
  poller?.stop();
  await fastify.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
