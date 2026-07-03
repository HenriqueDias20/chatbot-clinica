import { query } from '../db/pool.js';
import { findOrCreatePatient, updatePatientFields } from '../repositories/patient.repo.js';
import { getOrCreateActiveConversation, setConversationStatus } from '../repositories/conversation.repo.js';
import { saveMessage } from '../repositories/message.repo.js';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';

/** Intervalo fixo entre as mensagens da demo (o "digitando…" ocupa esse tempo). */
const MESSAGE_GAP_MS = 3000;

interface Persona {
  name: string;
  cpf: string;
  birth: string; // YYYY-MM-DD
  insurance: string;
}

// Personas que se alternam a cada clique no Demo (pra acumular conversas variadas).
const PERSONAS: Persona[] = [
  { name: 'Patrícia Gomes', cpf: '12345678900', birth: '1990-04-15', insurance: 'Unimed' },
  { name: 'Carlos Henrique', cpf: '98765432100', birth: '1985-09-02', insurance: 'Bradesco Saúde' },
  { name: 'Juliana Martins', cpf: '45678912300', birth: '1993-12-20', insurance: 'SulAmérica' },
  { name: 'Roberto Alves', cpf: '32165498700', birth: '1978-06-11', insurance: 'Particular' },
];

let personaIdx = 0;

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Tempo (ms) "digitando" antes da mensagem aparecer. */
  typing: number;
  /** Ao enviar esta mensagem, muda o status da conversa. */
  status?: 'human';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Próximo dia útil às 10:00, formatado em pt-BR (para o roteiro parecer atual). */
