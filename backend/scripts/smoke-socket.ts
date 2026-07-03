import { createServer } from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { initSocket } from '../src/websocket/io.js';
import { bus } from '../src/lib/events.js';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
}

function waitFor<T>(fn: (resolve: (v: T) => void) => void, ms = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fn((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

async function main(): Promise<void> {
  const httpServer = createServer();
  const ioServer = initSocket(httpServer);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const client = ioClient(`http://localhost:${port}`, { path: '/socket.io', transports: ['websocket'] });
  await waitFor<void>((resolve) => client.on('connect', () => resolve()));
  check('Cliente conectou ao Socket.io', client.connected);

  // message:new
  const msg = await waitFor<Record<string, unknown>>((resolve) => {
    client.once('message:new', (p: Record<string, unknown>) => resolve(p));
    bus.emit('message:new', {
      conversationId: 'c1',
      patientId: 'p1',
      phone: '5511999999999',
      role: 'user',
      content: 'Olá',
      at: new Date().toISOString(),
    });
  });
  check('Recebe message:new', msg.conversationId === 'c1' && msg.content === 'Olá', msg);

  // conversation:status
  const status = await waitFor<Record<string, unknown>>((resolve) => {
    client.once('conversation:status', (p: Record<string, unknown>) => resolve(p));
    bus.emit('conversation:status', { conversationId: 'c1', patientId: 'p1', status: 'human' });
  });
  check('Recebe conversation:status (human)', status.status === 'human', status);

  // appointment:created
  const appt = await waitFor<Record<string, unknown>>((resolve) => {
    client.once('appointment:created', (p: Record<string, unknown>) => resolve(p));
    bus.emit('appointment:created', {
      appointmentId: 'a1',
      patientId: 'p1',
      professionalId: 'prof1',
      scheduledAt: new Date().toISOString(),
    });
  });
  check('Recebe appointment:created', appt.appointmentId === 'a1', appt);

  // appointment:cancelled
  const cancel = await waitFor<Record<string, unknown>>((resolve) => {
    client.once('appointment:cancelled', (p: Record<string, unknown>) => resolve(p));
    bus.emit('appointment:cancelled', { appointmentId: 'a1', patientId: 'p1' });
  });
  check('Recebe appointment:cancelled', cancel.appointmentId === 'a1', cancel);

  client.close();
  await ioServer.close();
  httpServer.close();
}

main()
  .catch((err) => {
    console.error('Erro no smoke socket:', err);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM ✅' : `\n${failures} TESTE(S) FALHARAM ❌`);
    process.exit(failures === 0 ? 0 : 1);
  });
