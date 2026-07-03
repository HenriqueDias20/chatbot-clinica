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
const PHONE = '5511933334444';

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
  // Cadastro
  await bot.handle(job('oi'));
  await bot.handle(job('123.456.789-00'));
  await bot.handle(job('Paciente Teste'));
  let r = await bot.handle(job('10/10/1990'));
  check('menu mostra 8 opções', last(r).includes('1️⃣') && last(r).includes('8️⃣'));
  check('opção 1 = Agendar uma consulta', last(r).includes('1️⃣ Agendar uma consulta'));
  check('opção 4 = Agendar uma sessão', last(r).includes('4️⃣ Agendar uma sessão'));
  check('opção 6 = Localização', last(r).includes('6️⃣ Localização'));
  check('opção 7 = Horários de atendimento', last(r).includes('7️⃣ Horários'));
  check('opção 8 = Falar com a recepção', last(r).includes('8️⃣ Falar com a recepção'));

  // Opção 6 — Localização (não precisa de cadastro completo, pula convênio)
  r = await bot.handle(job('6'));
  check('opção 6 mostra endereço', r[0]!.text.includes('Localização') && r[0]!.text.includes('Av. Exemplo'), r[0]?.text.slice(0, 60));
  check('opção 6 mostra link maps', r[0]!.text.includes('maps.google.com'));
  check('opção 6 reapresenta menu', r.length === 2 && r[1]!.text.includes('1️⃣'));

  // Opção 7 — Horários
  r = await bot.handle(job('7'));
  check('opção 7 mostra horários', r[0]!.text.toLowerCase().includes('horário'), r[0]?.text.slice(0, 60));
  check('opção 7 reapresenta menu', r.length === 2 && r[1]!.text.includes('1️⃣'));

  // Opção 8 — Recepção
  r = await bot.handle(job('8'));
  check('opção 8 encaminha à recepção', last(r).toLowerCase().includes('recep'));

  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n${pass} ✅ / ${fail} ❌`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
