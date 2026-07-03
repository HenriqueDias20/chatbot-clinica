import { buildApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';
import { findOrCreatePatient } from '../src/repositories/patient.repo.js';
import { getOrCreateActiveConversation } from '../src/repositories/conversation.repo.js';
import { saveMessage } from '../src/repositories/message.repo.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

const PHONE = '5511000000088';

async function main(): Promise<void> {
  await query(`delete from patients where phone = $1`, [PHONE]);

  // Semeia uma conversa com mensagens.
  const patient = await findOrCreatePatient(PHONE, 'API Teste');
  const convo = await getOrCreateActiveConversation(patient.id);
  await saveMessage(convo.id, 'user', 'Olá, quero agendar');
  await saveMessage(convo.id, 'assistant', 'Claro! Quais horários...');

  const app = buildApp();
  await app.ready();

  // GET /api/conversations
  const r1 = await app.inject({ method: 'GET', url: '/api/conversations' });
  const list = r1.json().conversations as Array<{ id: string; phone: string; last_message: string }>;
  const mine = list.find((c) => c.phone === PHONE);
  check('GET /api/conversations lista a conversa', r1.statusCode === 200 && !!mine, { status: r1.statusCode, found: !!mine });
  check('Conversa traz última mensagem', mine?.last_message === 'Claro! Quais horários...', mine?.last_message);

  // GET messages
  const r2 = await app.inject({ method: 'GET', url: `/api/conversations/${convo.id}/messages` });
  const body2 = r2.json() as { messages: unknown[]; conversation: { phone: string } };
  check('GET messages -> histórico', r2.statusCode === 200 && body2.messages.length === 2, { n: body2.messages.length });
  check('GET messages -> dados do paciente', body2.conversation.phone === PHONE);

  // takeover
  const r3 = await app.inject({ method: 'POST', url: `/api/conversations/${convo.id}/takeover` });
  check('POST takeover -> human', r3.statusCode === 200 && r3.json().status === 'human', r3.json());

  // enviar mensagem manual (WhatsApp em dry-run)
  const r4 = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convo.id}/messages`,
    payload: { text: 'Oi, aqui é a recepção!' },
  });
  check('POST mensagem manual -> ok', r4.statusCode === 200 && r4.json().ok === true, r4.json());

  // texto vazio -> 400
  const r5 = await app.inject({ method: 'POST', url: `/api/conversations/${convo.id}/messages`, payload: { text: '  ' } });
  check('POST mensagem vazia -> 400', r5.statusCode === 400);

  // release
  const r6 = await app.inject({ method: 'POST', url: `/api/conversations/${convo.id}/release` });
  check('POST release -> bot', r6.statusCode === 200 && r6.json().status === 'bot', r6.json());

  // 404
  const r7 = await app.inject({ method: 'GET', url: `/api/conversations/00000000-0000-0000-0000-000000000000/messages` });
  check('GET messages inexistente -> 404', r7.statusCode === 404);

  await app.close();
  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .catch((err) => {
    console.error('Erro no smoke api:', err);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
    process.exit(failures === 0 ? 0 : 1);
  });
