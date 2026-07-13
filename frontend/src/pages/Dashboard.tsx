import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  consulta: { label: 'Consulta', color: '#6366f1' },
  sessao: { label: 'Sessão', color: '#0ea5e9' },
  localizacao: { label: 'Localização / Horário', color: '#f59e0b' },
  atendente: { label: 'Falar com atendente', color: '#f43f5e' },
  sem_categoria: { label: 'Sem categoria', color: '#9ca3af' },
};
const ACTION_LABELS: Record<string, string> = {
  agendar: 'Agendar',
  reagendar: 'Reagendar',
  cancelar: 'Cancelar',
  confirmar: 'Confirmar',
  sem_acao: 'Não informado',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function catLabel(c: string): string {
  return CATEGORY_META[c]?.label ?? c;
}
function catColor(c: string): string {
  return CATEGORY_META[c]?.color ?? '#9ca3af';
}
function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  if (!s || s <= 0) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}min` : `${h}h`;
}
function bucketLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Rosca (distribuição por assunto) ──
function Donut({ segments, total }: { segments: Array<{ label: string; value: number; color: string }>; total: number }) {
  const r = 56;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-32 w-32">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef0f3" strokeWidth="16" />
        {total > 0 &&
          segments.map((s) => {
            const dash = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="16"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        <text x="70" y="66" textAnchor="middle" className="fill-gray-900 text-2xl font-bold">
          {total}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-gray-400 text-[10px]">
          conversas
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}{' '}
            <span className="font-medium text-gray-900">
              {s.value} · {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Gráfico de barras (conversas por data) ──
function BarChart({ data }: { data: Array<{ bucket: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ minHeight: 176 }}>
      {data.map((d) => (
        <div key={d.bucket} className="flex min-w-[16px] flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[9px] font-medium text-gray-500">{d.count || ''}</span>
          <div
            className="w-full rounded-t bg-petroleum-500 transition-all"
            style={{ height: `${d.count > 0 ? Math.max(4, (d.count / max) * 130) : 0}px` }}
            title={`${bucketLabel(d.bucket)}: ${d.count}`}
          />
          <span className="whitespace-nowrap text-[9px] text-gray-400">{bucketLabel(d.bucket)}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'danger' }) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        tone === 'danger' && Number(value) > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200/60 bg-white'
      }`}
    >
      <div className={`text-2xl font-bold ${tone === 'danger' && Number(value) > 0 ? 'text-rose-600' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-[13px] font-medium leading-tight text-gray-600">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [group, setGroup] = useState<'day' | 'week'>('day');
  const [exportOpen, setExportOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', month, group],
    queryFn: () => api.getDashboard({ month, group }),
    refetchInterval: 60_000,
  });

  const donutSegments = useMemo(
    () =>
      (data?.byCategory ?? [])
        .filter((c) => c.count > 0)
        .map((c) => ({ label: catLabel(c.category), value: c.count, color: catColor(c.category) })),
    [data],
  );

  // Subcategoria (ação) agrupada por categoria — só Consulta/Sessão.
  const subByCategory = useMemo(() => {
    const groups = new Map<string, Array<{ action: string; count: number }>>();
    for (const s of data?.bySubcategory ?? []) {
      if (!groups.has(s.category)) groups.set(s.category, []);
      groups.get(s.category)!.push({ action: s.action, count: s.count });
    }
    return [...groups.entries()];
  }, [data]);

  const clients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const list = data?.byClient ?? [];
    if (!q) return list;
    return list.filter((c) => (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q));
  }, [data, clientSearch]);

  async function exportCsv(kind: 'conversations' | 'agents') {
    setExportOpen(false);
    try {
      await api.exportDashboardCsv(month, kind);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-auto bg-surface p-6">
      {/* Cabeçalho + filtro de período */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Relatório de Atendimentos</h1>
          <p className="text-sm text-gray-500">Conversas do bot e transbordos para a recepção.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          />
          <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
            {(['day', 'week'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`px-3 py-1.5 text-sm ${group === g ? 'bg-petroleum-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {g === 'day' ? 'Por dia' : 'Por semana'}
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              className="rounded-lg bg-petroleum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-petroleum-700"
            >
              Exportar CSV ▾
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <button onClick={() => exportCsv('conversations')} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                    Conversas (uma linha por conversa)
                  </button>
                  <button onClick={() => exportCsv('agents')} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                    Resumo por atendente
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400">Carregando...</div>}

      {data && (
        <div className="space-y-5">
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Total de conversas" value={data.cards.total} />
            <StatCard label="Resolvidas pelo bot" value={data.cards.resolvedByBot} sub={`${data.cards.resolvedByBotPct}% do total`} />
            <StatCard label="Encaminhadas p/ atendente" value={data.cards.handedOff} sub={`${data.cards.handedOffPct}% do total`} />
            <StatCard label="Tempo médio de resposta" value={fmtDuration(data.cards.avgResponseSeconds)} />
            <StatCard label="Aguardando atendente agora" value={data.cards.waitingNow} tone="danger" />
          </div>

          {/* Gráfico por data */}
          <Section title={`Conversas por ${group === 'day' ? 'dia' : 'semana'}`}>
            {data.series.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">Sem conversas no período.</div>
            ) : (
              <BarChart data={data.series} />
            )}
          </Section>

          {/* Assunto + subcategoria */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Conversas por assunto">
              {donutSegments.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">Sem dados no período.</div>
              ) : (
                <Donut segments={donutSegments} total={data.cards.total} />
              )}
            </Section>

            <Section title="Subcategorias (por ação)">
              {subByCategory.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">Sem Consulta/Sessão no período.</div>
              ) : (
                <div className="space-y-4">
                  {subByCategory.map(([cat, actions]) => {
                    const totalCat = actions.reduce((a, b) => a + b.count, 0);
                    return (
                      <div key={cat}>
                        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-800">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: catColor(cat) }} />
                          {catLabel(cat)} <span className="text-gray-400">({totalCat})</span>
                        </div>
                        <div className="space-y-1.5">
                          {actions.map((a) => (
                            <div key={a.action} className="flex items-center gap-2">
                              <span className="w-24 flex-shrink-0 text-xs text-gray-500">{ACTION_LABELS[a.action] ?? a.action}</span>
                              <div className="h-4 flex-1 overflow-hidden rounded bg-gray-100">
                                <div
                                  className="h-full rounded"
                                  style={{ width: `${totalCat ? (a.count / totalCat) * 100 : 0}%`, background: catColor(cat) }}
                                />
                              </div>
                              <span className="w-16 flex-shrink-0 text-right text-xs text-gray-600">
                                {a.count} · {totalCat ? Math.round((a.count / totalCat) * 100) : 0}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>

          {/* Métricas por atendente */}
          <Section title="Métricas por atendente">
            {data.byAgent.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">Nenhum atendente assumiu conversas no período.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="py-2 pr-3 font-medium">Atendente</th>
                      <th className="py-2 pr-3 font-medium">Atendidas</th>
                      <th className="py-2 pr-3 font-medium">Tempo médio 1ª resposta</th>
                      <th className="py-2 pr-3 font-medium">Duração média</th>
                      <th className="py-2 font-medium">Finalizadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byAgent.map((a) => (
                      <tr key={a.userId} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-medium text-gray-800">{a.name}</td>
                        <td className="py-2 pr-3 text-gray-600">{a.handled}</td>
                        <td className="py-2 pr-3 text-gray-600">{fmtDuration(a.avgFirstResponseSeconds)}</td>
                        <td className="py-2 pr-3 text-gray-600">{fmtDuration(a.avgDurationSeconds)}</td>
                        <td className="py-2 text-gray-600">{a.finalized}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Conversas por cliente */}
          <Section
            title="Conversas por cliente"
            right={
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 placeholder:text-gray-400"
              />
            }
          >
            {clients.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">Nenhum cliente no período.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="py-2 pr-3 font-medium">Cliente</th>
                      <th className="py-2 pr-3 font-medium">Telefone</th>
                      <th className="py-2 pr-3 font-medium">Conversas</th>
                      <th className="py-2 pr-3 font-medium">Assunto mais comum</th>
                      <th className="py-2 font-medium">Último contato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => (
                      <tr key={c.patientId} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-medium text-gray-800">{c.name ?? '—'}</td>
                        <td className="py-2 pr-3 text-gray-600">{c.phone}</td>
                        <td className="py-2 pr-3 text-gray-600">{c.conversations}</td>
                        <td className="py-2 pr-3 text-gray-600">{c.topCategory ? catLabel(c.topCategory) : '—'}</td>
                        <td className="py-2 text-gray-600">{fmtDateTime(c.lastContact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
