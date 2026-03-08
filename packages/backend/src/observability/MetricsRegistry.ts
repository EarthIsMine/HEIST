import { memoryUsage, uptime } from 'node:process';

export interface RoomMetricSummary {
  roomId: string;
  players: number;
  tick: { p50: number; p95: number; p99: number; max: number };
  drift: { p50: number; p95: number; p99: number; max: number };
  snapshot: { p50: number; p95: number; p99: number; max: number };
  emit: { p50: number; p95: number; p99: number; max: number };
  overrunRate: number;
  eventLoop: { meanMs: number; maxMs: number };
  samples: number;
  updatedAt: string;
}

class MetricsRegistry {
  // 룸 단위 성능 메트릭 최신값 저장소
  private readonly roomMetrics = new Map<string, RoomMetricSummary>();
  private shardCount = 1;
  private shardRooms = new Map<number, number>();
  private readonly tickP99WarnMs = parseFloat(process.env.METRICS_TICK_P99_WARN_MS || '50');
  private readonly overrunWarnRate = parseFloat(process.env.METRICS_OVERRUN_WARN_RATE || '1');
  private readonly eventLoopMaxWarnMs = parseFloat(process.env.METRICS_EVENTLOOP_MAX_WARN_MS || '100');
  private readonly rollingWindowMs = parseInt(process.env.METRICS_ROLLING_WINDOW_MS || '300000', 10);
  private readonly reconnectWindowMs = parseInt(process.env.METRICS_RECONNECT_WINDOW_MS || '120000', 10);
  private readonly stage4MaxDuplicateRatePct = parseFloat(process.env.STAGE4_MAX_DUPLICATE_RATE_PCT || '5');
  private readonly stage4MaxConsecutiveConsistencyFailures = parseInt(
    process.env.STAGE4_MAX_CONSISTENCY_FAILURES || '0',
    10,
  );
  private readonly stage4MaxRtoSec = parseInt(process.env.STAGE4_MAX_RTO_SEC || '300', 10);
  private readonly stage4MaxRpoEvents = parseInt(process.env.STAGE4_MAX_RPO_EVENTS || '0', 10);

  // 누적 카운터(프로세스 라이프타임 기준)
  private disconnectTotal = 0;
  private joinFailureTotal = 0;
  private reconnectSuccessTotal = 0;
  private joinSuccessTotal = 0;
  private joinRequestTotal = 0;
  private joinIdempotencyHitTotal = 0;

  private consistencyLastCheckedAt: string | null = null;
  private consistencyLastOk: boolean | null = null;
  private consistencyConsecutiveFailures = 0;
  private consistencyTotalFailures = 0;

  private recoveryLastRtoSec: number | null = null;
  private recoveryLastRpoEvents: number | null = null;
  private recoveryLastRecordedAt: string | null = null;

  // 최근 윈도우 계산용 타임스탬프 버퍼
  private disconnectEvents: number[] = [];
  private joinFailureEvents: number[] = [];
  private reconnectSuccessEvents: number[] = [];
  private lastDisconnectByWallet = new Map<string, number>();

  upsertRoomMetrics(roomId: string, metric: Omit<RoomMetricSummary, 'updatedAt'>): void {
    this.roomMetrics.set(roomId, {
      ...metric,
      updatedAt: new Date().toISOString(),
    });
  }

  removeRoom(roomId: string): void {
    this.roomMetrics.delete(roomId);
  }

  updateShardSnapshot(shardCount: number, shardRooms: Map<number, number>): void {
    this.shardCount = Math.max(1, shardCount);
    this.shardRooms = new Map(shardRooms);
  }

  recordDisconnect(walletAddress?: string): void {
    const now = Date.now();
    this.disconnectTotal += 1;
    this.disconnectEvents.push(now);
    if (walletAddress) {
      this.lastDisconnectByWallet.set(walletAddress, now);
    }
  }

  recordJoinFailure(): void {
    this.joinFailureTotal += 1;
    this.joinFailureEvents.push(Date.now());
  }

  recordJoinRequest(): void {
    this.joinRequestTotal += 1;
  }

  recordJoinIdempotencyHit(): void {
    this.joinIdempotencyHitTotal += 1;
  }

