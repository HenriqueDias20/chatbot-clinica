import { createBotService } from '../src/services/bot.service.js';
import { createClaudeService } from '../src/services/claude.service.js';
import { pool, query } from '../src/db/pool.js';
import type { InboundJob } from '../src/services/queue.service.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;
const PA = '5511000000051'; // cadastro + agendamento
const PB = '5511000000052'; // pré-cadastrado: menu + humano

function nextMonday10(): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 1);
  return d;
}
const NOW = nextMonday10();
const bot = createBotService({ claude: createClaudeService({ apiKey: '', log: silentLog }), now: () => NOW, log: silentLog });

function job(phone: string, text: string): InboundJob {
  return { phone, name: 'Contato WhatsApp', text, messageId: `wamid.${Math.random()}` };
}
const last = (o: { text: string }[]) => o[o.length - 1]?.text ?? '';

async function main(): Promise<void> {
  await query(`delete from patients where phone in ($1,$2)`, [PA, PB]);

  // ── Cadastro inicial (sempre primeiro) + agendamento ──
  console.log('── Cadastro inicial (PA) ──');
  let r = await bot.handle(job(PA, 'oi'));
  check('1) 1ª mensagem -> pede CPF (cadastro)', last(r).includes('CPF'), last(r).slice(0, 50));

  r = await bot.handle(job(PA, 'cpf 123'));
  check('   CPF inválido -> re-pergunta', last(r).includes('11 números'), last(r).slice(0, 40));

  r = await bot.handle(job(PA, '123.456.789-01'));
  check('2) CPF -> pede nome completo', last(r).toLowerCase().includes('nome completo'), last(r).slice(0, 40));

  r = await bot.handle(job(PA, 'Maria Aparecida Silva'));
  check('3) Nome -> pede nascimento', last(r).toLowerCase().includes('nascimento'), last(r).slice(0, 40));

  r = await bot.handle(job(PA, '15/03/1990'));
  check('4) Nascimento -> cadastro confirmado + MENU', r.length === 2 && last(r).includes('Agendar'), { n: r.length, last: last(r).slice(0, 30) });

  r = await bot.handle(job(PA, '1'));
  check('5) Menu "1" Agendar -> pede convênio', last(r).toLowerCase().includes('convênio'), last(r).slice(0, 40));

  r = await bot.handle(job(PA, 'Unimed'));
  check('6) Convênio -> mostra horários', last(r).toLowerCase().includes('horários'), last(r).slice(0, 40));

  r = await bot.handle(job(PA, '1'));
  check('7) Escolhe "1" -> agendado', last(r).toLowerCase().includes('agendada'), last(r).slice(0, 40));

  const p = await query<{ name: string; cpf: string; birth_date: string; insurance: string }>(
    `select name, cpf, birth_date::text, insurance from patients where phone = $1`,
    [PA],
  );
  check('   Cadastro completo no banco', !!(p.rows[0]?.name && p.rows[0]?.cpf && p.rows[0]?.birth_date && p.rows[0]?.insurance), p.rows[0]);

  // ── Paciente cadastrado SEM convênio: menu + convênio no Confirmar + humano ──
  console.log('\n── Já cadastrado, sem convênio (PB) ──');
  await query(
    `insert into patients (phone, name, cpf, birth_date)
     values ($1,'Joao Teste','99988877700','1980-05-05')
     on conflict (phone) do update set cpf=excluded.cpf, insurance=null`,
    [PB],
  );
  r = await bot.handle(job(PB, 'oi'));
  check('8) Já cadastrado + "oi" -> vai direto pro MENU (não pede CPF)', last(r).includes('Agendar') && !last(r).includes('CPF'), last(r).slice(0, 30));

  r = await bot.handle(job(PB, '2'));
  check('9) Menu "2" Confirmar -> pede convênio (3 opções exigem)', last(r).toLowerCase().includes('convênio'), last(r).slice(0, 40));

  r = await bot.handle(job(PB, 'Particular'));
  check('10) Convênio -> executa Confirmar (sem agendamento)', last(r).toLowerCase().includes('não encontrei') || last(r).toLowerCase().includes('confirmada'), last(r).slice(0, 50));

  r = await bot.handle(job(PB, 'quero falar com a recepção'));
  check('11) "falar com recepção" -> human', last(r).toLowerCase().includes('recep'), last(r).slice(0, 40));

  r = await bot.handle(job(PB, 'tem alguém?'));
  check('12) Modo human -> bot não responde', r.length === 0, { replies: r.length });

  await query(`delete from patients where phone in ($1,$2)`, [PA, PB]);
}

main()
  .catch((err) => {
    console.error('Erro:', err);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
    process.exit(failures === 0 ? 0 : 1);
  });
