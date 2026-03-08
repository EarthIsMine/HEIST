import type { StateSnapshot, GameResult, Vec2, WinReason } from '@heist/shared';
import {
  TICK_MS,
  MATCH_DURATION_MS,
  HEAD_START_MS,
} from '@heist/shared';
import { performance } from 'node:perf_hooks';
import { GameState, type PlayerInit } from './GameState.js';
import { updatePlayerMovement, resolveObstacleCollision } from './physics.js';
import {
  tryStartSteal,
  tryStartBreakJail,
  tryArrest,
  tryDisguise,
  tryBuildWall,
  updateChanneling,
  updateStuns,
  updateDisguises,
  updateDynamicObstacles,
  cancelPlayerSkill,
  type SkillEvent,
} from './skills.js';
import { BotAI } from './BotAI.js';
import { log } from '../utils/logger.js';
import { LoopMetrics } from '../observability/LoopMetrics.js';

export class GameLoop {
  private state: GameState;
  private timerId: NodeJS.Timeout | null = null;
  // 이상적인 다음 틱 시각(ms). 실제 실행과의 차이로 drift를 계산한다.
  private nextTickAt: number = 0;
  private startTime: number = 0;
  private onTick: (snapshots: Map<string, StateSnapshot>) => void;
  private onEnd: (result: GameResult) => void;
  private onSkillEvent?: (event: SkillEvent) => void;
  private botAI: BotAI;
  private metrics: LoopMetrics;
  private running: boolean = false;

