import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

function IconPulse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-petroleum-800 to-petroleum-950 p-6">
      <div className="w-full max-w-sm">
        {/* Marca */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-petroleum-500/20 text-emerald-300 ring-1 ring-white/10">
            <IconPulse />
          </div>
          <h1 className="mt-3 text-xl font-semibold text-white">Clínica Fisioterapia</h1>
          <p className="text-sm text-petroleum-300">Central de Atendimento</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-card">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              placeholder="seu@email.com"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-petroleum-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-petroleum-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-petroleum-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-petroleum-100"
            />
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div>}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-xl bg-petroleum-600 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-petroleum-700 disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-petroleum-300/80">
          Acesso restrito à equipe da recepção.
        </p>
      </div>
    </div>
  );
}
