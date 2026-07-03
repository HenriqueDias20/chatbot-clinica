import pg from 'pg';
import { buildPgConfig } from './connection.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/auth.js';

async function seed(): Promise<void> {
  const client = new pg.Client(buildPgConfig());
  await client.connect();
  try {
    await client.query('begin');

    // ── Profissionais + disponibilidade (apenas se ainda não houver) ──
    const { rows } = await client.query<{ count: string }>('select count(*)::int as count from professionals');
    const profCount = Number(rows[0]?.count ?? 0);

    if (profCount === 0) {
      const profs = [
        { name: 'Dra. Ana Souza', specialty: 'Fisioterapia Ortopédica' },
        { name: 'Dr. Bruno Lima', specialty: 'Fisioterapia Neurológica' },
        { name: 'Dra. Carla Mendes', specialty: 'Pilates Clínico' },
      ];
      for (const p of profs) {
        const res = await client.query<{ id: string }>(
          'insert into professionals (name, specialty, active) values ($1, $2, true) returning id',
          [p.name, p.specialty],
        );
        const profId = res.rows[0]!.id;
        // Seg–Sex (1..5), 08:00–18:00, slots de 60min
        for (let dow = 1; dow <= 5; dow++) {
          await client.query(
            `insert into availability (professional_id, day_of_week, start_time, end_time, slot_duration_minutes)
             values ($1, $2, '08:00', '18:00', 60)`,
            [profId, dow],
          );
        }
      }
      logger.info({ inserted: profs.length }, 'Profissionais + disponibilidade criados');
    } else {
      logger.info({ profCount }, 'Profissionais já existem — pulando');
    }

    // ── Configs do bot (upsert por chave) ──
    const configs: Record<string, string> = {
      welcome_message:
        'Olá! 👋 Sou o assistente virtual da Clínica de Fisioterapia. Posso ajudar a agendar, confirmar ou cancelar sua sessão. Como posso ajudar?',
      out_of_hours_message:
        'Nosso atendimento é de segunda a sexta, das 08h às 18h. Deixe sua mensagem que retornaremos no próximo horário comercial. 🙂',
      clinic_name: 'Clínica de Fisioterapia',
      business_hours_start: '08:00',
      business_hours_end: '18:00',
      clinic_address: 'Av. Exemplo, 123 — Centro\nSão Paulo, SP',
      clinic_maps_url: 'https://maps.google.com/?q=Av.+Exemplo+123+Centro',
      business_hours_text:
        '⏰ *Horários de atendimento*\n\nSegunda a sexta: 08h às 18h\nSábados, domingos e feriados: fechado',
    };
    for (const [key, value] of Object.entries(configs)) {
      await client.query(
        `insert into configs (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value`,
        [key, value],
      );
    }
    logger.info({ keys: Object.keys(configs).length }, 'Configs aplicadas');

    // ── FAQ (apenas se vazio) ──
    const faqCount = Number(
      (await client.query<{ count: string }>('select count(*)::int as count from faq')).rows[0]?.count ?? 0,
    );
    if (faqCount === 0) {
      const faqs = [
        { q: 'Qual o endereço da clínica?', a: 'Ficamos na Av. Exemplo, 123 — Centro. Há estacionamento no local.' },
        { q: 'Vocês atendem convênio?', a: 'Atendemos os principais convênios e também particular. Consulte a recepção para o seu plano.' },
        { q: 'Preciso de pedido médico?', a: 'Para a primeira avaliação não é obrigatório, mas é recomendado trazer o encaminhamento se tiver.' },
        { q: 'Quanto tempo dura uma sessão?', a: 'Em média 50 a 60 minutos, dependendo do tratamento.' },
        { q: 'Como faço para cancelar?', a: 'É só me avisar por aqui com pelo menos 4h de antecedência que eu cancelo para você.' },
      ];
      for (const f of faqs) {
        await client.query('insert into faq (question, answer, active) values ($1, $2, true)', [f.q, f.a]);
      }
      logger.info({ inserted: faqs.length }, 'FAQ criada');
    } else {
      logger.info({ faqCount }, 'FAQ já existe — pulando');
    }

    // ── Usuários do painel (recepção) — só cria se a senha ainda não foi definida ──
    // Senha padrão apenas para o ambiente de demonstração; trocar em produção.
    const defaultUsers = [
      { name: 'Recepção', email: 'recepcao@clinica.com', role: 'recepcao', senha: 'clinica123' },
      { name: 'Administrador', email: 'admin@clinica.com', role: 'admin', senha: 'admin123' },
    ];
    for (const u of defaultUsers) {
      // Só insere se ainda não existir (não sobrescreve senha já trocada).
      const exists = Number(
        (await client.query<{ count: string }>('select count(*)::int as count from users where lower(email) = lower($1)', [u.email])).rows[0]?.count ?? 0,
      );
      if (exists === 0) {
        await client.query(
          'insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)',
          [u.name, u.email, hashPassword(u.senha), u.role],
        );
      }
    }
    logger.info({ users: defaultUsers.length }, 'Usuários do painel garantidos');

    await client.query('commit');
    logger.info('Seed concluído com sucesso');
  } catch (err) {
    await client.query('rollback');
    logger.error({ err }, 'Falha no seed — rollback executado');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

seed();
