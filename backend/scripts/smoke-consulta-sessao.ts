import { createBotService } from '../src/services/bot.service.js';
import { createClaudeService } from '../src/services/claude.service.js';
import { pool, query } from '../src/db/pool.js';
import type { InboundJob } from '../src/services/queue.service.js';

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
};

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;
const PHONE = '5511955557777';

function nextMonday10(): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1);
  return d;
}
const bot = createBotService({ claude: createClaudeService({ apiKey: '', log: silentLog }), now: nextMonday10, log: silentLog });
const job = (text: string): InboundJob => ({ phone: PHONE, name: 'Teste', text, messageId: `wamid.${Math.random()}` });
const last = (o: { text: string }[]) => o[o.length - 1]?.text ?? '';

async function main() {
  await query(`delete from patients where phone = $1`, [PHONE]);

  // Cadastro completo
  await bot.handle(job('oi'));
  await bot.handle(job('111.222.333-44'));
  await bot.handle(job('Maria Teste'));
  await bot.handle(job('10/10/1990'));

  // ── Opção 1: Agendar CONSULTA (médico) ──
  console.log('\n── Opção 1: Agendar Consulta (médico) ──');
  let r = await bot.handle(job('1'));
  check('1 → pede convênio', last(r).toLowerCase().includes('convênio'));
  r = await bot.handle(job('Unimed'));
  check('convênio → mostra horários DE CONSULTA', last(r).includes('consulta') && last(r).toLowerCase().includes('horários'), last(r).slice(0, 80));
  check('horários só com Dr. Bruno (único médico)', !last(r).includes('Ana') && !last(r).includes('Carla') && last(r).includes('Bruno'));
  r = await bot.handle(job('1'));
  check('escolhe horário → consulta agendada', last(r).toLowerCase().includes('consulta foi agendada'), last(r).slice(0, 80));

  // Verifica no banco que é tipo "consulta" com médico
  const consulta = await query<{ kind: string; role: string }>(
    `select a.kind, pr.role from appointments a join professionals pr on pr.id = a.professional_id
     join patients p on p.id = a.patient_id where p.phone = $1 order by a.created_at desc limit 1`,
    [PHONE],
  );
  check('banco: kind=consulta com profissional médico', consulta.rows[0]?.kind === 'consulta' && consulta.rows[0]?.role === 'medico', consulta.rows[0]);

  // ── Opção 4: Agendar SESSÃO (fisio) ──
  console.log('\n── Opção 4: Agendar Sessão (fisio) ──');
  await bot.handle(job('oi'));
  r = await bot.handle(job('4'));
  check('4 → mostra horários DE SESSÃO', last(r).includes('sessão') && last(r).toLowerCase().includes('horários'), last(r).slice(0, 80));
  check('horários só com fisios (Ana ou Carla, sem Bruno)', !last(r).includes('Bruno') && (last(r).includes('Ana') || last(r).includes('Carla')));
  r = await bot.handle(job('1'));
  check('escolhe horário → sessão agendada', last(r).toLowerCase().includes('sessão foi agendada'), last(r).slice(0, 80));

  const sessao = await query<{ kind: string; role: string }>(
    `select a.kind, pr.role from appointments a join professionals pr on pr.id = a.professional_id
     join patients p on p.id = a.patient_id where p.phone = $1 order by a.created_at desc limit 1`,
    [PHONE],
  );
  check('banco: kind=sessao com profissional fisioterapeuta', sessao.rows[0]?.kind === 'sessao' && sessao.rows[0]?.role === 'fisioterapeuta', sessao.rows[0]);

  // ── Opção 2: Confirmar consulta (deve achar a consulta, não a sessão) ──
  console.log('\n── Opção 2: Confirmar minha consulta ──');
  await bot.handle(job('oi'));
  r = await bot.handle(job('2'));
  check('2 → confirma a CONSULTA', last(r).toLowerCase().includes('consulta') && last(r).toLowerCase().includes('confirmada'), last(r).slice(0, 80));

  // ── Opção 5: Cancelar sessão (deve achar a sessão, não a consulta) ──
  console.log('\n── Opção 5: Cancelar sessão ──');
  await bot.handle(job('oi'));
  r = await bot.handle(job('5'));
  check('5 → cancela a SESSÃO', last(r).toLowerCase().includes('sessão') && last(r).toLowerCase().includes('cancelada'), last(r).slice(0, 80));

  const sessaoCancelada = await query<{ status: string; kind: string }>(
    `select a.status, a.kind from appointments a join patients p on p.id = a.patient_id
     where p.phone = $1 and a.kind = 'sessao' order by a.created_at desc limit 1`,
    [PHONE],
  );
  check('sessão marcada cancelled (consulta intacta)', sessaoCancelada.rows[0]?.status === 'cancelled', sessaoCancelada.rows[0]);
  const consultaAtiva = await query<{ status: string }>(
    `select a.status from appointments a join patients p on p.id = a.patient_id
     where p.phone = $1 and a.kind = 'consulta' order by a.created_at desc limit 1`,
    [PHONE],
  );
  check('consulta continua confirmed (não foi tocada)', consultaAtiva.rows[0]?.status === 'confirmed', consultaAtiva.rows[0]);

  // ── Opção 3: Cancelar minha consulta ──
  console.log('\n── Opção 3: Cancelar minha consulta ──');
  await bot.handle(job('oi'));
  r = await bot.handle(job('3'));
  check('3 → cancela a CONSULTA', last(r).toLowerCase().includes('consulta') && last(r).toLowerCase().includes('cancelada'), last(r).slice(0, 80));

  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n${pass} ✅ / ${fail} ❌`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
