import { checkInactivity } from '../src/services/cron.service.js';
import { findOrCreatePatient } from '../src/repositories/patient.repo.js';
import { getOrCreateActiveConversation } from '../src/repositories/conversation.repo.js';
import { saveMessage } from '../src/repositories/message.repo.js';
import { pool, query } from '../src/db/pool.js';

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
};

const PA = '5511944440001'; // inatividade nova → recebe lembrete
const PB = '5511944440002'; // já tem lembrete antigo → será fechada
const PC = '5511944440003'; // já tem lembrete, mas respondeu depois → não fecha

async function main() {
  await query(`delete from patients where phone in ($1,$2,$3)`, [PA, PB, PC]);

  // ── Cenário A: paciente inativo há 31min, sem lembrete enviado ──
  const pA = await findOrCreatePatient(PA, 'Inativo Novo');
  const cA = await getOrCreateActiveConversation(pA.id);
  await saveMessage(cA.id, 'user', 'oi');
  await query(`update conversations set last_message_at = now() - interval '31 minutes' where id = $1`, [cA.id]);

  // ── Cenário B: lembrete enviado há 61min, paciente NÃO respondeu ──
  const pB = await findOrCreatePatient(PB, 'Sem Resposta');
  const cB = await getOrCreateActiveConversation(pB.id);
  await saveMessage(cB.id, 'user', 'oi');
  // Última msg ANTES do lembrete; lembrete há 61min
  await query(
    `update conversations
       set last_message_at = now() - interval '90 minutes',
           inactivity_reminder_at = now() - interval '61 minutes'
       where id = $1`,
    [cB.id],
  );

  // ── Cenário C: lembrete enviado há 61min, mas paciente RESPONDEU depois ──
  const pC = await findOrCreatePatient(PC, 'Respondeu');
  const cC = await getOrCreateActiveConversation(pC.id);
  await saveMessage(cC.id, 'user', 'oi inicial');
  // Última msg DEPOIS do lembrete → não deve fechar
  await query(
    `update conversations
       set last_message_at = now() - interval '30 minutes',
           inactivity_reminder_at = now() - interval '61 minutes'
       where id = $1`,
    [cC.id],
  );

  // Executa o cron
  const r = await checkInactivity(30, 60);
  console.log('\nresultado:', r);
  check('A recebeu lembrete (reminded >= 1)', r.reminded >= 1);
  check('B foi fechada (closed >= 1)', r.closed >= 1);

  const stA = await query<{ status: string; ts: string | null }>(
    `select status, inactivity_reminder_at as ts from conversations where id = $1`, [cA.id],
  );
  check('A: status continua bot + tem carimbo de lembrete', stA.rows[0]?.status === 'bot' && !!stA.rows[0]?.ts, stA.rows[0]);

  const stB = await query<{ status: string }>(`select status from conversations where id = $1`, [cB.id]);
  check('B: status virou closed', stB.rows[0]?.status === 'closed', stB.rows[0]);

  const stC = await query<{ status: string }>(`select status from conversations where id = $1`, [cC.id]);
  check('C (respondeu): continua ativa (status bot)', stC.rows[0]?.status === 'bot', stC.rows[0]);

  await query(`delete from patients where phone in ($1,$2,$3)`, [PA, PB, PC]);
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n${pass} ✅ / ${fail} ❌`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
