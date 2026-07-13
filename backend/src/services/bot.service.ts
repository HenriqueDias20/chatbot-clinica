import { env } from '../config/env.js';
import { logger, type Logger } from '../lib/logger.js';
import { normalizePhone } from '../lib/phone.js';
import { bus } from '../lib/events.js';
import { claudeService, type ClaudeService, type ConversationTurn, type Intent } from './claude.service.js';
import { findOrCreatePatient, updatePatientFields, type Patient } from '../repositories/patient.repo.js';
import {
  getOrCreateActiveConversation,
  setConversationState,
  setConversationStatus,
  setConversationIntake,
  markHandedOff,
  touchConversation,
  clearReminder,
} from '../repositories/conversation.repo.js';
import { getLastMessages, saveMessage } from '../repositories/message.repo.js';
import { getConfigs, listActiveFaq } from '../repositories/config.repo.js';
import type { InboundJob } from './queue.service.js';

export type Outgoing =
  | { kind: 'text'; text: string }
  | { kind: 'buttons'; text: string; buttons: Array<{ id: string; title: string }> };

type Kind = 'consulta' | 'sessao';

type Step =
  // Cadastro
  | 'await_cpf'
  | 'await_name'
  | 'await_birth'
  // Navegação em menus
  | 'main_menu'
  | 'consulta_menu'
  | 'consulta_tipo'
  | 'consulta_avaliacao'
  | 'sessao_menu'
  | 'sessao_tipo'
  | 'await_tipo_outros'
  | 'convenio'
  | 'await_convenio_outros'
  | 'await_question'
  | 'post_answer';

interface State {
  step?: Step;
  pendingKind?: Kind;
  pendingTipo?: string; // tipo escolhido (ou prefixo, quando aguardando "Outros")
}

export interface BotDeps {
  claude?: ClaudeService;
  now?: () => Date;
  log?: Logger;
}

const HUMAN_KEYWORDS = /\b(atendente|recep[cç][aã]o|falar com (algu[eé]m|humano|pessoa)|quero (um )?humano)\b/i;

// Convênios (opção "Outros" = 8, pede texto).
const CONVENIOS = ['Particular', 'Cabergs', 'Unimed', 'Saúde Caixa', 'Amil', 'Geap', 'Ipê Saúde'];

function isWithinBusinessHours(now: Date, configs: Record<string, string>): boolean {
  if (env.BUSINESS_HOURS_ALWAYS_OPEN) return true; // modo teste: atende sempre
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const start = configs.business_hours_start ?? env.BUSINESS_HOURS_START;
  const end = configs.business_hours_end ?? env.BUSINESS_HOURS_END;
  const [sh = 8, sm = 0] = start.split(':').map(Number);
  const [eh = 18, em = 0] = end.split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= sh * 60 + sm && cur < eh * 60 + em;
}

function text(t: string): Outgoing {
  return { kind: 'text', text: t };
}

function parseBirthDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = Number(m[2]);
  const year = Number(m[3]);
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return null;
  if (year < 1900 || dt > new Date()) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function createBotService(deps: BotDeps = {}) {
  const claude = deps.claude ?? claudeService;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? logger;

  async function saveOutgoing(
    ctx: { conversationId: string; patientId: string; phone: string },
    outs: Outgoing[],
  ): Promise<Outgoing[]> {
    for (const o of outs) {
      await saveMessage(ctx.conversationId, 'assistant', o.text);
      bus.emit('message:new', {
        conversationId: ctx.conversationId,
        patientId: ctx.patientId,
        phone: ctx.phone,
        role: 'assistant',
        content: o.text,
        at: new Date().toISOString(),
      });
    }
    return outs;
  }

  async function loadHistory(conversationId: string): Promise<ConversationTurn[]> {
    const all = await getLastMessages(conversationId, env.CLAUDE_MAX_CONTEXT_MESSAGES + 1);
    return all
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }

  // ── Textos dos menus ────────────────────────────────────────────────────
  const RESPONDA = 'Responda apenas com o número da opção desejada.';

  function mainMenuText(patient: Patient): Outgoing {
    const hi = patient.name ? `, ${patient.name.split(' ')[0]}` : '';
    return text(
      `Como posso ajudar${hi}? 🙂\n\n` +
        `1️⃣ Consulta\n` +
        `2️⃣ Sessão\n` +
        `3️⃣ Localização / Horário\n` +
        `4️⃣ Falar com atendente\n` +
        `5️⃣ Encerrar atendimento\n\n` +
        RESPONDA,
    );
  }

  const consultaMenuText = (): Outgoing =>
    text(
      `*Consulta* — o que você deseja?\n\n` +
        `1️⃣ Agendar consulta\n2️⃣ Reagendar consulta\n3️⃣ Cancelar consulta\n4️⃣ Confirmar consulta\n5️⃣ Voltar ao menu principal\n\n` +
        RESPONDA,
    );

  const consultaTipoText = (): Outgoing =>
    text(
      `Qual tipo de consulta você deseja agendar?\n\n` +
        `1️⃣ Primeira consulta\n2️⃣ Retorno\n3️⃣ Pós-operatório\n4️⃣ Fisiatria\n5️⃣ Medicina do Esporte\n6️⃣ Avaliação\n7️⃣ Outros\n\n` +
        RESPONDA,
    );

  const avaliacaoText = (): Outgoing =>
    text(
      `*Avaliação* — qual tipo?\n\n` +
        `1️⃣ Antropometria\n2️⃣ Baropodometria\n3️⃣ Ergoespirometria\n4️⃣ FMS\n5️⃣ Outros\n\n` +
        RESPONDA,
    );

  const sessaoMenuText = (): Outgoing =>
    text(
      `*Sessão* — o que você deseja?\n\n` +
        `1️⃣ Agendar sessão\n2️⃣ Reagendar sessão\n3️⃣ Cancelar sessão\n4️⃣ Confirmar sessão\n5️⃣ Voltar ao menu principal\n\n` +
        RESPONDA,
    );

  const sessaoTipoText = (): Outgoing =>
    text(
      `Qual tipo de sessão você deseja agendar?\n\n` +
        `1️⃣ Fisioterapia\n2️⃣ Cinesioterapia\n3️⃣ Particular\n4️⃣ Pélvica\n5️⃣ Pilates\n6️⃣ RPG\n7️⃣ Outros\n\n` +
        RESPONDA,
    );

  const convenioText = (): Outgoing =>
    text(
      `Para direcionar corretamente, qual é o seu convênio?\n\n` +
        `1️⃣ Particular\n2️⃣ Cabergs\n3️⃣ Unimed\n4️⃣ Saúde Caixa\n5️⃣ Amil\n6️⃣ Geap\n7️⃣ Ipê Saúde\n8️⃣ Outros\n\n` +
        RESPONDA,
    );

  /** Cadastro mínimo para atender qualquer fluxo. */
  function isRegistered(patient: Patient): boolean {
    return Boolean(patient.cpf && patient.name && patient.birth_date);
  }

  /** Inicia o cadastro (sempre começa pelo CPF). */
  async function startOnboarding(conversationId: string, clinic: string): Promise<Outgoing[]> {
    await setConversationState(conversationId, { step: 'await_cpf' });
    return [
      text(
        `Olá! 👋 Sou o assistente virtual da ${clinic}. Para começar seu atendimento, ` +
          `preciso confirmar seu cadastro.\n\nQual o seu *CPF*? (pode mandar só os números)`,
      ),
    ];
  }

  // ── Fluxo de agendamento ─────────────────────────────────────────────────

  /** Depois de escolher tipo → grava o tipo e pergunta o convênio (lista numerada). */
  async function goToConvenio(conversationId: string, kind: Kind, tipo: string): Promise<Outgoing[]> {
    await setConversationIntake(conversationId, { subtype: tipo });
    await setConversationState(conversationId, { step: 'convenio', pendingKind: kind, pendingTipo: tipo });
    return [convenioText()];
  }

  /** Transborda para a recepção com o resumo já coletado (categoria/ação/tipo/convênio). */
  async function handoffHuman(
    ctx: { conversationId: string; patientId: string; phone: string },
  ): Promise<Outgoing[]> {
    await markHandedOff(ctx.conversationId);
    await setConversationState(ctx.conversationId, {});
    bus.emit('conversation:status', { conversationId: ctx.conversationId, patientId: ctx.patientId, status: 'human' });
    return [text('Tudo bem! Já estou te encaminhando para a nossa recepção. 🙂')];
  }

  // Texto padrão de continuação após uma resposta automática do bot.
  const FOLLOWUP_TEXT =
    'Deseja fazer mais alguma coisa?\n\n1️⃣ Voltar ao menu principal\n2️⃣ Encerrar atendimento';

  /** Acrescenta as opções "voltar ao menu / encerrar" e deixa a conversa aguardando a escolha. */
  async function withFollowup(conversationId: string, messages: Outgoing[]): Promise<Outgoing[]> {
    await setConversationState(conversationId, { step: 'post_answer' });
    return [...messages, text(FOLLOWUP_TEXT)];
  }

  /** Encerramento solicitado pelo próprio cliente. */
  async function closeByUser(
    ctx: { conversationId: string; patientId: string; phone: string },
  ): Promise<Outgoing[]> {
    await setConversationStatus(ctx.conversationId, 'closed');
    await setConversationState(ctx.conversationId, {});
    bus.emit('conversation:status', { conversationId: ctx.conversationId, patientId: ctx.patientId, status: 'closed' });
    return [text('Atendimento encerrado. 🙂 Sempre que precisar, é só enviar uma nova mensagem!')];
  }

  async function answerFaq(
    msg: string,
    conversationId: string,
    configs: Record<string, string>,
  ): Promise<Outgoing[]> {
    const history = await loadHistory(conversationId);
    const replyCtx = {
      clinicName: configs.clinic_name ?? 'nossa clínica',
      faq: await listActiveFaq(),
      systemExtra: `Horário de atendimento: segunda a sexta, ${configs.business_hours_start ?? env.BUSINESS_HOURS_START} às ${configs.business_hours_end ?? env.BUSINESS_HOURS_END}.`,
    };
    const { text: answer } = await claude.generateReply(msg, history, replyCtx);
    return [text(answer)];
  }

  // Mapeia uma intenção genérica (Claude) → mostra o menu principal.
  async function routeIntent(
    intent: Intent,
    conversationId: string,
    patient: Patient,
    configs: Record<string, string>,
    msg: string,
    ctx: { conversationId: string; patientId: string; phone: string },
  ): Promise<Outgoing[]> {
    switch (intent) {
      case 'FALAR_HUMANO':
        await setConversationIntake(conversationId, { category: 'atendente', action: null, subtype: null });
        return handoffHuman(ctx);
      case 'DUVIDA':
        return withFollowup(conversationId, await answerFaq(msg, conversationId, configs));
      default:
        await setConversationState(conversationId, { step: 'main_menu' });
        return [mainMenuText(patient)];
    }
  }

  async function handle(job: InboundJob): Promise<Outgoing[]> {
    const phone = normalizePhone(job.phone);
    const patient = await findOrCreatePatient(phone, job.name);
    const convo = await getOrCreateActiveConversation(patient.id);
    const body = (job.text ?? '').trim();
    const ctx = { conversationId: convo.id, patientId: patient.id, phone };

    const userContent = body || '[mensagem não textual]';
    await saveMessage(convo.id, 'user', userContent);
    await touchConversation(convo.id);
    // Paciente respondeu → cancela qualquer lembrete pendente de inatividade.
    await clearReminder(convo.id);
    bus.emit('message:new', {
      conversationId: convo.id,
      patientId: patient.id,
      phone,
      role: 'user',
      content: userContent,
      at: new Date().toISOString(),
    });

    if (convo.status === 'human') {
      log.info({ conversationId: convo.id }, 'Conversa em modo human — sem resposta do bot');
      return [];
    }

    const configs = await getConfigs();
    if (!isWithinBusinessHours(now(), configs)) {
      const msg = configs.out_of_hours_message ?? 'Estamos fora do horário de atendimento. Retornaremos em breve. 🙂';
      return saveOutgoing(ctx, [text(msg)]);
    }

    // Atalho: pedir atendente a qualquer momento.
    if (HUMAN_KEYWORDS.test(body)) {
      await setConversationIntake(convo.id, { category: 'atendente', action: null, subtype: null });
      return saveOutgoing(ctx, await handoffHuman(ctx));
    }

    const state = (convo.state ?? {}) as State;
    const n = Number.parseInt(body, 10);

    switch (state.step) {
      // ── Cadastro inicial: CPF → Nome → Nascimento → menu principal ──
      case 'await_cpf': {
        const cpf = body.replace(/\D/g, '');
        if (cpf.length !== 11) return saveOutgoing(ctx, [text('Hmm, o CPF precisa ter 11 números. Pode digitar de novo? 🙂')]);
        await updatePatientFields(patient.id, { cpf });
        await setConversationState(convo.id, { step: 'await_name' });
        return saveOutgoing(ctx, [text('Obrigado! Agora, qual o seu *nome completo*?')]);
      }
      case 'await_name': {
        if (body.length < 3) return saveOutgoing(ctx, [text('Por favor, me diga seu *nome completo*. 🙂')]);
        const updated = await updatePatientFields(patient.id, { name: body });
        await setConversationState(convo.id, { step: 'await_birth' });
        return saveOutgoing(ctx, [text(`Prazer, ${updated.name!.split(' ')[0]}! Qual a sua *data de nascimento*? (DD/MM/AAAA)`)]);
      }
      case 'await_birth': {
        const birth = parseBirthDate(body);
        if (!birth) return saveOutgoing(ctx, [text('Não entendi a data. 🙂 Pode mandar no formato DD/MM/AAAA? (ex: 15/03/1990)')]);
        const updated = await updatePatientFields(patient.id, { birthDate: birth });
        await setConversationState(convo.id, { step: 'main_menu' });
        return saveOutgoing(ctx, [text('Cadastro confirmado! ✅'), mainMenuText(updated)]);
      }

      // ── Menu principal ──
      case 'main_menu': {
        if (n === 1) {
          await setConversationIntake(convo.id, { category: 'consulta', action: null, subtype: null });
          await setConversationState(convo.id, { step: 'consulta_menu' });
          return saveOutgoing(ctx, [consultaMenuText()]);
        }
        if (n === 2) {
          await setConversationIntake(convo.id, { category: 'sessao', action: null, subtype: null });
          await setConversationState(convo.id, { step: 'sessao_menu' });
          return saveOutgoing(ctx, [sessaoMenuText()]);
        }
        if (n === 3) {
          await setConversationIntake(convo.id, { category: 'localizacao', action: null, subtype: null });
          const address = configs.clinic_address ?? 'Endereço não cadastrado.';
          const maps = configs.clinic_maps_url;
          const horario = configs.business_hours_text ??
            `⏰ *Horário de atendimento*\n\nSegunda a sexta: ${configs.business_hours_start ?? '08:00'} às ${configs.business_hours_end ?? '18:00'}`;
          const msg = `📍 *Localização*\n${address}${maps ? `\n🗺️ ${maps}` : ''}\n\n${horario}`;
          return saveOutgoing(ctx, await withFollowup(convo.id, [text(msg)]));
        }
        if (n === 4) {
          await setConversationIntake(convo.id, { category: 'atendente', action: null, subtype: null });
          return saveOutgoing(ctx, await handoffHuman(ctx));
        }
        if (n === 5) return saveOutgoing(ctx, await closeByUser(ctx));
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), mainMenuText(patient)]);
      }

      // ── Submenu Consulta ──
      case 'consulta_menu': {
        if (n === 1 || n === 2) {
          await setConversationIntake(convo.id, { action: n === 1 ? 'agendar' : 'reagendar' });
          await setConversationState(convo.id, { step: 'consulta_tipo' });
          return saveOutgoing(ctx, [consultaTipoText()]);
        }
        if (n === 3 || n === 4) {
          await setConversationIntake(convo.id, { action: n === 3 ? 'cancelar' : 'confirmar' });
          return saveOutgoing(ctx, await handoffHuman(ctx));
        }
        if (n === 5) {
          await setConversationState(convo.id, { step: 'main_menu' });
          return saveOutgoing(ctx, [mainMenuText(patient)]);
        }
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), consultaMenuText()]);
      }

      // ── Tipo de consulta ──
      case 'consulta_tipo': {
        const tipos: Record<number, string> = {
          1: 'Primeira consulta',
          2: 'Retorno',
          3: 'Pós-operatório',
          4: 'Fisiatria',
          5: 'Medicina do Esporte',
        };
        if (tipos[n]) return saveOutgoing(ctx, await goToConvenio(convo.id, 'consulta', tipos[n]!));
        if (n === 6) {
          await setConversationState(convo.id, { step: 'consulta_avaliacao' });
          return saveOutgoing(ctx, [avaliacaoText()]);
        }
        if (n === 7) {
          // Outros → pede descrição
          await setConversationState(convo.id, { step: 'await_tipo_outros', pendingKind: 'consulta', pendingTipo: '' });
          return saveOutgoing(ctx, [text('Certo! Pode me dizer qual tipo de consulta você precisa? ✍️')]);
        }
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), consultaTipoText()]);
      }

      // ── Avaliação (submenu de consulta) ──
      case 'consulta_avaliacao': {
        const tipos: Record<number, string> = {
          1: 'Avaliação — Antropometria',
          2: 'Avaliação — Baropodometria',
          3: 'Avaliação — Ergoespirometria',
          4: 'Avaliação — FMS',
        };
        if (tipos[n]) return saveOutgoing(ctx, await goToConvenio(convo.id, 'consulta', tipos[n]!));
        if (n === 5) {
          await setConversationState(convo.id, { step: 'await_tipo_outros', pendingKind: 'consulta', pendingTipo: 'Avaliação — ' });
          return saveOutgoing(ctx, [text('Certo! Pode me dizer qual avaliação você precisa? ✍️')]);
        }
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), avaliacaoText()]);
      }

      // ── Submenu Sessão ──
      case 'sessao_menu': {
        if (n === 1 || n === 2) {
          await setConversationIntake(convo.id, { action: n === 1 ? 'agendar' : 'reagendar' });
          await setConversationState(convo.id, { step: 'sessao_tipo' });
          return saveOutgoing(ctx, [sessaoTipoText()]);
        }
        if (n === 3 || n === 4) {
          await setConversationIntake(convo.id, { action: n === 3 ? 'cancelar' : 'confirmar' });
          return saveOutgoing(ctx, await handoffHuman(ctx));
        }
        if (n === 5) {
          await setConversationState(convo.id, { step: 'main_menu' });
          return saveOutgoing(ctx, [mainMenuText(patient)]);
        }
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), sessaoMenuText()]);
      }

      // ── Tipo de sessão ──
      case 'sessao_tipo': {
        const tipos: Record<number, string> = {
          1: 'Fisioterapia',
          2: 'Cinesioterapia',
          3: 'Particular',
          4: 'Pélvica',
          5: 'Pilates',
          6: 'RPG',
        };
        if (tipos[n]) return saveOutgoing(ctx, await goToConvenio(convo.id, 'sessao', tipos[n]!));
        if (n === 7) {
          await setConversationState(convo.id, { step: 'await_tipo_outros', pendingKind: 'sessao', pendingTipo: '' });
          return saveOutgoing(ctx, [text('Certo! Pode me dizer qual tipo de sessão você precisa? ✍️')]);
        }
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), sessaoTipoText()]);
      }

      // ── "Outros" (tipo) digitado livremente ──
      case 'await_tipo_outros': {
        const kind = state.pendingKind ?? 'consulta';
        const prefix = state.pendingTipo ?? '';
        const tipo = `${prefix}${body || 'Outros'}`;
        return saveOutgoing(ctx, await goToConvenio(convo.id, kind, tipo));
      }

      // ── Convênio (lista numerada) → transborda para a recepção ──
      case 'convenio': {
        const kind = state.pendingKind ?? 'consulta';
        const tipo = state.pendingTipo;
        if (n >= 1 && n <= 7) {
          await updatePatientFields(patient.id, { insurance: CONVENIOS[n - 1]! });
          return saveOutgoing(ctx, await handoffHuman(ctx));
        }
        if (n === 8) {
          await setConversationState(convo.id, { step: 'await_convenio_outros', pendingKind: kind, pendingTipo: tipo });
          return saveOutgoing(ctx, [text('Sem problemas! Qual é o seu convênio? (digite o nome)')]);
        }
        return saveOutgoing(ctx, [text('Não entendi. 🙂'), convenioText()]);
      }

      // ── Convênio "Outros" digitado → transborda para a recepção ──
      case 'await_convenio_outros': {
        await updatePatientFields(patient.id, { insurance: body || 'Outros' });
        return saveOutgoing(ctx, await handoffHuman(ctx));
      }

      // ── Dúvida aberta (FAQ via texto livre) ──
      case 'await_question': {
        return saveOutgoing(ctx, await withFollowup(convo.id, await answerFaq(body, convo.id, configs)));
      }

      // ── Após resposta automática: 1 volta ao menu, 2 encerra ──
      case 'post_answer': {
        if (n === 1) {
          await setConversationState(convo.id, { step: 'main_menu' });
          return saveOutgoing(ctx, [mainMenuText(patient)]);
        }
        if (n === 2) return saveOutgoing(ctx, await closeByUser(ctx));
        return saveOutgoing(ctx, [
          text('Não entendi. 🙂 Responda com *1* para voltar ao menu principal ou *2* para encerrar o atendimento.'),
        ]);
      }

      // ── Sem estado: garante o cadastro; depois entende a intenção / mostra o menu ──
      default: {
        if (!isRegistered(patient)) {
          return saveOutgoing(ctx, await startOnboarding(convo.id, configs.clinic_name ?? 'nossa clínica'));
        }
        const history = await loadHistory(convo.id);
        const { intent, mock } = await claude.classifyIntent(body, history);
        log.info({ conversationId: convo.id, intent, mock }, 'Intenção do paciente');
        return saveOutgoing(ctx, await routeIntent(intent, convo.id, patient, configs, body, ctx));
      }
    }
  }

  return { handle };
}

export const botService = createBotService();
