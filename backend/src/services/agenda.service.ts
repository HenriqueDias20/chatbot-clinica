import {
  getAvailabilityForProfessional,
  listActiveProfessionals,
  getProfessional,
  type Availability,
  type Professional,
} from '../repositories/professional.repo.js';
import {
  createAppointment,
  getAppointmentsInRange,
  getDayAppointmentsDetailed,
  type Appointment,
  type AppointmentKind,
} from '../repositories/appointment.repo.js';

export interface Slot {
  professionalId: string;
  professionalName: string;
  at: Date;
}

function combineDateTime(day: Date, hms: string): Date {
  const parts = hms.split(':').map(Number);
  const d = new Date(day);
  d.setHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
  return d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Rótulo amigável de um horário, ex.: "seg, 09/06 às 14:00". */
export function formatSlotLabel(at: Date): string {
  const data = at.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hora = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

/**
 * Próximos horários livres considerando a disponibilidade dos profissionais
 * e os agendamentos já existentes.
 */
export async function getNextFreeSlots(opts: {
  count: number;
  daysAhead?: number;
  from?: Date;
  professionalId?: string;
  role?: 'medico' | 'fisioterapeuta';
}): Promise<Slot[]> {
  const from = opts.from ?? new Date();
  const daysAhead = opts.daysAhead ?? 14;

  const professionals: Professional[] = opts.professionalId
    ? ([await getProfessional(opts.professionalId)].filter(Boolean) as Professional[])
    : await listActiveProfessionals(opts.role);

  // Pré-carrega disponibilidade por profissional.
  const availByProf = new Map<string, Availability[]>();
  for (const p of professionals) {
    availByProf.set(p.id, await getAvailabilityForProfessional(p.id));
  }

  // Pré-carrega agendamentos do intervalo todo, por profissional (Set de timestamps ocupados).
  const rangeStart = startOfDay(from);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + daysAhead + 1);
  const bookedByProf = new Map<string, Set<number>>();
  for (const p of professionals) {
    const appts = await getAppointmentsInRange(p.id, rangeStart, rangeEnd);
    bookedByProf.set(p.id, new Set(appts.map((a) => new Date(a.scheduled_at).getTime())));
  }

  const slots: Slot[] = [];
  for (let offset = 0; offset <= daysAhead; offset++) {
    const day = new Date(rangeStart);
    day.setDate(day.getDate() + offset);
    const dow = day.getDay();

    for (const p of professionals) {
      const avails = (availByProf.get(p.id) ?? []).filter((a) => a.day_of_week === dow);
      const booked = bookedByProf.get(p.id) ?? new Set<number>();

      for (const a of avails) {
        const start = combineDateTime(day, a.start_time);
        const end = combineDateTime(day, a.end_time);
        const stepMs = a.slot_duration_minutes * 60_000;
        for (let t = start.getTime(); t + stepMs <= end.getTime(); t += stepMs) {
          const slotDate = new Date(t);
          if (slotDate <= from) continue; // já passou
          if (booked.has(t)) continue; // ocupado
          slots.push({ professionalId: p.id, professionalName: p.name, at: slotDate });
        }
      }
    }
  }

  slots.sort((x, y) => x.at.getTime() - y.at.getTime());
  return slots.slice(0, opts.count);
}

export interface DaySlot {
  at: string; // ISO
  status: 'free' | 'occupied';
  appointment?: { id: string; patientName: string | null; phone: string; status: string };
}
export interface ProfessionalDaySchedule {
  professionalId: string;
  professionalName: string;
  specialty: string | null;
  slots: DaySlot[];
}

/** Agenda de um dia: para cada profissional, todos os slots com status livre/ocupado. */
export async function getDaySchedule(date: Date): Promise<ProfessionalDaySchedule[]> {
  const day = startOfDay(date);
  const dow = day.getDay();
  const professionals = await listActiveProfessionals();
  const appts = await getDayAppointmentsDetailed(day);

  const result: ProfessionalDaySchedule[] = [];
  for (const p of professionals) {
    const avails = (await getAvailabilityForProfessional(p.id)).filter((a) => a.day_of_week === dow);
    const occupied = new Map<number, (typeof appts)[number]>();
    for (const a of appts) {
      if (a.professional_id === p.id) occupied.set(new Date(a.scheduled_at).getTime(), a);
    }

    const slots: DaySlot[] = [];
    for (const a of avails) {
      const start = combineDateTime(day, a.start_time);
      const end = combineDateTime(day, a.end_time);
      const stepMs = a.slot_duration_minutes * 60_000;
      for (let t = start.getTime(); t + stepMs <= end.getTime(); t += stepMs) {
        const appt = occupied.get(t);
        slots.push(
          appt
            ? {
                at: new Date(t).toISOString(),
                status: 'occupied',
                appointment: { id: appt.id, patientName: appt.patient_name, phone: appt.phone, status: appt.status },
              }
            : { at: new Date(t).toISOString(), status: 'free' },
        );
      }
    }
    result.push({ professionalId: p.id, professionalName: p.name, specialty: p.specialty, slots });
  }
  return result;
}

/**
 * Agenda verificando disponibilidade em tempo real (regra de negócio):
 * recusa se já houver agendamento para o profissional naquele horário.
 */
export async function scheduleIfFree(
  patientId: string,
  professionalId: string,
  at: Date,
  kind: AppointmentKind = 'sessao',
): Promise<{ ok: true; appointment: Appointment } | { ok: false; reason: string }> {
  const windowStart = new Date(at.getTime() - 1);
  const windowEnd = new Date(at.getTime() + 1);
  const conflicts = await getAppointmentsInRange(professionalId, windowStart, windowEnd);
  if (conflicts.length > 0) {
    return { ok: false, reason: 'horário acabou de ser ocupado' };
  }
  const appointment = await createAppointment(patientId, professionalId, at, 'confirmed', kind);
  return { ok: true, appointment };
}
