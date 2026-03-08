import { Injectable } from '@nestjs/common';
import {
  COP_COUNT,
  ENTRY_FEE_LAMPORTS,
  MAX_PLAYERS,
  THIEF_COUNT,
  type RoomInfo,
  type RoomPlayer,
  type Team,
} from '@heist/shared';
import { buildSuggestedRoomId, getShardId } from '../domain/room-policy';

type JoinResult = {
  ok: boolean;
  error?: string;
  retryAfterSec?: number;
  suggestedRoomId?: string;
};

type AckResult = {
  ok: boolean;
  error?: string;
};

type RoomState = {
  id: string;
  name: string;
  phase: 'filling' | 'playing' | 'ended';
  players: Map<string, RoomPlayer>;
  walletToSocketId: Map<string, string>;
  // 이행 단계에서는 최소 입력/스킬 트래킹만 수행하고, 추후 게임 루프 이식으로 확장한다.
  lastInputBySocketId: Map<string, { x: number; y: number }>;
  lastSkillBySocketId: Map<string, { skill: string; targetId?: string; at: number }>;
};

@Injectable()
export class RoomLifecycleService {
  private readonly maxActiveRooms = parseInt(process.env.NEST_MAX_ACTIVE_ROOMS || '200', 10);
  private readonly maxRoomsPerShard = parseInt(process.env.NEST_MAX_ROOMS_PER_SHARD || '25', 10);
  private readonly shardCount = parseInt(process.env.NEST_SHARD_COUNT || '16', 10);
  private readonly joinIdemTtlMs = parseInt(process.env.NEST_JOIN_IDEMPOTENCY_TTL_MS || '30000', 10);

  private readonly rooms = new Map<string, RoomState>();
  private readonly socketToRoomId = new Map<string, string>();
  private readonly shardRooms = new Map<number, number>();
  // roomId 파티션 키 기반 직렬 처리 큐
  private readonly roomOpQueue = new Map<string, Promise<void>>();
  private readonly joinIdemCache = new Map<string, { result: JoinResult; expiresAt: number }>();

  joinRoom(input: {
    socketId: string;
    roomId: string;
    name: string;
    walletAddress: string;
    requestId?: string;
  }): JoinResult {
    this.pruneIdempotency();
    const idemKey = input.requestId ? `${input.walletAddress}:${input.roomId}:${input.requestId}` : null;
    if (idemKey) {
      const cached = this.joinIdemCache.get(idemKey);
      if (cached && cached.expiresAt > Date.now()) return cached.result;
    }

    let room = this.rooms.get(input.roomId);
    const shardId = getShardId(input.roomId, this.shardCount);

    if (!room && this.rooms.size >= this.maxActiveRooms) {
      return this.cacheAndReturn(idemKey, {
        ok: false,
        error: `Nest room capacity reached (${this.maxActiveRooms})`,
        retryAfterSec: 3,
      });
    }

    if (!room) {
      const roomsInShard = this.shardRooms.get(shardId) || 0;
      if (roomsInShard >= this.maxRoomsPerShard) {
        return this.cacheAndReturn(idemKey, {
          ok: false,
          error: `Nest shard ${shardId} is hot`,
          retryAfterSec: 1,
          suggestedRoomId: buildSuggestedRoomId(this.findCoolestShard()),
        });
      }
      room = {
        id: input.roomId,
        name: `Room ${input.roomId.slice(0, 6)}`,
        phase: 'filling',
        players: new Map(),
        walletToSocketId: new Map(),
        lastInputBySocketId: new Map(),
        lastSkillBySocketId: new Map(),
      };
      this.rooms.set(input.roomId, room);
      this.shardRooms.set(shardId, roomsInShard + 1);
    }

    if (room.phase !== 'filling') {
      return this.cacheAndReturn(idemKey, {
        ok: false,
        error: 'Room is already in progress',
      });
    }
    if (room.players.size >= MAX_PLAYERS) {
      return this.cacheAndReturn(idemKey, {
        ok: false,
        error: 'Room is full',
      });
    }

    const prevSocketId = room.walletToSocketId.get(input.walletAddress);
    if (prevSocketId && prevSocketId !== input.socketId) {
      room.players.delete(prevSocketId);
      this.socketToRoomId.delete(prevSocketId);
      room.walletToSocketId.delete(input.walletAddress);
    }

    room.players.set(input.socketId, {
      id: input.socketId,
      name: input.name,
      walletAddress: input.walletAddress,
      ready: false,
      confirmed: ENTRY_FEE_LAMPORTS === 0,
      selectedTeam: 'thief',
    });
    room.walletToSocketId.set(input.walletAddress, input.socketId);
    this.socketToRoomId.set(input.socketId, input.roomId);
    return this.cacheAndReturn(idemKey, { ok: true });
  }

