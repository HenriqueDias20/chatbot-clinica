import { io, type Socket } from 'socket.io-client';
import { API_URL, auth } from './api';

// O backend só aceita o tempo real de quem está logado: quem abre a conexão é o
// AuthProvider, depois do login. O token é lido a cada tentativa de conexão.
export const socket: Socket = io(API_URL, {
  path: '/socket.io',
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => cb({ token: auth.getToken() }),
});
