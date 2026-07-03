import type { FastifyInstance } from 'fastify';
import { startDemoConversation, clearDemoConversations, SCENARIOS } from '../services/demo.service.js';

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Lista de cenários disponíveis (id + rótulo) para o painel montar o menu.
  app.get('/api/demo/scenarios', async () => {
    return { scenarios: SCENARIOS.map((s) => ({ id: s.id, label: s.label })) };
  });

  // Dispara uma conversa de demonstração (cenário opcional) que aparece em tempo real.
  app.post<{ Body: { scenario?: string } }>('/api/demo/play', async (req) => {
    const { conversationId } = await startDemoConversation(req.body?.scenario);
    return { ok: true, conversationId };
  });

  // Limpa todas as conversas de demonstração.
  app.post('/api/demo/clear', async () => {
    const removed = await clearDemoConversations();
    return { ok: true, removed };
  });
}