  recordJoinSuccess(walletAddress: string): void {
    const now = Date.now();
    this.joinSuccessTotal += 1;
    const lastDisconnect = this.lastDisconnectByWallet.get(walletAddress);
    // 같은 지갑이 reconnect 윈도우 내 재입장하면 재연결 성공으로 집계한다.
    if (lastDisconnect && now - lastDisconnect <= this.reconnectWindowMs) {
      this.reconnectSuccessTotal += 1;
      this.reconnectSuccessEvents.push(now);
      this.lastDisconnectByWallet.delete(walletAddress);
    }
  }

  recordConsistencyResult(ok: boolean): void {
    this.consistencyLastCheckedAt = new Date().toISOString();
    this.consistencyLastOk = ok;
    if (ok) {
      this.consistencyConsecutiveFailures = 0;
      return;
    }
    this.consistencyConsecutiveFailures += 1;
    this.consistencyTotalFailures += 1;
  }

  recordRecoveryDrill(rtoSec: number, rpoEvents: number): void {
    this.recoveryLastRtoSec = Math.max(0, rtoSec);
    this.recoveryLastRpoEvents = Math.max(0, rpoEvents);
    this.recoveryLastRecordedAt = new Date().toISOString();
  }

  isOverloaded(): boolean {
    // 룸별 핵심 SLO 위반 여부를 단순 OR로 판단한다.
    for (const metric of this.roomMetrics.values()) {
      if (metric.tick.p99 > this.tickP99WarnMs) return true;
      if (metric.overrunRate > this.overrunWarnRate) return true;
      if (metric.eventLoop.maxMs > this.eventLoopMaxWarnMs) return true;
    }
    return false;
  }