  constructor(
    players: PlayerInit[],
    onTick: (snapshots: Map<string, StateSnapshot>) => void,
    onEnd: (result: GameResult) => void,
    onSkillEvent?: (event: SkillEvent) => void,
    botIds?: string[],
    roomLabel: string = 'unknown-room',
  ) {
    this.state = new GameState(players);
    this.onTick = onTick;
    this.onEnd = onEnd;
    this.onSkillEvent = onSkillEvent;
    this.botAI = new BotAI();
    this.metrics = new LoopMetrics(roomLabel, `room=${roomLabel}`);
    if (botIds) {
      for (const id of botIds) {
        this.botAI.registerBot(id);
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();
    this.nextTickAt = this.startTime + TICK_MS;
    this.state.phase = 'head_start';
    this.metrics.start();
    log('GameLoop', 'Game started (head_start phase)');
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    // 절대 시각 기반으로 지연을 계산해 setInterval 누적 오차를 줄인다.
    const delay = Math.max(0, this.nextTickAt - Date.now());
    this.timerId = setTimeout(() => this.runTick(), delay);
  }

  private runTick(): void {
    if (!this.running) return;

    const tickStartMs = Date.now();
    const tickStartPerf = performance.now();
    const driftMs = tickStartMs - this.nextTickAt;
    const elapsed = tickStartMs - this.startTime;
    const dt = TICK_MS / 1000;

    // Phase transitions
    if (this.state.phase === 'head_start' && elapsed >= HEAD_START_MS) {
      this.state.phase = 'playing';
      log('GameLoop', 'Phase: playing');
    }

    // Update stuns
    updateStuns(this.state, tickStartMs);

    // Update disguises
    const disguiseEvents = updateDisguises(this.state, tickStartMs);
    for (const event of disguiseEvents) {
      this.onSkillEvent?.(event);
    }

    // Update dynamic obstacles (remove expired walls)
    const wallEvents = updateDynamicObstacles(this.state, tickStartMs);
    for (const event of wallEvents) {
      this.onSkillEvent?.(event);
    }

    // 물리 계산은 동일한 obstacle 스냅샷 기준으로 처리해 틱 내 일관성을 유지한다.
    const allObstacles = this.state.getAllObstacles();
    for (const [, player] of this.state.players) {
      updatePlayerMovement(player, dt, this.state.phase);
      resolveObstacleCollision(player, allObstacles);
    }

    // Update bot AI
    if (this.state.phase !== 'head_start' || true) {
      this.botAI.update(this.state, (botId, skill, targetId) => {
        this.requestSkill(botId, skill, targetId);
      });
    }

    // Update channeling skills
    const skillEvents = updateChanneling(this.state, dt, tickStartMs);
    for (const event of skillEvents) {
      this.onSkillEvent?.(event);
    }

    // Update timers
    this.state.tick++;
    this.state.matchTimerMs = Math.max(0, MATCH_DURATION_MS - elapsed);
    this.state.headStartTimerMs = Math.max(0, HEAD_START_MS - elapsed);

    // Win conditions
    const result = this.checkWinConditions();
    if (result) {
      this.stop();
      this.onEnd(result);
      return;
    }

    // 플레이어별 가시성 필터링 스냅샷을 한 번에 생성해 비용을 계측한다.
    const snapshotStartPerf = performance.now();
    const viewerIds = [...this.state.players.keys()];
    const snapshots = this.state.buildFilteredSnapshots(viewerIds, this.state.getAllObstacles());
    const snapshotBuildMs = performance.now() - snapshotStartPerf;

    // 소켓 emit 구간을 분리 계측해 네트워크/직렬화 비용을 구분한다.
    const emitStartPerf = performance.now();
    this.onTick(snapshots);
    const emitMs = performance.now() - emitStartPerf;

    const tickDurationMs = performance.now() - tickStartPerf;
    this.metrics.record({
      driftMs,
      tickDurationMs,
      snapshotBuildMs,
      emitMs,
      playerCount: this.state.players.size,
      overrun: tickDurationMs > TICK_MS,
    });

    this.nextTickAt += TICK_MS;
    const now = Date.now();
    // 과도한 지연이 누적되면 기준 시각을 재동기화해 복구 시간을 줄인다.
    if (this.nextTickAt < now - TICK_MS) {
      this.nextTickAt = now + TICK_MS;
    }
    this.scheduleNextTick();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.metrics.stop();
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  getSnapshot(): StateSnapshot {
    return this.state.toSnapshot();
  }

  applyInput(playerId: string, direction: Vec2): void {
    this.state.setPlayerDirection(playerId, direction);
  }

  requestSkill(playerId: string, skill: string, targetId?: string): void {
    let events: SkillEvent[] = [];

    switch (skill) {
      case 'steal': {
        if (!targetId) return;
        const event = tryStartSteal(this.state, playerId, targetId);
        if (event) events = [event];
        break;
      }
      case 'break_jail': {
        const event = tryStartBreakJail(this.state, playerId);
        if (event) events = [event];
        break;
      }
      case 'arrest': {
        if (!targetId) return;
        events = tryArrest(this.state, playerId, targetId);
        break;
      }
      case 'disguise': {
        const event = tryDisguise(this.state, playerId, Date.now());
        if (event) events = [event];
        break;
      }
      case 'build_wall': {
        const event = tryBuildWall(this.state, playerId, Date.now());
        if (event) events = [event];
        break;
      }
    }

    for (const event of events) {
      this.onSkillEvent?.(event);
    }
  }

  convertToBot(playerId: string): void {
    this.botAI.registerBot(playerId);
    log('GameLoop', `Player ${playerId} converted to bot`);
  }

  cancelSkill(playerId: string): void {
    const event = cancelPlayerSkill(this.state, playerId);
    if (event) {
      this.onSkillEvent?.(event);
    }
  }

  private checkWinConditions(): GameResult | null {
    // Thieves win: all storages emptied
    const allEmpty = this.state.storages.every((s) => s.remainingCoins <= 0);
    if (allEmpty) {
      return this.buildResult('thief', 'all_coins_stolen');
    }

    // Cops win: all thieves jailed
    const thieves = this.state.getThieves();
    const allJailed = thieves.length > 0 && thieves.every((t) => t.isJailed);
    if (allJailed) {
      return this.buildResult('cop', 'all_thieves_jailed');
    }

    // Time expired: cops win
    if (this.state.matchTimerMs <= 0) {
      return this.buildResult('cop', 'time_expired');
    }

    return null;
  }

  private buildResult(winningTeam: 'cop' | 'thief', reason: WinReason): GameResult {
    const winners = [...this.state.players.values()].filter(
      (p) => p.team === winningTeam,
    );
    const totalPool = this.state.players.size * 100_000_000; // ENTRY_FEE_LAMPORTS per player
    const payoutPerWinner = Math.floor(totalPool / Math.max(winners.length, 1));

    return {
      winningTeam,
      reason,
      stolenCoins: this.state.stolenCoins,
      payoutLamports: payoutPerWinner,
      payoutTxSignatures: [], // Will be filled by payout module
    };
  }
}
