# Spec — Mídia no WhatsApp (áudio, imagem, documento): RECEBER + ENVIAR

> Feature pedida: fazer áudio/imagem funcionarem no bot. Escopo confirmado com o cliente:
> **receber + enviar**, com armazenamento **permanente**.
> Branch: `feature/whatsapp-media` (criada a partir da `main`).
> Implementar num chat novo (contexto cheio): "lê docs/media-feature-spec.md e implementa".

## Estado hoje
- Bot só trata texto/botão. Mídia recebida vira `content = '[mensagem não textual]'` (ver `bot.service.handle`).
- `whatsapp-inbound.ts` → `extractText` retorna null pra image/audio/etc.
- Envio (`whatsapp.service.ts`) só tem sendText/sendButtons/sendTemplate.
- Painel (`frontend/src/pages/Conversas.tsx`) só renderiza texto; botão de anexo/áudio hoje é `mediaSoon()` (alert placeholder).

## Decisão de armazenamento
**Guardar os bytes no Postgres (bytea)** numa tabela `media_files` — permanente, **zero setup novo** (usa a `DATABASE_URL` que já existe; sem bucket, sem env nova, sem SDK do Supabase).
- Prós: simples, funciona no deploy atual, atende "guardar pra sempre".
- Contra: consome espaço do banco (Supabase free = 500MB). Pra clínica pequena, ok. Se crescer, migrar pra Supabase Storage depois (trocar só a camada de storage).
- Meta apaga a URL de download rápido → por isso **baixamos e guardamos no ato**.

## Schema — `009` ou `010_message_media.sql`
> ⚠️ A branch `claude/gifted-goodall-e8d729` já tem um `009_conversation_intake.sql`. Pra não colidir, use **`010_message_media.sql`** nesta branch.
```sql
alter table messages add column if not exists media_type varchar(20);      -- image|audio|video|document|sticker
alter table messages add column if not exists media_mime varchar(120);
alter table messages add column if not exists media_filename varchar(255);
alter table messages add column if not exists media_caption text;
create table if not exists media_files (
  message_id uuid primary key references messages(id) on delete cascade,
  data bytea not null,
  created_at timestamptz not null default now()
);
```
Rodar via `npm run migrate` (Console do Railway) antes do deploy.

## Backend

### Tipos (`types/whatsapp.ts`)
- `WhatsAppIncomingMessage`: add `image?/audio?/video?/document?/sticker?` = `{ id: string; mime_type: string; caption?: string; filename?: string; voice?: boolean; sha256?: string }`.
- `InboundMessage`: add `media?: { id: string; type: string; mime: string; caption?: string; filename?: string }`.

### Extrair mídia (`lib/whatsapp-inbound.ts`)
- Para type ∈ {image,audio,video,document,sticker}: pegar o objeto correspondente (`m[m.type]`) → montar `media`. `text` = caption ?? null.

### Fila (`services/queue.service.ts` → `InboundJob`)
- Add `media?: { id; type; mime; caption?; filename? }`.
- `routes/webhook.ts` já chama `extractInboundMessages` → passar `media` no enqueue.

### Baixar da Meta (`services/media.service.ts` — NOVO)
```
downloadMedia(mediaId) -> { data: Buffer; mime: string }
  1) GET https://graph.facebook.com/v21.0/{mediaId}?access_token=TOKEN  -> { url, mime_type }
  2) GET {url}  (header Authorization: Bearer TOKEN)  -> arrayBuffer
  (usa env.WHATSAPP_TOKEN; apiVersion v21.0)
uploadMediaToMeta(phoneId, buffer, mime, filename) -> mediaId
  POST https://graph.facebook.com/v21.0/{phoneId}/media  (multipart: messaging_product=whatsapp, type=mime, file)
```

