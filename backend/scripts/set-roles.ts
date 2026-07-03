import { pool, query } from '../src/db/pool.js';

async function main() {
  await query(`update professionals set role = 'medico', specialty = 'Clínica Médica' where name = 'Dr. Bruno Lima'`);
  await query(`update professionals set role = 'fisioterapeuta' where name in ('Dra. Ana Souza', 'Dra. Carla Mendes')`);
  const r = await query<{ name: string; role: string; specialty: string }>(`select name, role, specialty from professionals order by name`);
  for (const row of r.rows) console.log(`${row.name} → ${row.role} (${row.specialty})`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
