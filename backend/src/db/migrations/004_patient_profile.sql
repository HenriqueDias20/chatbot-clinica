-- 004_patient_profile.sql
-- Dados do paciente coletados no fluxo guiado.

alter table patients
  add column if not exists cpf        varchar(14),
  add column if not exists birth_date date,
  add column if not exists insurance  varchar(100);
