import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { openDatabase } from '../persistence/db';
import { seedPuzzlesIfEmpty } from '../persistence/seed';
import { GameLoop, type GameLoopOptions } from '../game/loop';
import type { GameEvent } from '../types/events';
import type { ChatMessage } from '../types/chat-message';

interface WsClient {
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

interface GameStartContext {
  processGuess: (msg: ChatMessage, now: number) => void;
}

interface LoopStatus {
  sessionId: string | null;
  round: number;
  active: boolean;
  restartScheduled: boolean;
}

interface GameControlResult {
  ok: boolean;
  started?: boolean;
  stopped?: boolean;
  alreadyRunning?: boolean;
  error?: string;
  status: LoopStatus;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  preGameMs?: number;
  interRoundMs?: number;
  maxRounds?: number;
  restartDelayMs?: number;
  autoStart?: boolean;
  logger?: boolean;
  controlLogging?: boolean;
  beforeGameStart?: () => void | Promise<void>;
  afterGameStart?: (ctx: GameStartContext) => void | Promise<void>;
  onGameStop?: () => void | Promise<void>;
  getHealth?: () => Record<string, unknown>;
  checkYouTube?: () => Promise<Record<string, unknown>>;
}

const DEFAULT_RESTART_DELAY_MS = 10_000;

export async function createServer(opts: ServerOptions = {}) {
  const {
    port = 3000,
    host = '127.0.0.1',
    dbPath = './game.db',
    preGameMs,
    interRoundMs,
    maxRounds,
    restartDelayMs = DEFAULT_RESTART_DELAY_MS,
    autoStart = false,
    logger = true,
    controlLogging = true,
    beforeGameStart,
    afterGameStart,
    onGameStop,
    getHealth,
    checkYouTube,
  } = opts;

  const db = openDatabase(dbPath);
  seedPuzzlesIfEmpty(db);

  const clients = new Set<WsClient>();

  function controlLog(message: string): void {
    if (controlLogging) console.log(`[control] ${message}`);
  }

  function controlError(message: string): void {
    if (controlLogging) console.error(`[control] ${message}`);
  }

  function broadcast(event: GameEvent): void {
    const msg = JSON.stringify(event);
    for (const client of clients) {
      try { client.send(msg); } catch { clients.delete(client); }
    }
  }

  function buildLoopOpts(includePreGame: boolean): GameLoopOptions {
    const o: GameLoopOptions = {};
    if (includePreGame && preGameMs !== undefined) o.preGameMs = preGameMs;
    if (interRoundMs !== undefined) o.interRoundMs = interRoundMs;
    if (maxRounds !== undefined) o.maxRounds = maxRounds;
    return o;
  }

  let currentLoop: GameLoop | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let enrichedSessionEnd: Extract<GameEvent, { type: 'session_end' }> | null = null;

  function getLoopStatus(): LoopStatus {
    const status = currentLoop?.getStatus();
    return {
      sessionId: status?.sessionId ?? null,
      round: status?.round ?? 0,
      active: status?.active ?? false,
      restartScheduled: restartTimer !== null,
    };
  }

  function clearRestartTimer(): void {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function processGuess(msg: ChatMessage, now: number): void {
    currentLoop?.processGuess(msg, now);
  }

  function startLoop(includePreGame: boolean): void {
    currentLoop = new GameLoop(db, `session-${Date.now()}`, onEvent, buildLoopOpts(includePreGame));
    currentLoop.start();
  }

  async function startGame(includePreGame = true): Promise<GameControlResult> {
    if (currentLoop?.getStatus().active) {
      return { ok: true, started: false, alreadyRunning: true, status: getLoopStatus() };
    }

    clearRestartTimer();
    enrichedSessionEnd = null;

    try {
      await beforeGameStart?.();
      startLoop(includePreGame);
      await afterGameStart?.({ processGuess });
      return { ok: true, started: true, status: getLoopStatus() };
    } catch (err) {
      if (currentLoop?.getStatus().active) {
        currentLoop.stop();
        currentLoop = null;
        broadcast({ type: 'game_idle' });
      }
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, started: false, error, status: getLoopStatus() };
    }
  }

  async function stopGame(): Promise<GameControlResult> {
    const hadGameState = currentLoop !== null || restartTimer !== null || enrichedSessionEnd !== null;
    clearRestartTimer();
    enrichedSessionEnd = null;

    if (currentLoop !== null) {
      currentLoop.stop();
      currentLoop = null;
    }

    try {
      await onGameStop?.();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, stopped: hadGameState, error, status: getLoopStatus() };
    }

    if (hadGameState) broadcast({ type: 'game_idle' });
    return { ok: true, stopped: hadGameState, status: getLoopStatus() };
  }

  function onEvent(event: GameEvent): void {
    if (event.type === 'session_end') {
      const nextSessionAt = Date.now() + restartDelayMs;
      enrichedSessionEnd = { ...event, nextSessionAt };
      broadcast(enrichedSessionEnd);
      restartTimer = setTimeout(() => {
        enrichedSessionEnd = null;
        restartTimer = null;
        startLoop(false);
      }, restartDelayMs);
      return;
    }
    broadcast(event);
  }

  const fastify = Fastify({ logger, disableRequestLogging: true });
  await fastify.register(websocketPlugin);

  fastify.get('/health', async () => ({
    ok: true,
    uptime: Math.floor(process.uptime()),
    ...getLoopStatus(),
    ...getHealth?.(),
  }));

  fastify.post('/youtube/check', async (_request, reply) => {
    if (checkYouTube === undefined) {
      return reply.code(404).send({ ok: false, error: 'YouTube status check is not configured.' });
    }
    controlLog('Checking YouTube API status...');
    const result = await checkYouTube();
    controlLog('YouTube API status check complete.');
    return result;
  });

  fastify.post('/game/start', async (_request, reply) => {
    controlLog('Game start requested.');
    const result = await startGame(true);
    if (!result.ok) {
      controlError(`Game start failed: ${result.error ?? 'unknown error'}`);
      return reply.code(500).send(result);
    }
    controlLog(result.alreadyRunning ? 'Game is already running.' : 'Game started.');
    return result;
  });

  fastify.post('/game/stop', async (_request, reply) => {
    controlLog('Game stop requested.');
    const result = await stopGame();
    if (!result.ok) {
      controlError(`Game stop failed: ${result.error ?? 'unknown error'}`);
      return reply.code(500).send(result);
    }
    controlLog(result.stopped ? 'Game stopped.' : 'Game was already idle.');
    return result;
  });

  fastify.get('/overlay', { websocket: true }, (socket) => {
    const client = socket as unknown as WsClient;
    clients.add(client);

    const snapshot = enrichedSessionEnd !== null
      ? [enrichedSessionEnd]
      : currentLoop?.getSnapshot(Date.now()) ?? [];
    for (const event of snapshot) {
      try { client.send(JSON.stringify(event)); } catch { /* already closed */ }
    }

    client.on('close', () => { clients.delete(client); });
  });

  await fastify.listen({ port, host });

  if (autoStart) {
    void startGame(true).then((result) => {
      if (!result.ok) fastify.log.error({ err: result.error }, 'Auto-start failed');
    });
  }

  return {
    fastify,
    processGuess,
    startGame: () => startGame(true),
    stopGame,
    stopCurrentLoop: stopGame,
  };
}
