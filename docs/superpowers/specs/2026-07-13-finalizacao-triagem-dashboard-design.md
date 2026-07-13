# Design — Finalização: bot como triagem + aba "Não lido" + Dashboard de conversas

> Data: 2026-07-13. Status: aprovado para implementação.

## Contexto e propósito

O chatbot deixa de **agendar**. Ele passa a ser uma **triagem / pré-atendimento**: coleta a
identidade do cliente (nome, CPF, nascimento, convênio) e a **intenção** (o que ele quer), e então
**transborda** para uma atendente, que finaliza tudo manualmente em outro sistema. O bot existe para
a recepção já ter uma **prévia** do que o cliente quer e dos seus dados.

Este spec cobre três blocos acoplados, implementados nesta ordem:

1. **Fluxo do bot + schema** (pré-requisito dos demais)
2. **Aba "Não lido"** no painel de conversas
3. **Dashboard novo** (relatório de conversas/atendimentos)

## Decisões travadas

- **Tudo vira transbordo**: Agendar / Reagendar / Cancelar / Confirmar coletam o detalhe e passam
  para a atendente. O bot nunca mais escreve na tabela `appointments`.
- **1 assunto principal por conversa**: cada conversa grava uma categoria/ação/tipo — a seleção que
  levou ao transbordo (último assunto vence). Total de conversas = soma das categorias.
- **"Não lido" = nova mensagem do cliente ainda não aberta**: rastreado por `last_read_at` na conversa.
- **Agenda manual no painel: fora de escopo** — a recepção agenda em outro sistema.
- **Métricas de tempo e "resolvido por" começam a existir a partir do deploy** — conversas antigas
  ficam sem esses números.

---

## Bloco 1 — Fluxo do bot + schema

### Fluxo (menu-driven)

```
Cadastro (CPF → nome → nascimento)                         [inalterado]
Menu principal: 1 Consulta · 2 Sessão · 3 Localização/Horário · 4 Falar com atendente · 5 Encerrar

1/2 (Consulta/Sessão) → Ação: 1 Agendar · 2 Reagendar · 3 Cancelar · 4 Confirmar · 5 Voltar
        ├─ Agendar/Reagendar → Tipo → Convênio → TRANSBORDO  (grava categoria+ação+tipo+convênio)
        └─ Cancelar/Confirmar →                   TRANSBORDO  (grava categoria+ação)
3 (Localização/Horário) → mostra info → volta/encerra        [self-service, sem transbordo]
4 (Falar com atendente) →                          TRANSBORDO (categoria = atendente)
5 (Encerrar)            → fecha
```

- **Transborda** (status → `human`, grava `handed_off_at`): Consulta, Sessão (todas as ações) e
  "Falar com atendente".
- **Self-service** (sem transbordo): Localização/Horário (mostra e volta ao menu) e Encerrar.
- O atalho por palavra-chave (`HUMAN_KEYWORDS`) continua transbordando a qualquer momento
  (categoria = atendente).

### Taxonomia

**Categoria** (4 fixas): `consulta` · `sessao` · `localizacao` · `atendente`

**Ação** (Consulta/Sessão): `agendar` · `reagendar` · `cancelar` · `confirmar`

**Tipo** (só para Agendar/Reagendar):

- **Consulta:** Primeira consulta · Retorno · Pós-operatório · Fisiatria · Medicina do Esporte ·
  Avaliação (→ Antropometria · Baropodometria · Ergoespirometria · FMS) · Outros
- **Sessão:** Fisioterapia · Cinesioterapia · Particular · Pélvica · Pilates · RPG · Outros

**Convênio** (inalterado): Particular · Cabergs · Unimed · Saúde Caixa · Amil · Geap · Ipê Saúde · Outros

### Resumo pro atendente (painel)

Ao transbordar, o painel exibe um card **"Resumo do pedido"** próximo aos dados do contato, com:
categoria · ação · tipo · convênio. É a prévia que a recepção usa para finalizar.

### Schema — migration `009_conversation_intake.sql`

Colunas novas em `conversations`:

| coluna                   | tipo         | uso                                             |
|--------------------------|--------------|-------------------------------------------------|
| `category`               | varchar(20)  | `consulta`/`sessao`/`localizacao`/`atendente`   |
| `action`                 | varchar(20)  | `agendar`/`reagendar`/`cancelar`/`confirmar`    |
| `subtype`                | varchar(60)  | tipo (ex.: "Fisioterapia", "Primeira consulta") |
| `handed_off_at`          | timestamptz  | quando foi pro humano (transbordo)              |
| `first_human_response_at`| timestamptz  | 1ª mensagem do atendente após o transbordo      |
| `closed_at`              | timestamptz  | quando a conversa foi fechada                    |
| `last_read_at`           | timestamptz  | quando um atendente abriu a conversa (bloco 2)  |

