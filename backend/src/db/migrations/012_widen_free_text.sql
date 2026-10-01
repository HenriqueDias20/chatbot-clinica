-- 012_widen_free_text.sql — texto livre do paciente sem limite curto
-- subtype (60) estourava com "Consulta de Medicina do Esporte — Primeira Consulta / Pós-Operatório"
-- (68 caracteres): o banco recusava e o paciente ficava sem resposta. Trocar varchar por text não reescreve a tabela.

alter table conversations alter column subtype type text;
alter table patients alter column name type text;
alter table patients alter column insurance type text;
