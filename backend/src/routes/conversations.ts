import type { FastifyInstance } from 'fastify';
import {
  listConversationsForPanel,
  getConversationWithPatient,
  setConversationStatus,
  assignConversation,
  unassignConversation,
} from '../repositories/conversation.repo.js';
import { getLastMessages, saveMessage } from '../repositories/message.repo.js';
import { getPatientAppointments } from '../repositories/appointment.repo.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { bus } from '../lib/events.js';

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  // Todas as rotas do painel exigem login.
  app.addHook('preHandler', app.authenticate);

  // Lista conversas (ativas por padrão; ?filter=finalized para encerradas).
  app.get<{ Querystring: { filter?: string } }>('/api/conversations', async (req) => {
    const filter = req.query.filter === 'finalized' ? 'finalized' : 'active';
    const conversations = await listConversationsForPanel(filter);
    return { conversations };
  });

  // Histórico de mensagens + dados do contato + agendamentos do paciente.
  app.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (req, reply) => {
    const convo = await getConversationWithPatient(req.params.id);
    if (!convo) return reply.code(404).send({ error: 'Conversa não encontrada' });
    const [messages, appointments] = await Promise.all([
      getLastMessages(req.params.id, 200),
      getPatientAppointments(convo.patient_id),
    ]);
    return { conversation: convo, messages, appointments };
  });

  // Assumir conversa (recepção) → modo human + registra quem assumiu.
  app.post<{ Params: { id: string } }>('/api/conversations/:id/takeover', async (req, reply) => {
    const convo = await getConversationWithPatient(req.params.id);
    if (!convo) return reply.code(404).send({ error: 'Conversa não encontrada' });
    await assignConversation(convo.id, req.user!.id);
    bus.emit('conversation:status', {
      conversationId: convo.id,
      patientId: convo.patient_id,
      status: 'human',
      assignedUserId: req.user!.id,
      assignedUserName: req.user!.name,
    });
    return { ok: true, status: 'human', assignedUserName: req.user!.name };
  });

  // Devolver para o bot → modo bot (limpa o responsável).
  app.post<{ Params: { id: string } }>('/api/conversations/:id/release', async (req, reply) => {
    const convo = await getConversationWithPatient(req.params.id);
    if (!convo) return reply.code(404).send({ error: 'Conversa não encontrada' });
    await unassignConversation(convo.id);
    bus.emit('conversation:status', { conversationId: convo.id, patientId: convo.patient_id, status: 'bot' });
    return { ok: true, status: 'bot' };
  });

  // Encerrar atendimento → fecha a conversa (sai da lista de ativas).
  app.post<{ Params: { id: string } }>('/api/conversations/:id/close', async (req, reply) => {
    const convo = await getConversationWithPatient(req.params.id);
    if (!convo) return reply.code(404).send({ error: 'Conversa não encontrada' });
    await setConversationStatus(convo.id, 'closed');
    bus.emit('conversation:status', { conversationId: convo.id, patientId: convo.patient_id, status: 'closed' });
    return { ok: true, status: 'closed' };
  });

  // Recepcionista envia mensagem manual.
  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    '/api/conversations/:id/messages',
    async (req, reply) => {
      const text = (req.body?.text ?? '').trim();
      if (!text) return reply.code(400).send({ error: 'Texto vazio' });

      const convo = await getConversationWithPatient(req.params.id);
      if (!convo) return reply.code(404).send({ error: 'Conversa não encontrada' });

      const message = await saveMessage(convo.id, 'assistant', text);
      const result = await whatsappService.sendText(convo.phone, text);

      bus.emit('message:new', {
        conversationId: convo.id,
        patientId: convo.patient_id,
        phone: convo.phone,
        role: 'assistant',
        content: text,
        at: message.created_at,
      });

      return { ok: true, message, whatsapp: result };
    },
  );
}
