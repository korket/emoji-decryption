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

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  preGameMs?: number;
  interRoundMs?: number;
  maxRounds?: number;
  restartDelayMs?: number;
}

const DEFAULT_RESTART_DELAY_MS = 30_000;

export async function createServer(opts: ServerOptions = {}) {
  const {
    port = 3000,
    host = '127.0.0.1',
    dbPath = './game.db',
    preGameMs,
    interRoundMs,
    maxRounds,
    restartDelayMs = DEFAULT_RESTART_DELAY_MS,
  } = opts;

  const db = openDatabase(dbPath);
  seedPuzzlesIfEmpty(db);

  const clients = new Set<WsClient>();

  function broadcast(event: GameEvent): void {
    const msg = JSON.stringify(event);
    for (const client of clients) {
      try { client.send(msg); } catch { clients.delete(client); }
    }
  }

  function buildLoopOpts(): GameLoopOptions {
    const o: GameLoopOptions = {};
    if (preGameMs !== undefined) o.preGameMs = preGameMs;
    if (interRoundMs !== undefined) o.interRoundMs = interRoundMs;
    if (maxRounds !== undefined) o.maxRounds = maxRounds;
    return o;
  }

  let currentLoop: GameLoop;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function onEvent(event: GameEvent): void {
    broadcast(event);
    if (event.type === 'session_end') {
      restartTimer = setTimeout(() => {
        restartTimer = null;
        currentLoop = new GameLoop(db, `session-${Date.now()}`, onEvent, buildLoopOpts());
        currentLoop.start();
      }, restartDelayMs);
    }
  }

  currentLoop = new GameLoop(db, `session-${Date.now()}`, onEvent, buildLoopOpts());

  const fastify = Fastify({ logger: true });
  await fastify.register(websocketPlugin);

  fastify.get('/health', async () => ({
    ok: true,
    uptime: Math.floor(process.uptime()),
    ...currentLoop.getStatus(),
  }));

  fastify.get('/overlay', { websocket: true }, (socket) => {
    const client = socket as unknown as WsClient;
    clients.add(client);

    const snapshot = currentLoop.getSnapshot(Date.now());
    for (const event of snapshot) {
      try { client.send(JSON.stringify(event)); } catch { /* already closed */ }
    }

    client.on('close', () => { clients.delete(client); });
  });

  currentLoop.start();

  await fastify.listen({ port, host });

  return {
    fastify,
    processGuess: (msg: ChatMessage, now: number) => currentLoop.processGuess(msg, now),
    stopCurrentLoop: () => {
      if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null; }
      currentLoop.stop();
    },
  };
}
