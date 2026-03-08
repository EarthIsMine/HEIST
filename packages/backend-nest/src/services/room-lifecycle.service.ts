import { Injectable } from '@nestjs/common';
import { buildSuggestedRoomId, getShardId } from '../domain/room-policy';

type JoinResult = {
  ok: boolean;
  error?: string;
  retryAfterSec?: number;
  suggestedRoomId?: string;
};

@Injectable()
export class RoomLifecycleService {
  private readonly maxActiveRooms = parseInt(process.env.NEST_MAX_ACTIVE_ROOMS || '200', 10);
  private readonly maxRoomsPerShard = parseInt(process.env.NEST_MAX_ROOMS_PER_SHARD || '25', 10);
  private readonly shardCount = parseInt(process.env.NEST_SHARD_COUNT || '16', 10);
  private readonly joinIdemTtlMs = parseInt(process.env.NEST_JOIN_IDEMPOTENCY_TTL_MS || '30000', 10);

  private readonly rooms = new Map<string, number>();
  private readonly shardRooms = new Map<number, number>();
  private readonly joinIdemCache = new Map<string, { result: JoinResult; expiresAt: number }>();

  // 실제 Socket 이식 전, join 정책을 Nest 서비스로 먼저 포팅하는 중간 단계.
  joinRoom(input: { roomId: string; walletAddress: string; requestId?: string }): JoinResult {
    this.pruneIdempotency();
    const idemKey = input.requestId ? `${input.walletAddress}:${input.roomId}:${input.requestId}` : null;
    if (idemKey) {
      const cached = this.joinIdemCache.get(idemKey);
      if (cached && cached.expiresAt > Date.now()) return cached.result;
    }

    const exists = this.rooms.has(input.roomId);
    const shardId = getShardId(input.roomId, this.shardCount);

    if (!exists && this.rooms.size >= this.maxActiveRooms) {
      return this.cacheAndReturn(idemKey, {
        ok: false,
        error: `Nest room capacity reached (${this.maxActiveRooms})`,
        retryAfterSec: 3,
      });
    }

    if (!exists) {
      const roomsInShard = this.shardRooms.get(shardId) || 0;
      if (roomsInShard >= this.maxRoomsPerShard) {
        return this.cacheAndReturn(idemKey, {
          ok: false,
          error: `Nest shard ${shardId} is hot`,
          retryAfterSec: 1,
          suggestedRoomId: buildSuggestedRoomId(this.findCoolestShard()),
        });
      }
      this.rooms.set(input.roomId, 0);
      this.shardRooms.set(shardId, roomsInShard + 1);
    }

    this.rooms.set(input.roomId, (this.rooms.get(input.roomId) || 0) + 1);
    return this.cacheAndReturn(idemKey, { ok: true });
  }

  getSnapshot() {
    return {
      roomCount: this.rooms.size,
      shardCount: this.shardCount,
      shardRooms: [...this.shardRooms.entries()].map(([shardId, rooms]) => ({ shardId, rooms })),
    };
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
}

