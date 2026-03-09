import { Module } from '@nestjs/common';
import { HealthController } from '../web/health.controller.js';
import { OpsController } from '../web/ops.controller.js';
import { HeistGateway } from '../gateway/heist.gateway.js';
import { RuntimeCoreService } from '../services/runtime-core.service.js';

@Module({
  controllers: [HealthController, OpsController],
  providers: [RuntimeCoreService, HeistGateway],
})
export class AppModule {}
