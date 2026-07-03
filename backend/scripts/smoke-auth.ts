import { buildApp } from '../src/app.js';
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

const PHONE = '5511933332222';

async function main() {
  const app = buildApp();
  await app.ready();

  // ── Rota protegida SEM token → 401 ──
  const noAuth = await app.inject({ method: 'GET', url: '/api/conversations' });
  check('GET /api/conversations sem token → 401', noAuth.statusCode === 401, noAuth.statusCode);

  // ── Login errado → 401 ──
  const badLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'recepcao@clinica.com', password: 'senha-errada' },
  });
  check('login com senha errada → 401', badLogin.statusCode === 401, badLogin.statusCode);

  // ── Login correto → token ──
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'recepcao@clinica.com', password: 'clinica123' },
  });
  check('login correto → 200', login.statusCode === 200, login.statusCode);
  const { token, user } = login.json() as { token: string; user: { id: string; name: string } };
  check('login retorna token + nome do usuário', !!token && user?.name === 'Recepção', user);

  const auth = { authorization: `Bearer ${token}` };

  // ── /api/auth/me com token ──
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth });
  check('GET /me com token → usuário', me.statusCode === 200 && (me.json() as any).user?.name === 'Recepção');

  // ── Rota protegida COM token → 200 ──
  const withAuth = await app.inject({ method: 'GET', url: '/api/conversations', headers: auth });
  check('GET /api/conversations com token → 200', withAuth.statusCode === 200, withAuth.statusCode);

  // ── Takeover registra quem assumiu ──
  await query(`delete from patients where phone = $1`, [PHONE]);
  const p = await findOrCreatePatient(PHONE, 'Paciente Teste');
  const convo = await getOrCreateActiveConversation(p.id);
  await saveMessage(convo.id, 'user', 'preciso de ajuda');

  const takeover = await app.inject({ method: 'POST', url: `/api/conversations/${convo.id}/takeover`, headers: auth });
  check('takeover → 200 com nome de quem assumiu', takeover.statusCode === 200 && (takeover.json() as any).assignedUserName === 'Recepção', takeover.json());

  // Lista deve trazer assigned_user_name preenchido
  const list = (await app.inject({ method: 'GET', url: '/api/conversations', headers: auth })).json() as any;
  const inList = list.conversations.find((c: any) => c.id === convo.id);
  check('conversa na lista mostra quem assumiu', inList?.assigned_user_name === 'Recepção' && inList?.status === 'human', { name: inList?.assigned_user_name, status: inList?.status });

  // Release limpa o responsável
  const release = await app.inject({ method: 'POST', url: `/api/conversations/${convo.id}/release`, headers: auth });
  check('release → 200', release.statusCode === 200);
  const after = await query<{ assigned_user_id: string | null; status: string }>(
    `select assigned_user_id, status from conversations where id = $1`, [convo.id],
  );
  check('release limpa assigned_user_id e volta pra bot', after.rows[0]?.assigned_user_id === null && after.rows[0]?.status === 'bot', after.rows[0]);

  await query(`delete from patients where phone = $1`, [PHONE]);
  await app.close();
}

main()
  .then(async () => {
    await pool.end();
    console.log(`\n${pass} ✅ / ${fail} ❌`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
