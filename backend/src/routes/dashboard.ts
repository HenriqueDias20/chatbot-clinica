import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { getConversationCounts } from '../repositories/conversation.repo.js';
import {
  getConversationCards,
  getConversationSeries,
  getByCategory,
  getBySubcategory,
  getByAgent,
  getByClient,
  getConversationsForExport,
  type SeriesPoint,
} from '../repositories/analytics.repo.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Intervalo [start, end) do mês (end exclusivo). Default: mês atual. */
function monthRange(monthParam?: string): { start: Date; end: Date; month: string } {
  const now = new Date();
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y!, m! - 1, 1, 0, 0, 0, 0);
  const end = new Date(y!, m!, 1, 0, 0, 0, 0);
  return { start, end, month };
}

/** Preenche buckets vazios (dias ou semanas sem conversa) com 0, para o gráfico ficar contínuo. */
function fillSeries(raw: SeriesPoint[], start: Date, end: Date, group: 'day' | 'week'): SeriesPoint[] {
  const map = new Map(raw.map((r) => [r.bucket, r.count]));
  const out: SeriesPoint[] = [];
  const cur = new Date(start);
  if (group === 'week') {
    // date_trunc('week') no Postgres começa na segunda-feira; alinha o cursor à segunda.
    const dow = (cur.getDay() + 6) % 7; // 0 = segunda
    cur.setDate(cur.getDate() - dow);
  }
  const step = group === 'week' ? 7 : 1;
  while (cur < end) {
    const key = dayKey(cur);
    out.push({ bucket: key, count: map.get(key) ?? 0 });
    cur.setDate(cur.getDate() + step);
  }
  return out;
}

function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  if (!s || s <= 0) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}min` : `${h}h`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function secondsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 1000;
}

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map(csvCell).join(';')];
  for (const r of rows) lines.push(r.map(csvCell).join(';'));
  return lines.join('\r\n');
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Relatório de conversas do período (mês) agrupado por dia ou semana.
  app.get<{ Querystring: { month?: string; group?: string } }>('/api/dashboard', async (req) => {
    const { start, end, month } = monthRange(req.query.month);
    const group = req.query.group === 'week' ? 'week' : 'day';

    const [cards, seriesRaw, byCategory, bySubcategory, byAgent, byClient, counts] = await Promise.all([
      getConversationCards(start, end),
      getConversationSeries(start, end, group, env.TIMEZONE),
      getByCategory(start, end),
      getBySubcategory(start, end),
      getByAgent(start, end),
      getByClient(start, end),
      getConversationCounts(),
    ]);

    const total = cards.total;
    return {
      month,
      group,
      cards: {
        total,
        resolvedByBot: cards.resolved_by_bot,
        resolvedByBotPct: total ? Math.round((cards.resolved_by_bot / total) * 100) : 0,
        handedOff: cards.handed_off,
        handedOffPct: total ? Math.round((cards.handed_off / total) * 100) : 0,
        avgResponseSeconds: Math.round(cards.avg_response_seconds),
        waitingNow: counts.waitingHuman,
      },
      series: fillSeries(seriesRaw, start, end, group),
      byCategory,
      bySubcategory,
      byAgent: byAgent.map((a) => ({
        userId: a.user_id,
        name: a.name,
        handled: a.handled,
        avgFirstResponseSeconds: Math.round(a.avg_first_response_seconds),
        avgDurationSeconds: Math.round(a.avg_duration_seconds),
        finalized: a.finalized,
      })),
      byClient: byClient.map((c) => ({
        patientId: c.patient_id,
        name: c.name,
        phone: c.phone,
        conversations: c.conversations,
        topCategory: c.top_category,
        lastContact: c.last_contact,
      })),
    };
  });

  // Exportação CSV (separador ';', UTF-8 com BOM para acentos no Excel).
  app.get<{ Querystring: { month?: string; kind?: string } }>('/api/dashboard/export', async (req, reply) => {
    const { start, end, month } = monthRange(req.query.month);
    const kind = req.query.kind === 'agents' ? 'agents' : 'conversations';

    let csv: string;
    let filename: string;
    if (kind === 'agents') {
      const rows = await getByAgent(start, end);
      csv = toCsv(
        ['Atendente', 'Conversas atendidas', 'Tempo médio 1ª resposta', 'Duração média', 'Finalizadas'],
        rows.map((r) => [
          r.name,
          r.handled,
          fmtDuration(r.avg_first_response_seconds),
          fmtDuration(r.avg_duration_seconds),
          r.finalized,
        ]),
      );
      filename = `atendentes-${month}.csv`;
    } else {
      const rows = await getConversationsForExport(start, end);
      csv = toCsv(
        [
          'Início', 'Fim', 'Cliente', 'Telefone', 'Categoria', 'Ação', 'Tipo', 'Convênio',
          'Atendente', 'Resolvido por', 'Status', 'Tempo 1ª resposta', 'Duração',
        ],
        rows.map((r) => [
          fmtDateTime(r.created_at),
          r.closed_at ? fmtDateTime(r.closed_at) : '',
          r.name ?? '',
          r.phone,
          r.category ?? '',
          r.action ?? '',
          r.subtype ?? '',
          r.insurance ?? '',
          r.agent_name ?? '',
          r.handed_off_at ? 'Atendente' : 'Bot',
          r.status,
          r.first_human_response_at && r.handed_off_at
            ? fmtDuration(secondsBetween(r.handed_off_at, r.first_human_response_at))
            : '',
          r.closed_at && r.assigned_at ? fmtDuration(secondsBetween(r.assigned_at, r.closed_at)) : '',
        ]),
      );
      filename = `conversas-${month}.csv`;
    }

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send('﻿' + csv); // BOM (acentos corretos no Excel)
  });
}
