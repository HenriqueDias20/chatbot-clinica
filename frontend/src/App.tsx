import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import Conversas from './pages/Conversas';
import Templates from './pages/Templates';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import { useRealtime, useSocketStatus } from './hooks/useRealtime';
import { useAuth } from './auth/AuthContext';

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconPulse() {
  return (
    <svg {...svg} className="h-5 w-5">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg {...svg} className="h-5 w-5">
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconSendMsg() {
  return (
    <svg {...svg} className="h-5 w-5">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg {...svg} className="h-5 w-5">
      <path d="M3 3v18h18" />
      <rect x="7" y="11" width="3" height="7" rx="1" />
      <rect x="12.5" y="7" width="3" height="11" rx="1" />
      <rect x="18" y="13" width="3" height="5" rx="1" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg {...svg} className="h-4 w-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}

const navItems: Array<{ to: string; label: string; icon: ReactNode; fullOnly?: boolean }> = [
  { to: '/conversas', label: 'Conversas', icon: <IconChat /> },
  { to: '/templates', label: 'Enviar mensagem', icon: <IconSendMsg /> },
  { to: '/dashboard', label: 'Dashboard', icon: <IconChart />, fullOnly: true },
];

export default function App() {
  const { user, loading, logout } = useAuth();
  useRealtime();
  const connected = useSocketStatus();
  const navigate = useNavigate();

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-surface text-sm text-slate-400">Carregando...</div>;
  }
  if (!user) {
    return <Login />;
  }

  const isAtendente = user.role === 'atendente';
  const visibleNav = navItems.filter((i) => !i.fullOnly || !isAtendente);

  const userInitials = user.name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-full bg-surface">
      <aside className="flex w-64 flex-col bg-gradient-to-b from-petroleum-900 to-petroleum-950 text-petroleum-100">
        {/* Marca — clique volta à Central de Atendimento (Conversas, sem seleção) */}
        <button
          onClick={() => navigate('/conversas', { state: { home: Date.now() } })}
          title="Voltar à Central de Atendimento"
          className="flex w-full items-center gap-3 px-5 pb-5 pt-6 text-left transition hover:opacity-90"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-petroleum-500/20 text-emerald-300 ring-1 ring-white/10">
            <IconPulse />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-white">Clínica Fisioterapia</div>
            <div className="text-xs text-petroleum-300">Central de Atendimento</div>
          </div>
        </button>

        {/* Status tempo real */}
        <div className="mx-4 mb-5 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/5">
          <span className="relative flex h-2 w-2">
            {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-400'}`} />
          </span>
          <span className="text-xs font-medium text-petroleum-200">{connected ? 'Tempo real ativo' : 'Reconectando...'}</span>
        </div>

        {/* Menu */}
        <nav className="flex-1 space-y-1 px-3">
          <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-petroleum-400">Menu</p>
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-petroleum-600 text-white shadow-soft ring-1 ring-white/10'
                    : 'text-petroleum-100/80 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Rodapé: usuário logado + sair */}
        <div className="space-y-2 border-t border-white/5 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/5">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-petroleum-500/25 text-xs font-semibold text-emerald-200 ring-1 ring-white/10">
              {userInitials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{user.name}</div>
              <div className="truncate text-[11px] text-petroleum-300">
                {user.role === 'admin' ? 'Administrador' : user.role === 'atendente' ? 'Atendente' : 'Recepção'}
              </div>
            </div>
            <button
              onClick={logout}
              title="Sair"
              className="rounded-lg p-1.5 text-petroleum-300 transition hover:bg-white/10 hover:text-white"
            >
              <IconLogout />
            </button>
          </div>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-[11px] font-medium text-petroleum-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
              Sistema online
            </div>
            <span className="text-[10px] font-medium text-petroleum-400">v1.0</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/conversas" replace />} />
          <Route path="/conversas" element={<Conversas />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/dashboard" element={isAtendente ? <Navigate to="/conversas" replace /> : <Dashboard />} />
          <Route path="*" element={<Navigate to="/conversas" replace />} />
        </Routes>
      </main>
    </div>
  );
}
