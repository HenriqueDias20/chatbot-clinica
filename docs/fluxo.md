# Fluxo do Sistema — Chatbot Fisioterapia

Diagramas em [Mermaid](https://mermaid.live). Cole o conteúdo de cada bloco em <https://mermaid.live> para visualizar/exportar (PNG/SVG), ou abra este arquivo no GitHub / VS Code (extensão *Markdown Preview Mermaid*) / Obsidian — todos renderizam nativamente.

---

## 1. Arquitetura (componentes)

```mermaid
flowchart LR
  WA["WhatsApp<br/>(Meta Cloud API)"] -->|"webhook POST"| WH["Fastify /webhook"]
  WH --> Q[("Fila<br/>BullMQ / memória")]
  Q --> BOT["Bot orquestrador<br/>(bot.service)"]

  BOT --> CL["Claude API<br/>(mock ou real)"]
  BOT --> AG["Agenda service<br/>(disponibilidade)"]
  BOT --> DB[("PostgreSQL<br/>Supabase")]
  BOT -->|"resposta"| WA

  BOT -->|"eventos"| BUS(["Event Bus<br/>(in-process)"])
  BUS --> IO["Socket.io"]
  IO -->|"tempo real"| UI["Painel React<br/>(Conversas / Agenda / Dashboard)"]

  UI -->|"REST /api"| API["Fastify REST"]
  API --> DB

  CRON["Cron jobs<br/>08:00 / a cada hora / 23:59"] --> DB
  CRON -->|"confirmações"| WA
```

---

## 2. Fluxo de decisão do bot (mensagem recebida)

```mermaid
flowchart TD
  A["Mensagem chega<br/>(webhook)"] --> B["Identifica/cria paciente<br/>(telefone normalizado)"]
  B --> C["Busca/cria conversa ativa"]
  C --> D["Salva mensagem do paciente"]
  D --> E{"Conversa em<br/>modo human?"}
  E -- "Sim" --> E1["Não responde<br/>(encaminha ao painel)"]
  E -- "Não" --> F{"Dentro do<br/>horário comercial?"}
  F -- "Não" --> F1["Envia mensagem padrão<br/>(fora do horário)"]
  F -- "Sim" --> G{"Estava escolhendo<br/>horário?"}
  G -- "Sim + número válido" --> G1["Verifica disponibilidade<br/>em tempo real"]
  G1 --> G2["Agenda e confirma ✅"]
  G -- "Não" --> H["Claude classifica intenção<br/>(últimas 10 mensagens)"]
  H --> I{"Intenção"}
  I -- "AGENDAR" --> J["Mostra próximos<br/>horários livres"]
  I -- "CONFIRMAR" --> K["Confirma próxima sessão"]
  I -- "CANCELAR" --> L["Cancela próxima sessão"]
  I -- "DÚVIDA / OUTRO" --> M["Responde via FAQ<br/>(Claude)"]
  I -- "FALAR_HUMANO" --> N["Conversa vira 'human'<br/>(painel notificado)"]

  G2 --> O["Salva resposta<br/>e envia via WhatsApp"]
  J --> O
  K --> O
  L --> O
  M --> O
  N --> O
```

---

## 3. Cron jobs

```mermaid
flowchart TD
  T1["08:00 (diário)"] --> A1["Envia confirmação das<br/>consultas de amanhã<br/>(1 - Sim / 2 - Cancelar)"]
  T2["A cada hora"] --> A2["Confirmações sem resposta<br/>há 2h → notifica painel"]
  T3["23:59 (diário)"] --> A3["Fecha conversas inativas<br/>há mais de 24h"]
```

---

## 4. Status da conversa (cores no painel)

```mermaid
stateDiagram-v2
  [*] --> bot
  bot --> human: paciente pede atendente<br/>ou recepção "Assumir"
  human --> bot: recepção "Devolver pro bot"
  bot --> closed: 24h sem mensagem (cron)
  human --> closed: 24h sem mensagem (cron)

  note right of bot
    Verde = bot respondendo
    Amarelo = aguardando paciente
  end note
  note right of human
    Vermelho = precisa de humano
  end note
```
