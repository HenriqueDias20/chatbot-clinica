import type { FastifyInstance } from 'fastify';
import {
  listConversationsForPanel,
  getConversationWithPatient,
  setConversationStatus,
  assignConversation,
  unassignConversation,
  markRead,
  markFirstHumanResponse,
} from '../repositories/conversation.repo.js';
import { getLastMessages, saveMessage, getMessageById } from '../repositories/message.repo.js';
import { createSignedUrl, buildMediaPath, uploadMedia } from '../services/storage.service.js';
import { getPatientAppointments } from '../repositories/appointment.repo.js';
import { whatsappService, mediaTypeFromMime } from '../services/whatsapp.service.js';
import { transcodeToOggOpus } from '../lib/audio.js';
import { bus } from '../lib/events.js';

const OUT_MEDIA_LABELS: Record<string, string> = {
  image: '📷 Foto',
  audio: '🎤 Áudio',
  video: '🎥 Vídeo',
  document: '📄 Documento',
};

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  // Todas as rotas do painel exigem login.
  app.addHook('preHandler', app.authenticate);

  // Lista conversas (ativas por padrão; ?filter=finalized|unread).
  app.get<{ Querystring: { filter?: string } }>('/api/conversations', async (req) => {
    const q = req.query.filter;
    const filter = q === 'finalized' || q === 'unread' ? q : 'active';
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

  // Link temporário para exibir a mídia (o bucket é privado — nada fica público).
  app.get<{ Params: { id: string } }>('/api/messages/:id/media', async (req, reply) => {
    const msg = await getMessageById(req.params.id);
    if (!msg?.media_path) return reply.code(404).send({ error: 'Mídia não encontrada' });
    const signed = await createSignedUrl(msg.media_path);
    if (!signed.ok) return reply.code(502).send({ error: signed.error });
    return { url: signed.url, mime: msg.media_mime, type: msg.media_type, name: msg.media_name };
  });

  // Marca a conversa como lida (atendente abriu no painel) → sai da aba "Não lidas".
  app.post<{ Params: { id: string } }>('/api/conversations/:id/read', async (req) => {
    await markRead(req.params.id);
    return { ok: true };
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
      // Se a conversa foi transbordada, registra a 1ª resposta do atendente (métrica de SLA).
      await markFirstHumanResponse(convo.id);
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

  // Recepcionista envia um anexo (foto/áudio/vídeo/documento) ao cliente.
  // Corpo em base64 (bodyLimit elevado). Sobe pra Meta, envia, e guarda no Storage p/ exibir.
  app.post<{
    Params: { id: string };
    Body: { fileBase64?: string; mime?: string; filename?: string; caption?: string };
  }>('/api/conversations/:id/media', { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    const { fileBase64, mime, filename, caption } = req.body ?? {};
    if (!fileBase64 || !mime) return reply.code(400).send({ error: 'Arquivo inválido.' });

    const convo = await getConversationWithPatient(req.params.id);
    if (!convo) return reply.code(404).send({ error: 'Conversa não encontrada' });

    const rawBuf = Buffer.from(fileBase64, 'base64');
    if (rawBuf.length === 0) return reply.code(400).send({ error: 'Arquivo vazio.' });

    const type = mediaTypeFromMime(mime);
    const cap = caption?.trim() || undefined;

    // Áudio gravado no navegador vem em webm → converte para ogg/opus (aceito pela Meta).
    let buf: Buffer = rawBuf;
    let outMime = mime;
    if (type === 'audio' && mime.toLowerCase().includes('webm')) {
      const conv = await transcodeToOggOpus(rawBuf);
      if (!conv.ok) return reply.code(502).send({ error: conv.error });
      buf = conv.data;
      outMime = 'audio/ogg';
    }

    // 1) sobe pra Meta e envia
    const up = await whatsappService.uploadMediaToMeta(buf, outMime, filename || 'arquivo');
    if (!up.ok) return reply.code(502).send({ error: up.error });
    const sent = await whatsappService.sendMedia(convo.phone, {
      type,
      mediaId: up.id,
      caption: cap,
      filename: filename || undefined,
    });
    if (!sent.ok) return reply.code(502).send({ error: sent.error });

    // 2) guarda no Storage para o painel exibir (best-effort — se falhar, ainda registra)
    let media: { type: string; path: string; mime: string; name?: string | null } | undefined;
    const stored = await uploadMedia(buildMediaPath(convo.id, outMime), buf, outMime);
    if (stored.ok) media = { type, path: stored.path, mime: outMime, name: filename ?? null };

    // 3) registra no histórico
    const content = cap ?? OUT_MEDIA_LABELS[type] ?? '[mídia]';
    const message = await saveMessage(convo.id, 'assistant', content, media);
    await markFirstHumanResponse(convo.id);

    bus.emit('message:new', {
      conversationId: convo.id,
      patientId: convo.patient_id,
      phone: convo.phone,
      role: 'assistant',
      content,
      at: message.created_at,
    });

    return { ok: true, message, dryRun: sent.dryRun };
  });
}
