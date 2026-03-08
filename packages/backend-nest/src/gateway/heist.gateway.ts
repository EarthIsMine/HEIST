import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RoomLifecycleService } from '../services/room-lifecycle.service';

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
export class HeistGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(HeistGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly roomLifecycle: RoomLifecycleService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const roomId = this.roomLifecycle.handleDisconnect(client.id);
    if (roomId) {
      const room = this.roomLifecycle.getRoomInfo(roomId);
      if (room) {
        this.server.to(roomId).emit('room_state', room);
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('list_rooms')
  handleListRooms() {
    return this.roomLifecycle.listRooms();
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: [string, JoinRoomPayload],
  ) {
    const [roomId, payload] = body;
    if (!roomId || !payload?.walletAddress) {
      return {
        ok: false,
        error: 'roomId and walletAddress are required',
      };
    }

    const result = this.roomLifecycle.joinRoom({
      socketId: client.id,
      roomId,
      name: payload.name || `Player-${payload.walletAddress.slice(0, 4)}`,
      walletAddress: payload.walletAddress,
      requestId: payload.requestId,
    });
    if (!result.ok) return result;

    client.join(roomId);
    const room = this.roomLifecycle.getRoomInfo(roomId);
    if (room) {
      this.server.to(roomId).emit('room_state', room);
    }
    return result;
  }

  @SubscribeMessage('confirm_entry')
  handleConfirmEntry(@ConnectedSocket() client: Socket) {
    const result = this.roomLifecycle.confirmEntry(client.id);
    const roomId = [...client.rooms].find((r) => r !== client.id);
    if (roomId && result.ok) {
      const room = this.roomLifecycle.getRoomInfo(roomId);
      if (room) this.server.to(roomId).emit('room_state', room);
    }
    return result;
  }

  @SubscribeMessage('select_team')
  handleSelectTeam(@ConnectedSocket() client: Socket, @MessageBody() team: 'cop' | 'thief') {
    const result = this.roomLifecycle.selectTeam(client.id, team);
    const roomId = [...client.rooms].find((r) => r !== client.id);
    if (roomId && result.ok) {
      const room = this.roomLifecycle.getRoomInfo(roomId);
      if (room) this.server.to(roomId).emit('room_state', room);
    }
    return result;
  }

  @SubscribeMessage('ready')
  handleReady(@ConnectedSocket() client: Socket) {
    this.roomLifecycle.setReady(client.id);
    const roomId = [...client.rooms].find((r) => r !== client.id);
    if (roomId) {
      const room = this.roomLifecycle.getRoomInfo(roomId);
      if (room) this.server.to(roomId).emit('room_state', room);
    }
  }

  @SubscribeMessage('input_move')
  handleInputMove() {
    // TODO(stage4): game loop 이식 후 실제 입력 처리 연결
  }

  @SubscribeMessage('request_steal')
  handleRequestSteal() {
    // TODO(stage4): skill engine 이식 후 연결
  }

  @SubscribeMessage('request_break_jail')
  handleRequestBreakJail() {
    // TODO(stage4): skill engine 이식 후 연결
  }

  @SubscribeMessage('request_arrest')
  handleRequestArrest() {
    // TODO(stage4): skill engine 이식 후 연결
  }

  @SubscribeMessage('request_disguise')
  handleRequestDisguise() {
    // TODO(stage4): skill engine 이식 후 연결
  }

  @SubscribeMessage('request_build_wall')
  handleRequestBuildWall() {
    // TODO(stage4): skill engine 이식 후 연결
  }

  @SubscribeMessage('cancel_skill')
  handleCancelSkill() {
    // TODO(stage4): skill engine 이식 후 연결
  }
}
