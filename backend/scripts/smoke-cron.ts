import { sendTomorrowConfirmations, checkUnconfirmed, closeInactive } from '../src/services/cron.service.js';
import { bus } from '../src/lib/events.js';
import { findOrCreatePatient } from '../src/repositories/patient.repo.js';
import { getOrCreateActiveConversation } from '../src/repositories/conversation.repo.js';
import { listActiveProfessionals } from '../src/repositories/professional.repo.js';
import { createAppointment } from '../src/repositories/appointment.repo.js';
import { pool, query } from '../src/db/pool.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

const PHONE = '5511000000066';

async function main(): Promise<void> {
  await query(`delete from patients where phone = $1`, [PHONE]);

  const patient = await findOrCreatePatient(PHONE, 'Cron Teste');
  const prof = (await listActiveProfessionals())[0]!;

  // Agendamento para amanhã às 14:00.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);
  const appt = await createAppointment(patient.id, prof.id, tomorrow, 'confirmed');

  // ── Job 08:00: envia confirmação ──
  const r1 = await sendTomorrowConfirmations();
  check('08:00 enviou ao menos 1 confirmação', r1.sent >= 1, r1);
  const after = await query<{ status: string; confirmation_sent_at: string | null }>(
    `select status, confirmation_sent_at from appointments where id = $1`,
    [appt.id],
  );
  check('Agendamento ficou pending + carimbo de envio', after.rows[0]?.status === 'pending' && !!after.rows[0]?.confirmation_sent_at, after.rows[0]);

  // ── Job horário: backdate o envio em 3h e checa não-respondidos ──
  await query(`update appointments set confirmation_sent_at = now() - interval '3 hours' where id = $1`, [appt.id]);
  let notified = false;
  const listener = (p: { appointmentId: string }) => {
    if (p.appointmentId === appt.id) notified = true;
  };
  bus.on('appointment:unconfirmed', listener);
  const r2 = await checkUnconfirmed(2);
  bus.off('appointment:unconfirmed', listener);
  check('Job horário sinaliza não-confirmado', r2.flagged >= 1 && notified, { flagged: r2.flagged, notified });

  // ── Job 23:59: fecha conversa inativa ──
  const convo = await getOrCreateActiveConversation(patient.id);
  await query(`update conversations set last_message_at = now() - interval '30 hours' where id = $1`, [convo.id]);
  const r3 = await closeInactive(24);
  check('23:59 fechou ao menos 1 conversa', r3.closed >= 1, r3);
  const convoAfter = await query<{ status: string }>(`select status from conversations where id = $1`, [convo.id]);
  check('Conversa marcada como closed', convoAfter.rows[0]?.status === 'closed', convoAfter.rows[0]);

  await query(`delete from patients where phone = $1`, [PHONE]);
}

main()
  .catch((err) => {
    console.error('Erro:', err);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
    process.exit(failures === 0 ? 0 : 1);
  });
