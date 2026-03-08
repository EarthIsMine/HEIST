import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RoomLifecycleService } from '../services/room-lifecycle.service';
import { getNestTrafficDecision } from '../domain/traffic-canary';

@Controller('/_migrate/room')
export class RoomLifecycleController {
  constructor(private readonly roomLifecycle: RoomLifecycleService) {}
  private readonly strictTrafficCanary = process.env.NEST_TRAFFIC_CANARY_STRICT === 'true';

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

    const decision = getNestTrafficDecision(body.roomId);
    // 운영 점검용 HTTP join probe도 소켓 경로와 같은 카나리 게이트를 사용한다.
    if (this.strictTrafficCanary && !decision.allowed) {
      return {
        ok: false,
        error: 'Room is not assigned to Nest by traffic canary policy',
        route: 'legacy',
        canary: decision,
        snapshot: this.roomLifecycle.getSnapshot(),
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
      canary: decision,
      snapshot: this.roomLifecycle.getSnapshot(),
    };
  }

  @Get('/decision')
  decision(@Query('roomId') roomId?: string) {
    if (!roomId) {
      return {
        ok: false,
        error: 'roomId is required',
      };
    }
    // 트래픽 전환 전/후에 roomId별 라우팅 판정을 운영에서 즉시 검증할 수 있다.
    const decision = getNestTrafficDecision(roomId);
    return {
      ok: true,
      strict: this.strictTrafficCanary,
      decision,
    };
  }

  @Get('/snapshot')
  snapshot() {
    return this.roomLifecycle.getSnapshot();
  }
}
