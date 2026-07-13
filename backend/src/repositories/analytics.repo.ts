import { query } from '../db/pool.js';

// Relatório de conversas (dashboard). Todas as funções recebem [start, end) — end exclusivo.
// As métricas de tempo/handoff só têm dados a partir do deploy da migration 009.

export interface ConversationCards {
  total: number;
  resolved_by_bot: number;
  handed_off: number;
  avg_response_seconds: number;
}

export async function getConversationCards(start: Date, end: Date): Promise<ConversationCards> {
  const res = await query<ConversationCards>(
    `select
       count(*)::int as total,
       count(*) filter (where handed_off_at is null)::int as resolved_by_bot,
       count(*) filter (where handed_off_at is not null)::int as handed_off,
       coalesce(avg(extract(epoch from (first_human_response_at - handed_off_at)))
         filter (where first_human_response_at is not null and handed_off_at is not null), 0)::float8
         as avg_response_seconds
     from conversations
     where created_at >= $1 and created_at < $2`,
    [start, end],
  );
  return res.rows[0] ?? { total: 0, resolved_by_bot: 0, handed_off: 0, avg_response_seconds: 0 };
}

export interface SeriesPoint {
  bucket: string;
  count: number;
}

export async function getConversationSeries(
  start: Date,
  end: Date,
  group: 'day' | 'week',
  tz: string,
): Promise<SeriesPoint[]> {
  const res = await query<SeriesPoint>(
    `select to_char(date_trunc($3, created_at at time zone $4), 'YYYY-MM-DD') as bucket,
            count(*)::int as count
     from conversations
     where created_at >= $1 and created_at < $2
     group by 1
     order by 1`,
    [start, end, group, tz],
  );
  return res.rows;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export async function getByCategory(start: Date, end: Date): Promise<CategoryCount[]> {
  const res = await query<CategoryCount>(
    `select coalesce(category, 'sem_categoria') as category, count(*)::int as count
     from conversations
     where created_at >= $1 and created_at < $2
     group by 1
     order by count desc`,
    [start, end],
  );
  return res.rows;
}

export interface SubcategoryCount {
  category: string;
  action: string;
  count: number;
}

export async function getBySubcategory(start: Date, end: Date): Promise<SubcategoryCount[]> {
  const res = await query<SubcategoryCount>(
    `select category, coalesce(action, 'sem_acao') as action, count(*)::int as count
     from conversations
     where created_at >= $1 and created_at < $2 and category in ('consulta','sessao')
     group by 1, 2
     order by 1, count desc`,
    [start, end],
  );
  return res.rows;
}

export interface AgentRow {
  user_id: string;
  name: string;
  handled: number;
  avg_first_response_seconds: number;
  avg_duration_seconds: number;
  finalized: number;
}

export async function getByAgent(start: Date, end: Date): Promise<AgentRow[]> {
  const res = await query<AgentRow>(
    `select u.id as user_id, u.name,
       count(*)::int as handled,
       coalesce(avg(extract(epoch from (c.first_human_response_at - c.handed_off_at)))
         filter (where c.first_human_response_at is not null and c.handed_off_at is not null), 0)::float8
         as avg_first_response_seconds,
       coalesce(avg(extract(epoch from (c.closed_at - c.assigned_at)))
         filter (where c.closed_at is not null and c.assigned_at is not null), 0)::float8
         as avg_duration_seconds,
       count(*) filter (where c.closed_at is not null)::int as finalized
     from conversations c
     join users u on u.id = c.assigned_user_id
     where c.created_at >= $1 and c.created_at < $2 and c.assigned_user_id is not null
     group by u.id, u.name
     order by handled desc`,
    [start, end],
  );
  return res.rows;
}

export interface ClientRow {
  patient_id: string;
  name: string | null;
  phone: string;
  conversations: number;
  last_contact: string | null;
  top_category: string | null;
}

export async function getByClient(start: Date, end: Date): Promise<ClientRow[]> {
  const res = await query<ClientRow>(
    `select p.id as patient_id, p.name, p.phone,
       count(*)::int as conversations,
       max(c.last_message_at) as last_contact,
       mode() within group (order by c.category) as top_category
     from conversations c
     join patients p on p.id = c.patient_id
     where c.created_at >= $1 and c.created_at < $2
     group by p.id, p.name, p.phone
     order by conversations desc, last_contact desc nulls last
     limit 300`,
    [start, end],
  );
  return res.rows;
}

export interface ExportRow {
  created_at: string;
  closed_at: string | null;
  name: string | null;
  phone: string;
  category: string | null;
  action: string | null;
  subtype: string | null;
  insurance: string | null;
  agent_name: string | null;
  handed_off_at: string | null;
  first_human_response_at: string | null;
  assigned_at: string | null;
  status: string;
}

export async function getConversationsForExport(start: Date, end: Date): Promise<ExportRow[]> {
  const res = await query<ExportRow>(
    `select c.created_at, c.closed_at, p.name, p.phone,
            c.category, c.action, c.subtype, p.insurance,
            u.name as agent_name, c.handed_off_at, c.first_human_response_at, c.assigned_at, c.status
     from conversations c
     join patients p on p.id = c.patient_id
     left join users u on u.id = c.assigned_user_id
     where c.created_at >= $1 and c.created_at < $2
     order by c.created_at`,
    [start, end],
  );
  return res.rows;
}
