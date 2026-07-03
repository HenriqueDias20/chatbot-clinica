import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';

export const socket: Socket = io(API_URL, {
  path: '/socket.io',
  autoConnect: true,
  transports: ['websocket', 'polling'],
});
