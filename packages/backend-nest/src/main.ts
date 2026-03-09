import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('NestBootstrap');
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });

  const port = parseInt(process.env.NEST_PORT || '8081', 10);
  await app.listen(port);
  logger.log(`HEIST Nest backend running on port ${port}`);
}

bootstrap().catch((err) => {
  // 프로세스 시작 실패는 즉시 종료해 오케스트레이터가 재시도하도록 한다.
  // eslint-disable-next-line no-console
  console.error('[NestBootstrap] Fatal startup error:', err);
  process.exit(1);
});
