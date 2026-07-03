import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import pino from 'pino';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';
import { conversationRoutes } from './routes/conversations.js';
import { agendaRoutes } from './routes/agenda.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { authRoutes, authenticate } from './routes/auth.js';
import { demoRoutes } from './routes/demo.js';

// Disponibiliza o corpo cru da requisição para validar a assinatura da Meta.
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      base: { service: 'chatbot-fisioterapia' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
  });

  // Parser de JSON que preserva o buffer original (necessário p/ HMAC do webhook).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const buf = body as Buffer;
    req.rawBody = buf;
    if (!buf || buf.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.register(cors, { origin: env.FRONTEND_URL, credentials: true });

  // Decorator de autenticação na instância raiz → herdado por todos os plugins-filhos.
  app.decorate('authenticate', authenticate);

  app.register(healthRoutes);
  app.register(webhookRoutes);
  app.register(authRoutes);
  app.register(conversationRoutes);
  app.register(agendaRoutes);
  app.register(dashboardRoutes);
  app.register(demoRoutes);

  return app;
}
