import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeService, type ReplyContext } from '../src/services/claude.service.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;

/** Cria um cliente Anthropic falso que devolve um texto fixo (ou lança erro). */
function fakeClient(opts: { text?: string; throws?: boolean }): Anthropic {
  return {
    messages: {
      create: async () => {
        if (opts.throws) throw new Error('boom');
        return { content: [{ type: 'text', text: opts.text ?? '' }] };
      },
    },
  } as unknown as Anthropic;
}

const ctx: ReplyContext = {
  clinicName: 'Clínica de Fisioterapia',
  faq: [
    { question: 'Qual o endereço da clínica?', answer: 'Av. Exemplo, 123 — Centro.' },
    { question: 'Vocês atendem convênio?', answer: 'Atendemos os principais convênios e particular.' },
  ],
};

// ── 1) MOCK: classificação por heurística ──
{
  const svc = createClaudeService({ apiKey: '', log: silentLog });
  check('mock -> isConfigured false', svc.isConfigured === false);
  const cases: Array<[string, string]> = [
    ['Quero agendar uma sessão', 'AGENDAR'],
    ['Preciso cancelar minha consulta', 'CANCELAR'],
    ['Confirmo sim', 'CONFIRMAR'],
    ['1', 'CONFIRMAR'],
    ['Quero falar com um atendente', 'FALAR_HUMANO'],
    ['Qual o endereço de vocês?', 'DUVIDA'],
    ['oi', 'OUTRO'],
  ];
  for (const [text, expected] of cases) {
    const r = await svc.classifyIntent(text);
    check(`mock classify "${text}" -> ${expected}`, r.intent === expected && r.mock === true, r);
  }
}

// ── 2) Caminho REAL (cliente injetado) classifica corretamente ──
{
  const svc = createClaudeService({ apiKey: '', client: fakeClient({ text: 'AGENDAR' }), log: silentLog });
  check('real -> isConfigured true', svc.isConfigured === true);
  const r = await svc.classifyIntent('quero marcar');
  check('real classify -> AGENDAR + mock:false', r.intent === 'AGENDAR' && r.mock === false, r);
}

// ── 3) Resposta com lixo -> OUTRO ──
{
  const svc = createClaudeService({ apiKey: '', client: fakeClient({ text: 'blah blah sei lá' }), log: silentLog });
  const r = await svc.classifyIntent('???');
  check('real classify resposta inválida -> OUTRO', r.intent === 'OUTRO', r);
}

// ── 4) Erro do cliente -> fallback OUTRO ──
{
  const svc = createClaudeService({ apiKey: '', client: fakeClient({ throws: true }), log: silentLog });
  const r = await svc.classifyIntent('quero agendar');
  check('erro classify -> fallback OUTRO', r.intent === 'OUTRO' && r.mock === false, r);
}

// ── 5) MOCK generateReply casa com FAQ ──
{
  const svc = createClaudeService({ apiKey: '', log: silentLog });
  const r = await svc.generateReply('qual o endereço?', [], ctx);
  check('mock reply casa FAQ endereço', r.text.includes('Av. Exemplo') && r.mock === true, r);
  const r2 = await svc.generateReply('blá aleatório', [], ctx);
  check('mock reply sem match -> resposta padrão', r2.text.length > 0 && r2.mock === true);
}

// ── 6) REAL generateReply usa o texto do cliente ──
{
  const svc = createClaudeService({
    apiKey: '',
    client: fakeClient({ text: 'Atendemos sim! Pode trazer seu convênio.' }),
    log: silentLog,
  });
  const r = await svc.generateReply('vocês atendem unimed?', [], ctx);
  check('real reply usa texto do Claude', r.text.includes('Atendemos sim') && r.mock === false, r);
}

// ── 7) Erro no generateReply -> fallback ──
{
  const svc = createClaudeService({ apiKey: '', client: fakeClient({ throws: true }), log: silentLog });
  const r = await svc.generateReply('oi', [], ctx);
  check('erro reply -> fallback recepção', r.text.toLowerCase().includes('recep'), r);
}

console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
process.exit(failures === 0 ? 0 : 1);
