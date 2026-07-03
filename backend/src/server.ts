import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startMessageConsumer } from './bot/consumer.js';
import { startCronJobs } from './bot/scheduler.js';
import { initSocket } from './websocket/io.js';

const app = buildApp();

async function start(): Promise<void> {
  try {
    await startMessageConsumer();
    startCronJobs();
    await app.ready();
    initSocket(app.server);
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`Servidor ouvindo em ${address}`);
  } catch (err) {
    app.log.error({ err }, 'Falha ao iniciar o servidor');
    process.exit(1);
  }
}

// Encerramento gracioso.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, 'Encerrando servidor...');
    void app.close().then(() => process.exit(0));
  });
}

void start();
