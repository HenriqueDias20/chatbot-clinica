import { pool, query } from '../src/db/pool.js';

const PHONE = '5511933332222';
const NAME = 'Patrícia Almeida';
const base = 'http://127.0.0.1:3000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wh(text: string, id: string) {
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
              metadata: { display_phone_number: '5511999999999', phone_number_id: 'PID' },
              contacts: [{ profile: { name: NAME }, wa_id: PHONE }],
              messages: [{ from: PHONE, id, timestamp: '1700000000', type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

async function send(text: string) {
  await fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wh(text, `wamid.${Math.random()}`)) });
}
async function lastBot(cid: string): Promise<string> {
  const r = (await (await fetch(`${base}/api/conversations/${cid}/messages`)).json()) as { messages: Array<{ content: string }> };
  return r.messages.at(-1)?.content ?? '';
}
async function findCid(): Promise<string> {
  const r = (await (await fetch(`${base}/api/conversations`)).json()) as { conversations: Array<{ id: string; phone: string }> };
  return r.conversations.find((c) => c.phone === PHONE)?.id ?? '';
}

async function main(): Promise<void> {
  // Limpa qualquer resíduo e alarga o horário comercial temporariamente.
  await query(`delete from patients where phone = $1`, [PHONE]);
  await query(`update configs set value='00:00' where key='business_hours_start'`);
  await query(`update configs set value='23:59' where key='business_hours_end'`);
  console.log('⏰ Horário comercial alargado temporariamente para o teste.\n');

  const roteiro = [
    'Oi, gostaria de agendar uma consulta',
    '987.111.222-33',
    'Patrícia Almeida',
    '22/08/1992',
    '1',
    'Bradesco Saúde',
    '1',
  ];

  let cid = '';
  for (const msg of roteiro) {
    await send(msg);
    await sleep(2200);
    if (!cid) cid = await findCid();
    console.log(`👤 ${msg}`);
    console.log(`🤖 ${(await lastBot(cid)).replace(/\n/g, '\n   ')}\n`);
  }

  const appt = await query<{ status: string; scheduled_at: string }>(
    `select status, scheduled_at from appointments a join patients p on p.id=a.patient_id where p.phone=$1`,
    [PHONE],
  );
  const pat = await query(`select name, cpf, birth_date::text, insurance from patients where phone=$1`, [PHONE]);
  console.log('📋 Cadastro gravado:', JSON.stringify(pat.rows[0]));
  console.log('📅 Agendamento gravado:', JSON.stringify(appt.rows));

  // Restaura o horário comercial.
  await query(`update configs set value='08:00' where key='business_hours_start'`);
  await query(`update configs set value='18:00' where key='business_hours_end'`);
  console.log('\n⏰ Horário comercial restaurado (08:00–18:00).');
  console.log('👁️  A conversa da Patrícia ficou no painel para você ver (não foi apagada).');
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await query(`update configs set value='08:00' where key='business_hours_start'`).catch(() => {});
    await query(`update configs set value='18:00' where key='business_hours_end'`).catch(() => {});
    await pool.end();
    process.exit(1);
  });
