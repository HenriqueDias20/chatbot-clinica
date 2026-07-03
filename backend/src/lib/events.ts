import { EventEmitter } from 'node:events';

/** Eventos de domínio emitidos pela lógica do bot/serviços e repassados ao painel via WebSocket. */
export interface DomainEvents {
  'message:new': {
    conversationId: string;
    patientId: string;
    phone: string;
    role: 'user' | 'assistant';
    content: string;
    at: string;
  };
  'conversation:status': {
    conversationId: string;
    patientId: string;
    status: 'bot' | 'human' | 'closed';
    assignedUserId?: string | null;
    assignedUserName?: string | null;
  };
  // Indicador "digitando…" para a demo em tempo real.
  'conversation:typing': {
    conversationId: string;
    role: 'user' | 'assistant';
  };
  'appointment:created': {
    appointmentId: string;
    patientId: string;
    professionalId: string;
    scheduledAt: string;
  };
  'appointment:cancelled': {
    appointmentId: string;
    patientId: string;
  };
  'appointment:unconfirmed': {
    appointmentId: string;
    patientName: string | null;
    phone: string;
    scheduledAt: string;
  };
}

class TypedEventBus {
  private readonly ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(50);
  }

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.ee.emit(event, payload);
  }

  on<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => void): void {
    this.ee.on(event, listener);
  }

  off<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => void): void {
    this.ee.off(event, listener);
  }
}

/** Barramento de eventos de domínio (in-process). */
export const bus = new TypedEventBus();
