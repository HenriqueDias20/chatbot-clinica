# Finalização (bot triagem + não lido + dashboard) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o bot em triagem (tudo transborda, sem agendar), adicionar aba "Não lido" no painel e reescrever o Dashboard como relatório de conversas com CSV.

**Architecture:** O bot grava `category/action/subtype` na conversa conforme o cliente navega e transborda para o atendente; timestamps (`handed_off_at`, `first_human_response_at`, `closed_at`, `last_read_at`) alimentam as métricas. O Dashboard consulta essas colunas por período.

**Tech Stack:** Node/Fastify/TS, PostgreSQL (migrations .sql puras), React/Vite/Tailwind, TanStack Query.

**Verificação (sem testes no projeto):** `cd backend && npm run typecheck`; `cd frontend && npm run build`. Onde fizer sentido, rodar o app e checar via console/preview.

---

## File map

**Backend**
- Create `backend/src/db/migrations/009_conversation_intake.sql` — colunas novas em `conversations`.
- Modify `backend/src/repositories/conversation.repo.ts` — intake fields, timestamps, filtro `unread`, analytics.
- Create `backend/src/repositories/analytics.repo.ts` — queries do dashboard (conversas).
- Modify `backend/src/services/bot.service.ts` — fluxo "tudo transborda"; grava intake.
- Modify `backend/src/routes/conversations.ts` — endpoint `read`; `first_human_response`; `closed_at`; filtro `unread`.
- Rewrite `backend/src/routes/dashboard.ts` — período (mês) + grupo dia/semana + CSV.
- Modify `backend/src/services/demo.service.ts` — roteiros refletindo transbordo.

**Frontend**
- Modify `frontend/src/types.ts` — tipos de conversa e `DashboardData`.
- Modify `frontend/src/lib/api.ts` — `unread`, `markRead`, dashboard novo, export CSV.
- Modify `frontend/src/pages/Conversas.tsx` — aba "Não lidas", marcar lido, card "Resumo do pedido".
- Rewrite `frontend/src/pages/Dashboard.tsx` — relatório de conversas.

---

## Bloco 1 — Fluxo do bot + schema

### Task 1: Migration 009
**Files:** Create `backend/src/db/migrations/009_conversation_intake.sql`

- [ ] Escrever a migration:
```sql
-- 009_conversation_intake.sql — bot vira triagem; métricas de atendimento
alter table conversations
  add column if not exists category                varchar(20),
  add column if not exists action                  varchar(20),
  add column if not exists subtype                 varchar(60),
  add column if not exists handed_off_at           timestamptz,
  add column if not exists first_human_response_at timestamptz,
  add column if not exists closed_at               timestamptz,
  add column if not exists last_read_at            timestamptz;

create index if not exists idx_conversations_category   on conversations (category);
create index if not exists idx_conversations_handed_off on conversations (handed_off_at);
create index if not exists idx_conversations_created    on conversations (created_at);
```
- [ ] Verificar: `cd backend && npm run typecheck` (migration é SQL, mas garante que nada quebrou). Aplicação real roda depois no ambiente.

### Task 2: Repo — intake, timestamps, unread
**Files:** Modify `backend/src/repositories/conversation.repo.ts`

- [ ] Adicionar ao `ConversationListItem` e ao `ConversationWithPatient` os campos: `category`, `action`, `subtype`, `handed_off_at`, `last_read_at` (strings/nulos). `getConversationWithPatient` já faz `select c.*` → só atualizar a interface. `listConversationsForPanel` já faz `select c.id, ...` → **adicionar** `c.category, c.action, c.subtype, c.last_read_at` no SELECT.
- [ ] `listConversationsForPanel(filter)` aceitar `'active' | 'finalized' | 'unread'`. Para `unread`, WHERE:
```sql
c.status <> 'closed'
  and lm.role = 'user'
  and (c.last_read_at is null or c.last_read_at < c.last_message_at)
```
  (a subquery lateral `lm` já existe; mover para permitir filtrar por `lm.role` — usar `where` externo depois do lateral).
