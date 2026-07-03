import { buildApp } from '../src/app.js';
import { startMessageConsumer } from '../src/bot/consumer.js';
import { createBotService } from '../src/services/bot.service.js';
import { createClaudeService } from '../src/services/claude.service.js';
import { pool, query } from '../src/db/pool.js';

const PORT = 3998;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) pass++;
  else fail++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

function wh(phone: string, text: string, id: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511999999999', phone_number_id: 'PHONE_ID' },
              contacts: [{ profile: { name: 'Teste' }, wa_id: phone }],
              messages: [{ from: phone, id, timestamp: '1700000000', type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function lastBotMessage(phone: string): Promise<string> {
  const res = await query<{ content: string }>(
    `select m.content from messages m
     join conversations c on c.id = m.conversation_id
     join patients p on p.id = c.patient_id
     where p.phone = $1 and m.role = 'assistant'
     order by m.created_at desc limit 1`,
    [phone],
  );
  return res.rows[0]?.content ?? '';
}
async function assistantCount(phone: string): Promise<number> {
  const res = await query<{ n: number }>(
    `select count(*)::int n from messages m
     join conversations c on c.id = m.conversation_id
     join patients p on p.id = c.patient_id
     where p.phone = $1 and m.role = 'assistant'`,
    [phone],
  );
  return res.rows[0]?.n ?? 0;
}

const PA = '5511955550001';
const PB = '5511955550002';
const PC = '5511955550003';

async function main(): Promise<void> {
  for (const p of [PA, PB, PC]) await query(`delete from patients where phone = $1`, [p]);

  await startMessageConsumer();
  const app = buildApp();
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`\n=== Servidor real em ${base} ===\n`);

  // ── Cenário A: CANCELAR ──
  console.log('── Cenário A: Cancelar agendamento (via HTTP) ──');
  // Pré-cadastra o paciente para pular o onboarding e ir direto aos horários.
  await query(
    `insert into patients (phone, name, cpf, birth_date, insurance)
     values ($1, 'Paciente A', '11111111111', '1990-01-01', 'Particular')
     on conflict (phone) do update set cpf = excluded.cpf`,
    [PA],
  );
  await post('/webhook', wh(PA, 'Quero agendar', 'a1'));
  await sleep(2200);
  await post('/webhook', wh(PA, '1', 'a2'));
  await sleep(2200);
  const apptBefore = await query(`select status from appointments a join patients p on p.id=a.patient_id where p.phone=$1`, [PA]);
  check('A) Agendamento criado', apptBefore.rows.length === 1, apptBefore.rows);
  await post('/webhook', wh(PA, 'quero cancelar', 'a3'));
  await sleep(2200);
  const apptAfter = await query<{ status: string }>(`select status from appointments a join patients p on p.id=a.patient_id where p.phone=$1`, [PA]);
  check('A) Agendamento marcado como cancelled', apptAfter.rows[0]?.status === 'cancelled', apptAfter.rows);
  console.log('   Bot:', (await lastBotMessage(PA)).slice(0, 70));

  // ── Cenário B: FALAR COM HUMANO ──
  console.log('\n── Cenário B: Falar com humano (via HTTP) ──');
  await post('/webhook', wh(PB, 'quero falar com um atendente', 'b1'));
  await sleep(2200);
  const statusB = await query<{ status: string }>(`select c.status from conversations c join patients p on p.id=c.patient_id where p.phone=$1`, [PB]);
  check('B) Conversa entrou em modo human', statusB.rows[0]?.status === 'human', statusB.rows);
  console.log('   Bot:', (await lastBotMessage(PB)).slice(0, 70));
  const before = await assistantCount(PB);
  await post('/webhook', wh(PB, 'tem alguém aí?', 'b2'));
  await sleep(2200);
  const after = await assistantCount(PB);
  check('B) Em modo human, bot NÃO responde (nº de respostas igual)', before === after, { before, after });

  // ── Cenário C: FORA DO HORÁRIO (via chamada direta, com "agora"=domingo) ──
  console.log('\n── Cenário C: Fora do horário comercial (domingo) ──');
  const sunday = new Date();
  while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
  sunday.setHours(10, 0, 0, 0);
  const botSunday = createBotService({ claude: createClaudeService({ apiKey: '', log: silentLog }), now: () => sunday, log: silentLog });
  const outs = await botSunday.handle({ phone: PC, name: 'Teste', text: 'Bom dia, quero agendar', messageId: 'c1' });
  const msgC = outs[0]?.text ?? '';
  check('C) Responde mensagem padrão fora do horário', /horário|atendimento/i.test(msgC), msgC.slice(0, 70));

  await app.close();
  for (const p of [PA, PB, PC]) await query(`delete from patients where phone = $1`, [p]);
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n=== Resultado: ${pass} PASS / ${fail} FAIL ===`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('Erro:', err);
    await pool.end();
    process.exit(1);
  });
