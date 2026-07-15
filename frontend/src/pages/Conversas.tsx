import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import type { ConversationListItem, PatientAppointment } from '../types';

const EMOJIS = ['😀', '😊', '👍', '🙏', '✅', '📅', '🕐', '😉', '🤙', '👋'];

function statusBadge(c: { status: string; last_role: string | null }): { dot: string; label: string; chip: string } {
  if (c.status === 'human') return { dot: 'bg-rose-500', label: 'Precisa de atendente', chip: 'bg-rose-50 text-rose-600' };
  if (c.last_role === 'assistant') return { dot: 'bg-amber-400', label: 'Aguardando paciente', chip: 'bg-amber-50 text-amber-600' };
  return { dot: 'bg-emerald-500', label: 'Atendimento automático', chip: 'bg-emerald-50 text-emerald-600' };
}

// Conversa transbordada aguardando resposta do atendente (cliente foi o último a falar).
// Fica vermelha já na transferência; volta ao normal quando o atendente responde.
function attendantWaitingMin(c: ConversationListItem, nowMs: number): number | null {
  if (c.status !== 'human' || c.last_role !== 'user' || !c.last_message_at) return null;
  const diff = nowMs - new Date(c.last_message_at).getTime();
  return Math.max(0, Math.floor(diff / 60000));
}

