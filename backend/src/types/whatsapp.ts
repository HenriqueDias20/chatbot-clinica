// Tipos do payload de webhook da Meta WhatsApp Cloud API (subconjunto usado).

export interface WhatsAppWebhookBody {
  object: string;
  entry?: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes?: WhatsAppChange[];
}

export interface WhatsAppChange {
  field: string;
  value: WhatsAppValue;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata?: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: WhatsAppIncomingMessage[];
  statuses?: WhatsAppStatus[];
}

/** Mídia recebida: a Meta manda só o id — o arquivo é baixado depois. */
export interface WhatsAppMediaPayload {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

export const MEDIA_KINDS = ['image', 'audio', 'video', 'document', 'sticker'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text: string; payload: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  image?: WhatsAppMediaPayload;
  audio?: WhatsAppMediaPayload;
  video?: WhatsAppMediaPayload;
  document?: WhatsAppMediaPayload;
  sticker?: WhatsAppMediaPayload;
}

export interface WhatsAppStatus {
  id: string;
  status: string; // sent | delivered | read | failed
  recipient_id: string;
  timestamp: string;
}

/** Mensagem recebida já normalizada para uso interno. */
export interface InboundMessage {
  waId: string; // número/ID de quem enviou (cru, como veio da Meta)
  phone: string; // normalizado (só dígitos)
  name: string | null;
  messageId: string;
  type: string;
  text: string | null;
  buttonReply?: { id: string; title: string };
  /** Presente quando a mensagem traz foto/áudio/vídeo/documento. */
  media?: InboundMedia;
}

export interface InboundMedia {
  kind: MediaKind;
  /** id da mídia na Meta (para buscar a URL e baixar). */
  id: string;
  mime: string;
  filename?: string;
  caption?: string;
}
