import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  Vec2,
  Team,
} from '@heist/shared';
import type { RoomInfo } from '@heist/shared';

import { Room } from './Room.js';
import { log } from '../utils/logger.js';
import { metricsRegistry } from '../observability/MetricsRegistry.js';
import { isRoomOwnedByThisNode } from '../cluster/affinity.js';
import { isStage2EnabledForRoom } from '../cluster/canary.js';
import { buildSuggestedRoomId, getShardId } from '../cluster/sharding.js';
import { roomStateRepository, type RoomStateRecord } from '../state/RoomStateRepository.js';
import { isStage4EnabledForRoom } from '../cluster/stage4Canary.js';

type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
const ADMISSION_CONTROL = process.env.ENABLE_OVERLOAD_ADMISSION_CONTROL === 'true';
const OVERLOAD_RETRY_AFTER_SEC = parseInt(process.env.OVERLOAD_RETRY_AFTER_SEC || '5', 10);
const SHARD_COUNT = parseInt(process.env.SHARD_COUNT || '16', 10);
const MAX_ACTIVE_ROOMS = parseInt(process.env.MAX_ACTIVE_ROOMS || '200', 10);
const MAX_ROOMS_PER_SHARD = parseInt(process.env.MAX_ROOMS_PER_SHARD || '25', 10);
const ENABLE_HOT_SHARD_SUGGESTION = process.env.ENABLE_HOT_SHARD_SUGGESTION !== 'false';
const ENABLE_NODE_DRAIN = process.env.ENABLE_NODE_DRAIN === 'true';
const DRAIN_ALLOW_EXISTING_ROOM_JOIN = process.env.DRAIN_ALLOW_EXISTING_ROOM_JOIN !== 'false';
const JOIN_IDEMPOTENCY_TTL_MS = parseInt(process.env.JOIN_IDEMPOTENCY_TTL_MS || '30000', 10);

type JoinAckResult = { ok: boolean; error?: string; retryAfterSec?: number; suggestedRoomId?: string };

export interface StateConsistencyReport {
  checkedAt: string;
  ok: boolean;
  runtimeRooms: number;
  repositoryRooms: number;
  missingInRepository: string[];
  staleInRepository: string[];
  mismatched: Array<{
    roomId: string;
    runtime: { phase: string; players: number; shardId: number };
    repository: { phase: string; players: number; shardId: number };
  }>;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRoomMap: Map<string, string> = new Map(); // socketId -> roomId
  private roomShardMap: Map<string, number> = new Map(); // roomId -> shardId
  private shardRoomCount: Map<number, number> = new Map(); // shardId -> active rooms
  // Stage4: roomId를 파티션 키로 사용해 룸 단위 이벤트를 직렬 처리한다.
  private roomOpQueue: Map<string, Promise<void>> = new Map();
  // 같은 requestId 재전송 시 동일 응답을 돌려주기 위한 단기 캐시
  private joinIdempotencyCache: Map<string, { result: JoinAckResult; expiresAt: number }> = new Map();
  private io: TypedIO;
  private minPlayers: number;

  constructor(io: TypedIO, minPlayers: number) {
    this.io = io;
    this.minPlayers = minPlayers;
    this.syncShardMetrics();
  }

