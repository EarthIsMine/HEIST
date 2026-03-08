import 'dotenv/config';
import { createApp } from './server.js';
import { RoomManager } from './rooms/RoomManager.js';
import { log } from './utils/logger.js';
import { setupSocketAdapter } from './cluster/socketAdapter.js';
import { metricsRegistry } from './observability/MetricsRegistry.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '1', 10);
const CONSISTENCY_CHECK_INTERVAL_MS = parseInt(process.env.CONSISTENCY_CHECK_INTERVAL_MS || '30000', 10);

const { app, httpServer, io } = createApp();
const roomManager = new RoomManager(io, MIN_PLAYERS);

async function main(): Promise<void> {
  // Redis 설정이 있으면 멀티 노드 adapter를 먼저 붙인 뒤 소켓 이벤트를 연다.
  await setupSocketAdapter(io);

  // Stage4: 운영에서 메모리/외부 저장소 정합성을 즉시 점검할 수 있는 엔드포인트
  app.get('/_state/consistency', async (_req, res) => {
    try {
      const report = await roomManager.buildStateConsistencyReport();
      metricsRegistry.recordConsistencyResult(report.ok);
      res.json(report);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Consistency check failed: ${err}`,
      });
    }
  });

  // Stage4: 장애 복구 드릴 결과(RTO/RPO)를 수동 기록해 확장 가능 여부 판단에 사용한다.
  app.post('/_state/recovery-drill', (req, res) => {
    const rtoSec = Number(req.body?.rtoSec);
    const rpoEvents = Number(req.body?.rpoEvents);
    if (!Number.isFinite(rtoSec) || !Number.isFinite(rpoEvents)) {
      res.status(400).json({
        ok: false,
        error: 'rtoSec and rpoEvents must be numbers',
      });
      return;
    }
    metricsRegistry.recordRecoveryDrill(rtoSec, rpoEvents);
    res.json({
      ok: true,
      rtoSec,
      rpoEvents,
    });
  });

  io.on('connection', (socket) => {
    log('Server', `Client connected: ${socket.id}`);

    socket.on('list_rooms', (ack) => {
      ack(roomManager.listRooms());
    });

    socket.on('join_room', (roomId, payload, ack) => {
      roomManager.handleJoinRoom(socket, roomId, payload, ack);
    });

    socket.on('confirm_entry', (txSignature, ack) => {
      roomManager.handleConfirmEntry(socket, txSignature, ack);
    });

    socket.on('select_team', (team, ack) => {
      const result = roomManager.handleSelectTeam(socket, team);
      ack(result);
    });

    socket.on('ready', () => {
      roomManager.handleReady(socket);
    });

    socket.on('input_move', (direction) => {
      roomManager.handleInputMove(socket, direction);
    });

    socket.on('request_steal', (storageId) => {
      roomManager.handleRequestSkill(socket, 'steal', storageId);
    });

    socket.on('request_break_jail', () => {
      roomManager.handleRequestSkill(socket, 'break_jail');
    });

    socket.on('request_arrest', (targetId) => {
      roomManager.handleRequestSkill(socket, 'arrest', targetId);
    });

    socket.on('request_disguise', () => {
      roomManager.handleRequestSkill(socket, 'disguise');
    });

    socket.on('request_build_wall', () => {
      roomManager.handleRequestSkill(socket, 'build_wall');
    });

    socket.on('cancel_skill', () => {
      roomManager.handleCancelSkill(socket);
    });

    socket.on('disconnect', () => {
      log('Server', `Client disconnected: ${socket.id}`);
      roomManager.handleDisconnect(socket);
    });
  });

  httpServer.listen(PORT, () => {
    log('Server', `HEIST server running on port ${PORT} (min players: ${MIN_PLAYERS})`);
  });

  // 정합성 체크를 주기 수행해 자동 롤백 게이트 판단 근거를 지속 갱신한다.
  const consistencyTimer = setInterval(async () => {
    try {
      const report = await roomManager.buildStateConsistencyReport();
      metricsRegistry.recordConsistencyResult(report.ok);
    } catch (err) {
      log('Consistency', `Periodic check failed: ${err}`);
      metricsRegistry.recordConsistencyResult(false);
    }
  }, Math.max(1000, CONSISTENCY_CHECK_INTERVAL_MS));
  consistencyTimer.unref();
}

main().catch((err) => {
  log('Server', `Fatal startup error: ${err}`);
  process.exit(1);
});

// 개발/운영 공통 graceful shutdown: 진행 중 게임 정리 후 소켓/HTTP를 닫는다.
function shutdown() {
  roomManager.abortAllGames('Server is restarting');
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
