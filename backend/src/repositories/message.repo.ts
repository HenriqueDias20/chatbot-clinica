import { query } from '../db/pool.js';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  media_type: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_name: string | null;
}

/** Arquivo já salvo no Storage, para anexar à mensagem. */
export interface MessageMedia {
  type: string; // image | audio | video | document | sticker
  path: string; // caminho dentro do bucket
  mime: string;
  name?: string | null;
}

/** Salva uma mensagem (regra: sempre salvar todas as mensagens). */
export async function saveMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  media?: MessageMedia,
): Promise<Message> {
  const res = await query<Message>(
    `insert into messages (conversation_id, role, content, media_type, media_path, media_mime, media_name)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [
      conversationId,
      role,
      content,
      media?.type ?? null,
      media?.path ?? null,
      media?.mime ?? null,
      media?.name ?? null,
    ],
  );
  return res.rows[0]!;
}

export async function getMessageById(id: string): Promise<Message | null> {
  const res = await query<Message>(`select * from messages where id = $1`, [id]);
  return res.rows[0] ?? null;
}

/** Últimas N mensagens (ordem cronológica) para montar o contexto do Claude. */
export async function getLastMessages(conversationId: string, limit: number): Promise<Message[]> {
  const res = await query<Message>(
    `select * from (
       select * from messages where conversation_id = $1 order by created_at desc limit $2
     ) t order by created_at asc`,
    [conversationId, limit],
  );
  return res.rows;
}
