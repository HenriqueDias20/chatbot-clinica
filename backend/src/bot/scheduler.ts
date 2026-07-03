import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { sendTomorrowConfirmations, checkUnconfirmed, closeInactive, checkInactivity } from '../services/cron.service.js';

/** Agenda os cron jobs do bot (fuso configurável). */
export function startCronJobs(): void {
  const timezone = env.TIMEZONE;

  // 08:00 — confirmação das consultas de amanhã.
  cron.schedule(
    '0 8 * * *',
    () => {
      void sendTomorrowConfirmations().catch((err) => logger.error({ err }, 'Cron 08:00 falhou'));
    },
    { timezone },
  );

  // A cada hora — checar confirmações sem resposta há 2h.
  cron.schedule(
    '0 * * * *',
    () => {
      void checkUnconfirmed(2).catch((err) => logger.error({ err }, 'Cron horário falhou'));
    },
    { timezone },
  );

  // 23:59 — fechar conversas inativas há +24h.
  cron.schedule(
    '59 23 * * *',
    () => {
      void closeInactive(24).catch((err) => logger.error({ err }, 'Cron 23:59 falhou'));
    },
    { timezone },
  );

  // A cada minuto — lembrete de inatividade (10 min) + auto-fechar (5 min após lembrete).
  cron.schedule(
    '* * * * *',
    () => {
      void checkInactivity(10, 5).catch((err) => logger.error({ err }, 'Cron inatividade falhou'));
    },
    { timezone },
  );

  logger.info({ timezone }, 'Cron jobs agendados (08:00, horário, 23:59, inatividade a cada 1min)');
}
