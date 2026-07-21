import { env } from '../config/env.js';
import { logger, type Logger } from '../lib/logger.js';
import { toWhatsAppRecipient } from '../lib/phone.js';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface QuickReplyButton {
  id: string;
  title: string; // limite da Meta: 20 caracteres
}

export interface TemplateParam {
  text: string;
}

export type SendResult =
  | { ok: true; messageId: string | null; dryRun: boolean }
  | { ok: false; error: string; status?: number };

export interface WhatsAppDeps {
  token: string;
  phoneNumberId: string;
  /** ID da WABA — necessário só para listar os templates aprovados. */
  wabaId?: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
  log?: Logger;
}

/** Template aprovado na Meta, já normalizado para o painel. */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  body: string;
  /** Quantidade de variáveis {{1}}, {{2}}… que o corpo espera. */
  paramCount: number;
}

export type ListTemplatesResult =
  | { ok: true; templates: WhatsAppTemplate[] }
  | { ok: false; error: string };

// Limites da Meta Cloud API
const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE = 20;

interface MetaError {
  error?: { message?: string; type?: string; code?: number };
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
}

interface MetaTemplateComponent {
  type?: string;
  text?: string;
}

interface MetaTemplate {
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  components?: MetaTemplateComponent[];
}

interface MetaTemplateListResponse {
  data?: MetaTemplate[];
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Cria o serviço de envio. Recebe as dependências por injeção para ser
 * facilmente testável (fetch mockado) e configurável por ambiente.
 *
 * Se `token` ou `phoneNumberId` estiverem vazios, opera em modo DRY-RUN:
 * não chama a Meta, apenas loga o payload que seria enviado.
 */
export function createWhatsAppService(deps: WhatsAppDeps) {
  const apiVersion = deps.apiVersion ?? 'v21.0';
  const wabaId = deps.wabaId ?? '';
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? logger;
  const baseUrl = `https://graph.facebook.com/${apiVersion}/${deps.phoneNumberId}/messages`;
  const isConfigured = Boolean(deps.token) && Boolean(deps.phoneNumberId);

  async function send(payload: Record<string, unknown>, kind: string): Promise<SendResult> {
    // Modo dry-run (sem credenciais): não chama a Meta.
    if (!isConfigured) {
      log.warn({ kind, payload }, 'WhatsApp em modo DRY-RUN — mensagem NÃO enviada (sem credenciais)');
      return { ok: true, messageId: null, dryRun: true };
    }

    try {
      const res = await fetchFn(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const raw = (await res.json().catch(() => ({}))) as MetaSendResponse & MetaError;

      if (!res.ok) {
        const msg = raw.error?.message ?? `HTTP ${res.status}`;
        log.error({ kind, status: res.status, error: raw.error }, 'Falha ao enviar mensagem WhatsApp');
        return { ok: false, error: msg, status: res.status };
      }

      const messageId = raw.messages?.[0]?.id ?? null;
      log.info({ kind, messageId, to: payload.to }, 'Mensagem WhatsApp enviada');
      return { ok: true, messageId, dryRun: false };
    } catch (err) {
      log.error({ kind, err }, 'Erro de rede ao chamar a Meta Cloud API');
      return { ok: false, error: err instanceof Error ? err.message : 'erro desconhecido' };
    }
  }

  // ── Texto simples ──
  async function sendText(phone: string, text: string): Promise<SendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      to: toWhatsAppRecipient(phone),
      type: 'text',
      text: { body: text, preview_url: false },
    };
    return send(payload, 'text');
  }

  // ── Botões de resposta rápida (máx. 3) ──
  async function sendButtons(
    phone: string,
    bodyText: string,
    buttons: QuickReplyButton[],
  ): Promise<SendResult> {
    if (buttons.length === 0) {
      return { ok: false, error: 'É preciso ao menos 1 botão' };
    }
    if (buttons.length > MAX_BUTTONS) {
      return { ok: false, error: `A Meta permite no máximo ${MAX_BUTTONS} botões (recebidos: ${buttons.length})` };
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: toWhatsAppRecipient(phone),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => {
            const title = b.title.slice(0, MAX_BUTTON_TITLE);
            if (title.length < b.title.length) {
              log.warn({ original: b.title }, `Título de botão truncado para ${MAX_BUTTON_TITLE} caracteres`);
            }
            return { type: 'reply', reply: { id: b.id, title } };
          }),
        },
      },
    };
    return send(payload, 'buttons');
  }

  // ── Template (ex.: confirmação 24h antes) ──
  async function sendTemplate(
    phone: string,
    templateName: string,
    params: TemplateParam[] = [],
    languageCode = 'pt_BR',
  ): Promise<SendResult> {
    const components =
      params.length > 0
        ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p.text })) }]
        : [];

    const payload = {
      messaging_product: 'whatsapp',
      to: toWhatsAppRecipient(phone),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };
    return send(payload, 'template');
  }

  // ── Lista os templates APROVADOS da WABA (para o painel escolher) ──
  async function listTemplates(): Promise<ListTemplatesResult> {
    if (!deps.token || !wabaId) {
      return { ok: false, error: 'Configure WHATSAPP_TOKEN e WHATSAPP_WABA_ID para listar os templates.' };
    }
    const url =
      `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates` +
      `?fields=name,status,category,language,components&limit=100`;
    try {
      const res = await fetchFn(url, { headers: { Authorization: `Bearer ${deps.token}` } });
      const raw = (await res.json().catch(() => ({}))) as MetaTemplateListResponse & MetaError;
      if (!res.ok) {
        const msg = raw.error?.message ?? `HTTP ${res.status}`;
        log.error({ status: res.status, error: raw.error }, 'Falha ao listar templates do WhatsApp');
        return { ok: false, error: msg };
      }
      const templates: WhatsAppTemplate[] = (raw.data ?? [])
        .filter((t) => t.status === 'APPROVED' && t.name)
        .map((t) => {
          const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
          // Descobre quantas variáveis {{n}} o corpo usa.
          const re = /\{\{(\d+)\}\}/g;
          const nums: number[] = [];
          let m: RegExpExecArray | null;
          while ((m = re.exec(body)) !== null) nums.push(Number(m[1]));
          return {
            name: t.name!,
            language: t.language ?? 'pt_BR',
            category: t.category ?? '',
            body,
            paramCount: nums.length > 0 ? Math.max(...nums) : 0,
          };
        });
      return { ok: true, templates };
    } catch (err) {
      log.error({ err }, 'Erro de rede ao listar templates do WhatsApp');
      return { ok: false, error: err instanceof Error ? err.message : 'erro desconhecido' };
    }
  }

  return { sendText, sendButtons, sendTemplate, listTemplates, isConfigured };
}

export type WhatsAppService = ReturnType<typeof createWhatsAppService>;

// Instância padrão configurada pelo ambiente.
export const whatsappService = createWhatsAppService({
  token: env.WHATSAPP_TOKEN,
  phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  wabaId: env.WHATSAPP_WABA_ID,
  log: logger,
});