  handleJoinRoom(
    socket: TypedSocket,
    roomId: string,
    payload: { name: string; walletAddress: string; requestId?: string },
    ack: (result: JoinAckResult) => void,
  ): void {
    metricsRegistry.recordJoinRequest();
    this.pruneJoinIdempotencyCache();
    const stage4EnabledForRoom = isStage4EnabledForRoom(roomId);
    const idemKey = payload.requestId
      ? stage4EnabledForRoom
        ? `${payload.walletAddress}:${roomId}:${payload.requestId}`
        : null
      : null;
    if (idemKey) {
      const cached = this.joinIdempotencyCache.get(idemKey);
      if (cached && cached.expiresAt > Date.now()) {
        metricsRegistry.recordJoinIdempotencyHit();
        ack(cached.result);
        return;
      }
    }

    // 카나리 모드에서는 일부 roomId에만 Stage2(affinity) 정책을 적용한다.
    const stage2EnabledForRoom = isStage2EnabledForRoom(roomId);
    const shardId = getShardId(roomId, SHARD_COUNT);
    let room = this.rooms.get(roomId);

    // Stage3 drain 모드: 노드 비우기 동안 신규 룸 생성은 차단한다.
    // 옵션에 따라 기존 룸 재참여도 막아 rebalance를 더 빠르게 만들 수 있다.
    if (ENABLE_NODE_DRAIN && (!room || !DRAIN_ALLOW_EXISTING_ROOM_JOIN)) {
      metricsRegistry.recordJoinFailure();
      this.replyJoinAck(idemKey, ack, {
        ok: false,
        error: 'Node is draining. Please retry shortly.',
        retryAfterSec: OVERLOAD_RETRY_AFTER_SEC,
      });
      return;
    }

    if (stage2EnabledForRoom && !isRoomOwnedByThisNode(roomId)) {
      metricsRegistry.recordJoinFailure();
      this.replyJoinAck(idemKey, ack, {
        ok: false,
        error: 'Room is assigned to another node. Please retry.',
        retryAfterSec: 1,
      });
      return;
    }

    if (!room) {
      // Stage3: 노드 전체 룸 상한을 넘기면 신규 룸 생성을 거절한다.
      if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
        metricsRegistry.recordJoinFailure();
        this.replyJoinAck(idemKey, ack, {
          ok: false,
          error: `Server room capacity reached (${MAX_ACTIVE_ROOMS})`,
          retryAfterSec: OVERLOAD_RETRY_AFTER_SEC,
        });
        return;
      }

      // Stage3: 샤드별 룸 상한을 두어 핫샤드 과부하를 완화한다.
      const roomsInShard = this.shardRoomCount.get(shardId) || 0;
      if (roomsInShard >= MAX_ROOMS_PER_SHARD) {
        metricsRegistry.recordJoinFailure();
        const suggestedRoomId = ENABLE_HOT_SHARD_SUGGESTION
          ? buildSuggestedRoomId(this.findCoolestShard())
          : undefined;
        this.replyJoinAck(idemKey, ack, {
          ok: false,
          error: `Shard ${shardId} is hot. Please retry with another room id.`,
          retryAfterSec: 1,
          suggestedRoomId,
        });
        return;
      }

      // 과부하 상태에서는 신규 룸 생성만 차단해 이벤트루프 악화를 완화한다.
      if (ADMISSION_CONTROL && metricsRegistry.isOverloaded()) {
        metricsRegistry.recordJoinFailure();
        this.replyJoinAck(idemKey, ack, {
          ok: false,
          error: 'Server overloaded. Please retry in a few seconds.',
          retryAfterSec: OVERLOAD_RETRY_AFTER_SEC,
        });
        return;
      }

      room = new Room(roomId, `Room ${roomId.slice(0, 6)}`, this.io, this.minPlayers);
      room.onCleanup = (playerIds) => {
        for (const pid of playerIds) {
          this.playerRoomMap.delete(pid);
        }
        this.unregisterRoom(roomId);
        log('RoomManager', `Room ${roomId} removed after game ended`);
      };
      this.registerRoom(roomId, room, shardId);
      log('RoomManager', `Created room ${roomId}`);
    }

    // Kick stale socket if same wallet is already in a room (reconnection)
    for (const [rid, r] of this.rooms) {
      for (const [oldSocketId, p] of r.players) {
        if (p.walletAddress === payload.walletAddress) {
          // Same socket re-joining the same room — just ack OK
          if (oldSocketId === socket.id && rid === roomId) {
            metricsRegistry.recordJoinSuccess(payload.walletAddress);
            this.replyJoinAck(idemKey, ack, { ok: true });
            return;
          }
          if (r.phase !== 'filling') {
            metricsRegistry.recordJoinFailure();
            this.replyJoinAck(idemKey, ack, { ok: false, error: 'This wallet is already in an active game' });
            return;
          }
          log('RoomManager', `Kicking stale session ${oldSocketId} for wallet ${payload.walletAddress}`);
          r.removePlayer(oldSocketId);
          this.playerRoomMap.delete(oldSocketId);
          const oldSocket = this.io.sockets.sockets.get(oldSocketId);
          if (oldSocket && oldSocketId !== socket.id) {
            oldSocket.emit('kicked', 'Same wallet connected from another session');
            oldSocket.leave(rid);
            oldSocket.disconnect(true);
          }
          if (r.isEmpty) {
            this.unregisterRoom(rid);
          }
          break;
        }
      }
    }

    socket.join(roomId);

    const success = room.addPlayer(socket.id, payload.name, payload.walletAddress);
    if (!success) {
      socket.leave(roomId);
      metricsRegistry.recordJoinFailure();
      this.replyJoinAck(idemKey, ack, { ok: false, error: 'Room is full or game in progress' });
      return;
    }

    socket.data.roomId = roomId;
    socket.data.playerId = socket.id;
    socket.data.walletAddress = payload.walletAddress;
    this.playerRoomMap.set(socket.id, roomId);

