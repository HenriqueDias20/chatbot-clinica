import type { PoolConfig } from 'pg';
import { env } from '../config/env.js';

/**
 * Supabase (e qualquer Postgres gerenciado) exige SSL.
 * Bancos locais / dentro do docker-compose (host "postgres") não usam.
 */
function needsSSL(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    const local = ['localhost', '127.0.0.1', '::1', 'postgres'];
    return !local.includes(host);
  } catch {
    return false;
  }
}

export function buildPgConfig(): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    ssl: needsSSL(env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  };
}