### Repositório (`repositories/message.repo.ts`)
- `Message`: add media_type, media_mime, media_filename, media_caption.
- `saveMessage(convId, role, content, media?)` — media opcional (grava as 4 colunas).
- `saveMediaBlob(messageId, data: Buffer)`.
- `getMediaFile(messageId) -> { mime, filename, data } | null`.
- `getLastMessages`/lista de conversa já retornam as colunas media (usar `select *`).

### Receber no bot (`services/bot.service.ts`)
- Em `handle`, quando `job.media`: baixar (`media.service.downloadMedia`) → `saveMessage(role user, content = caption ?? rótulo['[imagem]'/'[áudio]'/'[documento]'], media)` → `saveMediaBlob` → emitir `message:new` (incluir media). **Encaminhar pra recepção** (handoffHuman) — o bot não interpreta mídia. (Se estiver em `human`, só salva.)
- `saveOutgoing` continua igual (texto do bot).

### Servir mídia (`routes/media.ts` — NOVO, registrar em app.ts)
- `GET /api/media/:messageId?token=<JWT>` — auth pelo **token na query** (porque `<img>`/`<audio>` não mandam header Authorization). Validar via `verifyToken`. → `getMediaFile` → `reply.type(mime).send(data)`.

### Enviar mídia (`routes/conversations.ts`)
- `POST /api/conversations/:id/media` (auth normal) — **multipart** (add dep `@fastify/multipart`). Recebe `file` (+ caption opcional).
- Fluxo: ler buffer → `uploadMediaToMeta` → `whatsappService.sendMedia(phone, mediaId, type, caption?, filename?)` → `saveMessage(role assistant, content = caption ?? rótulo, media)` → `saveMediaBlob(buffer)` → emitir `message:new`.
- `whatsapp.service.ts`: `sendMedia(phone, mediaMetaId, type, caption?, filename?)` — payload `{ type, [type]: { id: mediaMetaId, caption?, filename? } }`, usa `toWhatsAppRecipient`.
- Limites Meta: imagem ≤5MB, áudio ≤16MB, vídeo ≤16MB, doc ≤100MB. Validar tamanho/mime.

## Frontend (`frontend/src/...`)
- `types.ts` Message: add media_type, media_mime, media_filename, media_caption.
- `lib/api.ts`: `mediaUrl(messageId)` = `${API_URL}/api/media/${id}?token=${auth.getToken()}`; `sendMedia(convId, file, caption?)` via `FormData` (POST /api/conversations/:id/media).
- `pages/Conversas.tsx` (render da mensagem):
  - `image`/`sticker` → `<img src={mediaUrl(m.id)} class="max-w-xs rounded-lg" />` (+ caption).
  - `audio` → `<audio controls src={mediaUrl(m.id)} />`.
  - `document` → link `<a href={mediaUrl(m.id)} download>{filename}</a>`.
- Upload: trocar `mediaSoon()` do `IconPaperclip` por `<input type=file>` → `sendMedia`. (Gravar áudio pelo mic = fase 2 opcional via `MediaRecorder`; começar só com upload de arquivo.)

## Dependências novas
- `@fastify/multipart` (backend, pro upload de envio).

## Bot: comportamento com mídia
Mídia recebida → salva + **encaminha pra recepção** (handoff). O bot não processa áudio/imagem. (Futuro: transcrição de áudio / visão via Claude — fora de escopo agora.)

## Testes (fim)
1. Receber: mandar **áudio** e **foto** do WhatsApp pro número → aparecem/tocam no painel (Conversas).
2. Enviar: anexar **foto** no painel → chega no WhatsApp do paciente.
3. Documento (PDF): receber e enviar.
4. Typecheck backend (`npm run typecheck`) + build frontend (`npm run build`).
5. Migration 010 aplicada no Railway antes do deploy.

## Deploy
- Branch `feature/whatsapp-media` → testar → merge `main` → Railway/Vercel deployam.
- Rodar `npm run migrate` no Console do Railway (aplica a 010).
- Reconciliar com `claude/gifted-goodall-e8d729` no merge (ambas tocam bot.service e migrations; sem conflito de tabela — media_files/messages vs conversations).
