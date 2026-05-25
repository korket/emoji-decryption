import 'dotenv/config';
import type { Auth } from 'googleapis';
import type { ChatMessage } from './types/chat-message.js';
import { getAuthClient } from './youtube/auth.js';
import { findActiveBroadcast, ChatPoller } from './youtube/chat.js';
import { createServer } from './overlay-server/server.js';

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

let poller: ChatPoller | null = null;
let pendingChat: { auth: Auth.OAuth2Client; liveChatId: string } | null = null;
const chatEnabled = envBool('CHAT_ENABLED', true);

function stopChat(): void {
  poller?.stop();
  poller = null;
  pendingChat = null;
}

async function prepareChat(): Promise<void> {
  if (!chatEnabled) {
    console.warn('YouTube chat is disabled. Game will run without chat input.');
    return;
  }

  stopChat();
  const auth = await getAuthClient();
  const { liveChatId } = await findActiveBroadcast(auth);
  pendingChat = { auth, liveChatId };
}

function startPreparedChat(processGuess: (msg: ChatMessage, now: number) => void): void {
  if (!chatEnabled) return;
  if (pendingChat === null) throw new Error('YouTube chat was not prepared.');

  const { auth, liveChatId } = pendingChat;
  pendingChat = null;
  poller = new ChatPoller(auth, liveChatId, (msg) => processGuess(msg, Date.now()));
  poller.start();
  console.log('Chat poller started. Game is live!\n');
}

const { fastify, stopCurrentLoop } = await createServer({
  port:             envInt('PORT',             3000),
  maxRounds:        envInt('MAX_ROUNDS',       10),
  preGameMs:        envInt('PRE_GAME_MS',      20_000),
  interRoundMs:     envInt('INTER_ROUND_MS',   10_000),
  restartDelayMs:   envInt('RESTART_DELAY_MS', 10_000),
  autoStart:        envBool('AUTO_START',      false),
  beforeGameStart:  prepareChat,
  afterGameStart:   ({ processGuess }) => startPreparedChat(processGuess),
  onGameStop:       stopChat,
});

console.log('Backend ready. Game is idle until POST /game/start.\n');

async function shutdown() {
  stopChat();
  await stopCurrentLoop();
  await fastify.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
