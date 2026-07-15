-- 010_role_atendente.sql — papel "atendente" (acesso somente à aba de Conversas)
-- Idempotente: derruba o check antigo e recria permitindo 'atendente'.

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('recepcao', 'admin', 'atendente'));
