import { query } from '../db/pool.js';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  active: boolean;
}

/** Todas as configs como mapa chave→valor. */
export async function getConfigs(): Promise<Record<string, string>> {
  const res = await query<{ key: string; value: string }>(`select key, value from configs`);
  const map: Record<string, string> = {};
  for (const row of res.rows) map[row.key] = row.value;
  return map;
}

export async function getConfig(key: string): Promise<string | null> {
  const res = await query<{ value: string }>(`select value from configs where key = $1`, [key]);
  return res.rows[0]?.value ?? null;
}

export async function listActiveFaq(): Promise<FaqItem[]> {
  const res = await query<FaqItem>(`select * from faq where active = true order by question`);
  return res.rows;
}
