import { buildApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

const PHONE = '5511000000077';

function nextWeekday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

async function main(): Promise<void> {
  await query(`delete from patients where phone = $1`, [PHONE]);
  const app = buildApp();
  await app.ready();

  // Profissionais
  const r1 = await app.inject({ method: 'GET', url: '/api/professionals' });
  const profs = r1.json().professionals as Array<{ id: string; name: string }>;
  check('GET /api/professionals', r1.statusCode === 200 && profs.length >= 1, { n: profs.length });

  const dayStr = nextWeekday().toISOString().slice(0, 10);

  // Agenda do dia
  const r2 = await app.inject({ method: 'GET', url: `/api/agenda?date=${dayStr}` });
  const body2 = r2.json() as { date: string; schedule: Array<{ professionalId: string; slots: Array<{ at: string; status: string }> }> };
  check('GET /api/agenda retorna slots', r2.statusCode === 200 && body2.schedule.length >= 1 && body2.schedule[0]!.slots.length > 0, {
    profs: body2.schedule.length,
    slots: body2.schedule[0]?.slots.length,
  });

  // Pega um slot livre do primeiro profissional
  const prof = body2.schedule[0]!;
  const freeSlot = prof.slots.find((s) => s.status === 'free')!;

  // Agendamento manual
  const r3 = await app.inject({
    method: 'POST',
    url: '/api/appointments',
    payload: { professionalId: prof.professionalId, scheduledAt: freeSlot.at, phone: PHONE, name: 'Agenda Teste' },
  });
  check('POST /api/appointments cria', r3.statusCode === 200 && r3.json().ok === true, r3.json());

  // Conflito: mesmo slot → 409
  const r4 = await app.inject({
    method: 'POST',
    url: '/api/appointments',
    payload: { professionalId: prof.professionalId, scheduledAt: freeSlot.at, phone: '5511000000076', name: 'Outro' },
  });
  check('POST mesmo slot -> 409 conflito', r4.statusCode === 409, { status: r4.statusCode });

  // Agora aquele slot aparece como ocupado
  const r5 = await app.inject({ method: 'GET', url: `/api/agenda?date=${dayStr}` });
  const sched5 = (r5.json() as typeof body2).schedule.find((s) => s.professionalId === prof.professionalId)!;
  const nowOccupied = sched5.slots.find((s) => s.at === freeSlot.at);
  check('Slot agora aparece ocupado', nowOccupied?.status === 'occupied', nowOccupied);

  // Validação
  const r6 = await app.inject({ method: 'POST', url: '/api/appointments', payload: { phone: PHONE } });
  check('POST sem campos -> 400', r6.statusCode === 400);

  await app.close();
  await query(`delete from patients where phone in ($1, '5511000000076')`, [PHONE]);
}

main()
  .catch((err) => {
    console.error('Erro:', err);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
    process.exit(failures === 0 ? 0 : 1);
  });