- `category`/`action`/`subtype`: gravados conforme o cliente seleciona; a seleção que leva ao
  transbordo é a que permanece (último assunto vence → "1 assunto principal").
- `resolvido por` é **derivado**: `handed_off_at IS NULL` → bot/self-service; senão → atendente.
- `closed_at` é preenchido em todo caminho que fecha a conversa (encerrar do cliente, finalizar no
  painel, auto-close por inatividade).

### Código a remover/desativar (o bot não agenda mais)

- Em `bot.service.ts`: `startScheduling`, passo `choosing_slot`, e as chamadas a `scheduleIfFree`,
  `getNextFreeSlots`, `cancelAppointment`, `confirmAppointment`. Substituídos por
  coletar-detalhe → `handoffHuman`.
- `agenda.service.ts` e os repos de appointment permanecem (podem ser usados por Agenda/relatórios),
  apenas deixam de ser chamados pelo fluxo do bot.

### Demo

Os roteiros de `demo.service.ts` são ajustados para refletir o novo fluxo (transbordo pós-convênio,
sem simular agendamento).

---

## Bloco 2 — Aba "Não lido"

- Reaproveita `last_read_at` (bloco 1).
- **Endpoint** `POST /api/conversations/:id/read` → seta `last_read_at = now()`. Disparado quando o
  atendente abre uma conversa no painel.
- **Regra de não-lida:** `status <> 'closed'` **E** última mensagem é do cliente (`last_role = 'user'`)
  **E** (`last_read_at IS NULL` OU `last_read_at < last_message_at`).
- **Backend:** `listConversationsForPanel` ganha o filtro `unread`; o retorno inclui `last_read_at`.
- **Frontend** (`Conversas.tsx`): abas passam a ser **Ativas · Não lidas · Finalizadas**, com
  contador na aba "Não lidas". Ao selecionar uma conversa, chama o endpoint de "read" e invalida a lista.

---

## Bloco 3 — Dashboard novo (relatório de conversas)

Reescrita completa de `GET /api/dashboard` e de `Dashboard.tsx`. **100% baseado em conversas**
(os cartões de agendamento saem).

### Filtro de período (topo)
- Seletor de **mês** (padrão: mês atual) + suporte a range.
- Toggle de agrupamento **dia / semana**.
- Botão **Exportar CSV** à direita.
- Todos os blocos respeitam o período.

### Cards de resumo
- Total de conversas (por `created_at` no período)
- Resolvidas pelo bot — qtd + % (`handed_off_at IS NULL` e fechadas)
- Encaminhadas para atendente — qtd + % (`handed_off_at IS NOT NULL`)
- Tempo médio de resposta = média de `first_human_response_at − handed_off_at`
- Aguardando atendente agora — vermelho quando > 0 (realtime: `status='human'` e `last_role='user'`)

### Gráfico de conversas por data
Barras, total por dia (ou por semana), conforme o toggle.

### Assunto + subcategoria
- Rosca por **categoria** (Consulta / Sessão / Localização / Atendente) com qtd e %.
- **Subcategoria** por **ação** (drill-down por categoria). O **tipo** aparece no CSV/detalhe.

### Métricas por atendente (tabela)
Por atendente, no período:
- Nº de conversas atendidas (`assigned_user_id`)
- Tempo médio de 1ª resposta = média de `first_human_response_at − handed_off_at`
- Tempo médio de duração = média de `closed_at − assigned_at`
- Nº de conversas finalizadas (`closed_at` no período)

### Conversas por cliente (tabela)
Nome · telefone · nº de conversas no período · assunto mais comum · último contato.
Ordenada por nº de conversas; busca por nome ou telefone.

### Exportação CSV
- **Aba "Conversas"** (uma linha por conversa): início, fim, cliente, telefone, categoria, ação,
  tipo, convênio, atendente, resolvido_por, status, tempo 1ª resposta, duração.
- **Aba "Resumo por atendente"**: a tabela acima.
- Separador `;`, **UTF-8 com BOM** (acentos corretos no Excel).

---

## Fora de escopo (agora)
- Criar/editar agendamento manual no painel (recepção usa outro sistema).
- Página **Agenda** do painel (pode secar sem o bot agendar) — sem mudanças neste pacote.
- Troca de senha das recepcionistas, dados reais de endereço/profissionais (itens do `transicao.md`).

## Ordem de implementação
1. Bloco 1 — migration `009` + fluxo do bot + repos + card de resumo + demo.
2. Bloco 2 — endpoint de "read" + filtro `unread` + aba no painel.
3. Bloco 3 — endpoint do dashboard + `Dashboard.tsx` + CSV.
