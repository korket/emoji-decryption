import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/overlay-server/server';

type CreatedServer = Awaited<ReturnType<typeof createServer>>;

const servers: CreatedServer[] = [];

async function makeServer(opts: Parameters<typeof createServer>[0] = {}): Promise<CreatedServer> {
  const server = await createServer({
    port: 0,
    dbPath: ':memory:',
    maxRounds: 1,
    preGameMs: 0,
    interRoundMs: 50,
    restartDelayMs: 50,
    logger: false,
    controlLogging: false,
    ...opts,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await server.stopCurrentLoop();
    await server.fastify.close();
  }
});

describe('server game controls', () => {
  it('starts idle by default', async () => {
    const { fastify } = await makeServer();

    const res = await fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      active: false,
      round: 0,
      sessionId: null,
      restartScheduled: false,
    });
  });

  it('starts the game with /game/start', async () => {
    let beforeCalled = 0;
    let afterCalled = 0;
    const { fastify } = await makeServer({
      beforeGameStart: () => { beforeCalled++; },
      afterGameStart: () => { afterCalled++; },
    });

    const res = await fastify.inject({ method: 'POST', url: '/game/start', payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, started: true, status: { active: true, round: 1 } });
    expect(beforeCalled).toBe(1);
    expect(afterCalled).toBe(1);
  });

  it('does not start a second loop when already running', async () => {
    const { fastify } = await makeServer();

    await fastify.inject({ method: 'POST', url: '/game/start', payload: {} });
    const res = await fastify.inject({ method: 'POST', url: '/game/start', payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, started: false, alreadyRunning: true, status: { active: true } });
  });

  it('stops the game with /game/stop', async () => {
    let stopCalled = 0;
    const { fastify } = await makeServer({ onGameStop: () => { stopCalled++; } });

    await fastify.inject({ method: 'POST', url: '/game/start', payload: {} });
    const res = await fastify.inject({ method: 'POST', url: '/game/stop', payload: {} });
    const health = await fastify.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, stopped: true, status: { active: false } });
    expect(health.json()).toMatchObject({ active: false, sessionId: null });
    expect(stopCalled).toBeGreaterThanOrEqual(1);
  });

  it('failed startup does not leave a running game loop', async () => {
    const { fastify } = await makeServer({
      beforeGameStart: () => { throw new Error('YouTube quota exceeded'); },
    });

    const res = await fastify.inject({ method: 'POST', url: '/game/start', payload: {} });
    const health = await fastify.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, started: false, error: 'YouTube quota exceeded' });
    expect(health.json()).toMatchObject({ active: false, round: 0, sessionId: null });
  });

  it('exposes configured YouTube status check', async () => {
    const { fastify } = await makeServer({
      getHealth: () => ({ youtube: { state: 'idle', estimatedQuotaUnits: 0 } }),
      checkYouTube: async () => ({ youtube: { state: 'ready', estimatedQuotaUnits: 1 } }),
    });

    const check = await fastify.inject({ method: 'POST', url: '/youtube/check', payload: {} });
    const health = await fastify.inject({ method: 'GET', url: '/health' });

    expect(check.statusCode).toBe(200);
    expect(check.json()).toEqual({ youtube: { state: 'ready', estimatedQuotaUnits: 1 } });
    expect(health.json()).toMatchObject({ youtube: { state: 'idle', estimatedQuotaUnits: 0 } });
  });
});