  confirmEntry(socketId: string): AckResult {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return { ok: false, error: 'Not in room' };
    this.enqueueRoomOperation(roomId, () => {
      const player = this.getPlayerBySocket(socketId);
      if (player) player.confirmed = true;
    });
    return { ok: true };
  }

  selectTeam(socketId: string, team: Team): AckResult {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return { ok: false, error: 'Not in room' };
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Not in room' };
    const player = room.players.get(socketId);
    if (!player) return { ok: false, error: 'Not in room' };

    let count = 0;
    for (const [id, p] of room.players.entries()) {
      if (id !== socketId && p.selectedTeam === team) count += 1;
    }
    const limit = team === 'cop' ? COP_COUNT : THIEF_COUNT;
    if (count >= limit) return { ok: false, error: `${team} team is full` };

    this.enqueueRoomOperation(roomId, () => {
      player.selectedTeam = team;
    });
    return { ok: true };
  }

  setReady(socketId: string): void {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return;
    this.enqueueRoomOperation(roomId, () => {
      const player = this.getPlayerBySocket(socketId);
      if (player) player.ready = true;
    });
  }

  applyInput(socketId: string, direction: { x: number; y: number }): void {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.enqueueRoomOperation(roomId, () => {
      room.lastInputBySocketId.set(socketId, direction);
    });
  }

  requestSkill(socketId: string, skill: string, targetId?: string): void {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.enqueueRoomOperation(roomId, () => {
      room.lastSkillBySocketId.set(socketId, {
        skill,
        targetId,
        at: Date.now(),
      });
    });
  }

  cancelSkill(socketId: string): void {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.enqueueRoomOperation(roomId, () => {
      room.lastSkillBySocketId.delete(socketId);
    });
  }

  handleDisconnect(socketId: string): string | null {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    this.socketToRoomId.delete(socketId);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (player) {
      room.walletToSocketId.delete(player.walletAddress);
    }
    room.players.delete(socketId);

    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      const shardId = getShardId(roomId, this.shardCount);
      const next = Math.max(0, (this.shardRooms.get(shardId) || 0) - 1);
      if (next === 0) this.shardRooms.delete(shardId);
      else this.shardRooms.set(shardId, next);
    }

    return roomId;
  }

  listRooms(): RoomInfo[] {
    return [...this.rooms.values()]
      .filter((room) => room.phase === 'filling')
      .map((room) => this.toRoomInfo(room));
  }

  getRoomInfo(roomId: string): RoomInfo | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return this.toRoomInfo(room);
  }

  getSnapshot() {
    return {
      roomCount: this.rooms.size,
      shardCount: this.shardCount,
      shardRooms: [...this.shardRooms.entries()].map(([shardId, rooms]) => ({ shardId, rooms })),
    };
  }

  private toRoomInfo(room: RoomState): RoomInfo {
    return {
      id: room.id,
      name: room.name,
      players: [...room.players.values()],
      maxPlayers: MAX_PLAYERS,
      entryFeeLamports: ENTRY_FEE_LAMPORTS,
    };
  }

  private getPlayerBySocket(socketId: string): RoomPlayer | null {
    const roomId = this.socketToRoomId.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.players.get(socketId) || null;
  }

  private findCoolestShard(): number {
    let coolest = 0;
    let minRooms = Number.MAX_SAFE_INTEGER;
    for (let shard = 0; shard < Math.max(1, this.shardCount); shard += 1) {
      const count = this.shardRooms.get(shard) || 0;
      if (count < minRooms) {
        minRooms = count;
        coolest = shard;
      }
    }
    return coolest;
  }

  private cacheAndReturn(idemKey: string | null, result: JoinResult): JoinResult {
    if (idemKey) {
      this.joinIdemCache.set(idemKey, {
        result,
        expiresAt: Date.now() + this.joinIdemTtlMs,
      });
    }
    return result;
  }

  private pruneIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.joinIdemCache.entries()) {
      if (entry.expiresAt <= now) this.joinIdemCache.delete(key);
    }
  }

  private enqueueRoomOperation(roomId: string, fn: () => void): void {
    const prev = this.roomOpQueue.get(roomId) || Promise.resolve();
    const next = prev
      .then(() => {
        fn();
      })
      .catch(() => {})
      .finally(() => {
        if (this.roomOpQueue.get(roomId) === next) {
          this.roomOpQueue.delete(roomId);
        }
      });
    this.roomOpQueue.set(roomId, next);
  }
}
