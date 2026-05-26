import 'dotenv/config';
import type { Auth } from 'googleapis';
import type { ChatMessage } from './types/chat-message.js';
import { openDatabase } from './persistence/db.js';
import { getTodayApiUsageSummary, recordApiUsage } from './persistence/api-usage.js';
import { getAuthClient } from './youtube/auth.js';
import { findActiveBroadcast, ChatPoller, type ChatPollerStatus } from './youtube/chat.js';
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
let pendingChat: { auth: Auth.OAuth2Client; liveChatId: string; broadcastId: string } | null = null;
const chatEnabled = envBool('CHAT_ENABLED', true);
const autoStart = envBool('AUTO_START', false);
const youtubeMinPollMs = envInt('YOUTUBE_MIN_POLL_MS', 5_000);
const dbPath = process.env.DB_PATH ?? './game.db';
const apiUsageDb = openDatabase(dbPath);

type YouTubeState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'ready'
  | 'starting'
  | 'connected'
  | 'stopped'
  | 'quota_exceeded'
  | 'auth_refreshing'
  | 'auth_failed'
  | 'forbidden'
  | 'ended'
  | 'retrying'
  | 'no_active_broadcast'
  | 'error';

interface YouTubeStatus {
  enabled: boolean;
  state: YouTubeState;
  message: string;
  updatedAt: number;
  checks: number;
  chatPolls: number;
  estimatedQuotaUnits: number;
  lastPollDelayMs?: number;
  broadcastId?: string;
  liveChatId?: string;
  httpStatus?: number;
  reason?: string;
}

let youtubeStatus: YouTubeStatus = {
  enabled: chatEnabled,
  state: chatEnabled ? 'idle' : 'disabled',
  message: chatEnabled ? 'YouTube chat is not connected yet.' : 'YouTube chat is disabled.',
  updatedAt: Date.now(),
  checks: 0,
  chatPolls: 0,
  estimatedQuotaUnits: 0,
};

function setYouTubeStatus(
  state: YouTubeState,
  message: string,
  extra: Partial<Omit<YouTubeStatus, 'enabled' | 'state' | 'message' | 'updatedAt'>> = {},
): void {
  youtubeStatus = { ...youtubeStatus, enabled: chatEnabled, state, message, updatedAt: Date.now(), ...extra };
}

function countYouTubeCall(kind: 'check' | 'chat_poll', extra: Partial<Pick<YouTubeStatus, 'lastPollDelayMs'>> = {}): void {
  const source = kind === 'check' ? 'youtube.liveBroadcasts.list' : 'youtube.liveChatMessages.list';
  try {
    recordApiUsage(apiUsageDb, { source });
  } catch (err) {
    console.warn('Failed to record API usage estimate:', err instanceof Error ? err.message : String(err));
  }

  youtubeStatus = {
    ...youtubeStatus,
    checks: youtubeStatus.checks + (kind === 'check' ? 1 : 0),
    chatPolls: youtubeStatus.chatPolls + (kind === 'chat_poll' ? 1 : 0),
    estimatedQuotaUnits: youtubeStatus.estimatedQuotaUnits + 1,
    updatedAt: Date.now(),
    ...extra,
  };
}

function classifyYouTubeError(
  err: unknown,
): Pick<YouTubeStatus, 'state' | 'message'> & Partial<Pick<YouTubeStatus, 'httpStatus' | 'reason'>> {
  type GaxiosLike = {
    response?: {
      status?: number;
      data?: { error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> } };
    };
  };

  const e = err as GaxiosLike;
  const httpStatus = e.response?.status;
  const reason = e.response?.data?.error?.errors?.[0]?.reason;
  const apiMessage = e.response?.data?.error?.message;
  const message = err instanceof Error ? err.message : apiMessage ?? String(err);

  const extra: Partial<Pick<YouTubeStatus, 'httpStatus' | 'reason'>> = {};
  if (httpStatus !== undefined) extra.httpStatus = httpStatus;
  if (reason !== undefined) extra.reason = reason;

  if (httpStatus === 403 && reason === 'quotaExceeded') {
    return { state: 'quota_exceeded', message: 'YouTube API quota exceeded. Wait for the daily quota reset or use another quota project.', ...extra };
  }
  if (httpStatus === 401) {
    return { state: 'auth_failed', message: 'YouTube authentication failed. Run npm run auth or delete token.json and re-authenticate.', ...extra };
  }
  if (httpStatus === 403) {
    return { state: 'forbidden', message: `YouTube API forbidden: ${reason ?? apiMessage ?? 'unknown reason'}.`, ...extra };
  }
  if (message.includes('No active live broadcast found')) {
    return { state: 'no_active_broadcast', message: 'YouTube API is reachable, but no active live broadcast was found.' };
  }

  return { state: 'error', message, ...extra };
}

