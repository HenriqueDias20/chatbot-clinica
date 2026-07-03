import { buildApp } from '../src/app.js';
import { startMessageConsumer } from '../src/bot/consumer.js';
import { pool, query } from '../src/db/pool.js';

const PHONE = '5511955554444';
const PORT = 3999;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function webhookBody(text: string, id: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511999999999', phone_number_id: 'PHONE_ID' },
              contacts: [{ profile: { name: 'Maria Teste' }, wa_id: PHONE }],
              messages: [{ from: PHONE, id, timestamp: '1700000000', type: 'text', text: { body: text } }],
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
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return res.json();
}

async function main(): Promise<void> {
  await query(`delete from patients where phone = $1`, [PHONE]);
  await startMessageConsumer();
  const app = buildApp();
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`\n=== Servidor HTTP real em ${base} ===\n`);

  const health = await get('/health/db');
  console.log('GET /health/db ->', JSON.stringify(health), '\n');

  // Conversa guiada: cada mensagem da "Maria" e a resposta do bot.
  const conversa: Array<[string, string]> = [
    ['Maria', 'quero agendar'],
    ['Maria', 'Maria Aparecida Silva'],
    ['Maria', '123.456.789-01'],
    ['Maria', '15/03/1990'],
    ['Maria', 'Unimed'],
    ['Maria', '1'],
  ];

  let convoId = '';
  let n = 0;
  for (const [, msg] of conversa) {
    await post('/webhook', webhookBody(msg, `wamid.L${n++}`));
    await sleep(2200);
    if (!convoId) {
      const list = (await get('/api/conversations')) as { conversations: Array<{ id: string; phone: string }> };
      convoId = list.conversations.find((c) => c.phone === PHONE)?.id ?? '';
    }
    const m = (await get(`/api/conversations/${convoId}/messages`)) as { messages: Array<{ content: string }> };
    console.log(`👤 ${msg}`);
    console.log(`🤖 ${m.messages.at(-1)!.content.replace(/\n/g, '\n   ')}\n`);
  }

  const appt = await query<{ status: string; scheduled_at: string }>(
    `select status, scheduled_at from appointments a join patients p on p.id = a.patient_id where p.phone = $1`,
    [PHONE],
  );
  const pat = await query(`select name, cpf, birth_date::text, insurance from patients where phone = $1`, [PHONE]);
  console.log('Cadastro no Supabase:', JSON.stringify(pat.rows[0]));
  console.log('Agendamento no Supabase:', JSON.stringify(appt.rows));

  await app.close();
  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .then(async () => {
    await pool.end();
    console.log('\n=== Fim (dados de teste limpos) ===');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Erro:', err);
    await pool.end();
    process.exit(1);
  });
