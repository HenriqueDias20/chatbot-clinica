import pino from 'pino';
import { env } from '../config/env.js';

// Logs em JSON estruturado (convenção do projeto).
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'chatbot-fisioterapia' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Nível como texto ("error"), não número (50): o Railway só reconhece texto.
  formatters: { level: (label) => ({ level: label }) },
});

export type Logger = typeof logger;
