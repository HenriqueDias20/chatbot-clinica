-- 001_init.sql — schema inicial do chatbot de fisioterapia
-- Observação: usamos TIMESTAMPTZ (timezone-aware) no lugar de TIMESTAMP por
-- causa do agendamento e dos cron jobs em America/Sao_Paulo.

create extension if not exists "pgcrypto";

create table if not exists patients (
  id         uuid primary key default gen_random_uuid(),
  phone      varchar(20) unique not null,
  name       varchar(100),
  created_at timestamptz default now()
);

create table if not exists professionals (
  id        uuid primary key default gen_random_uuid(),
  name      varchar(100) not null,
  specialty varchar(100),
  active    boolean default true
);

create table if not exists availability (
  id                    uuid primary key default gen_random_uuid(),
  professional_id       uuid references professionals(id) on delete cascade,
  day_of_week           int check (day_of_week between 0 and 6), -- 0=domingo .. 6=sábado
  start_time            time,
  end_time              time,
  slot_duration_minutes int default 60
);

create table if not exists appointments (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid references patients(id) on delete cascade,
  professional_id uuid references professionals(id),
  scheduled_at    timestamptz not null,
  status          varchar(20) default 'confirmed'
                    check (status in ('confirmed','pending','cancelled','completed','no_show')),
  notes           text,
  created_at      timestamptz default now()
);

create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid references patients(id) on delete cascade,
  status          varchar(20) default 'bot' check (status in ('bot','human','closed')),
  last_message_at timestamptz,
  created_at      timestamptz default now()
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role            varchar(10) not null check (role in ('user','assistant','system')),
  content         text not null,
  created_at      timestamptz default now()
);

create table if not exists configs (
  key   varchar(50) primary key,
  value text not null
);

create table if not exists faq (
  id       uuid primary key default gen_random_uuid(),
  question text not null,
  answer   text not null,
  active   boolean default true
);

-- Índices para os acessos mais frequentes do bot e do painel.
create index if not exists idx_conversations_patient   on conversations (patient_id);
create index if not exists idx_conversations_status     on conversations (status);
create index if not exists idx_conversations_last_msg   on conversations (last_message_at);
create index if not exists idx_messages_conversation    on messages (conversation_id, created_at);
create index if not exists idx_appointments_scheduled   on appointments (scheduled_at);
create index if not exists idx_appointments_prof_time   on appointments (professional_id, scheduled_at);
create index if not exists idx_appointments_patient     on appointments (patient_id);
create index if not exists idx_appointments_status      on appointments (status);
create index if not exists idx_availability_prof_day    on availability (professional_id, day_of_week);
