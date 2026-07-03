import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyPassword, signToken, verifyToken } from '../lib/auth.js';
import { findUserByEmail, getUserById, toPublicUser } from '../repositories/user.repo.js';
import type { PublicUser } from '../repositories/user.repo.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Extrai o token "Bearer xxx" do header Authorization. */
function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/**
 * preHandler que protege rotas do painel. Exportado para ser registrado como
 * decorator na instância RAIZ (em buildApp), assim todos os plugins-filhos o herdam.
 */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return reply.code(401).send({ error: 'Não autenticado' });
  const user = await getUserById(payload.sub);
  if (!user) return reply.code(401).send({ error: 'Sessão inválida' });
  req.user = toPublicUser(user);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Login → devolve token + dados do usuário.
  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const email = (req.body?.email ?? '').trim();
    const password = req.body?.password ?? '';
    if (!email || !password) return reply.code(400).send({ error: 'Informe e-mail e senha' });

    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }
    const token = signToken({ id: user.id, name: user.name, role: user.role });
    return { token, user: toPublicUser(user) };
  });

  // Quem sou eu (valida token e devolve o usuário atual).
  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return { user: req.user };
  });
}
