import pg from 'pg';
import { buildPgConfig } from './connection.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/auth.js';

/**
 * Cria usuários (recepcionistas) do painel. Idempotente: pula quem já existe.
 * Rodar no Console do Railway:  npm run seed:users
 */
// role 'atendente' = acesso somente à aba Conversas.
const NEW_USERS: Array<{ name: string; email: string; role: 'recepcao' | 'atendente' }> = [
  { name: 'Júlia Gambini Duarte', email: 'julia@clinica.com', role: 'atendente' },
  { name: 'Kessia Ribeiro Gonçalves', email: 'kessia@clinica.com', role: 'atendente' },
  { name: 'Yasmin Moura Lopes', email: 'yasmin@clinica.com', role: 'atendente' },
  { name: 'Geusa Bilhalba More', email: 'geusa@clinica.com', role: 'atendente' },
  { name: 'Isadora Santos Ajala', email: 'isadora@clinica.com', role: 'atendente' },
  { name: 'Janaina Biffi', email: 'janaina@clinica.com', role: 'recepcao' },
];

const DEFAULT_PASSWORD = 'clinica123';

async function main(): Promise<void> {
  const client = new pg.Client(buildPgConfig());
  await client.connect();
  try {
    let created = 0;
    for (const u of NEW_USERS) {
      const exists = await client.query('select 1 from users where lower(email) = lower($1)', [u.email]);
      if (exists.rowCount && exists.rowCount > 0) {
        logger.info({ email: u.email }, 'Usuário já existe — pulando');
        continue;
      }
      await client.query(
        `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)`,
        [u.name, u.email, hashPassword(DEFAULT_PASSWORD), u.role],
      );
      created++;
      logger.info({ email: u.email, name: u.name }, 'Usuário criado');
    }
    logger.info({ created, total: NEW_USERS.length }, 'Seed de usuários concluído');
  } finally {
    // Fire-and-forget: não travar o encerramento no client.end() (pooler + SSL).
    void client.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Falha ao criar usuários');
    process.exit(1);
  });
