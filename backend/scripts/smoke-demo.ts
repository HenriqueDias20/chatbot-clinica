import { startDemoConversation } from '../src/services/demo.service.js';
import { query, pool } from '../src/db/pool.js';
import { bus } from '../src/lib/events.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function count(convo: string): Promise<number> {
  const r = await query<{ n: string }>(`select count(*)::int as n from messages where conversation_id = $1`, [convo]);
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  // Captura os eventos emitidos (como o WebSocket faria).
  const typingEvents: string[] = [];
  const messageEvents: number[] = [];
  bus.on('conversation:typing', (p) => typingEvents.push(p.role));
  bus.on('message:new', () => messageEvents.push(Date.now()));

  const { conversationId } = await startDemoConversation();
  console.log('conversa criada:', conversationId);

  const samples: Array<{ t: string; n: number }> = [];
  let elapsed = 0;
  for (const step of [800, 5000, 5000, 5000, 5000, 5000, 6000]) {
    await sleep(step);
    elapsed += step;
    samples.push({ t: `~${Math.round(elapsed / 1000)}s`, n: await count(conversationId) });
  }
  console.table(samples);

  const finalN = samples[samples.length - 1]!.n;
  const grew = samples[0]!.n < finalN; // começou com menos do que terminou
  console.log(`\nmensagens cresceram progressivamente? ${grew ? '✅ SIM' : '❌ NÃO'} (de ${samples[0]!.n} → ${finalN})`);
  console.log(`total esperado: 10 | obtido: ${finalN} → ${finalN === 10 ? '✅' : '❌'}`);
  console.log(`eventos typing emitidos: ${typingEvents.length} (esperado 10) → ${typingEvents.length === 10 ? '✅' : '❌'}`);
  console.log(`eventos message:new emitidos: ${messageEvents.length} (esperado 10) → ${messageEvents.length === 10 ? '✅' : '❌'}`);

  // status final deve ser human (handoff no fim do roteiro)
  const st = await query<{ status: string }>(`select status from conversations where id = $1`, [conversationId]);
  console.log(`status final: ${st.rows[0]?.status} → ${st.rows[0]?.status === 'human' ? '✅ (encaminhou pra recepção)' : '❌'}`);

  await query(`delete from patients where phone = '5511987650000'`);
  await pool.end();
  const ok = grew && finalN === 10 && typingEvents.length === 10 && messageEvents.length === 10 && st.rows[0]?.status === 'human';
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
