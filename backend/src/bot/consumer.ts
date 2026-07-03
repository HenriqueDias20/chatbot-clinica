import { getMessageQueue } from '../services/queue.service.js';
import { botService } from '../services/bot.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { logger } from '../lib/logger.js';

/**
 * Inicia o consumidor da fila: para cada mensagem recebida, roda o fluxo do bot
 * e envia as respostas via WhatsApp.
 */
export async function startMessageConsumer(): Promise<void> {
  const queue = await getMessageQueue();
  queue.process(async (job) => {
    const outgoing = await botService.handle(job);
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
