import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

async function main(): Promise<void> {
  const app = buildApp();
  await app.ready();
  const r = await app.inject({ method: 'GET', url: '/api/dashboard' });
  const b = r.json() as {
    activeConversations: number;
    waitingHuman: number;
    todayCount: number;
    todayAppointments: unknown[];
    nextFreeSlots: unknown[];
  };
  check('GET /api/dashboard -> 200', r.statusCode === 200);
  check('Tem activeConversations (número)', typeof b.activeConversations === 'number');
  check('Tem waitingHuman (número)', typeof b.waitingHuman === 'number');
  check('Tem todayAppointments (array)', Array.isArray(b.todayAppointments));
  check('Tem nextFreeSlots (array com itens)', Array.isArray(b.nextFreeSlots) && b.nextFreeSlots.length > 0, {
    n: b.nextFreeSlots.length,
  });
  console.log('   resumo:', JSON.stringify({ active: b.activeConversations, human: b.waitingHuman, hoje: b.todayCount, livres: b.nextFreeSlots.length }));
  await app.close();
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
    process.exit(failures === 0 ? 0 : 1);
  });
