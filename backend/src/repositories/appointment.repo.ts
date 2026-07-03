import { query } from '../db/pool.js';

export type AppointmentStatus = 'confirmed' | 'pending' | 'cancelled' | 'completed' | 'no_show';
export type AppointmentKind = 'consulta' | 'sessao';

export interface Appointment {
  id: string;
  patient_id: string;
  professional_id: string;
  scheduled_at: string;
  status: AppointmentStatus;
  kind: AppointmentKind;
  notes: string | null;
  created_at: string;
}

export async function createAppointment(
  patientId: string,
  professionalId: string,
  scheduledAt: Date,
  status: AppointmentStatus = 'confirmed',
  kind: AppointmentKind = 'sessao',
): Promise<Appointment> {
  const res = await query<Appointment>(
    `insert into appointments (patient_id, professional_id, scheduled_at, status, kind)
     values ($1, $2, $3, $4, $5) returning *`,
    [patientId, professionalId, scheduledAt.toISOString(), status, kind],
  );
  return res.rows[0]!;
}

/** Agendamentos de um profissional dentro de um intervalo (para calcular slots livres). */
export async function getAppointmentsInRange(
  professionalId: string,
  from: Date,
  to: Date,
): Promise<Appointment[]> {
  const res = await query<Appointment>(
    `select * from appointments
     where professional_id = $1
       and scheduled_at >= $2 and scheduled_at < $3
       and status in ('confirmed','pending')
     order by scheduled_at`,
    [professionalId, from.toISOString(), to.toISOString()],
  );
  return res.rows;
}

export interface AppointmentStats {
  total: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  completed: number;
  no_show: number;
}

/** Contagem de agendamentos por status num intervalo (por data da sessão). */
export async function getAppointmentStatsInRange(start: Date, end: Date): Promise<AppointmentStats> {
  const res = await query<AppointmentStats>(
    `select
       count(*)::int as total,
       count(*) filter (where status = 'confirmed')::int as confirmed,
       count(*) filter (where status = 'pending')::int as pending,
       count(*) filter (where status = 'cancelled')::int as cancelled,
       count(*) filter (where status = 'completed')::int as completed,
       count(*) filter (where status = 'no_show')::int as no_show
     from appointments
     where scheduled_at >= $1 and scheduled_at < $2`,
    [start.toISOString(), end.toISOString()],
  );
  return res.rows[0]!;
}

/** Série de agendamentos por dia (no fuso da clínica), excluindo cancelados. */
export async function getAppointmentSeries(start: Date, end: Date, tz: string): Promise<Array<{ date: string; count: number }>> {
  const res = await query<{ date: string; count: number }>(
    `select to_char((scheduled_at at time zone $3)::date, 'YYYY-MM-DD') as date, count(*)::int as count
     from appointments
     where scheduled_at >= $1 and scheduled_at < $2 and status <> 'cancelled'
     group by 1 order by 1`,
    [start.toISOString(), end.toISOString(), tz],
  );
  return res.rows;
}

export interface PatientAppointment extends Appointment {
  professional_name: string | null;
}

/** Histórico de agendamentos do paciente (com nome do profissional), mais recentes primeiro. */
export async function getPatientAppointments(patientId: string): Promise<PatientAppointment[]> {
  const res = await query<PatientAppointment>(
    `select a.*, pr.name as professional_name
     from appointments a left join professionals pr on pr.id = a.professional_id
     where a.patient_id = $1
     order by a.scheduled_at desc limit 50`,
    [patientId],
  );
  return res.rows;
}

/** Próximo agendamento ativo do paciente (futuro), opcionalmente filtrado por tipo. */
export async function getNextAppointmentForPatient(
  patientId: string,
  kind?: AppointmentKind,
): Promise<Appointment | null> {
  if (kind) {
    const res = await query<Appointment>(
      `select * from appointments
       where patient_id = $1 and kind = $2 and status in ('confirmed','pending') and scheduled_at >= now()
       order by scheduled_at limit 1`,
      [patientId, kind],
    );
    return res.rows[0] ?? null;
  }
  const res = await query<Appointment>(
    `select * from appointments
     where patient_id = $1 and status in ('confirmed','pending') and scheduled_at >= now()
     order by scheduled_at limit 1`,
    [patientId],
  );
  return res.rows[0] ?? null;
}

export async function updateAppointmentStatus(id: string, status: AppointmentStatus): Promise<void> {
  await query(`update appointments set status = $2 where id = $1`, [id, status]);
}

/** Marca que a confirmação foi enviada (status pending + carimbo de envio). */
export async function markConfirmationSent(id: string): Promise<void> {
  await query(`update appointments set status = 'pending', confirmation_sent_at = now() where id = $1`, [id]);
}

/** Agendamentos com confirmação enviada há mais de N horas e ainda pendentes (futuro). */
export async function getUnconfirmedAfter(hours: number): Promise<DayAppointment[]> {
  const res = await query<DayAppointment>(
    `select a.id, a.professional_id, a.scheduled_at, a.status,
            p.id as patient_id, p.name as patient_name, p.phone
     from appointments a
     join patients p on p.id = a.patient_id
     where a.status = 'pending'
       and a.confirmation_sent_at is not null
       and a.confirmation_sent_at < now() - ($1 || ' hours')::interval
       and a.scheduled_at >= now()
     order by a.scheduled_at`,
    [String(hours)],
  );
  return res.rows;
}

/** Agendamentos de um dia (para a Agenda/Dashboard do painel). */
export async function getAppointmentsForDay(day: Date): Promise<Appointment[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const res = await query<Appointment>(
    `select * from appointments
     where scheduled_at >= $1 and scheduled_at < $2 and status <> 'cancelled'
     order by scheduled_at`,
    [start.toISOString(), end.toISOString()],
  );
  return res.rows;
}

export interface DayAppointment {
  id: string;
  professional_id: string;
  scheduled_at: string;
  status: AppointmentStatus;
  patient_id: string;
  patient_name: string | null;
  phone: string;
}

/** Agendamentos de um dia com dados do paciente (para a Agenda do painel). */
export async function getDayAppointmentsDetailed(day: Date): Promise<DayAppointment[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const res = await query<DayAppointment>(
    `select a.id, a.professional_id, a.scheduled_at, a.status,
            p.id as patient_id, p.name as patient_name, p.phone
     from appointments a
     join patients p on p.id = a.patient_id
     where a.scheduled_at >= $1 and a.scheduled_at < $2 and a.status <> 'cancelled'
     order by a.scheduled_at`,
    [start.toISOString(), end.toISOString()],
  );
  return res.rows;
}

/** Agendamentos confirmados/pendentes para amanhã (cron de confirmação). */
export async function getAppointmentsForDate(date: Date): Promise<Appointment[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const res = await query<Appointment>(
    `select * from appointments
     where scheduled_at >= $1 and scheduled_at < $2 and status in ('confirmed','pending')
     order by scheduled_at`,
    [start.toISOString(), end.toISOString()],
  );
  return res.rows;
}