function nextWeekdayLabel(): string {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const u = (text: string): Turn => ({ role: 'user', text, typing: 1 });
const b = (text: string): Turn => ({ role: 'assistant', text, typing: 1 });
const RESPONDA = 'Responda apenas com o número da opção desejada.';

// Convênio → número na lista (Particular=1, Unimed=3, senão "Outros"=8 + digita)
const convenioTurns = (p: Persona): Turn[] => {
  if (p.insurance === 'Particular') return [u('1')];
  if (p.insurance === 'Unimed') return [u('3')];
  return [u('8'), b('Sem problemas! Qual é o seu convênio? (digite o nome)'), u(p.insurance)];
};

/** Saudação + menu principal (início comum de todos os cenários). */
function greeting(nome: string): Turn[] {
  return [
    u('Oi, bom dia! 🙂'),
    b(
      `Olá, ${nome}! 👋 Sou o assistente virtual da Clínica de Fisioterapia. Como posso ajudar?\n\n` +
        '1️⃣ Consulta\n2️⃣ Sessão\n3️⃣ Localização / Horário\n4️⃣ Falar com atendente\n5️⃣ Encerrar atendimento\n\n' +
        RESPONDA,
    ),
  ];
}
const mainMenuOnly = (nome: string): Turn => greeting(nome)[1]!;

const consultaMenu = b(
  '*Consulta* — o que você deseja?\n\n1️⃣ Agendar consulta\n2️⃣ Cancelar consulta\n3️⃣ Confirmar consulta\n4️⃣ Voltar ao menu principal\n\n' + RESPONDA,
);
const sessaoMenu = b(
  '*Sessão* — o que você deseja?\n\n1️⃣ Agendar sessão\n2️⃣ Cancelar sessão\n3️⃣ Confirmar sessão\n4️⃣ Voltar ao menu principal\n\n' + RESPONDA,
);
const consultaTipos = b(
  'Qual tipo de consulta você deseja agendar?\n\n1️⃣ Primeira consulta\n2️⃣ Pós-operatório\n3️⃣ Fisiatria\n4️⃣ Medicina do Esporte\n5️⃣ Avaliação\n6️⃣ Outros\n\n' + RESPONDA,
);
const sessaoTipos = b(
  'Qual tipo de sessão você deseja agendar?\n\n1️⃣ Fisioterapia\n2️⃣ Cinesioterapia\n3️⃣ Particular\n4️⃣ Pélvica\n5️⃣ Outros\n\n' + RESPONDA,
);
const convenioMenu = b(
  'Para direcionar corretamente, qual é o seu convênio?\n\n1️⃣ Particular\n2️⃣ Cabergs\n3️⃣ Unimed\n4️⃣ Saúde Caixa\n5️⃣ Amil\n6️⃣ Geap\n7️⃣ Ipê Saúde\n8️⃣ Outros\n\n' + RESPONDA,
);

const FOLLOWUP = 'Deseja fazer mais alguma coisa?\n\n1️⃣ Voltar ao menu principal\n2️⃣ Encerrar atendimento';
const ENCERRAR = 'Atendimento encerrado. 🙂 Sempre que precisar, é só enviar uma nova mensagem!';

interface Scenario {
  id: string;
  label: string;
  build: (persona: Persona) => Turn[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'agendar_consulta',
    label: 'Consulta · Agendar (Primeira consulta)',
    build: (p) => {
      const quando = nextWeekdayLabel();
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('1'), consultaMenu,
        u('1'), consultaTipos,
        u('1'), convenioMenu,
        ...convenioTurns(p),
        b(`Perfeito! Estes são os próximos horários disponíveis para *consulta*:\n1) Dr. Bruno Lima — ${quando}\n2) Dr. Bruno Lima — sex., 26/06 às 14:00\n\n${RESPONDA}`),
        u('1'),
        b(`Pronto! ✅ Sua consulta (Primeira consulta) foi agendada com Dr. Bruno Lima em ${quando}. Até lá!`),
        b(FOLLOWUP),
        u('2'), b(ENCERRAR),
      ];
    },
  },
  {
    id: 'agendar_sessao',
    label: 'Sessão · Agendar (Fisioterapia)',
    build: (p) => {
      const quando = nextWeekdayLabel();
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('2'), sessaoMenu,
        u('1'), sessaoTipos,
        u('1'), convenioMenu,
        ...convenioTurns(p),
        b(`Perfeito! Estes são os próximos horários disponíveis para *sessão*:\n1) Dra. Ana Souza — ${quando}\n2) Dra. Carla Mendes — sex., 26/06 às 15:00\n\n${RESPONDA}`),
        u('1'),
        b(`Pronto! ✅ Sua sessão (Fisioterapia) foi agendada com Dra. Ana Souza em ${quando}. Até lá!`),
        b(FOLLOWUP),
        u('1'), mainMenuOnly(nome),
      ];
    },
  },
  {
    id: 'consulta_avaliacao',
    label: 'Consulta · Avaliação (Antropometria)',
    build: (p) => {
      const quando = nextWeekdayLabel();
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('1'), consultaMenu,
        u('1'), consultaTipos,
        u('5'),
        b('*Avaliação* — qual tipo?\n\n1️⃣ Antropometria\n2️⃣ Baropodometria\n3️⃣ Ergoespirometria\n4️⃣ FMS\n5️⃣ Outros\n\n' + RESPONDA),
        u('1'), convenioMenu,
        ...convenioTurns(p),
        b(`Perfeito! Estes são os próximos horários disponíveis para *consulta*:\n1) Dr. Bruno Lima — ${quando}\n\n${RESPONDA}`),
        u('1'),
        b(`Pronto! ✅ Sua consulta (Avaliação — Antropometria) foi agendada com Dr. Bruno Lima em ${quando}. Até lá!`),
        b(FOLLOWUP),
        u('2'), b(ENCERRAR),
      ];
    },
  },
  {
    id: 'confirmar_consulta',
    label: 'Consulta · Confirmar',
    build: (p) => {
      const quando = nextWeekdayLabel();
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('1'), consultaMenu,
        u('3'),
        b(`Sua consulta de ${quando} está confirmada! ✅`),
        b(FOLLOWUP),
        u('2'), b(ENCERRAR),
      ];
    },
  },
  {
    id: 'cancelar_sessao',
    label: 'Sessão · Cancelar',
    build: (p) => {
      const quando = nextWeekdayLabel();
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('2'), sessaoMenu,
        u('2'),
        b(`Tudo certo, sua sessão de ${quando} foi cancelada. Se quiser, posso reagendar.`),
        b(FOLLOWUP),
        u('2'), b(ENCERRAR),
      ];
    },
  },
  {
    id: 'localizacao',
    label: 'Localização / Horário',
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('3'),
        b('📍 *Localização*\nAv. Exemplo, 123 — Centro, São Paulo, SP\n🗺️ https://maps.google.com/?q=Clínica+Fisioterapia\n\n⏰ *Horário de atendimento*\nSegunda a sexta: 08h às 18h\nSábados, domingos e feriados: fechado'),
        b(FOLLOWUP),
        u('2'), b(ENCERRAR),
      ];
    },
  },
  {
    id: 'falar_atendente',
    label: 'Falar com atendente (transbordo)',
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('4'),
        { role: 'assistant', typing: 1, status: 'human', text: 'Tudo bem! Já estou te encaminhando para a nossa recepção. 🙂' },
        u('Oi, preciso de ajuda com o meu convênio, por favor.'),
      ];
    },
  },
];