- [ ] Novas funções:
```ts
export async function setConversationIntake(
  id: string,
  fields: { category?: string | null; action?: string | null; subtype?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (sets.length === 0) return;
  await query(`update conversations set ${sets.join(', ')} where id = $1`, vals);
}

export async function markHandedOff(id: string): Promise<void> {
  await query(
    `update conversations set status = 'human', handed_off_at = coalesce(handed_off_at, now()) where id = $1`,
    [id],
  );
}

export async function markFirstHumanResponse(id: string): Promise<void> {
  await query(
    `update conversations set first_human_response_at = now()
     where id = $1 and first_human_response_at is null and handed_off_at is not null`,
    [id],
  );
}

export async function markRead(id: string): Promise<void> {
  await query(`update conversations set last_read_at = now() where id = $1`, [id]);
}
```
- [ ] `setConversationStatus`: quando `status = 'closed'`, gravar `closed_at`:
```ts
await query(
  `update conversations set status = $2,
     closed_at = case when $2 = 'closed' then coalesce(closed_at, now()) else closed_at end
   where id = $1`,
  [id, status],
);
```
- [ ] `closeInactiveConversations`: adicionar `, closed_at = now()` no UPDATE.
- [ ] Verificar: `cd backend && npm run typecheck`.

### Task 3: Bot flow — tudo transborda
**Files:** Modify `backend/src/services/bot.service.ts`

- [ ] Importar `setConversationIntake, markHandedOff` do repo.
- [ ] `handoffHuman(ctx)`: trocar `setConversationStatus(ctx.conversationId, 'human')` por `markHandedOff(ctx.conversationId)`. Manter o `bus.emit('conversation:status', ... status:'human')` e o texto de encaminhamento. Aceitar um `category` opcional para gravar antes do handoff.
- [ ] Menu principal (`case 'main_menu'`): ao escolher 1 → `setConversationIntake(id,{category:'consulta',action:null,subtype:null})`; 2 → `'sessao'`; 3 → `setConversationIntake(id,{category:'localizacao',action:null,subtype:null})` (segue self-service); 4 → `setConversationIntake(id,{category:'atendente',action:null,subtype:null})` + `handoffHuman`.
- [ ] Submenu Consulta (`case 'consulta_menu'`) — novas opções: `1 Agendar · 2 Reagendar · 3 Cancelar · 4 Confirmar · 5 Voltar`. Atualizar `consultaMenuText()`.
  - 1/2 → `setConversationIntake(id,{action:'agendar'|'reagendar'})` → `step: 'consulta_tipo'`.
  - 3/4 → `setConversationIntake(id,{action:'cancelar'|'confirmar'})` → `handoffHuman(ctx)` (não chamar `cancelAppointment`/`confirmAppointment`).
  - 5 → `main_menu`.
- [ ] Submenu Sessão (`case 'sessao_menu'`) — igual, opções `1 Agendar · 2 Reagendar · 3 Cancelar · 4 Confirmar · 5 Voltar`. Atualizar `sessaoMenuText()`.
- [ ] Tipos: `consultaTipoText()` adicionar **Retorno**; `sessaoTipoText()` adicionar **Pilates** e **RPG** (renumerar; "Outros" continua sendo a última). Atualizar os mapas `tipos` em `consulta_tipo` / `sessao_tipo` conforme a nova numeração. Ao escolher um tipo → `setConversationIntake(id,{subtype: <label>})` e ir para `goToConvenio`.
- [ ] `consulta_avaliacao` e `await_tipo_outros`: ao resolver o tipo, gravar `setConversationIntake(id,{subtype})` antes de `goToConvenio`.
- [ ] `case 'convenio'` e `case 'await_convenio_outros'`: após `updatePatientFields(insurance)`, **remover** `startScheduling(...)` e chamar `handoffHuman(ctx)`.
- [ ] Remover do fluxo (não do arquivo de libs): `startScheduling`, passo `choosing_slot`, imports não usados (`getNextFreeSlots`, `scheduleIfFree`, `formatSlotLabel` se sobrar sem uso; `getNextAppointmentForPatient`, `updateAppointmentStatus` se `cancelAppointment/confirmAppointment` saírem). Remover os `case 'choosing_slot'`, funções `startScheduling`, `cancelAppointment`, `confirmAppointment` e o `routeIntent` que chamava handoff/faq (manter FALAR_HUMANO→handoff, DUVIDA→faq; AGENDAR/CANCELAR/CONFIRMAR agora só mostram o menu).
- [ ] Tirar `SlotOption`/`options` do `State` se não usados mais (deixar `pendingKind/pendingTipo`).
- [ ] Verificar: `cd backend && npm run typecheck` (deve acusar imports/símbolos não usados — limpar até passar).

