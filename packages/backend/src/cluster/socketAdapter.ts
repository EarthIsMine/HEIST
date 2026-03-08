import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@heist/shared';
import { log } from '../utils/logger.js';

type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export async function setupSocketAdapter(io: TypedIO): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // 로컬/단일 노드 환경에서는 기본 메모리 adapter로 동작한다.
    log('SocketAdapter', 'REDIS_URL not set. Running in single-node adapter mode.');
    return;
  }

  // pub/sub 두 커넥션을 분리해 cross-node room 이벤트를 전달한다.
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    log('SocketAdapter', 'Redis adapter enabled');
  } catch (err) {
    // Redis 연결 실패 시 서버 자체는 계속 기동해 단일 노드 모드로 폴백한다.
    log('SocketAdapter', `Failed to enable Redis adapter: ${err}`);
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
  }
}
