import { getMessageQueue } from '../services/queue.service.js';
import { botService, type Outgoing } from '../services/bot.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { logger } from '../lib/logger.js';

/**
 * Inicia o consumidor da fila: para cada mensagem recebida, roda o fluxo do bot
 * e envia as respostas via WhatsApp.
 */
export async function startMessageConsumer(): Promise<void> {
  const queue = await getMessageQueue();
  queue.process(async (job) => {
    let outgoing: Outgoing[];
    try {
      outgoing = await botService.handle(job);
    } catch (err) {
      // Sem isto o erro só ia para o log e o paciente ficava sem resposta.
      logger.error({ err, messageId: job.messageId }, 'Erro no fluxo do bot — encaminhando para a recepção');
      outgoing = await botService.handleFailure(job);
    }
    for (const o of outgoing) {
      if (o.kind === 'buttons') {
        await whatsappService.sendButtons(job.phone, o.text, o.buttons);
      } else {
        await whatsappService.sendText(job.phone, o.text);
      }
    }
  });
  logger.info({ backend: queue.backend }, 'Consumer de mensagens iniciado');
}
