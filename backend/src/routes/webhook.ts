import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { verifyMetaSignature } from '../lib/signature.js';
import { extractInboundMessages } from '../lib/whatsapp-inbound.js';
import { getMessageQueue } from '../services/queue.service.js';
import type { WhatsAppWebhookBody } from '../types/whatsapp.js';

interface VerifyQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /webhook — verificação do webhook pela Meta ──
  app.get<{ Querystring: VerifyQuery }>('/webhook', async (req, reply) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      app.log.info('Webhook verificado pela Meta com sucesso');
      // A Meta espera o challenge ecoado como texto puro.
      return reply.code(200).type('text/plain').send(challenge ?? '');
    }
    app.log.warn({ mode }, 'Verificação de webhook falhou (token inválido)');
    return reply.code(403).send('Forbidden');
  });

  // ── POST /webhook — recebimento de mensagens ──
  app.post('/webhook', async (req, reply) => {
    // 1) Valida assinatura HMAC (se App Secret configurado).
    const sig = verifyMetaSignature(
      req.rawBody,
      req.headers['x-hub-signature-256'] as string | undefined,
      env.WHATSAPP_APP_SECRET,
    );
    if (sig.skipped) {
      app.log.warn('WHATSAPP_APP_SECRET não configurado — assinatura do webhook NÃO verificada');
    } else if (!sig.valid) {
      app.log.warn('Assinatura do webhook inválida — requisição rejeitada');
      return reply.code(401).send();
    }

    // 2) Responde 200 imediatamente (a Meta reenvia se demorar).
    reply.code(200).send();

    // 3) Enfileira as mensagens para o fluxo do bot processar.
    try {
      const body = req.body as WhatsAppWebhookBody;
      const messages = extractInboundMessages(body);
      if (messages.length === 0) {
        app.log.debug('Webhook POST sem mensagens (provavelmente status de entrega)');
        return;
      }
      const queue = await getMessageQueue();
      for (const m of messages) {
        app.log.info({ from: m.phone, type: m.type, messageId: m.messageId }, 'Mensagem recebida — enfileirando');
        await queue.enqueue({
          phone: m.phone,
          name: m.name,
          text: m.text,
          messageId: m.messageId,
          ...(m.media ? { media: m.media } : {}),
        });
      }
    } catch (err) {
      app.log.error({ err }, 'Erro ao enfileirar payload do webhook');
    }
  });
}
