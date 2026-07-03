import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { bus } from '../lib/events.js';
import { whatsappService } from './whatsapp.service.js';
import {
  getDayAppointmentsDetailed,
  markConfirmationSent,
  getUnconfirmedAfter,
} from '../repositories/appointment.repo.js';
import { listActiveProfessionals } from '../repositories/professional.repo.js';
import {
  closeInactiveConversations,
  findConversationsForReminder,
  findConversationsToAutoClose,
  markReminderSent,
  setConversationStatus,
  setConversationState,
} from '../repositories/conversation.repo.js';
import { saveMessage } from '../repositories/message.repo.js';
import { getConfig } from '../repositories/config.repo.js';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: env.TIMEZONE,
  });
}

/** Job 08:00 — envia confirmação para as consultas de amanhã. */
export async function sendTomorrowConfirmations(): Promise<{ sent: number }> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const appts = await getDayAppointmentsDetailed(tomorrow);
  const professionals = await listActiveProfessionals();
  const profName = new Map(professionals.map((p) => [p.id, p.name]));
  const clinic = (await getConfig('clinic_name')) ?? 'a clínica';

  let sent = 0;
  for (const a of appts) {
    const nome = a.patient_name ?? '';
    const hora = formatTime(a.scheduled_at);
    const prof = profName.get(a.professional_id) ?? 'seu profissional';
    const text = `Olá ${nome}! Aqui é ${clinic}. Confirmando sua sessão amanhã às ${hora} com ${prof}. Você confirma?`;
    await whatsappService.sendButtons(a.phone, text, [
      { id: 'confirmar_sim', title: '1 - Sim' },
      { id: 'cancelar', title: '2 - Cancelar' },
    ]);
    await markConfirmationSent(a.id);
    sent++;
  }
  logger.info({ sent }, 'Cron 08:00 — confirmações de amanhã enviadas');
  return { sent };
}

/** Job a cada hora — confirmações sem resposta após N horas → notifica o painel. */
export async function checkUnconfirmed(hours = 2): Promise<{ flagged: number }> {
  const appts = await getUnconfirmedAfter(hours);
  for (const a of appts) {
    bus.emit('appointment:unconfirmed', {
      appointmentId: a.id,
      patientName: a.patient_name,
      phone: a.phone,
      scheduledAt: a.scheduled_at,
    });
  }
  if (appts.length > 0) {
    logger.warn({ flagged: appts.length }, 'Cron horário — confirmações sem resposta, painel notificado');
  }
  return { flagged: appts.length };
}

/**
 * Cron de inatividade no atendimento automático:
 * - Após `reminderMin` min sem resposta → envia lembrete com opções (1 menu / 2 encerrar).
 * - Se continuar sem resposta por mais `autoCloseMin` min → encerra automaticamente.
 */
export async function checkInactivity(reminderMin = 10, autoCloseMin = 5): Promise<{ reminded: number; closed: number }> {
  // 1) Enviar lembretes
  const toRemind = await findConversationsForReminder(reminderMin);
  for (const c of toRemind) {
    const reminder =
      'Ainda está aí? Posso te ajudar com mais alguma coisa?\n\n' +
      '1️⃣ Voltar ao menu principal\n2️⃣ Encerrar atendimento';
    await whatsappService.sendText(c.phone, reminder);
    await saveMessage(c.id, 'assistant', reminder);
    await markReminderSent(c.id);
    // Deixa a conversa aguardando a escolha 1/2 (mesmo passo de uma resposta automática).
    await setConversationState(c.id, { step: 'post_answer' });
    bus.emit('message:new', {
      conversationId: c.id,
      patientId: c.patient_id,
      phone: c.phone,
      role: 'assistant',
      content: reminder,
      at: new Date().toISOString(),
    });
  }
  if (toRemind.length > 0) logger.info({ reminded: toRemind.length }, 'Lembretes de inatividade enviados');

  // 2) Auto-fechar quem não respondeu ao lembrete dentro do prazo
  const toClose = await findConversationsToAutoClose(autoCloseMin);
  for (const c of toClose) {
    const farewell =
      'Como não tivemos retorno, este atendimento foi encerrado automaticamente. ' +
      'Caso precise de ajuda, envie uma nova mensagem. 🙂';
    await whatsappService.sendText(c.phone, farewell);
    await saveMessage(c.id, 'assistant', farewell);
    await setConversationStatus(c.id, 'closed');
    await setConversationState(c.id, {});
    bus.emit('conversation:status', { conversationId: c.id, patientId: c.patient_id, status: 'closed' });
  }
  if (toClose.length > 0) logger.info({ closed: toClose.length }, 'Conversas auto-fechadas por inatividade');

  return { reminded: toRemind.length, closed: toClose.length };
}

/** Job 23:59 — fecha conversas inativas há mais de N horas. */
export async function closeInactive(hours = 24): Promise<{ closed: number }> {
  const closed = await closeInactiveConversations(hours);
  logger.info({ closed }, 'Cron 23:59 — conversas inativas fechadas');
  return { closed };
}
