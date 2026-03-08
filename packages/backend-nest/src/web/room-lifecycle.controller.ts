import { Body, Controller, Get, Post } from '@nestjs/common';
import { RoomLifecycleService } from '../services/room-lifecycle.service';

@Controller('/_migrate/room')
export class RoomLifecycleController {
  constructor(private readonly roomLifecycle: RoomLifecycleService) {}

  @Post('/join')
  join(
    @Body() body: { roomId?: string; walletAddress?: string; requestId?: string },
  ) {
    if (!body?.roomId || !body?.walletAddress) {
      return {
        ok: false,
        error: 'roomId and walletAddress are required',
      };
    }

    const result = this.roomLifecycle.joinRoom({
      socketId: `http:${body.walletAddress}`,
      roomId: body.roomId,
      name: 'http-probe',
      walletAddress: body.walletAddress,
      requestId: body.requestId,
    });
    return {
      ...result,
      snapshot: this.roomLifecycle.getSnapshot(),
    };
  }

  @Get('/snapshot')
  snapshot() {
    return this.roomLifecycle.getSnapshot();
  }
}
