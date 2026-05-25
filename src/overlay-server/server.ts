import { rmSync } from 'fs';
import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { openDatabase } from '../persistence/db';
import { seedPuzzlesIfEmpty } from '../persistence/seed';
import { GameLoop } from '../game/loop';
import type { GameEvent } from '../types/events';

interface WsClient {
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  interRoundMs?: number;
}

export async function createServer(opts: ServerOptions = {}) {
  const { port = 3000, host = '127.0.0.1', dbPath = './game.db', interRoundMs } = opts;

  rmSync(dbPath, { force: true });
  const db = openDatabase(dbPath);
  seedPuzzlesIfEmpty(db);

  const clients = new Set<WsClient>();

  function broadcast(event: GameEvent): void {
    const msg = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.send(msg);
      } catch {
        clients.delete(client);
      }
    }
  }

  const sessionId = `session-${Date.now()}`;
  const loopOpts = interRoundMs !== undefined ? { interRoundMs } : {};
  const loop = new GameLoop(db, sessionId, broadcast, loopOpts);

  const fastify = Fastify({ logger: true });
  await fastify.register(websocketPlugin);

  fastify.get('/health', async () => ({ ok: true }));

  fastify.get('/overlay', { websocket: true }, (socket) => {
    clients.add(socket as unknown as WsClient);

    const snapshot = loop.getSnapshot(Date.now());
    for (const event of snapshot) {
      try {
        (socket as unknown as WsClient).send(JSON.stringify(event));
      } catch {
        // Client already closed
      }
    }

    (socket as unknown as WsClient).on('close', () => {
      clients.delete(socket as unknown as WsClient);
    });
  });

  loop.start();

  await fastify.listen({ port, host });

  return { fastify, loop, db };
}
