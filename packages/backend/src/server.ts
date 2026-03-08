import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@heist/shared';
import { metricsRegistry } from './observability/MetricsRegistry.js';
import { roomStateRepository } from './state/RoomStateRepository.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const httpServer = createServer(app);

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // L7 헬스체크: 과부하 시 degraded를 반환해 상위 시스템이 감지할 수 있게 한다.
  app.get('/health', (_req, res) => {
    res.json({
      status: metricsRegistry.isOverloaded() ? 'degraded' : 'ok',
    });
  });

  // 운영 수집기에서 폴링할 수 있도록 JSON 형태로 메트릭을 노출한다.
  app.get('/_metrics', (_req, res) => {
    res.json(metricsRegistry.getSnapshot());
  });

  // Stage4: 외부 상태 저장소에 기록된 active room 메타상태를 조회한다.
  app.get('/_state/rooms', async (_req, res) => {
    const rooms = await roomStateRepository.list();
    res.json({
      backend: roomStateRepository.backend,
      count: rooms.length,
      rooms,
    });
  });

  return { app, httpServer, io };
}
