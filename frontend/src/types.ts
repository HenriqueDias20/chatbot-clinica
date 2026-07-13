export type ConversationStatus = 'bot' | 'human' | 'closed';

export interface ConversationListItem {
  id: string;
  status: ConversationStatus;
  last_message_at: string | null;
  created_at: string;
  patient_id: string;
  phone: string;
  name: string | null;
  last_message: string | null;
  last_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_at: string | null;
  category: string | null;
  action: string | null;
  subtype: string | null;
  last_read_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ConversationDetail {
  id: string;
  status: ConversationStatus;
  phone: string;
  name: string | null;
  patient_id: string;
  cpf: string | null;
  birth_date: string | null;
  insurance: string | null;
  patient_created_at: string;
  assigned_user_name: string | null;
  assigned_at: string | null;
  category: string | null;
  action: string | null;
  subtype: string | null;
  handed_off_at: string | null;
}

export interface PatientAppointment {
  id: string;
  scheduled_at: string;
  status: string;
  professional_name: string | null;
}

export interface Professional {
  id: string;
  name: string;
  specialty: string | null;
  active: boolean;
}

export interface DaySlot {
  at: string;
  status: 'free' | 'occupied';
  appointment?: { id: string; patientName: string | null; phone: string; status: string };
}

export interface ProfessionalDaySchedule {
  professionalId: string;
  professionalName: string;
  specialty: string | null;
  slots: DaySlot[];
}

export interface DashboardData {
  range: string;
  since: string;
  conversations: { active: number; waitingHuman: number };
  appointments: {
    total: number;
    confirmed: number;
    pending: number;
    cancelled: number;
    completed: number;
    no_show: number;
  };
  series: Array<{ date: string; count: number }>;
  confirmationRate: number;
  avgPerDay: number;
  todayAppointments: Array<{
    id: string;
    scheduledAt: string;
    status: string;
    patientName: string;
    professionalName: string;
  }>;
}
