import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { socket } from '../lib/socket';

/** Assina os eventos do WebSocket e invalida as queries afetadas (tempo real). */
export function useRealtime(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const onMessage = (p: { conversationId: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages', p.conversationId] });
    };
    const onStatus = (p: { conversationId: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages', p.conversationId] });
    };
    const onAppointment = () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };

    socket.on('message:new', onMessage);
    socket.on('conversation:status', onStatus);
    socket.on('appointment:created', onAppointment);
    socket.on('appointment:cancelled', onAppointment);

    return () => {
      socket.off('message:new', onMessage);
      socket.off('conversation:status', onStatus);
      socket.off('appointment:created', onAppointment);
      socket.off('appointment:cancelled', onAppointment);
    };
  }, [qc]);
}

/** Indica se o WebSocket está conectado (para o badge do painel). */
export function useSocketStatus(): boolean {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
    };
  }, []);
  return connected;
}