### Task 4: Rotas — read, first response, closed_at, unread
**Files:** Modify `backend/src/routes/conversations.ts`

- [ ] Import `markRead, markFirstHumanResponse` do repo.
- [ ] Filtro `unread` na lista: `const filter = ['finalized','unread'].includes(req.query.filter ?? '') ? req.query.filter : 'active'`.
- [ ] Novo endpoint:
```ts
app.post<{ Params: { id: string } }>('/api/conversations/:id/read', async (req, reply) => {
  await markRead(req.params.id);
  return { ok: true };
});
```
- [ ] No POST `/messages` (atendente envia): após `saveMessage`, chamar `await markFirstHumanResponse(convo.id)`.
- [ ] Verificar: `cd backend && npm run typecheck`.

### Task 5: Demo em sincronia
**Files:** Modify `backend/src/services/demo.service.ts`

- [ ] Ajustar o cenário de agendamento para terminar em **transbordo** após o convênio (mensagem "encaminhando para a recepção", `status:'human'`), em vez de simular horário/agendamento. Manter o cenário de "falar com atendente".
- [ ] Verificar: `cd backend && npm run typecheck`.

### Task 6: Commit bloco 1
- [ ] `git add backend/src && git commit -m "feat(bot): triagem — tudo transborda + intake/metrics no schema"`.

---

## Bloco 2 — Aba "Não lido"

### Task 7: Front — tipos e API
**Files:** Modify `frontend/src/types.ts`, `frontend/src/lib/api.ts`

- [ ] `types.ts`: em `ConversationListItem` add `last_read_at: string | null`, `category`, `action`, `subtype` (todos `string | null`). Em `ConversationDetail` add `category`, `action`, `subtype`, `handed_off_at` (`string | null`).
- [ ] `api.ts`: `listConversations` aceitar `'active' | 'finalized' | 'unread'`. Add `markRead: (id) => request('/api/conversations/${id}/read', { method: 'POST' })`.
- [ ] Verificar: `cd frontend && npm run build`.

### Task 8: Front — aba e marcar lido
**Files:** Modify `frontend/src/pages/Conversas.tsx`

- [ ] `listFilter` type → `'active' | 'unread' | 'finalized'`. Render 3 abas: `Ativas · Não lidas · Finalizadas`. Contador de não lidas: usar o total retornado quando `listFilter==='unread'`, ou calcular no cliente a partir da lista ativa (`last_role==='user' && (!last_read_at || last_read_at < last_message_at)`), o que for simples — preferir o número da própria lista `unread`.
- [ ] Ao selecionar conversa (`onClick`/`setSelectedId`): chamar `api.markRead(id)` e `qc.invalidateQueries(['conversations'])`. Criar mutation `markRead`.
- [ ] Card **"Resumo do pedido"** na sidebar de contato (aba Informações), visível quando `contact.category`: mostrar Categoria/Ação/Tipo/Convênio com labels amigáveis (mapear `consulta→Consulta`, `agendar→Agendar`, etc.).
- [ ] Verificar: `cd frontend && npm run build`.

### Task 9: Commit bloco 2
- [ ] `git add frontend/src && git commit -m "feat(painel): aba Não lidas + resumo do pedido no contato"`.

---

## Bloco 3 — Dashboard novo

### Task 10: Analytics repo
**Files:** Create `backend/src/repositories/analytics.repo.ts`