    log('RoomManager', `Player ${payload.name} joined room ${roomId}`);
    metricsRegistry.recordJoinSuccess(payload.walletAddress);
    this.persistRoomState(roomId);
    this.replyJoinAck(idemKey, ack, { ok: true });
  }

  handleConfirmEntry(
    socket: TypedSocket,
    txSignature: string,
    ack: (result: { ok: boolean; error?: string }) => void,
  ): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) {
      ack({ ok: false, error: 'Not in a room' });
      return;
    }

    // MVP: Trust the signature without on-chain verification
    const success = room.confirmEntry(socket.id);
    if (success) {
      log('RoomManager', `Entry confirmed for ${socket.id} with tx ${txSignature}`);
      ack({ ok: true });
    } else {
      ack({ ok: false, error: 'Failed to confirm entry' });
    }
  }

  handleSelectTeam(socket: TypedSocket, team: Team): { ok: boolean; error?: string } {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return { ok: false, error: 'Not in a room' };
    const result = room.selectTeam(socket.id, team);
    if (result.ok) {
      log('RoomManager', `Player ${socket.id} selected team: ${team}`);
    }
    return result;
  }

  handleReady(socket: TypedSocket): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;
    if (!isStage4EnabledForRoom(room.id)) {
      room.setReady(socket.id);
      log('RoomManager', `Player ${socket.id} is ready in room ${room.id}`);
      return;
    }
    this.enqueueRoomOperation(room.id, 'ready', () => {
      room.setReady(socket.id);
      log('RoomManager', `Player ${socket.id} is ready in room ${room.id}`);
    });
  }

  handleInputMove(socket: TypedSocket, direction: Vec2): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;
    if (!isStage4EnabledForRoom(room.id)) {
      room.handleInputMove(socket.id, direction);
      return;
    }
    this.enqueueRoomOperation(room.id, 'input_move', () => {
      room.handleInputMove(socket.id, direction);
    });
  }

  handleRequestSkill(socket: TypedSocket, skill: string, targetId?: string): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;
    if (!isStage4EnabledForRoom(room.id)) {
      room.handleRequestSkill(socket.id, skill, targetId);
      return;
    }
    this.enqueueRoomOperation(room.id, 'request_skill', () => {
      room.handleRequestSkill(socket.id, skill, targetId);
    });
  }

  handleCancelSkill(socket: TypedSocket): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;
    if (!isStage4EnabledForRoom(room.id)) {
      room.handleCancelSkill(socket.id);
      return;
    }
    this.enqueueRoomOperation(room.id, 'cancel_skill', () => {
      room.handleCancelSkill(socket.id);
    });
  }

  handleDisconnect(socket: TypedSocket): void {
    metricsRegistry.recordDisconnect(socket.data.walletAddress);
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    if (!isStage4EnabledForRoom(room.id)) {
      room.removePlayer(socket.id);
      this.playerRoomMap.delete(socket.id);

      if (room.isEmpty) {
        this.unregisterRoom(room.id);
        log('RoomManager', `Room ${room.id} deleted (empty)`);
      } else {
        this.persistRoomState(room.id);
      }
      return;
    }

    this.enqueueRoomOperation(room.id, 'disconnect', () => {
      room.removePlayer(socket.id);
      this.playerRoomMap.delete(socket.id);

      if (room.isEmpty) {
        this.unregisterRoom(room.id);
        log('RoomManager', `Room ${room.id} deleted (empty)`);
      } else {
        this.persistRoomState(room.id);
      }
    });
  }

  abortAllGames(reason: string): void {
    for (const room of this.rooms.values()) {
      room.abort(reason);
    }
  }

  listRooms(): RoomInfo[] {
    return [...this.rooms.values()]
      .filter((r) => r.phase === 'filling')
      .map((r) => r.toRoomInfo());
  }

  private getPlayerRoom(socketId: string): Room | undefined {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  // 룸 등록/해제 시 샤드 로드를 함께 업데이트해 운영 메트릭과 admission 판단에 사용한다.
  private registerRoom(roomId: string, room: Room, shardId: number): void {
    this.rooms.set(roomId, room);
    this.roomShardMap.set(roomId, shardId);
    this.shardRoomCount.set(shardId, (this.shardRoomCount.get(shardId) || 0) + 1);
    this.syncShardMetrics();
    this.persistRoomState(roomId);
  }

  private unregisterRoom(roomId: string): void {
    if (!this.rooms.has(roomId)) return;
    this.rooms.delete(roomId);
    const shardId = this.roomShardMap.get(roomId);
    if (shardId !== undefined) {
      const next = Math.max(0, (this.shardRoomCount.get(shardId) || 0) - 1);
      if (next === 0) this.shardRoomCount.delete(shardId);
      else this.shardRoomCount.set(shardId, next);
      this.roomShardMap.delete(roomId);
    }
    this.syncShardMetrics();
    // 외부 상태 저장소에서도 룸 엔트리를 제거해 stale 데이터를 방지한다.
    void roomStateRepository.remove(roomId).catch((err) => {
      log('StateStore', `Failed to remove room state ${roomId}: ${err}`);
    });
  }

  private syncShardMetrics(): void {
    metricsRegistry.updateShardSnapshot(SHARD_COUNT, this.shardRoomCount);
  }

  private findCoolestShard(): number {
    let coolestShard = 0;
    let minRooms = Number.MAX_SAFE_INTEGER;

    for (let shard = 0; shard < Math.max(1, SHARD_COUNT); shard += 1) {
      const count = this.shardRoomCount.get(shard) || 0;
      if (count < minRooms) {
        minRooms = count;
        coolestShard = shard;
      }
    }

    return coolestShard;
  }

  private enqueueRoomOperation(roomId: string, op: string, fn: () => void): void {
    const prev = this.roomOpQueue.get(roomId) || Promise.resolve();
    const next = prev
      .then(() => {
        fn();
      })
      .catch((err) => {
        log('RoomManager', `Queued op failed (${op}) room=${roomId}: ${err}`);
      })
      .finally(() => {
        if (this.roomOpQueue.get(roomId) === next) {
          this.roomOpQueue.delete(roomId);
        }
      });
    this.roomOpQueue.set(roomId, next);
  }

  private replyJoinAck(idemKey: string | null, ack: (result: JoinAckResult) => void, result: JoinAckResult): void {
    if (idemKey) {
      this.joinIdempotencyCache.set(idemKey, {
        result,
        expiresAt: Date.now() + JOIN_IDEMPOTENCY_TTL_MS,
      });
    }
    ack(result);
  }

  private pruneJoinIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.joinIdempotencyCache.entries()) {
      if (entry.expiresAt <= now) {
        this.joinIdempotencyCache.delete(key);
      }
    }
  }

  private persistRoomState(roomId: string): void {
    if (!isStage4EnabledForRoom(roomId)) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const shardId = this.roomShardMap.get(roomId) ?? 0;

    // 게임 상태의 authoritative 데이터는 메모리에 두고, 운영 복구용 메타상태만 외부 저장한다.
    void roomStateRepository
      .upsert({
        roomId,
        phase: room.phase,
        players: room.players.size,
        shardId,
        updatedAt: new Date().toISOString(),
      })
      .catch((err) => {
        log('StateStore', `Failed to upsert room state ${roomId}: ${err}`);
      });
  }

  // 운영 점검용: 메모리 authoritative 상태와 외부 저장소 상태의 차이를 계산한다.
  async buildStateConsistencyReport(): Promise<StateConsistencyReport> {
    const repositoryRooms = await roomStateRepository.list();
    const repositoryMap = new Map<string, RoomStateRecord>();
    for (const rec of repositoryRooms) {
      repositoryMap.set(rec.roomId, rec);
    }

    const missingInRepository: string[] = [];
    const staleInRepository: string[] = [];
    const mismatched: StateConsistencyReport['mismatched'] = [];

    for (const [roomId, room] of this.rooms.entries()) {
      if (!isStage4EnabledForRoom(roomId)) continue;
      const repo = repositoryMap.get(roomId);
      if (!repo) {
        missingInRepository.push(roomId);
        continue;
      }

      const runtime = {
        phase: room.phase,
        players: room.players.size,
        shardId: this.roomShardMap.get(roomId) ?? 0,
      };
      const repository = {
        phase: repo.phase,
        players: repo.players,
        shardId: repo.shardId,
      };
      if (
        runtime.phase !== repository.phase ||
        runtime.players !== repository.players ||
        runtime.shardId !== repository.shardId
      ) {
        mismatched.push({ roomId, runtime, repository });
      }
    }

    for (const roomId of repositoryMap.keys()) {
      if (!isStage4EnabledForRoom(roomId) || !this.rooms.has(roomId)) {
        staleInRepository.push(roomId);
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      ok: missingInRepository.length === 0 && staleInRepository.length === 0 && mismatched.length === 0,
      runtimeRooms: this.rooms.size,
      repositoryRooms: repositoryRooms.length,
      missingInRepository,
      staleInRepository,
      mismatched,
    };
  }
}
