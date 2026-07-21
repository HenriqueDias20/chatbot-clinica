import type {
  ConversationDetail,
  ConversationListItem,
  DashboardData,
  Message,
  PatientAppointment,
  Professional,
  ProfessionalDaySchedule,
  WhatsAppTemplate,
} from '../types';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const TOKEN_KEY = 'clinica_token';

export const auth = {
  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  setToken: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Disparado quando o backend rejeita o token (401) — o App escuta e desloga. */
export const onUnauthorized = { handler: null as null | (() => void) };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = auth.getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    auth.clear();
    onUnauthorized.handler?.();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'recepcao' | 'admin' | 'atendente';
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: AuthUser }>('/api/auth/me').then((r) => r.user),

  listConversations: (filter: 'active' | 'finalized' | 'unread' = 'active') =>
    request<{ conversations: ConversationListItem[] }>(`/api/conversations?filter=${filter}`).then((r) => r.conversations),

  getMessages: (id: string) =>
    request<{ conversation: ConversationDetail; messages: Message[]; appointments: PatientAppointment[] }>(
      `/api/conversations/${id}/messages`,
    ),

  takeover: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}/takeover`, { method: 'POST' }),

  release: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}/release`, { method: 'POST' }),

  close: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}/close`, { method: 'POST' }),

  markRead: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}/read`, { method: 'POST' }),

  sendMessage: (id: string, text: string) =>
    request<{ ok: boolean; message: Message }>(`/api/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  getProfessionals: () =>
    request<{ professionals: Professional[] }>('/api/professionals').then((r) => r.professionals),

  getAgenda: (date: string) =>
    request<{ date: string; schedule: ProfessionalDaySchedule[] }>(`/api/agenda?date=${date}`),

  createAppointment: (input: { professionalId: string; scheduledAt: string; phone: string; name?: string }) =>
    request<{ ok: boolean }>('/api/appointments', { method: 'POST', body: JSON.stringify(input) }),

  getDashboard: (params: { month: string; group: 'day' | 'week' }) =>
    request<DashboardData>(`/api/dashboard?month=${params.month}&group=${params.group}`),

  // Baixa o CSV do período (usa o token; dispara download via blob).
  exportDashboardCsv: async (month: string, kind: 'conversations' | 'agents'): Promise<void> => {
    const token = auth.getToken();
    const res = await fetch(`${API_URL}/api/dashboard/export?month=${month}&kind=${kind}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Erro ${res.status} ao exportar`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind === 'agents' ? 'atendentes' : 'conversas'}-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getTemplates: () => request<{ templates: WhatsAppTemplate[]; error?: string }>('/api/templates'),

  sendTemplate: (input: {
    phone: string;
    name?: string;
    template: string;
    language: string;
    params: string[];
    body: string;
  }) =>
    request<{ ok: boolean; conversationId: string; dryRun?: boolean }>('/api/templates/send', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getDemoScenarios: () =>
    request<{ scenarios: Array<{ id: string; label: string }> }>('/api/demo/scenarios').then((r) => r.scenarios),

  playDemo: (scenario?: string) =>
    request<{ ok: boolean; conversationId: string }>('/api/demo/play', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    }),

  clearDemo: () => request<{ ok: boolean; removed: number }>('/api/demo/clear', { method: 'POST' }),
};
