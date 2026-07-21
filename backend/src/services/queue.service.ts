import type { Worker as BullWorker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { InboundMedia } from '../types/whatsapp.js';

/** Job de mensagem recebida a ser processada pelo fluxo do bot. */
export interface InboundJob {
  phone: string;
  name: string | null;
  text: string | null;
  messageId: string;
  /** Foto/áudio/documento: só a referência da Meta — o download acontece no bot. */
  media?: InboundMedia;
}

export type JobHandler = (job: InboundJob) => Promise<void>;

export interface MessageQueue {
  backend: 'redis' | 'memory';
  enqueue(job: InboundJob): Promise<void>;
  process(handler: JobHandler): void;
  close(): Promise<void>;
}

const QUEUE_NAME = 'inbound-messages';

// ── Backend em memória (dev sem Redis) ──
function createMemoryQueue(): MessageQueue {
  let handler: JobHandler | null = null;
  return {
    backend: 'memory',
    async enqueue(job) {
      if (!handler) {
        logger.warn({ job }, 'Fila em memória sem handler registrado — job descartado');
        return;
      }
      // Processa de forma assíncrona, sem bloquear o webhook.
      queueMicrotask(() => {
        handler!(job).catch((err) => logger.error({ err, job }, 'Erro ao processar job (memória)'));
      });
    },
    process(h) {
      handler = h;
    },
    async close() {
      handler = null;
    },
  };
}

// ── Backend Redis/BullMQ (Upstash/produção) ──
async function createRedisQueue(): Promise<MessageQueue> {
  // Import dinâmico para não exigir conexão quando em memória.
  const { Queue, Worker } = await import('bullmq');
  const { Redis } = await import('ioredis');

  // BullMQ empacota sua própria cópia do ioredis; em runtime são compatíveis (mesma v5),
  // então passamos a conexão com cast para evitar o conflito de tipos entre as cópias.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) as never;
  const queue = new Queue<InboundJob>(QUEUE_NAME, { connection });
  let worker: BullWorker<InboundJob> | null = null;

  logger.info('Fila usando Redis/BullMQ');

  return {
    backend: 'redis',
    async enqueue(job) {
      await queue.add('inbound', job, {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    },
    process(handler) {
      const w = new Worker<InboundJob>(QUEUE_NAME, async (job) => handler(job.data), { connection });
      w.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Job falhou (BullMQ)'));
      worker = w;
    },
    async close() {
      await worker?.close();
      await queue.close();
      (connection as { disconnect: () => void }).disconnect();
    },
  };
}

let instance: MessageQueue | null = null;

/** Retorna a fila singleton (Redis se REDIS_ENABLED, senão memória). */
export async function getMessageQueue(): Promise<MessageQueue> {
  if (instance) return instance;
  instance = env.REDIS_ENABLED ? await createRedisQueue() : createMemoryQueue();
  if (instance.backend === 'memory') {
    logger.warn('Fila em MEMÓRIA (REDIS_ENABLED=false) — use Redis em produção');
  }
  return instance;
}
