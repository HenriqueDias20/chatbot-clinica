import { query } from '../db/pool.js';

export interface Patient {
  id: string;
  phone: string;
  name: string | null;
  cpf: string | null;
  birth_date: string | null;
  insurance: string | null;
  created_at: string;
}

/** Identifica ou cria o paciente pelo telefone (já normalizado). */
export async function findOrCreatePatient(phone: string, name?: string | null): Promise<Patient> {
  const res = await query<Patient>(
    `insert into patients (phone, name)
     values ($1, $2)
     on conflict (phone) do update
       set name = coalesce(patients.name, excluded.name)
     returning *`,
    [phone, name ?? null],
  );
  return res.rows[0]!;
}

/** Atualiza dados do cadastro (nome, CPF, nascimento, convênio). Retorna o paciente atualizado. */
export async function updatePatientFields(
  id: string,
  fields: { name?: string; cpf?: string; birthDate?: string; insurance?: string },
): Promise<Patient> {
  const res = await query<Patient>(
    `update patients set
       name       = coalesce($2, name),
       cpf        = coalesce($3, cpf),
       birth_date = coalesce($4, birth_date),
       insurance  = coalesce($5, insurance)
     where id = $1
     returning *`,
    [id, fields.name ?? null, fields.cpf ?? null, fields.birthDate ?? null, fields.insurance ?? null],
  );
  return res.rows[0]!;
}

/** Próximo campo do cadastro que ainda falta (ordem do onboarding), ou null se completo. */
export function firstMissingField(p: Patient): 'name' | 'cpf' | 'birth' | 'insurance' | null {
  if (!p.name) return 'name';
  if (!p.cpf) return 'cpf';
  if (!p.birth_date) return 'birth';
  if (!p.insurance) return 'insurance';
  return null;
}
