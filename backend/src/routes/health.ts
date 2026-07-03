import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Healthcheck que também verifica o banco.
  app.get('/health/db', async (_req, reply) => {
    try {
      await pool.query('select 1');
      return { status: 'ok', db: 'up' };
    } catch (err) {
      app.log.error({ err }, 'Healthcheck do banco falhou');
      reply.code(503);
      return { status: 'error', db: 'down' };
    }
  });
}
