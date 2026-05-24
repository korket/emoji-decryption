import { createServer } from './overlay-server/server.js';

const { fastify } = await createServer();

async function shutdown() {
  await fastify.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
