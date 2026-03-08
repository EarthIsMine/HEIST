import { Body, Controller, Get, Post } from '@nestjs/common';
import { metricsRegistry } from '../../../backend/src/observability/MetricsRegistry.js';
import { roomStateRepository } from '../../../backend/src/state/RoomStateRepository.js';
import { RuntimeCoreService } from '../services/runtime-core.service';

@Controller()
export class OpsController {
  constructor(private readonly runtimeCore: RuntimeCoreService) {}

  @Get('/_metrics')
  async getMetrics() {
    // legacy 프록시를 거치지 않고 Nest 프로세스가 누적한 메트릭 스냅샷을 직접 노출한다.
    return metricsRegistry.getSnapshot();
  }

  @Get('/_state/consistency')
  async getConsistency() {
    // 5단계: Nest 런타임의 RoomManager 상태 기준으로 정합성 리포트를 생성한다.
    const report = await this.runtimeCore.buildConsistencyReport();
    return report;
  }

  @Get('/_state/rooms')
  async getStateRooms() {
    // 외부 상태 저장소(memory/redis) 어댑터 공통 조회 경로.
    const rooms = await roomStateRepository.list();
    return {
      backend: roomStateRepository.backend,
      count: rooms.length,
      rooms,
    };
  }

  @Post('/_state/recovery-drill')
  async postRecoveryDrill(@Body() body: { rtoSec?: number; rpoEvents?: number }) {
    // 운영 리허설 결과를 메트릭에 반영해 대시보드/알람 기준으로 재사용한다.
    const rtoSec = Number(body?.rtoSec);
    const rpoEvents = Number(body?.rpoEvents);
    if (!Number.isFinite(rtoSec) || !Number.isFinite(rpoEvents)) {
      return {
        ok: false,
        error: 'rtoSec and rpoEvents must be numbers',
        migrationPhase: 'phase-2-ops-endpoints',
      };
    }
    metricsRegistry.recordRecoveryDrill(rtoSec, rpoEvents);
    return {
      ok: true,
      rtoSec,
      rpoEvents,
    };
  }
}
