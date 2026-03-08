import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RoomManager } from '../../../backend/src/rooms/RoomManager.js';
import { RuntimeCoreService } from '../services/runtime-core.service';
import { getNestTrafficDecision } from '../domain/traffic-canary';

type JoinRoomPayload = {
  name: string;
  walletAddress: string;
  requestId?: string;
};

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  transports: ['websocket', 'polling'],
})
export class HeistGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(HeistGateway.name);
  private roomManager: RoomManager | null = null;
  private readonly minPlayers = parseInt(process.env.MIN_PLAYERS || '1', 10);
  private readonly strictTrafficCanary = process.env.NEST_TRAFFIC_CANARY_STRICT === 'true';

  @WebSocketServer()
  server!: Server;

  constructor(private readonly runtimeCore: RuntimeCoreService) {}

  afterInit(server: Server): void {
    // 4단계 완성: Nest Gateway에서 기존 RoomManager/GameLoop를 직접 사용한다.
    // 이렇게 하면 스킬/물리/틱/스냅샷 브로드캐스트가 legacy와 동일하게 동작한다.
    this.roomManager = new RoomManager(server as any, this.minPlayers);
    this.runtimeCore.setRoomManager(this.roomManager);
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    const manager = this.roomManager;
    if (!manager) return;

    client.on('list_rooms', (ack) => {
      ack(manager.listRooms());
    });

    client.on('join_room', (roomId: string, payload: JoinRoomPayload, ack) => {
      // 6단계: strict 모드에서는 카나리 비대상 룸을 Nest에서 받지 않고 legacy 라우팅을 유도한다.
      const decision = getNestTrafficDecision(roomId);
      if (this.strictTrafficCanary && !decision.allowed) {
        ack({
          ok: false,
          error: 'Room is not assigned to Nest by traffic canary policy',
          retryAfterSec: 1,
          route: 'legacy',
          canary: decision,
        });
        return;
      }
      manager.handleJoinRoom(client as any, roomId, payload as any, ack);
    });

    client.on('confirm_entry', (txSignature: string, ack) => {
      manager.handleConfirmEntry(client as any, txSignature, ack);
    });

    client.on('select_team', (team: 'cop' | 'thief', ack) => {
      const result = manager.handleSelectTeam(client as any, team);
      ack(result);
    });

    client.on('ready', () => {
      manager.handleReady(client as any);
    });

    client.on('input_move', (direction: { x: number; y: number }) => {
      manager.handleInputMove(client as any, direction);
    });

    client.on('request_steal', (storageId: string) => {
      manager.handleRequestSkill(client as any, 'steal', storageId);
    });

    client.on('request_break_jail', () => {
      manager.handleRequestSkill(client as any, 'break_jail');
    });

    client.on('request_arrest', (targetId: string) => {
      manager.handleRequestSkill(client as any, 'arrest', targetId);
    });

    client.on('request_disguise', () => {
      manager.handleRequestSkill(client as any, 'disguise');
    });

    client.on('request_build_wall', () => {
      manager.handleRequestSkill(client as any, 'build_wall');
    });

    client.on('cancel_skill', () => {
      manager.handleCancelSkill(client as any);
    });

    client.on('disconnect', () => {
      manager.handleDisconnect(client as any);
      this.logger.log(`Client disconnected: ${client.id}`);
    });
  }

  handleDisconnect(_client: Socket): void {
    // 실제 disconnect 처리/정리는 connection 핸들러 내 socket.on('disconnect')에서 수행한다.
  }

  onModuleDestroy(): void {
    if (this.roomManager) {
      this.roomManager.abortAllGames('Nest gateway is shutting down');
    }
  }
}
