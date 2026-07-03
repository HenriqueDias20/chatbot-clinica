-- 006_inactivity_reminder.sql
-- Controle de lembrete de inatividade enviado para a conversa.

alter table conversations
  add column if not exists inactivity_reminder_at timestamptz;

create index if not exists idx_conversations_reminder
  on conversations (inactivity_reminder_at) where status <> 'closed';
