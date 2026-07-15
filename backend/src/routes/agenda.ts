import type { FastifyInstance } from 'fastify';
import { requireFullAccess } from './auth.js';
import { listActiveProfessionals } from '../repositories/professional.repo.js';
import { findOrCreatePatient } from '../repositories/patient.repo.js';
import { getDaySchedule, scheduleIfFree } from '../services/agenda.service.js';
import { normalizePhone } from '../lib/phone.js';
import { bus } from '../lib/events.js';

function parseDate(raw: string | undefined): Date {
  if (raw) {
    const d = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export async function agendaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireFullAccess); // atendente não acessa a agenda

  // Profissionais ativos.
  app.get('/api/professionals', async () => {
    const professionals = await listActiveProfessionals();
    return { professionals };
  });

  // Agenda do dia (slots por profissional). ?date=YYYY-MM-DD (default: hoje).
  app.get<{ Querystring: { date?: string } }>('/api/agenda', async (req) => {
    const date = parseDate(req.query.date);
    const schedule = await getDaySchedule(date);
    return { date: date.toISOString().slice(0, 10), schedule };
  });

  // Agendamento manual pela recepção.
  app.post<{ Body: { professionalId?: string; scheduledAt?: string; phone?: string; name?: string } }>(
    '/api/appointments',
    async (req, reply) => {
      const { professionalId, scheduledAt, phone, name } = req.body ?? {};
      if (!professionalId || !scheduledAt || !phone) {
        return reply.code(400).send({ error: 'professionalId, scheduledAt e phone são obrigatórios' });
      }
      const at = new Date(scheduledAt);
      if (Number.isNaN(at.getTime())) return reply.code(400).send({ error: 'scheduledAt inválido' });

      const patient = await findOrCreatePatient(normalizePhone(phone), name ?? null);
      const res = await scheduleIfFree(patient.id, professionalId, at);
      if (!res.ok) return reply.code(409).send({ error: res.reason });

      bus.emit('appointment:created', {
        appointmentId: res.appointment.id,
        patientId: patient.id,
        professionalId,
        scheduledAt: res.appointment.scheduled_at,
      });
      return { ok: true, appointment: res.appointment };
    },
  );
}
