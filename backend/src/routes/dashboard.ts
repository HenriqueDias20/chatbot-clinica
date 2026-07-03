import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { getConversationCounts } from '../repositories/conversation.repo.js';
import {
  getDayAppointmentsDetailed,
  getAppointmentStatsInRange,
  getAppointmentSeries,
} from '../repositories/appointment.repo.js';
import { listActiveProfessionals } from '../repositories/professional.repo.js';

type Range = 'today' | '7d' | '30d' | '90d';
const RANGE_DAYS: Record<Range, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

function rangeDates(range: Range): { start: Date; end: Date; days: number } {
  const days = RANGE_DAYS[range];
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1); // amanhã 00:00 (exclusivo)
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start, end, days };
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Querystring: { range?: string } }>('/api/dashboard', async (req) => {
    const range = (['today', '7d', '30d', '90d'].includes(req.query.range ?? '') ? req.query.range : '7d') as Range;
    const { start, end, days } = rangeDates(range);

    const [counts, stats, seriesRaw, todayRaw, professionals] = await Promise.all([
      getConversationCounts(),
      getAppointmentStatsInRange(start, end),
      getAppointmentSeries(start, end, env.TIMEZONE),
      getDayAppointmentsDetailed(new Date()),
      listActiveProfessionals(),
    ]);

    // Preenche dias sem agendamento com 0.
    const seriesMap = new Map(seriesRaw.map((s) => [s.date, s.count]));
    const series: Array<{ date: string; count: number }> = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      series.push({ date: key, count: seriesMap.get(key) ?? 0 });
    }

    const active = stats.total - stats.cancelled;
    const confirmationRate = active > 0 ? Math.round((stats.confirmed / active) * 100) : 0;
    const totalSeries = series.reduce((acc, s) => acc + s.count, 0);
    const avgPerDay = Math.round((totalSeries / days) * 10) / 10;

    const profName = new Map(professionals.map((p) => [p.id, p.name]));
    const todayAppointments = todayRaw.map((a) => ({
      id: a.id,
      scheduledAt: a.scheduled_at,
      status: a.status,
      patientName: a.patient_name ?? a.phone,
      professionalName: profName.get(a.professional_id) ?? '—',
    }));

    return {
      range,
      since: dayKey(start),
      conversations: {
        active: counts.active,
        waitingHuman: counts.waitingHuman,
      },
      appointments: stats,
      series,
      confirmationRate,
      avgPerDay,
      todayAppointments,
    };
  });
}
