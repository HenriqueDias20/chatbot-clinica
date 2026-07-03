import pg from 'pg';
import { buildPgConfig } from './connection.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

export const pool = new Pool({ ...buildPgConfig(), max: 10 });

pool.on('error', (err) => {
  logger.error({ err }, 'Erro inesperado em cliente ocioso do pool Postgres');
});

/** Helper tipado para queries. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}
