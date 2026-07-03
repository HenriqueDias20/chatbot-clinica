-- 002_conversation_state.sql
-- Estado do fluxo do bot por conversa (ex.: "escolhendo horário", opções oferecidas).
-- JSONB para manter o fluxo flexível — mudar/adicionar passos não exige migration nova.

alter table conversations
  add column if not exists state jsonb not null default '{}'::jsonb;

-- Garante no máximo UMA conversa não-fechada por paciente (evita conversas duplicadas).
create unique index if not exists uniq_open_conversation_per_patient
  on conversations (patient_id)
  where status <> 'closed';
