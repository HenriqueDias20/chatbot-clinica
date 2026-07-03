import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { bus, type DomainEvents } from '../lib/events.js';

let io: SocketIOServer | null = null;

/** Inicializa o Socket.io sobre o servidor HTTP e repassa os eventos de domínio. */
export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.FRONTEND_URL, credentials: true },
    path: '/socket.io',
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
