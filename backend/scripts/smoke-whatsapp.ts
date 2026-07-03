import { createWhatsAppService } from '../src/services/whatsapp.service.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

// ── Mock de fetch que grava as chamadas e devolve resposta de sucesso da Meta ──
interface Call {
  url: string;
  body: Record<string, unknown>;
  auth: string | undefined;
}
function makeFakeFetch(status = 200, responseBody: unknown = { messages: [{ id: 'wamid.SENT123' }] }) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
      auth: headers.get('authorization') ?? undefined,
    });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as never;

// ── 1) sendText monta payload correto ──
{
  const { fetchFn, calls } = makeFakeFetch();
  const svc = createWhatsAppService({ token: 'TKN', phoneNumberId: '123', fetchFn, log: silentLog });
  const r = await svc.sendText('+55 (11) 98888-7777', 'Olá!');
  const b = calls[0]?.body;
  check('sendText -> ok + messageId', r.ok && 'messageId' in r && r.messageId === 'wamid.SENT123', r);
  check('sendText -> telefone normalizado', b?.to === '5511988887777', { to: b?.to });
  check('sendText -> type=text e body correto', b?.type === 'text' && (b?.text as { body: string })?.body === 'Olá!');
  check('sendText -> Authorization Bearer', calls[0]?.auth === 'Bearer TKN');
  check('sendText -> URL v21.0 + phoneNumberId', calls[0]?.url.includes('/v21.0/123/messages') ?? false);
}

// ── 2) sendButtons (3 botões) ──
{
  const { fetchFn, calls } = makeFakeFetch();
  const svc = createWhatsAppService({ token: 'TKN', phoneNumberId: '123', fetchFn, log: silentLog });
  const r = await svc.sendButtons('5511988887777', 'Confirma sua sessão amanhã?', [
    { id: 'sim', title: 'Sim' },
    { id: 'nao', title: 'Cancelar' },
  ]);
  const inter = calls[0]?.body.interactive as { type: string; action: { buttons: unknown[] } } | undefined;
  check('sendButtons -> ok', r.ok);
  check('sendButtons -> type interactive/button', calls[0]?.body.type === 'interactive' && inter?.type === 'button');
  check('sendButtons -> 2 botões montados', inter?.action.buttons.length === 2);
}

// ── 3) sendButtons com 4 botões -> erro (limite da Meta) ──
{
  const { fetchFn, calls } = makeFakeFetch();
  const svc = createWhatsAppService({ token: 'TKN', phoneNumberId: '123', fetchFn, log: silentLog });
  const r = await svc.sendButtons('5511988887777', 'x', [
    { id: '1', title: 'A' },
    { id: '2', title: 'B' },
    { id: '3', title: 'C' },
    { id: '4', title: 'D' },
  ]);
  check('sendButtons 4 botões -> ok:false', !r.ok);
  check('sendButtons 4 botões -> NÃO chamou a Meta', calls.length === 0);
}

// ── 4) sendTemplate monta componentes/parâmetros ──
{
  const { fetchFn, calls } = makeFakeFetch();
  const svc = createWhatsAppService({ token: 'TKN', phoneNumberId: '123', fetchFn, log: silentLog });
  const r = await svc.sendTemplate('5511988887777', 'confirmacao_sessao', [
    { text: 'João' },
    { text: '14:00' },
    { text: 'Dra. Ana' },
  ]);
  const tmpl = calls[0]?.body.template as
    | { name: string; language: { code: string }; components: Array<{ parameters: unknown[] }> }
    | undefined;
  check('sendTemplate -> ok', r.ok);
  check('sendTemplate -> nome e idioma', tmpl?.name === 'confirmacao_sessao' && tmpl?.language.code === 'pt_BR');
  check('sendTemplate -> 3 parâmetros no body', tmpl?.components[0]?.parameters.length === 3);
}

// ── 5) Modo DRY-RUN (sem token) -> não chama a Meta ──
{
  const { fetchFn, calls } = makeFakeFetch();
  const svc = createWhatsAppService({ token: '', phoneNumberId: '', fetchFn, log: silentLog });
  const r = await svc.sendText('5511988887777', 'teste');
  check('dry-run -> ok + dryRun:true', r.ok && 'dryRun' in r && r.dryRun === true, r);
  check('dry-run -> NÃO chamou a Meta', calls.length === 0);
}

// ── 6) Erro da Meta (HTTP 400) -> ok:false com mensagem ──
{
  const { fetchFn } = makeFakeFetch(400, { error: { message: 'Invalid phone number', code: 100 } });
  const svc = createWhatsAppService({ token: 'TKN', phoneNumberId: '123', fetchFn, log: silentLog });
  const r = await svc.sendText('5511988887777', 'teste');
  check('erro Meta -> ok:false', !r.ok);
  check('erro Meta -> mensagem repassada', !r.ok && r.error === 'Invalid phone number', r);
}

console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
process.exit(failures === 0 ? 0 : 1);
