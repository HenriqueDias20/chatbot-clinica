import { query } from '../db/pool.js';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

/** Salva uma mensagem (regra: sempre salvar todas as mensagens). */
export async function saveMessage(conversationId: string, role: MessageRole, content: string): Promise<Message> {
  const res = await query<Message>(
    `insert into messages (conversation_id, role, content) values ($1, $2, $3) returning *`,
    [conversationId, role, content],
  );
  return res.rows[0]!;
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