// Não lida: ativa, última mensagem do cliente, e ainda não aberta desde então.
function isUnread(c: ConversationListItem): boolean {
  if (c.status === 'closed' || c.last_role !== 'user' || !c.last_message_at) return false;
  return !c.last_read_at || new Date(c.last_read_at).getTime() < new Date(c.last_message_at).getTime();
}
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`); // aceita 'YYYY-MM-DD' ou ISO completo
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}
function fmtCpf(cpf: string | null): string {
  if (!cpf) return '—';
  return cpf.length === 11 ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : cpf;
}
function initials(name: string | null, phone: string): string {
  if (name) {
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || phone.slice(-2);
  }
  return phone.slice(-2);
}
function apptStatusColor(s: string): string {
  if (s === 'confirmed') return 'text-emerald-600';
  if (s === 'cancelled') return 'text-rose-500';
  if (s === 'pending') return 'text-amber-600';
  return 'text-slate-500';
}

// Rótulos amigáveis para o "Resumo do pedido".
const CATEGORY_LABELS: Record<string, string> = {
  consulta: 'Consulta',
  sessao: 'Sessão',
  localizacao: 'Localização / Horário',
  atendente: 'Falar com atendente',
};
const ACTION_LABELS: Record<string, string> = {
  agendar: 'Agendar',
  reagendar: 'Reagendar',
  cancelar: 'Cancelar',
  confirmar: 'Confirmar',
};

export default function Conversas() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'info' | 'hist'>('info');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [listFilter, setListFilter] = useState<'active' | 'unread' | 'finalized'>('active');
  const [typing, setTyping] = useState<{ conversationId: string; role: 'user' | 'assistant' } | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [demoMenuOpen, setDemoMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();

  // Clique na marca (topo) → volta à tela inicial: Conversas ativas, sem seleção.
  useEffect(() => {
    if ((location.state as { home?: number } | null)?.home) {
      setSelectedId(null);
      setListFilter('active');
    }
  }, [location.state]);

  const conversationsQuery = useQuery({
    queryKey: ['conversations', listFilter],
    queryFn: () => api.listConversations(listFilter),
    refetchInterval: 20_000,
  });
  const messagesQuery = useQuery({
    queryKey: ['messages', selectedId],
    queryFn: () => api.getMessages(selectedId!),
    enabled: !!selectedId,
  });
  const scenariosQuery = useQuery({
    queryKey: ['demo-scenarios'],
    queryFn: api.getDemoScenarios,
    staleTime: Infinity,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesQuery.data, typing]);

  // Indicador "digitando…" em tempo real (demo). Some quando a mensagem chega.
  useEffect(() => {
    const onTyping = (p: { conversationId: string; role: 'user' | 'assistant' }) => {
      setTyping(p);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 8000);
    };
    const onMessage = (p: { conversationId: string }) => {
      setTyping((t) => (t && t.conversationId === p.conversationId ? null : t));
    };
    socket.on('conversation:typing', onTyping);
    socket.on('message:new', onMessage);
    return () => {
      socket.off('conversation:typing', onTyping);
      socket.off('message:new', onMessage);
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  // Recalcula o SLA da recepção periodicamente (destaque vermelho aparece sozinho).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  function refreshConversation(id: string) {
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['messages', id] });
  }
  const takeover = useMutation({ mutationFn: api.takeover, onSuccess: (_d, id) => refreshConversation(id) });
  const release = useMutation({ mutationFn: api.release, onSuccess: (_d, id) => refreshConversation(id) });
  const closeConversation = useMutation({
    mutationFn: api.close,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setSelectedId(null);
    },
  });
  const sendMessage = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.sendMessage(id, text),
    onSuccess: (_d, vars) => {
      setDraft('');
      refreshConversation(vars.id);
    },
  });
  const playDemo = useMutation({
    mutationFn: (scenario?: string) => api.playDemo(scenario),
    onSuccess: (r) => {
      setListFilter('active');
      setSelectedId(r.conversationId);
      setDemoMenuOpen(false);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const clearDemo = useMutation({
    mutationFn: api.clearDemo,
    onSuccess: () => {
      setSelectedId(null);
      setDemoMenuOpen(false);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Contador da aba "Não lidas" (consulta leve, independente da aba aberta).
  const unreadQuery = useQuery({
    queryKey: ['conversations', 'unread-count'],
    queryFn: () => api.listConversations('unread'),
    refetchInterval: 20_000,
  });
  const unreadCount = unreadQuery.data?.length ?? 0;

  const markReadMut = useMutation({
    mutationFn: api.markRead,
    // Só atualiza o contador; não recarrega a lista aberta (a conversa não "some" enquanto você lê).
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations', 'unread-count'] }),
  });
  function openConversation(id: string) {
    setSelectedId(id);
    markReadMut.mutate(id);
  }

  const allRaw = conversationsQuery.data ?? [];
  const conversations = allRaw.filter((c) => {
    const q = search.trim().toLowerCase();
    return !q || (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q);
  });
  const selected = conversations.find((c) => c.id === selectedId) ?? allRaw.find((c) => c.id === selectedId);
  const contact = messagesQuery.data?.conversation;
  const appointments = messagesQuery.data?.appointments ?? [];

  return (
    <div className="flex h-full">
      {/* ── Lista de atendimentos ── */}
      <div className="flex w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-800">Atendimentos</h1>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setDemoMenuOpen((v) => !v)}
                  disabled={playDemo.isPending}
                  title="Simular uma conversa em tempo real (demonstração)"
                  className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  <IconPlay /> {playDemo.isPending ? 'Iniciando…' : 'Demo'} <IconChevron open={demoMenuOpen} />
                </button>
                {demoMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setDemoMenuOpen(false)} />
                    <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-card">
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Escolha o exemplo
                      </div>
                      {(scenariosQuery.data ?? []).map((s) => (
                        <button
                          key={s.id}
                          onClick={() => playDemo.mutate(s.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
                        >
                          <IconPlay /> {s.label}
                        </button>
                      ))}
                      {scenariosQuery.isLoading && <div className="px-3 py-2 text-xs text-slate-400">Carregando…</div>}
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        onClick={() => {
                          if (confirm('Limpar todas as conversas de demonstração? Os atendimentos reais não são afetados.')) clearDemo.mutate();
                        }}
                        disabled={clearDemo.isPending}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <IconTrash /> {clearDemo.isPending ? 'Limpando…' : 'Limpar conversas da demo'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <span className="rounded-full bg-petroleum-50 px-2.5 py-0.5 text-xs font-semibold text-petroleum-700">
                {conversations.length}
              </span>
            </div>
          </div>
          <div className="relative mt-3">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-petroleum-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-petroleum-100"
            />
          </div>
          <div className="mt-3 flex rounded-xl bg-slate-100 p-0.5 text-xs font-medium">
            {(['active', 'unread', 'finalized'] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setListFilter(f);
                  setSelectedId(null);
                }}
                className={`flex-1 rounded-lg py-1.5 transition ${
                  listFilter === f ? 'bg-white text-petroleum-700 shadow-soft' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {f === 'active' ? 'Ativas' : f === 'unread' ? 'Não lidas' : 'Finalizadas'}
                {f === 'unread' && unreadCount > 0 && (
                  <span className="ml-1 inline-flex min-w-[1.1rem] justify-center rounded-full bg-rose-500 px-1 py-px text-[10px] font-semibold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-2">
          {conversationsQuery.isLoading && <div className="p-4 text-sm text-slate-400">Carregando...</div>}
          {!conversationsQuery.isLoading && conversations.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">Nenhuma conversa encontrada.</div>
          )}
          {conversations.map((c) => (
            <ConversationRow
              key={c.id}
              c={c}
              active={selectedId === c.id}
              waitingMin={attendantWaitingMin(c, nowMs)}
              unread={isUnread(c)}
              onClick={() => openConversation(c.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Painel central ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {!selected ? (
          listFilter === 'finalized' ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-soft ring-1 ring-slate-100">
                <IconCheck />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-600">Atendimentos finalizados</h3>
              <p className="mt-1 max-w-xs text-sm text-slate-400">Selecione um atendimento encerrado na lista para consultar o histórico completo.</p>
            </div>
          ) : (
            <EmptyState conversations={allRaw} onSelect={openConversation} />
          )
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 shadow-soft">
              <div className="flex items-center gap-3">
                <Avatar name={selected.name} phone={selected.phone} size={10} />
                <div>
                  <div className="font-semibold text-slate-800">{selected.name ?? selected.phone}</div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusBadge(selected).dot}`} />
                    <span className="text-slate-500">{statusBadge(selected).label}</span>
                  </div>
                </div>
                {(contact?.assigned_user_name ?? selected.assigned_user_name) && (
                  <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-petroleum-50 px-2.5 py-1 text-xs font-medium text-petroleum-700 ring-1 ring-petroleum-100">
                    <IconUser />
                    Assumida por {contact?.assigned_user_name ?? selected.assigned_user_name}
                  </span>
                )}
              </div>
              {selected.status === 'closed' ? (
                <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-500">
                  <IconCheck /> Atendimento finalizado
                </span>
              ) : (
                <div className="flex gap-2">
                  {selected.status === 'human' ? (
                    <button
                      onClick={() => release.mutate(selected.id)}
                      disabled={release.isPending}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Devolver ao bot
                    </button>
                  ) : (
                    <button
                      onClick={() => takeover.mutate(selected.id)}
                      disabled={takeover.isPending}
                      className="rounded-lg bg-petroleum-600 px-3 py-1.5 text-sm font-medium text-white shadow-soft transition hover:bg-petroleum-700 disabled:opacity-50"
                    >
                      Assumir conversa
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm('Finalizar este atendimento? A conversa sairá da lista de ativas.')) closeConversation.mutate(selected.id);
                    }}
                    disabled={closeConversation.isPending}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <IconCheck /> Finalizar
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto px-6 py-5">
              {messagesQuery.isLoading && <div className="text-sm text-slate-400">Carregando histórico...</div>}
              {messagesQuery.data?.messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[68%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-soft ${
                      m.role === 'user'
                        ? 'rounded-tl-md border border-slate-200 bg-white text-slate-700'
                        : 'rounded-tr-md bg-petroleum-600 text-white'
                    }`}
                  >
                    {m.content}
                    <div className={`mt-1 text-right text-[10px] ${m.role === 'user' ? 'text-slate-400' : 'text-petroleum-200'}`}>
                      {fmtTime(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              {typing && selected && typing.conversationId === selected.id && (
                <div className={`flex ${typing.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`flex items-center gap-1 rounded-2xl px-4 py-3 shadow-soft ${
                      typing.role === 'user'
                        ? 'rounded-tl-md border border-slate-200 bg-white'
                        : 'rounded-tr-md bg-petroleum-600'
                    }`}
                  >
                    <TypingDots dark={typing.role !== 'user'} />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {selected.status === 'closed' ? (
              <div className="border-t border-slate-200 bg-white px-4 py-4 text-center text-sm text-slate-400">
                Este atendimento foi finalizado — as mensagens ficam disponíveis para consulta.
              </div>
            ) : (
            <div className="relative border-t border-slate-200 bg-white px-3 py-3">
              {emojiOpen && (
                <div className="absolute bottom-16 left-3 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-card">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      onClick={() => {
                        setDraft((d) => d + e);
                        setEmojiOpen(false);
                      }}
                      className="rounded-lg p-1 text-lg hover:bg-slate-100"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:border-petroleum-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-petroleum-100">
                <button onClick={mediaSoon} title="Anexar arquivo" className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600">
                  <IconPaperclip />
                </button>
                <button onClick={() => setEmojiOpen((v) => !v)} title="Emoji" className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600">
                  <IconSmile />
                </button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="Escreva uma mensagem..."
                  className="flex-1 bg-transparent px-1 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
                />
                {draft.trim() ? (
                  <button onClick={submit} disabled={sendMessage.isPending} title="Enviar" className="rounded-xl bg-petroleum-600 p-2 text-white shadow-soft transition hover:bg-petroleum-700 disabled:opacity-50">
                    <IconSend />
                  </button>
                ) : (
                  <button onClick={mediaSoon} title="Gravar áudio" className="rounded-xl bg-petroleum-600 p-2 text-white transition hover:bg-petroleum-700">
                    <IconMic />
                  </button>
                )}
              </div>
            </div>
            )}
          </>
        )}
      </div>

      {/* ── Dados do contato ── */}
      {selected && (
        <div className="hidden w-72 flex-shrink-0 flex-col border-l border-slate-200 bg-white xl:flex">
          <div className="flex flex-col items-center border-b border-slate-100 px-4 py-6">
            <Avatar name={selected.name} phone={selected.phone} size={16} ring />
            <div className="mt-2.5 text-center">
              <div className="font-semibold text-slate-800">{contact?.name ?? selected.name ?? selected.phone}</div>
              <div className="text-xs text-slate-400">{selected.phone}</div>
            </div>
          </div>
          <div className="flex border-b border-slate-100 text-sm">
            {(['info', 'hist'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 font-medium transition ${
                  tab === t ? 'border-b-2 border-petroleum-500 text-petroleum-700' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t === 'info' ? 'Informações' : 'Histórico'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'info' && contact && (
              <div className="space-y-4">
                {contact.category && (
                  <div className="rounded-xl border border-petroleum-100 bg-petroleum-50/60 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-petroleum-700">
                      <IconClipboard /> Resumo do pedido
                    </div>
                    <dl className="space-y-1.5 text-sm">
                      <SummaryRow label="Assunto" value={CATEGORY_LABELS[contact.category] ?? contact.category} />
                      {contact.action && <SummaryRow label="Ação" value={ACTION_LABELS[contact.action] ?? contact.action} />}
                      {contact.subtype && <SummaryRow label="Tipo" value={contact.subtype} />}
                      {contact.insurance && <SummaryRow label="Convênio" value={contact.insurance} />}
                    </dl>
                  </div>
                )}
                <dl className="space-y-3.5 text-sm">
                  <Field label="Nome completo" value={contact.name ?? '—'} />
                  <Field label="Telefone" value={contact.phone} />
                  <Field label="CPF" value={fmtCpf(contact.cpf)} />
                  <Field label="Nascimento" value={fmtDate(contact.birth_date)} />
                  <Field label="Convênio" value={contact.insurance ?? '—'} />
                  <Field label="Paciente desde" value={new Date(contact.patient_created_at).toLocaleDateString('pt-BR')} />
                </dl>
              </div>
            )}
            {tab === 'hist' && (
              <div className="space-y-2">
                {appointments.length === 0 && <div className="text-sm text-slate-400">Nenhum agendamento registrado.</div>}
                {appointments.map((a: PatientAppointment) => (
                  <div key={a.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="text-sm font-medium text-slate-800">
                      {new Date(a.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs text-slate-500">{a.professional_name ?? '—'}</div>
                    <div className={`mt-0.5 text-xs font-medium ${apptStatusColor(a.status)}`}>{a.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function mediaSoon() {
    alert('📎 Anexos e 🎤 áudio ficam disponíveis quando o WhatsApp real estiver conectado (API de mídia da Meta).');
  }
  function submit() {
    const t = draft.trim();
    if (t && selected) sendMessage.mutate({ id: selected.id, text: t });
  }
}

// ── Linha da lista ──
function ConversationRow({
  c,
  active,
  waitingMin,
  unread,
  onClick,
}: {
  c: ConversationListItem;
  active: boolean;
  waitingMin: number | null;
  unread: boolean;
  onClick: () => void;
}) {
  const badge = statusBadge(c);
  const late = waitingMin !== null;
  // Transbordada (precisa de atendente) → destaca a LINHA inteira em vermelho.
  const needsAttendant = c.status === 'human';
  const border = active ? 'border-petroleum-500' : needsAttendant ? 'border-rose-500' : 'border-transparent';
  const bg = active
    ? 'bg-petroleum-50 shadow-soft'
    : needsAttendant
      ? 'bg-rose-50 ring-1 ring-rose-200 hover:bg-rose-100/70'
      : 'hover:bg-slate-100/70';
  return (
    <button
      onClick={onClick}
      className={`mb-1 flex w-full items-start gap-3 rounded-xl border-l-[3px] px-3 py-3 text-left transition-all ${border} ${bg}`}
    >
      <Avatar name={c.name} phone={c.phone} size={10} dot={needsAttendant ? 'bg-rose-500' : badge.dot} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm font-semibold ${active ? 'text-petroleum-800' : needsAttendant ? 'text-rose-700' : 'text-slate-800'}`}>
            {c.name ?? c.phone}
          </span>
          <span className="flex flex-shrink-0 items-center gap-1">
            {unread && !late && <span className="h-2 w-2 rounded-full bg-sky-500" title="Não lida" />}
            <span className={`text-[11px] ${late ? 'font-semibold text-rose-500' : unread ? 'font-semibold text-slate-600' : 'text-slate-400'}`}>
              {fmtTime(c.last_message_at)}
            </span>
          </span>
        </div>
        <div className={`mt-0.5 truncate text-xs ${unread ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{c.last_message ?? '—'}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {late && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
              </span>
              {waitingMin && waitingMin >= 1 ? `Aguardando há ${waitingMin} min` : 'Aguardando atendente'}
            </span>
          )}
          {c.status === 'human' && (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <IconUser className="h-2.5 w-2.5" />
              {c.assigned_user_name ?? 'Precisa de atendente'}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Empty state composto ──
function EmptyState({ conversations, onSelect }: { conversations: ConversationListItem[]; onSelect: (id: string) => void }) {
  const ativas = conversations.length;
  const humano = conversations.filter((c) => c.status === 'human').length;
  const aguardando = conversations.filter((c) => c.status !== 'human' && c.last_role === 'assistant').length;
  const bot = ativas - humano - aguardando;
  const queue = [...conversations]
    .filter((c) => c.status === 'human' || c.last_role === 'assistant')
    .sort((a, b) => (a.status === 'human' ? -1 : 1) - (b.status === 'human' ? -1 : 1))
    .slice(0, 6);

  return (
    <div className="flex h-full justify-center overflow-y-auto p-6 lg:p-10">
      <div className="w-full max-w-5xl space-y-6">
        {/* Banner */}
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-petroleum-700 to-petroleum-900 p-7 text-white shadow-card">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
              <IconChatBig />
            </div>
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight">Central de Atendimento</h2>
              <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-petroleum-100/85">
                Selecione um atendimento na lista ao lado para visualizar a conversa e responder o paciente.
              </p>
            </div>
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric label="Conversas ativas" value={ativas} tint="petroleum" icon={<IconChatSm />} />
          <Metric label="Precisam de atendente" value={humano} tint="rose" icon={<IconAlert />} />
          <Metric label="Aguardando paciente" value={aguardando} tint="amber" icon={<IconClock />} />
          <Metric label="Atendimento automático" value={bot < 0 ? 0 : bot} tint="emerald" icon={<IconBot />} />
        </div>

        {/* Fila de atendimento */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-slate-800">Fila de atendimento</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">{queue.length} aguardando</span>
          </div>
          {queue.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">Nenhum atendimento na fila. Tudo em dia! 🎉</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {queue.map((c) => {
                const badge = statusBadge(c);
                return (
                  <li key={c.id}>
                    <button onClick={() => onSelect(c.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50">
                      <Avatar name={c.name} phone={c.phone} size={9} dot={badge.dot} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800">{c.name ?? c.phone}</div>
                        <div className="truncate text-xs text-slate-500">{c.last_message ?? '—'}</div>
                      </div>
                      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.chip}`}>{badge.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const TINTS: Record<string, { bg: string; text: string }> = {
  petroleum: { bg: 'bg-petroleum-50', text: 'text-petroleum-600' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
};
function Metric({ label, value, tint, icon }: { label: string; value: number; tint: string; icon: ReactNode }) {
  const t = TINTS[tint]!;
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-card transition-shadow hover:shadow-soft">
      <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl ${t.bg} ${t.text}`}>{icon}</div>
      <div className="text-3xl font-bold tracking-tight text-slate-800">{value}</div>
      <div className="mt-1 text-[13px] font-medium leading-tight text-slate-600">{label}</div>
    </div>
  );
}

function Avatar({ name, phone, size, dot, ring }: { name: string | null; phone: string; size: number; dot?: string; ring?: boolean }) {
  const dim = `${size * 0.25}rem`;
  return (
    <div
      className={`relative flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-petroleum-100 to-petroleum-50 font-semibold text-petroleum-700 ${
        ring ? 'ring-2 ring-white shadow-soft' : 'ring-1 ring-white'
      }`}
      style={{ width: dim, height: dim, fontSize: `${Math.max(11, size * 1.1)}px` }}
    >
      {initials(name, phone)}
      {dot && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${dot}`} />}
    </div>
  );
}

function TypingDots({ dark }: { dark: boolean }) {
  const c = dark ? 'bg-white/80' : 'bg-slate-400';
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${c} animate-bounce`}
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
        />
      ))}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}

const sp = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
const IconSearch = () => (<svg {...sp} className="h-4 w-4"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>);
const IconPaperclip = () => (<svg {...sp} className="h-5 w-5"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>);
const IconSmile = () => (<svg {...sp} className="h-5 w-5"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>);
const IconMic = () => (<svg {...sp} className="h-5 w-5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>);
const IconSend = () => (<svg {...sp} className="h-5 w-5"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>);
const IconCheck = () => (<svg {...sp} className="h-4 w-4"><path d="M20 6 9 17l-5-5" /></svg>);
const IconChatBig = () => (<svg {...sp} className="h-7 w-7"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>);
const IconChatSm = () => (<svg {...sp} className="h-5 w-5"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>);
const IconAlert = () => (<svg {...sp} className="h-5 w-5"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>);
const IconClock = () => (<svg {...sp} className="h-5 w-5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const IconBot = () => (<svg {...sp} className="h-5 w-5"><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 8V4M9 14h.01M15 14h.01M2 14h2M20 14h2" /></svg>);
const IconUser = ({ className = 'h-3 w-3' }: { className?: string }) => (<svg {...sp} className={className}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
const IconPlay = () => (<svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M8 5v14l11-7z" /></svg>);
const IconChevron = ({ open }: { open: boolean }) => (<svg {...sp} className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>);
const IconTrash = () => (<svg {...sp} className="h-3.5 w-3.5"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>);
const IconClipboard = () => (<svg {...sp} className="h-3.5 w-3.5"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h4" /></svg>);
