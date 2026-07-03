import { query } from '../db/pool.js';

export type ProfessionalRole = 'medico' | 'fisioterapeuta' | 'ambos';

export interface Professional {
  id: string;
  name: string;
  specialty: string | null;
  active: boolean;
  role: ProfessionalRole;
}

export interface Availability {
  id: string;
  professional_id: string;
  day_of_week: number; // 0=domingo .. 6=sábado
  start_time: string; // "HH:MM:SS"
  end_time: string;
  slot_duration_minutes: number;
}

export async function listActiveProfessionals(filterRole?: 'medico' | 'fisioterapeuta'): Promise<Professional[]> {
  if (filterRole) {
    const res = await query<Professional>(
      `select * from professionals where active = true and role in ($1, 'ambos') order by name`,
      [filterRole],
    );
    return res.rows;
  }
  const res = await query<Professional>(`select * from professionals where active = true order by name`);
  return res.rows;
}

export async function getProfessional(id: string): Promise<Professional | null> {
  const res = await query<Professional>(`select * from professionals where id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function getAvailabilityForProfessional(professionalId: string): Promise<Availability[]> {
  const res = await query<Availability>(
    `select * from availability where professional_id = $1 order by day_of_week, start_time`,
    [professionalId],
  );
  return res.rows;
}
