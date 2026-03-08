import { createClient, type RedisClientType } from 'redis';
import { log } from '../utils/logger.js';

export interface RoomStateRecord {
  roomId: string;
  phase: string;
  players: number;
  shardId: number;
  updatedAt: string;
}

interface RoomStateRepository {
  backend: 'memory' | 'redis';
  upsert(state: RoomStateRecord): Promise<void>;
  remove(roomId: string): Promise<void>;
  list(): Promise<RoomStateRecord[]>;
}

class MemoryRoomStateRepository implements RoomStateRepository {
  backend: 'memory' = 'memory';
  private readonly rooms = new Map<string, RoomStateRecord>();

  async upsert(state: RoomStateRecord): Promise<void> {
    this.rooms.set(state.roomId, state);
  }

  async remove(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }

  async list(): Promise<RoomStateRecord[]> {
    return [...this.rooms.values()].sort((a, b) => a.roomId.localeCompare(b.roomId));
  }
}

class RedisRoomStateRepository implements RoomStateRepository {
  backend: 'redis' = 'redis';
  private readonly roomsKey = 'heist:room_state:rooms';
  private readonly client: RedisClientType;
  private connected = false;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  private key(roomId: string): string {
    return `heist:room_state:${roomId}`;
  }

  async upsert(state: RoomStateRecord): Promise<void> {
    await this.ensureConnected();
    await this.client.sAdd(this.roomsKey, state.roomId);
    await this.client.hSet(this.key(state.roomId), {
      roomId: state.roomId,
      phase: state.phase,
      players: String(state.players),
      shardId: String(state.shardId),
      updatedAt: state.updatedAt,
    });
  }

  async remove(roomId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.sRem(this.roomsKey, roomId);
    await this.client.del(this.key(roomId));
  }

  async list(): Promise<RoomStateRecord[]> {
    await this.ensureConnected();
    const roomIds = await this.client.sMembers(this.roomsKey);
    const out: RoomStateRecord[] = [];

    for (const roomId of roomIds) {
      const data = await this.client.hGetAll(this.key(roomId));
      if (!data.roomId) continue;
      out.push({
        roomId: data.roomId,
        phase: data.phase || 'unknown',
        players: parseInt(data.players || '0', 10),
        shardId: parseInt(data.shardId || '0', 10),
        updatedAt: data.updatedAt || new Date(0).toISOString(),
      });
    }

    return out.sort((a, b) => a.roomId.localeCompare(b.roomId));
  }
}

function createRoomStateRepository(): RoomStateRepository {
  const preferred = (process.env.STATE_STORE_BACKEND || 'memory').toLowerCase();
  const redisUrl = process.env.REDIS_URL;

  if (preferred === 'redis' && redisUrl) {
    log('StateStore', 'Using redis room-state repository');
    return new RedisRoomStateRepository(redisUrl);
  }

  if (preferred === 'redis' && !redisUrl) {
    log('StateStore', 'STATE_STORE_BACKEND=redis but REDIS_URL missing. Falling back to memory.');
  } else {
    log('StateStore', 'Using memory room-state repository');
  }
  return new MemoryRoomStateRepository();
}

export const roomStateRepository = createRoomStateRepository();

