import { Module } from '@nestjs/common';
import { HealthController } from '../web/health.controller';
import { OpsController } from '../web/ops.controller';
import { RoomLifecycleController } from '../web/room-lifecycle.controller';
import { RoomLifecycleService } from '../services/room-lifecycle.service';
import { HeistGateway } from '../gateway/heist.gateway';
import { RuntimeCoreService } from '../services/runtime-core.service';

@Module({
  controllers: [HealthController, OpsController, RoomLifecycleController],
  providers: [RoomLifecycleService, RuntimeCoreService, HeistGateway],
})
export class AppModule {}