function applyPollerStatus(status: ChatPollerStatus): void {
  const extra: Partial<Omit<YouTubeStatus, 'enabled' | 'state' | 'message' | 'updatedAt'>> = {};
  if (status.httpStatus !== undefined) extra.httpStatus = status.httpStatus;
  if (status.reason !== undefined) extra.reason = status.reason;
  if (youtubeStatus.broadcastId !== undefined) extra.broadcastId = youtubeStatus.broadcastId;
  if (youtubeStatus.liveChatId !== undefined) extra.liveChatId = youtubeStatus.liveChatId;
  setYouTubeStatus(status.state, status.message, extra);
}

function stopChat(updateStatus = true): void {
  poller?.stop();
  poller = null;
  pendingChat = null;
  if (updateStatus) {
    setYouTubeStatus(
      chatEnabled ? 'stopped' : 'disabled',
      chatEnabled ? 'YouTube chat is stopped.' : 'YouTube chat is disabled.',
    );
  }
}

async function checkYouTube(storePendingChat = false): Promise<{ youtube: YouTubeStatus }> {
  if (!chatEnabled) {
    setYouTubeStatus('disabled', 'YouTube chat is disabled.');
    return { youtube: youtubeStatus };
  }

  setYouTubeStatus('checking', 'Checking YouTube API, auth, quota, and active live broadcast...');
  try {
    const auth = await getAuthClient();
    countYouTubeCall('check');
    const { broadcastId, liveChatId } = await findActiveBroadcast(auth);
    if (storePendingChat) pendingChat = { auth, broadcastId, liveChatId };
    setYouTubeStatus('ready', 'YouTube API connected. Active live chat found.', { broadcastId, liveChatId });
  } catch (err) {
    const status = classifyYouTubeError(err);
    const { state, message, ...extra } = status;
    setYouTubeStatus(state, message, extra);
  }

  return { youtube: youtubeStatus };
}

async function prepareChat(): Promise<void> {
  if (!chatEnabled) {
    console.warn('YouTube chat is disabled. Game will run without chat input.');
    setYouTubeStatus('disabled', 'YouTube chat is disabled. Game will run without chat input.');
    return;
  }

  stopChat(false);
  const { youtube } = await checkYouTube(true);
  if (youtube.state !== 'ready') {
    throw new Error(youtube.message);
  }
}

function startPreparedChat(processGuess: (msg: ChatMessage, now: number) => void): void {
  if (!chatEnabled) return;
  if (pendingChat === null) throw new Error('YouTube chat was not prepared.');

  const { auth, liveChatId, broadcastId } = pendingChat;
  pendingChat = null;
  setYouTubeStatus('starting', 'Starting YouTube live chat poller.', { broadcastId, liveChatId });
  poller = new ChatPoller(
    auth,
    liveChatId,
    (msg) => processGuess(msg, msg.receivedAt),
    applyPollerStatus,
    youtubeMinPollMs,
    (lastPollDelayMs) => countYouTubeCall('chat_poll', { lastPollDelayMs }),
  );
  poller.start();
  console.log('Chat poller started. Game is live!\n');
}

const { fastify, stopCurrentLoop } = await createServer({
  port:             envInt('PORT',             3000),
  dbPath,
  maxRounds:        envInt('MAX_ROUNDS',       10),
  preGameMs:        envInt('PRE_GAME_MS',      20_000),
  interRoundMs:     envInt('INTER_ROUND_MS',   10_000),
  restartDelayMs:   envInt('RESTART_DELAY_MS', 10_000),
  autoStart,
  beforeGameStart:  prepareChat,
  afterGameStart:   ({ processGuess }) => startPreparedChat(processGuess),
  onGameStop:       stopChat,
  getHealth:        () => ({ youtube: youtubeStatus, apiUsage: getTodayApiUsageSummary(apiUsageDb) }),
  checkYouTube:      () => checkYouTube(false),
});

console.log('Backend ready. Game is idle until POST /game/start.\n');

if (chatEnabled && !autoStart) {
  void checkYouTube(false).then(({ youtube }) => {
    console.log(`YouTube status: ${youtube.state} - ${youtube.message}\n`);
  });
}

async function shutdown() {
  stopChat();
  await stopCurrentLoop();
  await fastify.close();
  apiUsageDb.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
