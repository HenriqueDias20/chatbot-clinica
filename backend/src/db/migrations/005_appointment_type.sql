-- 005_appointment_type.sql
-- Distinção entre Consulta (médico) e Sessão (fisioterapia).

-- Profissional pode ser médico, fisioterapeuta ou ambos.
alter table professionals
  add column if not exists role varchar(20) not null default 'fisioterapeuta'
    check (role in ('medico', 'fisioterapeuta', 'ambos'));

-- Tipo do agendamento.
alter table appointments
  add column if not exists kind varchar(20) not null default 'sessao'
    check (kind in ('consulta', 'sessao'));

create index if not exists idx_appointments_kind on appointments (kind);
create index if not exists idx_professionals_role on professionals (role);
