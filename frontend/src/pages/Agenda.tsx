import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DaySlot } from '../types';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}
function slotTime(at: string): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface BookingTarget {
  professionalId: string;
  professionalName: string;
  at: string;
}

export default function Agenda() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [booking, setBooking] = useState<BookingTarget | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const agendaQuery = useQuery({
    queryKey: ['agenda', date],
    queryFn: () => api.getAgenda(date),
  });

  const createMutation = useMutation({
    mutationFn: api.createAppointment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agenda', date] });
      setBooking(null);
      setPhone('');
      setName('');
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const schedule = agendaQuery.data?.schedule ?? [];

  function slotClass(slot: DaySlot): string {
    return slot.status === 'occupied'
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100 cursor-pointer';
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho com navegação por dia */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold capitalize text-gray-900">{dateLabel(date)}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(shiftDate(date, -1))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            ◀ Anterior
          </button>
          <button onClick={() => setDate(todayISO())} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            Hoje
          </button>
          <button onClick={() => setDate(shiftDate(date, 1))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            Próximo ▶
          </button>
        </div>
      </div>

      {/* Colunas por profissional */}
      <div className="flex-1 overflow-auto p-4">
        {agendaQuery.isLoading && <div className="text-sm text-gray-400">Carregando agenda...</div>}
        {!agendaQuery.isLoading && schedule.every((p) => p.slots.length === 0) && (
          <div className="text-sm text-gray-400">Nenhum horário disponível nesse dia (fim de semana?).</div>
        )}
        <div className="flex gap-4">
          {schedule.map((prof) => (
            <div key={prof.professionalId} className="w-56 flex-shrink-0">
              <div className="mb-2">
                <div className="font-medium text-gray-900">{prof.professionalName}</div>
                <div className="text-xs text-gray-500">{prof.specialty ?? '—'}</div>
              </div>
              <div className="space-y-1.5">
                {prof.slots.map((slot) => (
                  <div
                    key={slot.at}
                    onClick={() =>
                      slot.status === 'free' &&
                      setBooking({ professionalId: prof.professionalId, professionalName: prof.professionalName, at: slot.at })
                    }
                    className={`rounded-lg border px-3 py-2 text-sm ${slotClass(slot)}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{slotTime(slot.at)}</span>
                      <span className="text-xs">{slot.status === 'free' ? 'Livre' : 'Ocupado'}</span>
                    </div>
                    {slot.appointment && (
                      <div className="mt-0.5 truncate text-xs">
                        {slot.appointment.patientName ?? slot.appointment.phone}
                      </div>
                    )}
                  </div>
                ))}
                {prof.slots.length === 0 && <div className="text-xs text-gray-400">Sem disponibilidade.</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal de agendamento manual */}
      {booking && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" onClick={() => setBooking(null)}>
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">Agendar manualmente</h2>
            <p className="mt-1 text-sm text-gray-500">
              {booking.professionalName} — {dateLabel(date)} às {slotTime(booking.at)}
            </p>
            <div className="mt-4 space-y-3">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Telefone (com DDD)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-petroleum-400 focus:outline-none"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do paciente (opcional)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-petroleum-400 focus:outline-none"
              />
              {error && <div className="text-xs text-red-600">{error}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setBooking(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancelar
              </button>
              <button
                onClick={() =>
                  phone.trim() &&
                  createMutation.mutate({
                    professionalId: booking.professionalId,
                    scheduledAt: booking.at,
                    phone: phone.trim(),
                    name: name.trim() || undefined,
                  })
                }
                disabled={createMutation.isPending || !phone.trim()}
                className="rounded-lg bg-petroleum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-petroleum-700 disabled:opacity-50"
              >
                Agendar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
