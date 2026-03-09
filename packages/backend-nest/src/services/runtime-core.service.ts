import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RoomManager, type StateConsistencyReport } from '../core/rooms/RoomManager.js';
import { metricsRegistry } from '../core/observability/MetricsRegistry.js';

@Injectable()
export class RuntimeCoreService implements OnModuleDestroy {
  private readonly logger = new Logger(RuntimeCoreService.name);
  private roomManager: RoomManager | null = null;
  private consistencyTimer: NodeJS.Timeout | null = null;
  private readonly consistencyCheckIntervalMs = parseInt(
    process.env.CONSISTENCY_CHECK_INTERVAL_MS || '30000',
    10,
  );

  setRoomManager(roomManager: RoomManager): void {
    // 게이트웨이 초기화 시 생성한 단일 RoomManager를 런타임 코어에 등록한다.
    // Ops/정합성 엔드포인트는 이 참조를 기준으로 실제 런타임 상태를 조회한다.
    this.roomManager = roomManager;
    this.ensureConsistencyTimer();
  }

  getRoomManager(): RoomManager | null {
    return this.roomManager;
  }

  async buildConsistencyReport(): Promise<StateConsistencyReport> {
    if (!this.roomManager) {
      // 아직 소켓 게이트웨이가 초기화되지 않은 시점의 안전한 기본 응답.
      return {
        checkedAt: new Date().toISOString(),
        ok: false,
        runtimeRooms: 0,
        repositoryRooms: 0,
        missingInRepository: [],
        staleInRepository: [],
        mismatched: [],
      };
    }
    const report = await this.roomManager.buildStateConsistencyReport();
    metricsRegistry.recordConsistencyResult(report.ok);
    return report;
  }

  private ensureConsistencyTimer(): void {
    if (this.consistencyTimer || !this.roomManager) return;
    // Nest 런타임에서도 정합성 점검을 주기적으로 갱신해 risk gate 판단 근거를 유지한다.
    this.consistencyTimer = setInterval(async () => {
      if (!this.roomManager) return;
      try {
        const report = await this.roomManager.buildStateConsistencyReport();
        metricsRegistry.recordConsistencyResult(report.ok);
      } catch (err) {
        this.logger.warn(`Periodic consistency check failed: ${String(err)}`);
        metricsRegistry.recordConsistencyResult(false);
      }
    }, Math.max(1000, this.consistencyCheckIntervalMs));
    this.consistencyTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.consistencyTimer) {
      clearInterval(this.consistencyTimer);
      this.consistencyTimer = null;
    }
  }
}
