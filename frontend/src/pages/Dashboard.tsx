import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

const RANGES: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
];

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');
}
function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ── Donut (distribuição de status) ──
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
          agendamentos
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="font-medium text-gray-900">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Gráfico de linha (agendamentos por dia) ──
function LineChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const W = 760;
  const H = 180;
  const pad = 28;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.count));
  const x = (i: number) => (n <= 1 ? W / 2 : pad + (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const pts = data.map((d, i) => `${x(i)},${y(d.count)}`).join(' ');
  const area = `${x(0)},${H - pad} ${pts} ${x(n - 1)},${H - pad}`;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && data[v]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#e5e7eb" />
      <polygon points={area} fill="rgba(41,102,97,0.12)" />
      <polyline points={pts} fill="none" stroke="#296661" strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={d.date} cx={x(i)} cy={y(d.count)} r="3" fill="#296661" />
      ))}
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-gray-400 text-[10px]">
          {dayLabel(data[i]!.date)}
        </text>
      ))}
      <text x={pad} y={16} className="fill-gray-400 text-[10px]">
        {max}
      </text>
    </svg>
  );
}

function Card({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4 text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-gray-500">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {title}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const [range, setRange] = useState('7d');
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => api.getDashboard(range),
    refetchInterval: 30_000,
  });

  const a = data?.appointments;
  const donutSegments = a
    ? [
        { label: 'Confirmados', value: a.confirmed, color: '#22c55e' },
        { label: 'Pendentes', value: a.pending, color: '#f59e0b' },
        { label: 'Concluídos', value: a.completed, color: '#3b82f6' },
        { label: 'Falta', value: a.no_show, color: '#9ca3af' },
        { label: 'Cancelados', value: a.cancelled, color: '#f43f5e' },
      ].filter((s) => s.value > 0)
    : [];

  return (
    <div className="h-full overflow-auto bg-surface p-6">
      {/* Cabeçalho */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Painel de Métricas</h1>
          <p className="text-sm text-gray-500">Acompanhe os atendimentos e agendamentos da clínica.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['dashboard'] })}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ⟳ Atualizar
          </button>
          <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 text-sm ${range === r.key ? 'bg-petroleum-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400">Carregando...</div>}

      {data && (
        <div className="space-y-5">
          {/* Visão geral: donut + cards */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Visão Geral</h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
              <Donut segments={donutSegments} total={data.appointments.total} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Card title="Conversas ativas" value={data.conversations.active} color="#3b82f6" />
                <Card title="Aguardando humano" value={data.conversations.waitingHuman} color="#f43f5e" />
                <Card title="Agendamentos" value={data.appointments.total} color="#6366f1" />
                <Card title="Confirmados" value={data.appointments.confirmed} color="#22c55e" />
                <Card title="Cancelados" value={data.appointments.cancelled} color="#f43f5e" />
                <Card title="Concluídos" value={data.appointments.completed} color="#3b82f6" />
              </div>
            </div>
          </div>

          {/* Gráfico de linha */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Agendamentos por dia</h2>
              <span className="rounded-full bg-surface px-3 py-1 text-xs text-gray-500">Desde {fmtDate(data.since)}</span>
            </div>
            <LineChart data={data.series} />
          </div>

          {/* Resumo + agendamentos de hoje */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Resumo do período</h2>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-2xl font-bold text-green-600">{data.confirmationRate}%</div>
                  <div className="text-xs text-gray-500">Taxa de confirmação</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{data.avgPerDay}</div>
                  <div className="text-xs text-gray-500">Média por dia</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{data.appointments.total}</div>
                  <div className="text-xs text-gray-500">Total no período</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Agendamentos de hoje</h2>
              {data.todayAppointments.length === 0 && <div className="text-sm text-gray-400">Nenhum para hoje.</div>}
              <ul className="space-y-2">
                {data.todayAppointments.slice(0, 6).map((ap) => (
                  <li key={ap.id} className="flex items-center justify-between border-b border-gray-50 pb-1.5 text-sm">
                    <span className="text-gray-800">{ap.patientName}</span>
                    <span className="text-gray-500">
                      {new Date(ap.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {ap.professionalName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
