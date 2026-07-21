import type { FastifyInstance } from 'fastify';
import { whatsappService } from '../services/whatsapp.service.js';
import { normalizePhone } from '../lib/phone.js';
import { findOrCreatePatient } from '../repositories/patient.repo.js';
import {
  getOrCreateActiveConversation,
  markHandedOff,
  setConversationIntake,
  touchConversation,
} from '../repositories/conversation.repo.js';
import { saveMessage } from '../repositories/message.repo.js';
import { bus } from '../lib/events.js';

/** Troca {{1}}, {{2}}… pelos valores, para guardar o texto real no histórico. */
function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_full, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  // Ferramenta de atendimento: qualquer usuário logado (inclusive 'atendente') pode usar.
  app.addHook('preHandler', app.authenticate);

  // Lista os templates aprovados na Meta.
  app.get('/api/templates', async () => {
    const res = await whatsappService.listTemplates();
    if (!res.ok) return { templates: [], error: res.error };
    return { templates: res.templates };
  });

  // Envia um template para um número — inicia (ou reabre) a conversa.
  app.post<{
    Body: {
      phone?: string;
      name?: string;
      template?: string;
      language?: string;
      params?: string[];
      body?: string;
    };
  }>('/api/templates/send', async (req, reply) => {
    const phoneRaw = (req.body?.phone ?? '').trim();
    const templateName = (req.body?.template ?? '').trim();
    const language = (req.body?.language ?? 'pt_BR').trim();
    const params = (req.body?.params ?? []).map((p) => String(p ?? '').trim());
    const bodyText = req.body?.body ?? '';

    if (!phoneRaw) return reply.code(400).send({ error: 'Informe o telefone do cliente.' });
    if (!templateName) return reply.code(400).send({ error: 'Escolha um template.' });
    if (params.some((p) => !p)) return reply.code(400).send({ error: 'Preencha todas as variáveis do template.' });

    const phone = normalizePhone(phoneRaw);
    const sent = await whatsappService.sendTemplate(
      phone,
      templateName,
      params.map((text) => ({ text })),
      language,
    );
    if (!sent.ok) return reply.code(502).send({ error: sent.error });

    // Registra no histórico para a conversa aparecer no painel.
    const patient = await findOrCreatePatient(phone, req.body?.name?.trim() || null);
    const convo = await getOrCreateActiveConversation(patient.id);
    const text = renderTemplate(bodyText, params) || `[template: ${templateName}]`;
    const message = await saveMessage(convo.id, 'assistant', text);
    await touchConversation(convo.id);
    // Quem iniciou foi a recepção → a conversa é da atendente, não do bot.
    await setConversationIntake(convo.id, { category: 'atendente', action: null, subtype: null });
    await markHandedOff(convo.id);

    bus.emit('message:new', {
      conversationId: convo.id,
      patientId: patient.id,
      phone,
      role: 'assistant',
      content: text,
      at: message.created_at,
    });
    bus.emit('conversation:status', { conversationId: convo.id, patientId: patient.id, status: 'human' });

    return { ok: true, conversationId: convo.id, dryRun: sent.dryRun };
  });
}
