import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { bus, type DomainEvents } from '../lib/events.js';
import { verifyToken } from '../lib/auth.js';
import { getUserById } from '../repositories/user.repo.js';

let io: SocketIOServer | null = null;

/** Token do painel → id do usuário ativo (null se inválido, expirado ou desativado). */
async function userIdFromToken(token: string): Promise<string | null> {
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;
  const user = await getUserById(payload.sub);
  return user?.id ?? null;
}

/** Inicializa o Socket.io sobre o servidor HTTP e repassa os eventos de domínio. */
export function initSocket(
  httpServer: HttpServer,
  resolveUserId: (token: string) => Promise<string | null> = userIdFromToken,
): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.FRONTEND_URL, credentials: true },
    path: '/socket.io',
  });

  // Só o painel logado recebe eventos: eles carregam telefone e texto das mensagens.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    resolveUserId(typeof token === 'string' ? token : '')
      .then((userId) => {
        if (!userId) return next(new Error('unauthorized'));
        socket.data.userId = userId;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Painel conectado (WebSocket)');
    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Painel desconectado');
    });
  });

  // Repassa cada evento de domínio para todos os painéis conectados.
  const forward = <K extends keyof DomainEvents>(event: K) => {
    bus.on(event, (payload) => io?.emit(event, payload));
  };
  forward('message:new');
  forward('conversation:status');
  forward('conversation:typing');
  forward('appointment:created');
  forward('appointment:cancelled');
  forward('appointment:unconfirmed');

  logger.info('Socket.io inicializado');
  return io;
}

export function getIo(): SocketIOServer | null {
  return io;
}
