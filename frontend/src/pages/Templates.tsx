import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { WhatsAppTemplate } from '../types';

/** Troca {{1}}, {{2}}… pelos valores digitados (para a prévia). */
function renderBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_full, n: string) => params[Number(n) - 1] || `{{${n}}}`);
}

export default function Templates() {
  const [selected, setSelected] = useState<WhatsAppTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: api.getTemplates });
  const templates = templatesQuery.data?.templates ?? [];
  const listError = templatesQuery.data?.error;

  const preview = useMemo(() => (selected ? renderBody(selected.body, params) : ''), [selected, params]);
  const canSend = Boolean(selected && phone.trim() && params.every((p) => p.trim()));

  const send = useMutation({
    mutationFn: () =>
      api.sendTemplate({
        phone: phone.trim(),
        name: name.trim() || undefined,
        template: selected!.name,
        language: selected!.language,
        params,
        body: selected!.body,
      }),
    onSuccess: () => {
      setFeedback({ ok: true, msg: 'Mensagem enviada! A conversa já aparece na aba Conversas.' });
      setPhone('');
      setName('');
      setParams(selected ? new Array(selected.paramCount).fill('') : []);
    },
    onError: (e) => setFeedback({ ok: false, msg: (e as Error).message }),
  });

  function pick(t: WhatsAppTemplate) {
    setSelected(t);
    setParams(new Array(t.paramCount).fill(''));
    setFeedback(null);
  }

  return (
    <div className="h-full overflow-auto bg-surface p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Enviar mensagem ao cliente</h1>
        <p className="text-sm text-gray-500">
          Para iniciar uma conversa (ou falar com quem não escreve há mais de 24h), o WhatsApp exige um
          <strong> modelo aprovado pela Meta</strong>.
        </p>
      </div>

      {templatesQuery.isLoading && <div className="text-sm text-gray-400">Carregando modelos...</div>}

      {listError && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Não consegui listar os modelos.</strong>
          <div className="mt-1">{listError}</div>
          <div className="mt-2 text-amber-700">
            Confira se a variável <code className="rounded bg-amber-100 px-1">WHATSAPP_WABA_ID</code> está
            configurada no Railway e se o token do WhatsApp é válido.
          </div>
        </div>
      )}

      {!templatesQuery.isLoading && !listError && templates.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
          <strong className="text-gray-900">Nenhum modelo aprovado ainda.</strong>
          <p className="mt-2">
            Crie os modelos no <strong>WhatsApp Manager</strong> (Meta) em <em>Modelos de mensagem → Criar modelo</em>,
            categoria <strong>Utilidade</strong> e idioma <strong>Português (BR)</strong>. Assim que a Meta aprovar,
            eles aparecem aqui automaticamente.
          </p>
        </div>
      )}

      {templates.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
          {/* Lista de modelos */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Modelos aprovados</h2>
            <ul className="space-y-2">
              {templates.map((t) => (
                <li key={`${t.name}-${t.language}`}>
                  <button
                    onClick={() => pick(t)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected?.name === t.name
                        ? 'border-petroleum-500 bg-petroleum-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{t.body}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">
                      {t.language} · {t.category}
                      {t.paramCount > 0 && ` · ${t.paramCount} variável(is)`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Formulário de envio */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            {!selected ? (
              <div className="py-10 text-center text-sm text-gray-400">
                Selecione um modelo à esquerda para enviar.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Telefone do cliente
                  </label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="51 99999-9999"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Nome do cliente <span className="font-normal normal-case text-gray-400">(opcional)</span>
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Maria Silva"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>

                {params.map((p, i) => (
                  <div key={i}>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Variável {`{{${i + 1}}}`}
                    </label>
                    <input
                      value={p}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                ))}

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Prévia</div>
                  <div className="whitespace-pre-wrap rounded-xl bg-petroleum-600 px-4 py-3 text-sm text-white">
                    {preview}
                  </div>
                </div>

                {feedback && (
                  <div
                    className={`rounded-xl p-3 text-sm ${
                      feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {feedback.msg}
                  </div>
                )}

                <button
                  onClick={() => send.mutate()}
                  disabled={!canSend || send.isPending}
                  className="rounded-lg bg-petroleum-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-petroleum-700 disabled:opacity-50"
                >
                  {send.isPending ? 'Enviando...' : 'Enviar mensagem'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
