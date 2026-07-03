import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger, type Logger } from '../lib/logger.js';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export const INTENTS = ['AGENDAR', 'CANCELAR', 'CONFIRMAR', 'DUVIDA', 'FALAR_HUMANO', 'OUTRO'] as const;
export type Intent = (typeof INTENTS)[number];

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Contexto da clínica + FAQ — injetado pelo fluxo (vem do banco). */
export interface ReplyContext {
  clinicName: string;
  faq: Array<{ question: string; answer: string }>;
  /** Texto extra opcional para o system prompt (ex.: horário comercial). */
  systemExtra?: string;
}

export interface ClaudeDeps {
  apiKey: string;
  model?: string;
  maxContextMessages?: number;
  /** Cliente Anthropic injetável (para testes). */
  client?: Anthropic;
  log?: Logger;
}

export interface ClassifyResult {
  intent: Intent;
  mock: boolean;
}

export interface ReplyResult {
  text: string;
  mock: boolean;
}

// ─── Heurística usada no modo MOCK (sem API) ────────────────────────────────

const HEURISTICS: Array<{ intent: Intent; patterns: RegExp }> = [
  { intent: 'CONFIRMAR', patterns: /\b(confirmar|confirmo|confirmado|^1$|sim, confirmo)\b/i },
  { intent: 'CANCELAR', patterns: /\b(cancelar|desmarcar|cancela|^2$|n[aã]o vou poder)\b/i },
  { intent: 'AGENDAR', patterns: /\b(agendar|marcar|agendamento|hor[aá]rio|consulta|sess[aã]o|remarcar)\b/i },
  { intent: 'FALAR_HUMANO', patterns: /\b(atendente|humano|pessoa|recep[cç][aã]o|falar com algu[eé]m)\b/i },
  {
    intent: 'DUVIDA',
    patterns: /\b(quanto|onde|qual|como|convênio|convenio|pre[çc]o|endere[çc]o|hor[aá]rio de|d[uú]vida)\b|\?/i,
  },
];

function heuristicIntent(text: string): Intent {
  for (const h of HEURISTICS) {
    if (h.patterns.test(text)) return h.intent;
  }
  return 'OUTRO';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseIntent(raw: string): Intent {
  const upper = raw.toUpperCase();
  for (const intent of INTENTS) {
    if (upper.includes(intent)) return intent;
  }
  return 'OUTRO';
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

const CLASSIFY_SYSTEM = [
  'Você é um classificador de intenções para o WhatsApp de uma clínica de fisioterapia.',
  'Dada a última mensagem do paciente (com o histórico como contexto), responda APENAS com UMA palavra,',
  'exatamente uma destas opções:',
  'AGENDAR, CANCELAR, CONFIRMAR, DUVIDA, FALAR_HUMANO, OUTRO.',
  'Não explique, não use pontuação, responda só a palavra.',
].join(' ');

function buildReplySystem(ctx: ReplyContext): string {
  const faqText = ctx.faq.map((f, i) => `${i + 1}. P: ${f.question}\n   R: ${f.answer}`).join('\n');
  return [
    `Você é o assistente virtual da ${ctx.clinicName}, atendendo pacientes pelo WhatsApp.`,
    'Seja cordial, breve e objetivo. Responda em português do Brasil.',
    'Use a base de conhecimento (FAQ) abaixo para responder dúvidas.',
    'Se a pergunta fugir do FAQ ou exigir um humano, diga que vai encaminhar para a recepção.',
    ctx.systemExtra ? `\nInformações da clínica:\n${ctx.systemExtra}` : '',
    `\nFAQ:\n${faqText}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createClaudeService(deps: ClaudeDeps) {
  const model = deps.model ?? env.CLAUDE_MODEL;
  const maxContext = deps.maxContextMessages ?? env.CLAUDE_MAX_CONTEXT_MESSAGES;
  const log = deps.log ?? logger;
  const client: Anthropic | null = deps.client ?? (deps.apiKey ? new Anthropic({ apiKey: deps.apiKey }) : null);

  function trimHistory(history: ConversationTurn[]): ConversationTurn[] {
    // Regra de negócio: limite de N mensagens de contexto.
    return history.slice(-maxContext);
  }

  // ── Classificação de intenção ──
  async function classifyIntent(text: string, history: ConversationTurn[] = []): Promise<ClassifyResult> {
    if (!client) {
      const intent = heuristicIntent(text);
      log.warn({ text, intent }, 'Claude em modo MOCK — intenção classificada por heurística');
      return { intent, mock: true };
    }

    try {
      const message = await client.messages.create({
        model,
        max_tokens: 16,
        system: CLASSIFY_SYSTEM,
        messages: [
          ...trimHistory(history).map((t) => ({ role: t.role, content: t.content })),
          { role: 'user' as const, content: text },
        ],
      });
      const intent = parseIntent(extractText(message));
      log.info({ intent, model }, 'Intenção classificada pelo Claude');
      return { intent, mock: false };
    } catch (err) {
      log.error({ err }, 'Erro ao classificar intenção — fallback para OUTRO');
      return { intent: 'OUTRO', mock: false };
    }
  }

  // ── Resposta natural (FAQ / dúvidas) ──
  async function generateReply(
    text: string,
    history: ConversationTurn[],
    ctx: ReplyContext,
  ): Promise<ReplyResult> {
    if (!client) {
      // MOCK: tenta casar com alguma pergunta do FAQ; senão, resposta padrão.
      const lower = text.toLowerCase();
      const hit = ctx.faq.find((f) => lower.split(/\s+/).some((w) => w.length > 3 && f.question.toLowerCase().includes(w)));
      const reply = hit
        ? hit.answer
        : 'Posso te ajudar com agendamento, confirmação ou dúvidas. Se precisar, encaminho para a recepção. 🙂';
      log.warn({ text }, 'Claude em modo MOCK — resposta gerada localmente');
      return { text: reply, mock: true };
    }

    try {
      const message = await client.messages.create({
        model,
        max_tokens: 400,
        system: buildReplySystem(ctx),
        messages: [
          ...trimHistory(history).map((t) => ({ role: t.role, content: t.content })),
          { role: 'user' as const, content: text },
        ],
      });
      const reply = extractText(message) || 'Vou encaminhar você para a recepção, um instante. 🙂';
      log.info({ model }, 'Resposta gerada pelo Claude');
      return { text: reply, mock: false };
    } catch (err) {
      log.error({ err }, 'Erro ao gerar resposta — usando mensagem de fallback');
      return { text: 'Tive um problema técnico. Vou te encaminhar para a recepção. 🙂', mock: false };
    }
  }

  return { classifyIntent, generateReply, isConfigured: Boolean(client), model };
}

export type ClaudeService = ReturnType<typeof createClaudeService>;

// Instância padrão configurada pelo ambiente (mock se ANTHROPIC_API_KEY vazio).
export const claudeService = createClaudeService({
  apiKey: env.ANTHROPIC_API_KEY,
  log: logger,
});
