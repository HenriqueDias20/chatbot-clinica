# Chatbot WhatsApp — Clínica de Fisioterapia

Bot de WhatsApp para agendamento + painel de controle para a recepção. O bot recebe mensagens, classifica a intenção (agendar, cancelar, confirmar, dúvida, falar com humano) e responde automaticamente; a recepção acompanha tudo em tempo real, pode assumir conversas e gerenciar a agenda.

## Stack

- **Backend:** Node.js + Fastify + TypeScript (strict)
- **Banco:** PostgreSQL (Supabase) · **Fila:** Redis + BullMQ (com fallback em memória)
- **IA:** Anthropic Claude API (classificação de intenção + respostas via FAQ)
- **WhatsApp:** Meta Cloud API (webhook + envio)
- **Tempo real:** Socket.io
- **Frontend:** React + TypeScript + Tailwind + React Query + Socket.io
- **Infra:** Docker Compose + Nginx

## Estrutura

```
chatbot-fisioterapia/
├── docker-compose.yml      # postgres, redis, backend, frontend, nginx
├── nginx.conf
├── docs/postman_collection.json
├── backend/
│   ├── src/
│   │   ├── config/         # env (validado com Zod)
│   │   ├── db/             # pool, migrations, seed, runner
│   │   ├── lib/            # logger, phone, signature, events (bus)
│   │   ├── repositories/   # acesso ao banco
│   │   ├── routes/         # webhook, conversations, agenda, dashboard, health
│   │   ├── services/       # whatsapp, claude, agenda, queue, bot, cron
│   │   ├── bot/            # consumer (fila) + scheduler (cron)
│   │   ├── websocket/      # socket.io
│   │   └── server.ts
│   └── scripts/            # smoke tests (testáveis sem WhatsApp real)
└── frontend/
    └── src/
        ├── pages/          # Conversas, Agenda, Dashboard
        ├── lib/            # api, socket
        └── hooks/          # useRealtime
```

## Pré-requisitos

- Node.js 20+
- Conta no [Supabase](https://supabase.com) (PostgreSQL grátis)
- (Opcional) [Upstash](https://upstash.com) para Redis em produção
- (Opcional) App no [Meta for Developers](https://developers.facebook.com) + chave [Anthropic](https://console.anthropic.com) para uso real

> **Modos mock:** sem `ANTHROPIC_API_KEY`, o Claude usa heurística (sem custo). Sem `WHATSAPP_TOKEN`, o envio fica em *dry-run* (loga em vez de enviar). Com `REDIS_ENABLED=false`, a fila roda em memória. Isso permite desenvolver e testar **tudo** sem credenciais pagas.

## Setup (desenvolvimento)

```bash
# 1. Backend
cd backend
cp ../.env.example .env        # e preencha DATABASE_URL (Supabase)
npm install
npm run migrate                # cria as tabelas
npm run seed                   # dados iniciais (profissionais, FAQ, configs)
npm run dev                    # sobe em http://localhost:3000

# 2. Frontend (outro terminal)
cd frontend
npm install
npm run dev                    # sobe em http://localhost:5173
```

### Variáveis de ambiente (`backend/.env`)

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String do Supabase (Session Pooler para IPv4) |
| `REDIS_URL` / `REDIS_ENABLED` | Redis/Upstash; `false` = fila em memória |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | Claude; vazio = mock. Default `claude-haiku-4-5` |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Envio Meta; vazio = dry-run |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | Verificação + assinatura do webhook |
| `BUSINESS_HOURS_START` / `END` / `TIMEZONE` | Horário comercial e fuso |

## Testes

Scripts de smoke (rodam contra o banco real, sem WhatsApp/Claude reais):

```bash
cd backend
npx tsx scripts/smoke-webhook.ts     # webhook GET/POST
npx tsx scripts/smoke-whatsapp.ts    # envio (texto/botões/template)
npx tsx scripts/smoke-claude.ts      # classificação + FAQ
npx tsx scripts/smoke-bot.ts         # fluxo completo do bot
npx tsx scripts/smoke-socket.ts      # WebSocket
npx tsx scripts/smoke-api.ts         # API de conversas
npx tsx scripts/smoke-agenda.ts      # agenda + agendamento manual
npx tsx scripts/smoke-cron.ts        # cron jobs
npx tsx scripts/live-http.ts         # servidor HTTP real, ponta a ponta
npx tsx scripts/live-scenarios.ts    # cancelar / humano / fora do horário
```

Também há uma **coleção do Postman** em `docs/postman_collection.json`.

## Cron jobs

Agendados em `src/bot/scheduler.ts` (fuso de `TIMEZONE`):

- **08:00** — envia confirmação das consultas de amanhã (`1 - Sim / 2 - Cancelar`)
- **A cada hora** — confirmações sem resposta há 2h → notifica o painel
- **23:59** — fecha conversas inativas há +24h

## Regras de negócio

- Nunca responder conversa em modo *human* (recepção assumiu)
- Sempre salvar todas as mensagens
- Verificar disponibilidade em tempo real antes de confirmar agendamento
- Normalizar telefone antes de salvar
- Fora do horário comercial → mensagem padrão configurável
- Limite de 10 mensagens de contexto para o Claude

## Produção

1. **Banco:** Supabase Pro (backup automático — recomendado para dados de paciente / LGPD).
2. **Redis:** `REDIS_ENABLED=true` + `REDIS_URL` do Upstash.
3. **Claude:** adicionar `ANTHROPIC_API_KEY` com créditos.
4. **WhatsApp:** criar app na Meta, preencher `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`. O webhook precisa de URL pública HTTPS (`https://SEU-DOMINIO/webhook`).
5. **Deploy:** `docker compose up --build` (ou um PaaS como Render/Railway).

### Webhook em dev (túnel)

```bash
npx cloudflared tunnel --url http://localhost:3000
# cole https://SEU-TUNEL/webhook + o verify token no painel da Meta
```

## Licença

Privado — projeto sob encomenda.