  getSnapshot() {
    // 응답 직전에 윈도우 밖 이벤트를 정리해 recent 지표 정확도를 유지한다.
    this.pruneOldEvents();
    const mem = memoryUsage();
    const rooms = [...this.roomMetrics.values()];
    const windowMinutes = this.rollingWindowMs / 60_000;
    const disconnectRecent = this.disconnectEvents.length;
    const joinFailureRecent = this.joinFailureEvents.length;
    const reconnectSuccessRecent = this.reconnectSuccessEvents.length;
    const activePlayers = rooms.reduce((acc, room) => acc + room.players, 0);

    const reconnectFailureRatePct =
      disconnectRecent === 0
        ? 0
        : (Math.max(0, disconnectRecent - reconnectSuccessRecent) / disconnectRecent) * 100;
    const disconnectRatePerMin = disconnectRecent / Math.max(windowMinutes, 1);
    const joinFailureRatePerMin = joinFailureRecent / Math.max(windowMinutes, 1);
    const duplicateRatePct =
      this.joinRequestTotal === 0 ? 0 : (this.joinIdempotencyHitTotal / this.joinRequestTotal) * 100;
    const recoveryMeetsTarget =
      this.recoveryLastRtoSec !== null && this.recoveryLastRpoEvents !== null
        ? this.recoveryLastRtoSec <= this.stage4MaxRtoSec &&
          this.recoveryLastRpoEvents <= this.stage4MaxRpoEvents
        : null;
    const rollbackReasons: string[] = [];
    if (this.consistencyConsecutiveFailures > this.stage4MaxConsecutiveConsistencyFailures) {
      rollbackReasons.push('consistency-failure');
    }
    if (duplicateRatePct > this.stage4MaxDuplicateRatePct) {
      rollbackReasons.push('duplicate-rate-exceeded');
    }
    const scaleOutBlockReasons: string[] = [];
    if (recoveryMeetsTarget === false) {
      scaleOutBlockReasons.push('recovery-target-missed');
    } else if (recoveryMeetsTarget === null) {
      scaleOutBlockReasons.push('recovery-target-unknown');
    }

    return {
      generatedAt: new Date().toISOString(),
      uptimeSec: uptime(),
      overload: {
        overloaded: this.isOverloaded(),
        thresholds: {
          tickP99Ms: this.tickP99WarnMs,
          overrunRatePct: this.overrunWarnRate,
          eventLoopMaxMs: this.eventLoopMaxWarnMs,
        },
      },
      process: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
        arrayBuffersBytes: mem.arrayBuffers,
      },
      connection: {
        rollingWindowSec: this.rollingWindowMs / 1000,
        reconnectWindowSec: this.reconnectWindowMs / 1000,
        totals: {
          disconnects: this.disconnectTotal,
          joinFailures: this.joinFailureTotal,
          reconnectSuccess: this.reconnectSuccessTotal,
          joinSuccess: this.joinSuccessTotal,
        },
        recent: {
          disconnects: disconnectRecent,
          joinFailures: joinFailureRecent,
          reconnectSuccess: reconnectSuccessRecent,
          disconnectRatePerMin: Number(disconnectRatePerMin.toFixed(3)),
          joinFailureRatePerMin: Number(joinFailureRatePerMin.toFixed(3)),
          // disconnect 대비 reconnect 성공을 뺀 비율을 실패율로 본다.
          reconnectFailureRatePct: Number(reconnectFailureRatePct.toFixed(3)),
          activePlayers,
        },
      },
      sharding: {
        shardCount: this.shardCount,
        shardRooms: [...this.shardRooms.entries()].map(([shardId, rooms]) => ({
          shardId,
          rooms,
        })),
      },
      operations: {
        // drain 모드는 신규 유입을 줄여 노드를 안전하게 비우기 위한 운영 스위치다.
        nodeDrain: process.env.ENABLE_NODE_DRAIN === 'true',
        // 메시지 순서 보장 정책: roomId 파티션 + 룸 단위 직렬 처리
        messageOrdering: {
          partitionKey: 'roomId',
          mode: 'serialized-per-room',
        },
        stage4Canary: {
          enabled: process.env.ENABLE_STAGE4_ROOMTYPE_CANARY === 'true',
          roomTypes: (process.env.STAGE4_CANARY_ROOM_TYPES || 'default')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
          percent: parseInt(process.env.STAGE4_CANARY_PERCENT || '10', 10),
        },
        stage4RiskGates: {
          rollbackRecommended: rollbackReasons.length > 0,
          rollbackReasons,
          scaleOutAllowed: scaleOutBlockReasons.length === 0,
          scaleOutBlockReasons,
          thresholds: {
            maxDuplicateRatePct: this.stage4MaxDuplicateRatePct,
            maxConsecutiveConsistencyFailures: this.stage4MaxConsecutiveConsistencyFailures,
            maxRtoSec: this.stage4MaxRtoSec,
            maxRpoEvents: this.stage4MaxRpoEvents,
          },
        },
      },
      consistency: {
        lastCheckedAt: this.consistencyLastCheckedAt,
        lastOk: this.consistencyLastOk,
        consecutiveFailures: this.consistencyConsecutiveFailures,
        totalFailures: this.consistencyTotalFailures,
      },
      idempotency: {
        joinRequests: this.joinRequestTotal,
        joinIdempotencyHits: this.joinIdempotencyHitTotal,
        duplicateRatePct: Number(duplicateRatePct.toFixed(3)),
      },
      recovery: {
        lastRecordedAt: this.recoveryLastRecordedAt,
        lastRtoSec: this.recoveryLastRtoSec,
        lastRpoEvents: this.recoveryLastRpoEvents,
        meetsTarget: recoveryMeetsTarget,
      },
      rooms: {
        count: rooms.length,
        metrics: rooms,
      },
    };
  }

  private pruneOldEvents(): void {
    const cutoff = Date.now() - this.rollingWindowMs;
    this.disconnectEvents = this.disconnectEvents.filter((ts) => ts >= cutoff);
    this.joinFailureEvents = this.joinFailureEvents.filter((ts) => ts >= cutoff);
    this.reconnectSuccessEvents = this.reconnectSuccessEvents.filter((ts) => ts >= cutoff);

    // 장시간 재접속이 없는 지갑 기록은 제거해 메모리 누적을 방지한다.
    for (const [wallet, ts] of this.lastDisconnectByWallet.entries()) {
      if (ts < cutoff) {
        this.lastDisconnectByWallet.delete(wallet);
      }
    }
  }
}

export const metricsRegistry = new MetricsRegistry();
