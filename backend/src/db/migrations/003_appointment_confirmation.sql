-- 003_appointment_confirmation.sql
-- Controle do envio de confirmação 24h antes (cron jobs da Etapa 11).

alter table appointments
  add column if not exists confirmation_sent_at timestamptz;

create index if not exists idx_appointments_confirmation
  on appointments (status, confirmation_sent_at);
