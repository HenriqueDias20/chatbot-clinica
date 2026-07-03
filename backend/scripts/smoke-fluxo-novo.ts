import { createBotService } from '../src/services/bot.service.js';
import { createClaudeService } from '../src/services/claude.service.js';
import { pool, query } from '../src/db/pool.js';
import type { InboundJob } from '../src/services/queue.service.js';

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}`, d !== undefined ? JSON.stringify(String(d).slice(0, 90)) : ''); };

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;
const PHONE = '5511911110000';
function nextMonday10(): Date { const d = new Date(); d.setHours(10, 0, 0, 0); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1); return d; }
const bot = createBotService({ claude: createClaudeService({ apiKey: '', log: silent }), now: nextMonday10, log: silent });
const job = (t: string): InboundJob => ({ phone: PHONE, name: 'Teste', text: t, messageId: `w.${Math.random()}` });
const last = (o: { text: string }[]) => o[o.length - 1]?.text ?? '';
const joined = (o: { text: string }[]) => o.map((x) => x.text).join(' | ');

async function main() {
  await query(`delete from patients where phone = $1`, [PHONE]);

  // Cadastro
  await bot.handle(job('oi'));
  await bot.handle(job('11122233344'));
  await bot.handle(job('Maria Teste'));
  let r = await bot.handle(job('10/10/1990'));
  check('cadastro → menu principal (5 opções)', last(r).includes('Consulta') && last(r).includes('Encerrar atendimento'), last(r));

  // ── Consulta → Agendar → Primeira consulta → Unimed → horário ──
  r = await bot.handle(job('1'));
  check('menu 1 → submenu Consulta', last(r).includes('Agendar consulta') && last(r).includes('Voltar ao menu'));
  r = await bot.handle(job('1'));
  check('Consulta 1 → tipos de consulta', last(r).includes('Primeira consulta') && last(r).includes('Avaliação'));
  r = await bot.handle(job('1'));
  check('tipo 1 → pergunta convênio (lista)', last(r).includes('qual é o seu convênio') && last(r).includes('Unimed'), last(r));
  r = await bot.handle(job('3'));
  check('convênio 3 (Unimed) → horários de consulta (médico Bruno)', last(r).includes('consulta') && last(r).includes('Bruno') && !last(r).includes('Ana'));
  r = await bot.handle(job('1'));
  check('escolhe horário → consulta (Primeira consulta) agendada + followup', joined(r).includes('Primeira consulta') && joined(r).includes('agendada') && last(r).includes('Encerrar atendimento'), joined(r));
  const cons = await query<{ kind: string; role: string; ins: string }>(
    `select a.kind, pr.role, p.insurance ins from appointments a join professionals pr on pr.id=a.professional_id join patients p on p.id=a.patient_id where p.phone=$1 order by a.created_at desc limit 1`, [PHONE]);
  check('banco: consulta com médico + convênio Unimed', cons.rows[0]?.kind === 'consulta' && cons.rows[0]?.role === 'medico' && cons.rows[0]?.ins === 'Unimed', cons.rows[0]);

  // followup 1 → volta ao menu principal
  r = await bot.handle(job('1'));
  check('followup 1 → menu principal', last(r).includes('Localização / Horário'));

  // ── Sessão → Agendar → Fisioterapia → Outros(convênio) → horário ──
  r = await bot.handle(job('2'));
  check('menu 2 → submenu Sessão', last(r).includes('Agendar sessão'));
  r = await bot.handle(job('1'));
  check('Sessão 1 → tipos de sessão', last(r).includes('Fisioterapia') && last(r).includes('Pélvica'));
  r = await bot.handle(job('1'));
  check('tipo Fisioterapia → convênio', last(r).includes('convênio'));
  r = await bot.handle(job('8'));
  check('convênio 8 (Outros) → pede nome', last(r).toLowerCase().includes('qual é o seu convênio') || last(r).toLowerCase().includes('convênio'));
  r = await bot.handle(job('Bradesco Saúde'));
  check('convênio digitado → horários de sessão (fisio)', last(r).includes('sessão') && (last(r).includes('Ana') || last(r).includes('Carla')) && !last(r).includes('Bruno'));
  r = await bot.handle(job('1'));
  check('escolhe horário → sessão (Fisioterapia) agendada', joined(r).includes('Fisioterapia') && joined(r).includes('agendada'));
  const sess = await query<{ kind: string; role: string; ins: string }>(
    `select a.kind, pr.role, p.insurance ins from appointments a join professionals pr on pr.id=a.professional_id join patients p on p.id=a.patient_id where p.phone=$1 order by a.created_at desc limit 1`, [PHONE]);
  check('banco: sessão com fisio + convênio Bradesco', sess.rows[0]?.kind === 'sessao' && sess.rows[0]?.role === 'fisioterapeuta' && sess.rows[0]?.ins === 'Bradesco Saúde', sess.rows[0]);

  // ── Avaliação (submenu) ──
  await bot.handle(job('1')); // followup → menu
  await bot.handle(job('1')); // Consulta
  await bot.handle(job('1')); // Agendar
  r = await bot.handle(job('5')); // Avaliação
  check('tipo 5 → submenu Avaliação', last(r).includes('Antropometria') && last(r).includes('Baropodometria'));
  r = await bot.handle(job('1')); // Antropometria
  check('Avaliação 1 → convênio (guardou tipo)', last(r).includes('convênio'));
  r = await bot.handle(job('1')); // Particular
  r = await bot.handle(job('1')); // horário
  check('agenda com tipo "Avaliação — Antropometria"', joined(r).includes('Avaliação') && joined(r).includes('Antropometria'), joined(r));

  // ── Localização/Horário (menu 3) ──
  await bot.handle(job('1')); // followup → menu
  r = await bot.handle(job('3'));
  check('menu 3 → Localização + Horário + followup', last(r).includes('Encerrar atendimento') && joined(r).includes('Localização'));

  // ── Encerrar (menu 5) ──
  await bot.handle(job('1')); // followup → menu
  r = await bot.handle(job('5'));
  check('menu 5 → encerra atendimento', last(r).toLowerCase().includes('encerrado'));
  const st = await query<{ status: string }>(`select status from conversations where patient_id=(select id from patients where phone=$1) order by created_at desc limit 1`, [PHONE]);
  check('conversa fica closed', st.rows[0]?.status === 'closed', st.rows[0]);

  // ── Falar com atendente (menu 4) numa nova conversa ──
  await bot.handle(job('oi')); // nova conversa (a anterior fechou) → cadastro? já registrado → intent → menu
  // força menu:
  let rr = await bot.handle(job('menu'));
  // pode não cair no menu; vamos garantir indo por intenção que leva a main_menu; então:
  await bot.handle(job('1')); // se estiver no menu, entra em consulta; senão ignore
  // Teste direto de handoff via palavra-chave:
  rr = await bot.handle(job('quero falar com atendente'));
  check('palavra-chave "atendente" → transbordo (human)', last(rr).toLowerCase().includes('recepção') || last(rr).toLowerCase().includes('encaminhando'), last(rr));

  await query(`delete from patients where phone = $1`, [PHONE]);
}

main().then(async () => { await pool.end(); console.log(`\n${pass} ✅ / ${fail} ❌`); process.exit(fail === 0 ? 0 : 1); })
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
