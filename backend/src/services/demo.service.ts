import { query } from '../db/pool.js';
import { findOrCreatePatient, updatePatientFields } from '../repositories/patient.repo.js';
import { getOrCreateActiveConversation, setConversationIntake, markHandedOff } from '../repositories/conversation.repo.js';
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

const consultaMenu = b(
  '*Consulta* — o que você deseja?\n\n1️⃣ Agendar consulta\n2️⃣ Reagendar consulta\n3️⃣ Cancelar consulta\n4️⃣ Voltar ao menu principal\n\n' + RESPONDA,
);
const sessaoMenu = b(
  '*Sessão* — o que você deseja?\n\n1️⃣ Reagendar sessão\n2️⃣ Cancelar sessão\n3️⃣ Voltar ao menu principal\n\n' + RESPONDA,
);
const consultaTipos = b(
  'O que você deseja agendar?\n\n1️⃣ Consulta de Fisiatria\n2️⃣ Consulta de Medicina do Esporte\n3️⃣ Sessão de Fisioterapia\n4️⃣ Outros\n\n' + RESPONDA,
);
const consultaModalidade = b(
  'Entendi! E qual é o seu caso?\n\n1️⃣ Primeira Consulta\n2️⃣ Primeira Consulta / Pós-Operatório\n3️⃣ Retorno\n\n' + RESPONDA,
);
const convenioMenu = b(
  'Para direcionar corretamente, qual é o seu convênio?\n\n1️⃣ Particular\n2️⃣ Cabergs\n3️⃣ Unimed\n4️⃣ Saúde Caixa\n5️⃣ Amil\n6️⃣ Geap\n7️⃣ Ipê Saúde\n8️⃣ Outros\n\n' + RESPONDA,
);

const FOLLOWUP = 'Deseja fazer mais alguma coisa?\n\n1️⃣ Voltar ao menu principal\n2️⃣ Encerrar atendimento';
const ENCERRAR = 'Atendimento encerrado. 🙂 Sempre que precisar, é só enviar uma nova mensagem!';

/** Mensagem de transbordo (o bot coletou a triagem e encaminha para a recepção; conversa vira 'human'). */
const transbordo: Turn = {
  role: 'assistant',
  typing: 1,
  status: 'human',
  text: 'Tudo bem! Já tenho o que preciso. 🙂 Vou te encaminhar para a nossa recepção finalizar.',
};

interface Scenario {
  id: string;
  label: string;
  /** Assunto principal gravado na conversa (aparece no dashboard). */
  intake: { category: string; action?: string; subtype?: string };
  build: (persona: Persona) => Turn[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'agendar_consulta',
    label: 'Consulta · Agendar (Fisiatria)',
    intake: { category: 'consulta', action: 'agendar', subtype: 'Consulta de Fisiatria — Primeira Consulta' },
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('1'), consultaMenu,
        u('1'), consultaTipos,
        u('1'), consultaModalidade,
        u('1'), convenioMenu,
        ...convenioTurns(p),
        transbordo,
        u('Perfeito, obrigado! 🙏'),
      ];
    },
  },
  {
    id: 'agendar_sessao_fisio',
    label: 'Sessão de Fisioterapia · Agendar (Retorno)',
    intake: { category: 'sessao', action: 'agendar', subtype: 'Sessão de Fisioterapia — Retorno' },
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('1'), consultaMenu,
        u('1'), consultaTipos,
        u('3'), consultaModalidade,
        u('3'), convenioMenu,
        ...convenioTurns(p),
        transbordo,
        u('Combinado, fico no aguardo! 🙂'),
      ];
    },
  },
  {
    id: 'reagendar_consulta',
    label: 'Consulta · Reagendar',
    intake: { category: 'consulta', action: 'reagendar' },
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('1'), consultaMenu,
        u('2'),
        transbordo,
        u('Preciso mudar o horário da minha consulta, por favor.'),
      ];
    },
  },
  {
    id: 'cancelar_sessao',
    label: 'Sessão · Cancelar',
    intake: { category: 'sessao', action: 'cancelar' },
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('2'), sessaoMenu,
        u('2'),
        transbordo,
        u('Preciso cancelar a de amanhã, por favor.'),
      ];
    },
  },
  {
    id: 'localizacao',
    label: 'Localização / Horário',
    intake: { category: 'localizacao' },
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('3'),
        b('📍 *Localização*\nR. José de Alencar, 501 - Menino Deus, Porto Alegre - RS, 90880-481\n🗺️ https://maps.google.com/?q=R.+Jos%C3%A9+de+Alencar,+501+-+Menino+Deus,+Porto+Alegre+-+RS,+90880-481\n\n⏰ *Horário de atendimento*\nSegunda a sexta: 08h às 18h\nSábados, domingos e feriados: fechado'),
        b(FOLLOWUP),
        u('2'), b(ENCERRAR),
      ];
    },
  },
  {
    id: 'falar_atendente',
    label: 'Falar com atendente (transbordo)',
    intake: { category: 'atendente' },
    build: (p) => {
      const nome = p.name.split(' ')[0]!;
      return [
        ...greeting(nome),
        u('4'),
        transbordo,
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

  const scenario = getScenario(scenarioId);
  // Grava o assunto principal (para o dashboard) já no início.
  await setConversationIntake(convo.id, {
    category: scenario.intake.category,
    action: scenario.intake.action ?? null,
    subtype: scenario.intake.subtype ?? null,
  });
  const script = scenario.build(persona);

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
          await markHandedOff(convo.id);
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
