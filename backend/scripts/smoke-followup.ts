import { createBotService } from '../src/services/bot.service.js';
import { createClaudeService } from '../src/services/claude.service.js';
import { checkInactivity } from '../src/services/cron.service.js';
import { findOrCreatePatient } from '../src/repositories/patient.repo.js';
import { getOrCreateActiveConversation } from '../src/repositories/conversation.repo.js';
import { saveMessage } from '../src/repositories/message.repo.js';
import { pool, query } from '../src/db/pool.js';
import type { InboundJob } from '../src/services/queue.service.js';

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}`, detail !== undefined ? JSON.stringify(String(detail).slice(0, 90)) : '');
};

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;
const PHONE = '5511922221111';
const bot = createBotService({ claude: createClaudeService({ apiKey: '', log: silentLog }), log: silentLog });
const job = (text: string): InboundJob => ({ phone: PHONE, name: 'Teste', text, messageId: `wamid.${Math.random()}` });
const all = (o: { text: string }[]) => o.map((x) => x.text).join(' | ');
const last = (o: { text: string }[]) => o[o.length - 1]?.text ?? '';

async function statusOf(convoId: string): Promise<string> {
  return (await query<{ status: string }>(`select status from conversations where id = $1`, [convoId])).rows[0]?.status ?? '?';
}
async function stepOf(convoId: string): Promise<string> {
  const r = await query<{ state: { step?: string } }>(`select state from conversations where id = $1`, [convoId]);
  return r.rows[0]?.state?.step ?? '(vazio)';
}

async function main() {
  await query(`delete from patients where phone = $1`, [PHONE]);
  // Cadastro
  await bot.handle(job('oi'));
  await bot.handle(job('111.222.333-44'));
  await bot.handle(job('Maria Teste'));
  await bot.handle(job('10/10/1990'));

  const p = await findOrCreatePatient(PHONE, 'Maria Teste');
  const convo = await getOrCreateActiveConversation(p.id);

  // ── Localização (6) → resposta + opções de continuação ──
  let r = await bot.handle(job('6'));
  check('6 (Localização) responde endereço', all(r).toLowerCase().includes('localiz'), last(r));
  check('6 oferece opções 1/2 (menu/encerrar)', last(r).includes('Voltar ao menu') && last(r).includes('Encerrar'), last(r));
  check('estado vira post_answer', (await stepOf(convo.id)) === 'post_answer');

  // Responde 1 → volta ao menu
  r = await bot.handle(job('1'));
  check('post_answer + "1" volta ao menu principal', last(r).includes('Agendar') && last(r).includes('Falar com a recepção'));
  check('estado vira menu', (await stepOf(convo.id)) === 'menu');

  // ── Horários (7) → 2 → encerra ──
  r = await bot.handle(job('7'));
  check('7 (Horários) oferece opções 1/2', last(r).includes('Encerrar atendimento'));
  r = await bot.handle(job('2'));
  check('post_answer + "2" encerra atendimento', last(r).toLowerCase().includes('encerrado'), last(r));
  check('conversa fica closed', (await statusOf(convo.id)) === 'closed');

  // ── Inatividade 10/5: lembrete com opções, depois auto-close ──
  await query(`delete from patients where phone = $1`, [PHONE]);
  const p2 = await findOrCreatePatient(PHONE, 'Inativo');
  const c2 = await getOrCreateActiveConversation(p2.id);
  await saveMessage(c2.id, 'user', 'oi');
  await query(`update conversations set last_message_at = now() - interval '11 minutes' where id = $1`, [c2.id]);

  const r1 = await checkInactivity(10, 5);
  check('inatividade: enviou lembrete (>=1)', r1.reminded >= 1);
  const remMsg = (await query<{ content: string }>(`select content from messages where conversation_id = $1 order by created_at desc limit 1`, [c2.id])).rows[0]?.content ?? '';
  check('lembrete diz "Ainda está aí?" com opções', remMsg.includes('Ainda está aí') && remMsg.includes('Encerrar'), remMsg);
  check('lembrete deixa conversa em post_answer', (await stepOf(c2.id)) === 'post_answer');

  // Cliente continua sem responder por +5min → auto-close
  await query(`update conversations set inactivity_reminder_at = now() - interval '6 minutes', last_message_at = now() - interval '17 minutes' where id = $1`, [c2.id]);
  const r2 = await checkInactivity(10, 5);
  check('inatividade: auto-fechou (>=1)', r2.closed >= 1);
  check('conversa auto-fechada fica closed', (await statusOf(c2.id)) === 'closed');
  const closeMsg = (await query<{ content: string }>(`select content from messages where conversation_id = $1 order by created_at desc limit 1`, [c2.id])).rows[0]?.content ?? '';
  check('mensagem de auto-encerramento correta', closeMsg.includes('não tivemos retorno'), closeMsg);

  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n${pass} ✅ / ${fail} ❌`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