function getScenario(id?: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}

/** Remove todas as conversas/pacientes criados pela simulação (Demo). */
export async function clearDemoConversations(): Promise<number> {
  const r = await query(`delete from patients where is_demo = true`);
  return r.rowCount ?? 0;
}

/**
 * Inicia uma conversa de demonstração que "acontece" em tempo real no painel.
 * Cada clique cria uma conversa NOVA (persona alternada), preservando as anteriores no histórico.
 * Retorna o id da conversa imediatamente; as mensagens são emitidas com delays.
 */
export async function startDemoConversation(scenarioId?: string): Promise<{ conversationId: string; patientId: string }> {
  const persona = PERSONAS[personaIdx % PERSONAS.length]!;
  personaIdx++;
  // Telefone único por rodada → paciente/conversa novos (não sobrescreve os anteriores).
  const phone = `5511${String(Date.now()).slice(-9)}`;

  const patient = await findOrCreatePatient(phone, persona.name);
  await updatePatientFields(patient.id, { cpf: persona.cpf, birthDate: persona.birth, insurance: persona.insurance });
  await query(`update patients set is_demo = true where id = $1`, [patient.id]);
  const convo = await getOrCreateActiveConversation(patient.id);

  const script = getScenario(scenarioId).build(persona);

  // Status atual da conversa (para detectar quando um atendente assume / encerra).
  const currentStatus = async (): Promise<string> => {
    const r = await query<{ status: string }>(`select status from conversations where id = $1`, [convo.id]);
    return r.rows[0]?.status ?? 'bot';
  };

  // Fire-and-forget: toca o roteiro em segundo plano (cada conversa é independente).
  void (async () => {
    try {
      // Pequena pausa pro frontend já estar com a conversa aberta.
      await sleep(700);
      let handedOff = false; // true quando o PRÓPRIO roteiro encaminha pra recepção
      for (const turn of script) {
        // Se um atendente assumiu (ou a conversa foi encerrada) por fora do roteiro, o bot para.
        const before = await currentStatus();
        if (before === 'closed' || (before === 'human' && !handedOff)) {
          logger.info({ conversationId: convo.id }, 'Demo: interrompida (atendente assumiu / conversa encerrada)');
          break;
        }
        bus.emit('conversation:typing', { conversationId: convo.id, role: turn.role });
        await sleep(MESSAGE_GAP_MS);
        // Reconfere após o "digitando" — o atendente pode ter assumido nesse intervalo.
        const after = await currentStatus();
        if (after === 'closed' || (after === 'human' && !handedOff)) {
          logger.info({ conversationId: convo.id }, 'Demo: interrompida (atendente assumiu durante a digitação)');
          break;
        }
        const saved = await saveMessage(convo.id, turn.role, turn.text);
        bus.emit('message:new', {
          conversationId: convo.id,
          patientId: patient.id,
          phone,
          role: turn.role,
          content: turn.text,
          at: saved.created_at,
        });
        if (turn.status === 'human') {
          await setConversationStatus(convo.id, 'human');
          handedOff = true;
          bus.emit('conversation:status', { conversationId: convo.id, patientId: patient.id, status: 'human' });
        }
      }
      logger.info({ conversationId: convo.id }, 'Demo: conversa concluída');
    } catch (err) {
      logger.error({ err }, 'Demo: falha ao tocar a conversa');
    }
  })();

  return { conversationId: convo.id, patientId: patient.id };
}
