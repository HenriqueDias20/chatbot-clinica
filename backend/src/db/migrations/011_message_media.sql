-- 011_message_media.sql — mídia (foto/áudio/documento) nas mensagens
-- O arquivo em si fica no Supabase Storage (bucket privado); aqui guardamos só a referência.

alter table messages
  add column if not exists media_type varchar(20),   -- image | audio | video | document | sticker
  add column if not exists media_path text,          -- caminho dentro do bucket
  add column if not exists media_mime varchar(100),
  add column if not exists media_name text;          -- nome original (documentos)

create index if not exists idx_messages_media on messages (media_type) where media_type is not null;
