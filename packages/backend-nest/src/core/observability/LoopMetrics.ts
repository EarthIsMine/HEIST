import { monitorEventLoopDelay } from 'node:perf_hooks';
import { log } from '../utils/logger.js';
import { metricsRegistry } from './MetricsRegistry.js';

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

class RollingWindow {
  private samples: number[] = [];

  constructor(private readonly maxSamples: number) {}

  push(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  summary() {
    if (this.samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0, max: 0 };
    }

    return {
      p50: percentile(this.samples, 50),
      p95: percentile(this.samples, 95),
      p99: percentile(this.samples, 99),
      max: Math.max(...this.samples),
    };
  }
}

export interface TickMetricInput {
  driftMs: number;
  tickDurationMs: number;
  snapshotBuildMs: number;
  emitMs: number;
  playerCount: number;
  overrun: boolean;
}

export class LoopMetrics {
  // 최근 N개 샘플 기준으로 분포를 계산해 순간 스파이크보다 추세를 본다.
  private readonly drift = new RollingWindow(2048);
  private readonly tickDuration = new RollingWindow(2048);
  private readonly snapshotBuild = new RollingWindow(2048);
  private readonly emit = new RollingWindow(2048);
  // Node 이벤트 루프 지연을 함께 수집해 CPU/GC/블로킹 이슈를 분리한다.
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  private reportTimer: NodeJS.Timeout | null = null;
  private overruns = 0;
  private tickCount = 0;
  private lastPlayerCount = 0;

  constructor(
    private readonly roomId: string,
    private readonly label: string,
    private readonly reportEveryMs: number = 10_000,
  ) {}

  start(): void {
    this.eventLoopDelay.enable();
    // 주기 로그만 남기고 요청 처리 종료를 막지 않도록 unref 타이머 사용.
    this.reportTimer = setInterval(() => this.report(), this.reportEveryMs);
    this.reportTimer.unref();
  }

  stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    this.eventLoopDelay.disable();
    // 종료된 룸 메트릭은 레지스트리에서 제거해 현재 활성 룸만 노출한다.
    metricsRegistry.removeRoom(this.roomId);
  }

  record(input: TickMetricInput): void {
    this.tickCount += 1;
    this.lastPlayerCount = input.playerCount;

    this.drift.push(input.driftMs);
    this.tickDuration.push(input.tickDurationMs);
    this.snapshotBuild.push(input.snapshotBuildMs);
    this.emit.push(input.emitMs);
    if (input.overrun) this.overruns += 1;
  }

  private report(): void {
    if (this.tickCount === 0) return;

    const drift = this.drift.summary();
    const tick = this.tickDuration.summary();
    const snapshot = this.snapshotBuild.summary();
    const emit = this.emit.summary();
    const overrunRate = (this.overruns / this.tickCount) * 100;

    const eventLoopMeanMs = this.eventLoopDelay.mean / 1e6;
    const eventLoopMaxMs = this.eventLoopDelay.max / 1e6;
    // 다음 리포트 구간을 위해 집계를 리셋한다.
    this.eventLoopDelay.reset();

    log(
      'Metrics',
      `${this.label} players=${this.lastPlayerCount} tick(p95=${tick.p95.toFixed(2)}ms p99=${tick.p99.toFixed(2)}ms max=${tick.max.toFixed(2)}ms) ` +
        `drift(p95=${drift.p95.toFixed(2)}ms max=${drift.max.toFixed(2)}ms) ` +
        `snapshot(p95=${snapshot.p95.toFixed(2)}ms) emit(p95=${emit.p95.toFixed(2)}ms) ` +
        `overrun=${overrunRate.toFixed(2)}% eventloop(mean=${eventLoopMeanMs.toFixed(2)}ms max=${eventLoopMaxMs.toFixed(2)}ms)`,
    );

    metricsRegistry.upsertRoomMetrics(this.roomId, {
      roomId: this.roomId,
      players: this.lastPlayerCount,
      tick,
      drift,
      snapshot,
      emit,
      overrunRate,
      eventLoop: { meanMs: eventLoopMeanMs, maxMs: eventLoopMaxMs },
      samples: this.tickCount,
    });
  }
}
