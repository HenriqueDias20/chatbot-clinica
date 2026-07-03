\# CLAUDE.md — Chatbot Fisioterapia



\## Stack

\- Backend: Node.js + Fastify + TypeScript

\- Banco: PostgreSQL + Redis

\- Fila: BullMQ

\- WhatsApp: Meta Cloud API

\- IA: Anthropic Claude API

\- Frontend: React + TypeScript + Tailwind + Socket.io



\## Convenções

\- Sempre TypeScript strict

\- Logs em JSON estruturado

\- Variáveis de ambiente para toda credencial

\- Tratar erro em toda chamada externa



\## Estrutura de pastas

(cola a estrutura que defini no prompt anterior)



\## Regras de negócio críticas

\- Nunca responder conversa em modo "human"

\- Normalizar telefone antes de salvar

\- Limite de 10 mensagens de contexto pro Claude

