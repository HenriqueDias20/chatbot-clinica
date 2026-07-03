import { query } from '../db/pool.js';

export type ConversationStatus = 'bot' | 'human' | 'closed';

export interface Conversation {
  id: string;
  patient_id: string;
  status: ConversationStatus;
  state: Record<string, unknown>;
  last_message_at: string | null;
  created_at: string;
}

/** Busca a conversa ativa (não fechada) do paciente ou cria uma nova. */
export async function getOrCreateActiveConversation(patientId: string): Promise<Conversation> {
  const existing = await query<Conversation>(
    `select * from conversations where patient_id = $1 and status <> 'closed' order by created_at desc limit 1`,
    [patientId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await query<Conversation>(
    `insert into conversations (patient_id, status, last_message_at) values ($1, 'bot', now()) returning *`,
    [patientId],
  );
  return created.rows[0]!;
}

export interface ConversationListItem {
  id: string;
  status: ConversationStatus;
  last_message_at: string | null;
  created_at: string;
  patient_id: string;
  phone: string;
  name: string | null;
  last_message: string | null;
  last_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_at: string | null;
}

/** Conversas para o painel (ativas ou finalizadas), com dados do paciente e prévia da última mensagem. */
export async function listConversationsForPanel(
  filter: 'active' | 'finalized' = 'active',
): Promise<ConversationListItem[]> {
  const whereStatus = filter === 'finalized' ? "c.status = 'closed'" : "c.status <> 'closed'";
  const res = await query<ConversationListItem>(
    `select c.id, c.status, c.last_message_at, c.created_at,
            p.id as patient_id, p.phone, p.name,
            lm.content as last_message, lm.role as last_role,
            c.assigned_user_id, c.assigned_at, u.name as assigned_user_name
     from conversations c
     join patients p on p.id = c.patient_id
     left join users u on u.id = c.assigned_user_id
     left join lateral (
       select content, role from messages m
       where m.conversation_id = c.id order by m.created_at desc limit 1
     ) lm on true
     where ${whereStatus}
     order by c.last_message_at desc nulls last`,
  );
  return res.rows;
}

/** Contagens para o Dashboard. */
export async function getConversationCounts(): Promise<{ active: number; waitingHuman: number }> {
  const res = await query<{ active: number; waiting_human: number }>(
    `select
       count(*) filter (where status <> 'closed')::int as active,
       count(*) filter (where status = 'human')::int as waiting_human
     from conversations`,
  );
  return { active: res.rows[0]?.active ?? 0, waitingHuman: res.rows[0]?.waiting_human ?? 0 };
}

export interface ConversationWithPatient extends Conversation {
  phone: string;
  name: string | null;
  cpf: string | null;
  birth_date: string | null;
  insurance: string | null;
  patient_created_at: string;
  assigned_user_id: string | null;
  assigned_at: string | null;
  assigned_user_name: string | null;
}

export async function getConversationWithPatient(id: string): Promise<ConversationWithPatient | null> {
  const res = await query<ConversationWithPatient>(
    `select c.*, p.phone, p.name, p.cpf, p.birth_date, p.insurance, p.created_at as patient_created_at,
            u.name as assigned_user_name
     from conversations c
     join patients p on p.id = c.patient_id
     left join users u on u.id = c.assigned_user_id
     where c.id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function setConversationStatus(id: string, status: ConversationStatus): Promise<void> {
  await query(`update conversations set status = $2 where id = $1`, [id, status]);
}

/** Recepcionista assume a conversa: vira 'human' e registra quem/quando. */
export async function assignConversation(id: string, userId: string): Promise<void> {
  await query(
    `update conversations set status = 'human', assigned_user_id = $2, assigned_at = now() where id = $1`,
    [id, userId],
  );
}

/** Devolve a conversa ao bot e limpa o responsável. */
export async function unassignConversation(id: string): Promise<void> {
  await query(
    `update conversations set status = 'bot', assigned_user_id = null, assigned_at = null where id = $1`,
    [id],
  );
}

export async function setConversationState(id: string, state: Record<string, unknown>): Promise<void> {
  await query(`update conversations set state = $2::jsonb where id = $1`, [id, JSON.stringify(state)]);
}

export async function touchConversation(id: string): Promise<void> {
  await query(`update conversations set last_message_at = now() where id = $1`, [id]);
}

export interface InactiveConvo {
  id: string;
  patient_id: string;
  phone: string;
  name: string | null;
  last_message_at: string;
}

/**
 * Conversas que precisam de LEMBRETE de inatividade:
 * - Em modo bot (não human, não closed)
 * - Sem mensagem há `minutes` minutos
 * - Que ainda não receberam lembrete
 */
export async function findConversationsForReminder(minutes: number): Promise<InactiveConvo[]> {
  const res = await query<InactiveConvo>(
    `select c.id, c.patient_id, p.phone, p.name, c.last_message_at
     from conversations c
     join patients p on p.id = c.patient_id
     where c.status = 'bot'
       and c.inactivity_reminder_at is null
       and c.last_message_at is not null
       and c.last_message_at < now() - ($1 || ' minutes')::interval`,
    [String(minutes)],
  );
  return res.rows;
}

/**
 * Conversas que receberam lembrete há mais de `minutes` minutos e o paciente
 * não respondeu desde então → devem ser fechadas automaticamente.
 */
export async function findConversationsToAutoClose(minutes: number): Promise<InactiveConvo[]> {
  const res = await query<InactiveConvo>(
    `select c.id, c.patient_id, p.phone, p.name, c.last_message_at
     from conversations c
     join patients p on p.id = c.patient_id
     where c.status = 'bot'
       and c.inactivity_reminder_at is not null
       and c.inactivity_reminder_at < now() - ($1 || ' minutes')::interval
       and c.last_message_at <= c.inactivity_reminder_at`,
    [String(minutes)],
  );
  return res.rows;
}

/** Marca que o lembrete de inatividade foi enviado agora. */
export async function markReminderSent(id: string): Promise<void> {
  await query(`update conversations set inactivity_reminder_at = now() where id = $1`, [id]);
}

/** Limpa o carimbo de lembrete (usado quando o paciente responde). */
export async function clearReminder(id: string): Promise<void> {
  await query(`update conversations set inactivity_reminder_at = null where id = $1`, [id]);
}

/** Fecha conversas inativas há mais de N horas (cron da Etapa 11). Retorna qtd fechada. */
export async function closeInactiveConversations(hours: number): Promise<number> {
  const res = await query(
    `update conversations set status = 'closed'
     where status <> 'closed' and last_message_at < now() - ($1 || ' hours')::interval`,
    [String(hours)],
  );
  return res.rowCount ?? 0;
}
