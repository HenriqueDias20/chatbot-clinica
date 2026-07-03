-- 008_patient_is_demo.sql
-- Marca pacientes criados pela simulação (Demo) para poderem ser limpos com segurança.

alter table patients add column if not exists is_demo boolean not null default false;

-- Marca os pacientes de demo já existentes (personas fictícias da simulação).
update patients set is_demo = true
where name in ('Patrícia Gomes', 'Carlos Henrique', 'Juliana Martins', 'Roberto Alves');
