import { query } from '../db/pool.js';

export type UserRole = 'recepcao' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

/** Dados públicos do usuário (sem hash de senha). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const res = await query<User>(
    `select * from users where lower(email) = lower($1) and active = true limit 1`,
    [email],
  );
  return res.rows[0] ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await query<User>(`select * from users where id = $1 and active = true limit 1`, [id]);
  return res.rows[0] ?? null;
}

export async function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  role?: UserRole;
}): Promise<User> {
  const res = await query<User>(
    `insert into users (name, email, password_hash, role)
     values ($1, $2, $3, $4)
     on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash, role = excluded.role, active = true
     returning *`,
    [input.name, input.email, input.passwordHash, input.role ?? 'recepcao'],
  );
  return res.rows[0]!;
}

export async function listUsers(): Promise<PublicUser[]> {
  const res = await query<User>(`select * from users where active = true order by name`);
  return res.rows.map(toPublicUser);
}
