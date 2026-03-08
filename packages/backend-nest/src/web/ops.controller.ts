import { Body, Controller, Get, Post } from '@nestjs/common';
import { LegacyReadProxyService } from '../services/legacy-read-proxy.service';

@Controller()
export class OpsController {
  constructor(private readonly legacyProxy: LegacyReadProxyService) {}

  @Get('/_metrics')
  async getMetrics() {
    // 병행 이관 초반에는 legacy 관측치를 그대로 프록시해 대시보드 스키마를 안정화한다.
    const legacy = await this.legacyProxy.getJson<Record<string, unknown>>('/_metrics');
    if (legacy) return legacy;
    return {
      source: 'nest-local',
      migrationPhase: 'phase-1-bootstrap',
      legacyReadProxy: this.legacyProxy.isEnabled(),
      generatedAt: new Date().toISOString(),
    };
  }

  @Get('/_state/consistency')
  async getConsistency() {
    const legacy = await this.legacyProxy.getJson<Record<string, unknown>>('/_state/consistency');
    if (legacy) return legacy;
    return {
      ok: true,
      source: 'nest-local',
      migrationPhase: 'phase-1-bootstrap',
      checkedAt: new Date().toISOString(),
      note: 'legacy proxy disabled or unavailable',
    };
  }

  @Get('/_state/rooms')
  async getStateRooms() {
    const legacy = await this.legacyProxy.getJson<Record<string, unknown>>('/_state/rooms');
    if (legacy) return legacy;
    return {
      backend: 'nest-local',
      count: 0,
      rooms: [],
      migrationPhase: 'phase-2-ops-endpoints',
      legacyReadProxy: this.legacyProxy.isEnabled(),
    };
  }

  @Post('/_state/recovery-drill')
  async postRecoveryDrill(@Body() body: { rtoSec?: number; rpoEvents?: number }) {
    const rtoSec = Number(body?.rtoSec);
    const rpoEvents = Number(body?.rpoEvents);
    if (!Number.isFinite(rtoSec) || !Number.isFinite(rpoEvents)) {
      return {
        ok: false,
        error: 'rtoSec and rpoEvents must be numbers',
        migrationPhase: 'phase-2-ops-endpoints',
      };
    }

    const proxied = await this.legacyProxy.postJson<Record<string, unknown>>('/_state/recovery-drill', {
      rtoSec,
      rpoEvents,
    });
    if (proxied) return proxied;

    return {
      ok: true,
      source: 'nest-local',
      migrationPhase: 'phase-2-ops-endpoints',
      legacyWriteProxy: this.legacyProxy.isWriteProxyEnabled(),
      rtoSec,
      rpoEvents,
      note: 'write proxy disabled or unavailable',
    };
  }
}
