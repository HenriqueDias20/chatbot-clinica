import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

// ── Hash de senha (scrypt nativo) ───────────────────────────────────────────
// Formato armazenado: "<salt-hex>:<hash-hex>"

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── JWT simples (HS256) sem dependências externas ────────────────────────────

export interface JwtPayload {
  sub: string; // user id
  name: string;
  role: string;
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h

export function signToken(user: { id: string; name: string; role: string }): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', env.JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', env.JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  // Comparação segura
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