- [ ] Funções (todas recebem `start: Date, end: Date`, `end` exclusivo), consultando `conversations` + join `patients`/`users`:
  - `getConversationCards(start,end)` → `{ total, resolvedByBot, handedOff, avgResponseSeconds }` via `count(*)`, `count(*) filter (where handed_off_at is null)`, `count(*) filter (where handed_off_at is not null)`, `avg(extract(epoch from (first_human_response_at - handed_off_at)))`. `waitingNow` vem de `getConversationCounts()` já existente (`status='human'`).
  - `getConversationSeries(start,end,group:'day'|'week',tz)` → `date_trunc($group, created_at at time zone tz)` agrupado, `count(*)`.
  - `getByCategory(start,end)` → `category, count(*)` group by.
  - `getBySubcategory(start,end)` → `category, action, count(*)` group by (para drill-down).
  - `getByAgent(start,end)` → join users: `assigned_user_id, u.name, count(*) handled, avg(first_human_response_at-handed_off_at) resp, avg(closed_at-assigned_at) dur, count(*) filter (where closed_at is not null) finalized`.
  - `getByClient(start,end)` → group by patient: `name, phone, count(*) conversations, max(last_message_at) last_contact, mode() within group (order by category) top_category`.
  - `getConversationsForExport(start,end)` e `getAgentSummaryForExport(start,end)` → linhas para CSV.
- [ ] Verificar: `cd backend && npm run typecheck`.

### Task 11: Dashboard route (período + CSV)
**Files:** Rewrite `backend/src/routes/dashboard.ts`

- [ ] `GET /api/dashboard?month=YYYY-MM&group=day|week`: calcular `start`=1º dia do mês, `end`=1º dia do mês seguinte (default: mês atual). Montar resposta:
```ts
{ month, group, cards:{ total, resolvedByBot, resolvedByBotPct, handedOff, handedOffPct, avgResponseSeconds, waitingNow },
  series:[{bucket,count}], byCategory:[{category,count}], bySubcategory:[{category,action,count}],
  byAgent:[...], byClient:[...] }
```
- [ ] `GET /api/dashboard/export?month=YYYY-MM&kind=conversations|agents`: gerar CSV (separador `;`, primeira linha com header, `﻿` BOM no início), `reply.header('content-type','text/csv; charset=utf-8')`. Escapar campos com `;`/aspas/quebra de linha.
- [ ] Verificar: `cd backend && npm run typecheck`.

### Task 12: Front — types/api do dashboard
**Files:** Modify `frontend/src/types.ts`, `frontend/src/lib/api.ts`

- [ ] `types.ts`: substituir `DashboardData` pela nova forma (cards/series/byCategory/bySubcategory/byAgent/byClient).
- [ ] `api.ts`: `getDashboard(params:{month:string; group:'day'|'week'})`; add `exportDashboardCsv(params, kind)` que faz `fetch` com token, lê `blob`, dispara download (`URL.createObjectURL` + `<a download>`).
- [ ] Verificar: `cd frontend && npm run build`.

### Task 13: Front — Dashboard.tsx (rewrite)
**Files:** Rewrite `frontend/src/pages/Dashboard.tsx`

- [ ] Ordem das seções: filtro de período (input `month` + toggle dia/semana + botão Exportar CSV com menu Conversas/Atendentes) → cards → gráfico de barras por data → rosca de assunto + cards de subcategoria por ação → tabela por atendente → tabela por cliente (com busca).
- [ ] Reusar `Donut` (existe) e criar `BarChart` (barras). Formatadores de tempo (segundos → "m min"/"h").
- [ ] Verificar: `cd frontend && npm run build`; rodar app e conferir render/preview + console sem erros.

### Task 14: Commit bloco 3
- [ ] `git add backend/src frontend/src && git commit -m "feat(dashboard): relatório de conversas por período + CSV"`.

---

## Self-review (cobertura do spec)
- Fluxo tudo-transborda → Task 3. Intake category/action/subtype → Tasks 2–3. Timestamps/métricas → Tasks 2, 4, 10. Resumo pro atendente → Task 8. Aba Não lido → Tasks 2, 4, 7, 8. Dashboard (período, cards, série, assunto+subcat, atendente, cliente, CSV) → Tasks 10–13. Demo → Task 5. Sem placeholders; nomes de funções consistentes entre tasks (`markHandedOff`, `markRead`, `markFirstHumanResponse`, `setConversationIntake`).
