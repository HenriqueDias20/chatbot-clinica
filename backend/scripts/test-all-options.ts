import { createBotService } from '../src/services/bot.service.js';
import { createClaudeService } from '../src/services/claude.service.js';
import { setConversationStatus } from '../src/repositories/conversation.repo.js';
import { pool, query } from '../src/db/pool.js';
import type { InboundJob } from '../src/services/queue.service.js';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean): void {
  if (cond) pass++;
  else fail++;
  console.log(`   ${cond ? '✅' : '❌'} ${label}`);
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;
const PHONE = '5511944443333';

function nextMonday10(): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 1);
  return d;
}
const bot = createBotService({ claude: createClaudeService({ apiKey: '', log: silentLog }), now: nextMonday10, log: silentLog });

function job(text: string): InboundJob {
  return { phone: PHONE, name: 'Contato', text, messageId: `wamid.${Math.random()}` };
}
const last = (o: { text: string }[]) => o[o.length - 1]?.text ?? '';

async function say(text: string): Promise<{ text: string }[]> {
  const r = await bot.handle(job(text));
  console.log(`   👤 ${text}`);
  for (const m of r) console.log(`   🤖 ${m.text.replace(/\n/g, '\n      ')}`);
  if (r.length === 0) console.log('   🤖 (silêncio — bot não responde)');
  return r;
}

async function convoId(): Promise<string> {
  const res = await query<{ id: string }>(
    `select c.id from conversations c join patients p on p.id = c.patient_id where p.phone = $1 order by c.created_at desc limit 1`,
    [PHONE],
  );
  return res.rows[0]!.id;
}

async function main(): Promise<void> {
  await query(`delete from patients where phone = $1`, [PHONE]);

  console.log('\n══ CADASTRO INICIAL ══');
  let r = await say('Olá');
  check('1ª mensagem pede CPF', last(r).includes('CPF'));
  await say('123.456.789-01');
  await say('Henrique Dias');
  r = await say('15/03/1990');
  check('Cadastro concluído → mostra MENU', last(r).includes('Agendar'));

  console.log('\n══ OPÇÃO 1 — AGENDAR ══');
  r = await say('1');
  check('pede convênio', last(r).toLowerCase().includes('convênio'));
  r = await say('Unimed');
  check('mostra horários', last(r).toLowerCase().includes('horários'));
  r = await say('1');
  check('agendamento confirmado', last(r).toLowerCase().includes('agendada'));
  const appt = await query(`select status from appointments a join patients p on p.id=a.patient_id where p.phone=$1`, [PHONE]);
  check('agendamento gravado no banco', appt.rows.length === 1);

  console.log('\n══ OPÇÃO 2 — CONFIRMAR ══');
  await say('oi');
  r = await say('2');
  check('confirma a sessão', last(r).toLowerCase().includes('confirmada'));

  console.log('\n══ OPÇÃO 4 — DÚVIDA ══');
  await say('oi');
  r = await say('4');
  check('pede a dúvida', last(r).toLowerCase().includes('dúvida'));
  r = await say('Qual o endereço da clínica?');
  check('responde a dúvida (FAQ)', last(r).length > 0);

  console.log('\n══ OPÇÃO 3 — CANCELAR ══');
  await say('oi');
  r = await say('3');
  check('cancela a sessão', last(r).toLowerCase().includes('cancelada'));
  const apptC = await query<{ status: string }>(`select status from appointments a join patients p on p.id=a.patient_id where p.phone=$1`, [PHONE]);
  check('agendamento marcado cancelled', apptC.rows[0]?.status === 'cancelled');

  console.log('\n══ OPÇÃO 5 — RECEPÇÃO (HUMANO) ══');
  await say('oi');
  r = await say('5');
  check('encaminha para recepção', last(r).toLowerCase().includes('recep'));
  const st = await query<{ status: string }>(`select c.status from conversations c join patients p on p.id=c.patient_id where p.phone=$1`, [PHONE]);
  check('conversa em modo human', st.rows[0]?.status === 'human');

  console.log('\n══ EM MODO HUMANO — BOT FICA EM SILÊNCIO ══');
  r = await say('tem alguém aí?');
  check('bot NÃO responde (recepção assume)', r.length === 0);

  console.log('\n══ DEVOLVER PRO BOT (ação do painel) ══');
  const cid = await convoId();
  await setConversationStatus(cid, 'bot'); // simula o botão "Devolver pro bot"
  console.log('   🔄 recepção clicou em "Devolver pro bot" (status → bot)');
  r = await say('oi de novo');
  check('bot volta a responder após devolução', r.length > 0 && last(r).includes('Agendar'));

  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n══════════════════════════════\n   RESULTADO: ${pass} ✅  /  ${fail} ❌\n══════════════════════════════`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('Erro:', err);
    await pool.end();
    process.exit(1);
  });
