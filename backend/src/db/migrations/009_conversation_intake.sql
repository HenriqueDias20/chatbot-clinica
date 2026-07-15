-- 009_conversation_intake.sql — bot vira triagem; métricas de atendimento
-- category/action/subtype: o assunto principal da conversa (último assunto vence).
-- timestamps: alimentam as métricas do dashboard (só passam a existir a partir do deploy).

alter table conversations
  add column if not exists category                varchar(20),
  add column if not exists action                  varchar(20),
  add column if not exists subtype                 varchar(60),
  add column if not exists handed_off_at           timestamptz,
  add column if not exists first_human_response_at timestamptz,
  add column if not exists closed_at               timestamptz,
  add column if not exists last_read_at            timestamptz;

create index if not exists idx_conversations_category   on conversations (category);
create index if not exists idx_conversations_handed_off on conversations (handed_off_at);
create index if not exists idx_conversations_created    on conversations (created_at);
