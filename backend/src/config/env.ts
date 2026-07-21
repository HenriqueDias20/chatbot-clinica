import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
// backend/.env fica dois níveis acima de src/config
config({ path: resolve(here, '../../.env') });

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),

  // Banco / cache
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // false = fila em memória (dev sem Redis). true = BullMQ no REDIS_URL (Upstash/produção).
  REDIS_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Integrações (opcionais até as etapas correspondentes)
  ANTHROPIC_API_KEY: z.string().default(''),
  // Modelo do Claude usado pelo bot. Trocar aqui não exige mudança de código.
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5'),
  // Regra de negócio: limite de mensagens de contexto enviadas ao Claude.
  CLAUDE_MAX_CONTEXT_MESSAGES: z.coerce.number().default(10),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default(''),
  // App Secret da Meta — usado para validar a assinatura X-Hub-Signature-256.
  // Opcional: se vazio, a verificação de assinatura é pulada (com aviso).
  WHATSAPP_APP_SECRET: z.string().default(''),
  // ID da WABA (conta do WhatsApp Business) — usado para listar os templates aprovados.
  WHATSAPP_WABA_ID: z.string().default(''),

  // Supabase Storage — guarda as mídias (foto/áudio/documento) das conversas.
  // Bucket PRIVADO: o painel recebe links assinados e temporários via backend.
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_KEY: z.string().default(''),
  MEDIA_BUCKET: z.string().default('whatsapp-media'),

  // App
  JWT_SECRET: z.string().default('dev-secret-trocar-em-producao'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Regras de negócio
  BUSINESS_HOURS_START: z.string().default('08:00'),
  BUSINESS_HOURS_END: z.string().default('18:00'),
  // Testes: quando true, o bot atende a qualquer hora/dia (ignora horário comercial).
  BUSINESS_HOURS_ALWAYS_OPEN: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'Variáveis de ambiente inválidas',
      errors: parsed.error.flatten().fieldErrors,
    }),
  );
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
