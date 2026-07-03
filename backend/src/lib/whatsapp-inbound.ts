import { normalizePhone } from './phone.js';
import type { InboundMessage, WhatsAppIncomingMessage, WhatsAppWebhookBody } from '../types/whatsapp.js';

function extractText(m: WhatsAppIncomingMessage): string | null {
  switch (m.type) {
    case 'text':
      return m.text?.body ?? null;
    case 'interactive':
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case 'button':
      return m.button?.text ?? null;
    default:
      return null;
  }
}

function extractButtonReply(m: WhatsAppIncomingMessage): { id: string; title: string } | undefined {
  if (m.interactive?.button_reply) return m.interactive.button_reply;
  if (m.interactive?.list_reply) {
    return { id: m.interactive.list_reply.id, title: m.interactive.list_reply.title };
  }
  if (m.button) return { id: m.button.payload, title: m.button.text };
  return undefined;
}

/** Extrai e normaliza todas as mensagens recebidas de um payload de webhook. */
export function extractInboundMessages(body: WhatsAppWebhookBody): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;
      const contactName = value.contacts?.[0]?.profile?.name ?? null;
      for (const m of value.messages) {
        out.push({
          waId: m.from,
          phone: normalizePhone(m.from),
          name: contactName,
          messageId: m.id,
          type: m.type,
          text: extractText(m),
          buttonReply: extractButtonReply(m),
        });
      }
    }
  }
  return out;
}
