import { Controller, Get } from '@nestjs/common';
import { metricsRegistry } from '../core/observability/MetricsRegistry.js';

@Controller()
export class HealthController {
  @Get('/health')
  getHealth() {
    // legacy와 동일하게 과부하 시 degraded를 내려 상위 LB/모니터링이 즉시 감지하도록 한다.
    return {
      status: metricsRegistry.isOverloaded() ? 'degraded' : 'ok',
      service: 'backend-nest',
      phase: 'full-cutover',
      checkedAt: new Date().toISOString(),
    };
  }
}
