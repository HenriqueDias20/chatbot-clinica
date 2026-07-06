import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildPgConfig } from './connection.js';
import { logger } from '../lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, 'migrations');

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists _migrations (
      id         serial primary key,
      name       text unique not null,
      applied_at timestamptz default now()
    );
  `);
}

async function appliedMigrations(client: pg.Client): Promise<Set<string>> {
  const res = await client.query<{ name: string }>('select name from _migrations order by name');
  return new Set(res.rows.map((r) => r.name));
}

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

async function runUp(): Promise<void> {
  const client = new pg.Client(buildPgConfig());
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const done = await appliedMigrations(client);
    const files = await listMigrationFiles();
    const pending = files.filter((f) => !done.has(f));

    if (pending.length === 0) {
      logger.info('Nenhuma migration pendente.');
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      logger.info({ file }, 'Aplicando migration');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into _migrations (name) values ($1)', [file]);
        await client.query('commit');
        logger.info({ file }, 'Migration aplicada');
      } catch (err) {
        await client.query('rollback');
        logger.error({ file, err }, 'Falha na migration — rollback executado');
        throw err;
      }
    }
    logger.info({ count: pending.length }, 'Migrations concluídas');
  } finally {
    // Fire-and-forget: fechar a conexão com o pooler (pgbouncer + SSL) pode travar,
    // e o process.exit no final encerra tudo de qualquer forma.
    void client.end().catch(() => {});
  }
}

async function runStatus(): Promise<void> {
  const client = new pg.Client(buildPgConfig());
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const done = await appliedMigrations(client);
    const files = await listMigrationFiles();
    for (const f of files) {
      logger.info({ migration: f, status: done.has(f) ? 'aplicada' : 'pendente' });
    }
  } finally {
    // Fire-and-forget: fechar a conexão com o pooler (pgbouncer + SSL) pode travar,
    // e o process.exit no final encerra tudo de qualquer forma.
    void client.end().catch(() => {});
  }
}

const cmd = process.argv[2] ?? 'up';
const run = cmd === 'status' ? runStatus : runUp;

run()
  .then(() => {
    // Encerra explicitamente para não travar o processo (ex.: no start do Railway,
    // onde o comando é "npm run migrate && npm start" — o start só roda se o migrate sair).
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Erro no runner de migrations');
    process.exit(1);
  });
