-- 007_users_auth.sql
-- Usuários do painel (recepção) + rastreio de quem assumiu cada conversa.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  email varchar(160) not null unique,
  password_hash text not null,
  role varchar(20) not null default 'recepcao' check (role in ('recepcao', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Quem assumiu a conversa (recepcionista logada) e quando.
alter table conversations
  add column if not exists assigned_user_id uuid references users (id) on delete set null;
alter table conversations
  add column if not exists assigned_at timestamptz;

create index if not exists idx_conversations_assigned on conversations (assigned_user_id);
