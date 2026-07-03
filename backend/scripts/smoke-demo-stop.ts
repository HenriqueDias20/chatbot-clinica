import { startDemoConversation, clearDemoConversations } from '../src/services/demo.service.js';
import { assignConversation } from '../src/repositories/conversation.repo.js';
import { query, pool } from '../src/db/pool.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (l: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}`, d ?? ''); };
const count = async (id: string) => Number((await query<{ n: string }>(`select count(*)::int n from messages where conversation_id=$1`, [id])).rows[0]?.n ?? 0);

async function main() {
  // Garante um usuário para "assumir".
  const u = await query<{ id: string }>(`select id from users limit 1`);
  const userId = u.rows[0]!.id;

  const { conversationId } = await startDemoConversation('agendar_consulta');
  console.log('conversa:', conversationId);

  await sleep(7000); // deixa tocar ~2 mensagens
  const antes = await count(conversationId);
  console.log('mensagens antes de assumir:', antes);

  // Atendente assume (mesma coisa que o botão "Assumir conversa")
  await assignConversation(conversationId, userId);
  console.log('→ atendente assumiu');

  await sleep(10000); // espera bem mais que o intervalo (3s) entre mensagens
  const depois = await count(conversationId);
  console.log('mensagens depois de assumir (+10s):', depois);

  check('o bot parou após assumir (no máx +1 msg em transição)', depois - antes <= 1, `Δ=${depois - antes}`);
  const st = (await query<{ status: string }>(`select status from conversations where id=$1`, [conversationId])).rows[0]?.status;
  check('conversa continua em human (atendente no controle)', st === 'human', st);

  await clearDemoConversations();
  await pool.end();
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
