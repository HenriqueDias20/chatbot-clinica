import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';

const app = buildApp();
await app.ready();

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  const ok = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${ok}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

// 1) GET verificação com token correto -> ecoa o challenge
const r1 = await app.inject({
  method: 'GET',
  url: `/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=CHALLENGE_123`,
});
check('GET verify token correto -> 200 + challenge', r1.statusCode === 200 && r1.body === 'CHALLENGE_123', {
  status: r1.statusCode,
  body: r1.body,
});

// 2) GET verificação com token errado -> 403
const r2 = await app.inject({
  method: 'GET',
  url: `/webhook?hub.mode=subscribe&hub.verify_token=TOKEN_ERRADO&hub.challenge=x`,
});
check('GET verify token errado -> 403', r2.statusCode === 403, { status: r2.statusCode });

// 3) POST mensagem de texto -> 200
const payload = {
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
            contacts: [{ profile: { name: 'João Teste' }, wa_id: '5511988887777' }],
            messages: [
              {
                from: '5511988887777',
                id: 'wamid.ABC123',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Olá, quero agendar uma sessão' },
              },
            ],
          },
        },
      ],
    },
  ],
};
const r3 = await app.inject({
  method: 'POST',
  url: '/webhook',
  headers: { 'content-type': 'application/json' },
  payload,
});
check('POST mensagem -> 200', r3.statusCode === 200, { status: r3.statusCode });

// 4) Health do banco
const r4 = await app.inject({ method: 'GET', url: '/health/db' });
check('GET /health/db -> 200 db up', r4.statusCode === 200, { body: r4.json() });

await app.close();
console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
process.exit(failures === 0 ? 0 : 1);
