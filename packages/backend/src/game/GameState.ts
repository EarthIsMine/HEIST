import type { Player, Storage, Jail, Obstacle, StateSnapshot, Phase, Team, Vec2 } from '@heist/shared';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
  TOTAL_COINS,
  COP_VISION_RADIUS,
  THIEF_VISION_RADIUS,
} from '@heist/shared';
import { createStorages, COP_SPAWNS, THIEF_SPAWNS, JAIL_CONFIG, OBSTACLES } from '@heist/shared';
import { distance, hasLineOfSight } from './physics.js';

export interface PlayerInit {
  id: string;
  walletAddress: string;
  name: string;
  team: Team;
}

export class GameState {
  tick: number = 0;
  phase: Phase = 'lobby';
  matchTimerMs: number = 0;
  headStartTimerMs: number = 0;

  players: Map<string, Player> = new Map();
  storages: Storage[];
  jail: Jail;
  stolenCoins: number = 0;
  dynamicObstacles: Obstacle[] = [];

  constructor(playerInits: PlayerInit[]) {
    this.storages = createStorages();
    this.jail = { ...JAIL_CONFIG, inmates: [] };

    let copIndex = 0;
    let thiefIndex = 0;

    for (const init of playerInits) {
      const spawnPos =
        init.team === 'cop'
          ? COP_SPAWNS[copIndex++ % COP_SPAWNS.length]
          : THIEF_SPAWNS[thiefIndex++ % THIEF_SPAWNS.length];

      this.players.set(init.id, {
        id: init.id,
        walletAddress: init.walletAddress,
        name: init.name,
        team: init.team,
        position: { ...spawnPos },
        velocity: { x: 0, y: 0 },
        lastDirection: { x: 0, y: -1 },
        visionRadius: init.team === 'cop' ? COP_VISION_RADIUS : THIEF_VISION_RADIUS,
        isJailed: false,
        isStunned: false,
        stunUntil: 0,
        channeling: null,
        channelingStart: 0,
        channelingTarget: null,
        connected: true,
        isDisguised: false,
        disguiseUntil: 0,
        disguiseCooldownUntil: 0,
        wallCooldownUntil: 0,
      });
    }
  }

  getAllObstacles(): Obstacle[] {
    return [...OBSTACLES, ...this.dynamicObstacles];
  }

  addDynamicObstacle(obs: Obstacle): void {
    this.dynamicObstacles.push(obs);
  }

  removeExpiredObstacles(now: number): Obstacle[] {
    const removed: Obstacle[] = [];
    this.dynamicObstacles = this.dynamicObstacles.filter((obs) => {
      if (obs.expiresAt && now >= obs.expiresAt) {
        removed.push(obs);
        return false;
      }
      return true;
    });
    return removed;
  }

  setPlayerDirection(playerId: string, direction: Vec2): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (direction.x !== 0 || direction.y !== 0) {
      player.lastDirection = { ...direction };
    }
    player.velocity = direction;
  }

  unfreezeCops(): void {
    // Cops can now move (head start ended)
    // Nothing special needed - during head_start, physics skips cops
  }

  getThieves(): Player[] {
    return [...this.players.values()].filter((p) => p.team === 'thief');
  }

  getCops(): Player[] {
    return [...this.players.values()].filter((p) => p.team === 'cop');
  }

  toSnapshot(): StateSnapshot {
    return {
      tick: this.tick,
      phase: this.phase,
      matchTimerMs: this.matchTimerMs,
      headStartTimerMs: this.headStartTimerMs,
      players: [...this.players.values()],
      storages: this.storages,
      jail: this.jail,
      obstacles: this.getAllObstacles(),
      stolenCoins: this.stolenCoins,
      totalCoins: TOTAL_COINS,
    };
  }

  toFilteredSnapshot(playerId: string): StateSnapshot {
    const viewer = this.players.get(playerId);
    if (!viewer) return this.toSnapshot();

    const allObstacles = this.getAllObstacles();

    const visiblePlayers = [...this.players.values()].filter((p) => {
      // Always show self and teammates
      if (p.id === playerId || p.team === viewer.team) return true;
      // Check distance
      const dist = distance(viewer.position, p.position);
      if (dist > viewer.visionRadius) return false;
      // Check line of sight
      return hasLineOfSight(viewer.position, p.position, allObstacles);
    });

    // Disguise: cops see disguised thieves as cops
    const processedPlayers = visiblePlayers.map((p) => {
      if (p.isDisguised && viewer.team === 'cop' && p.id !== playerId) {
        return { ...p, team: 'cop' as Team, isDisguised: false };
      }
      return p;
    });

    return {
      tick: this.tick,
      phase: this.phase,
      matchTimerMs: this.matchTimerMs,
      headStartTimerMs: this.headStartTimerMs,
      players: processedPlayers,
      storages: this.storages,
      jail: this.jail,
      obstacles: allObstacles,
      stolenCoins: this.stolenCoins,
      totalCoins: TOTAL_COINS,
    };
  }

  buildFilteredSnapshots(viewerIds: string[], allObstacles: Obstacle[] = this.getAllObstacles()): Map<string, StateSnapshot> {
    // viewer마다 반복해서 Map/배열을 재생성하지 않도록 공통 데이터를 재사용한다.
    const allPlayers = [...this.players.values()];
    const snapshots = new Map<string, StateSnapshot>();

    for (const viewerId of viewerIds) {
      const viewer = this.players.get(viewerId);
      if (!viewer) {
        snapshots.set(viewerId, this.toSnapshot());
        continue;
      }

      const visiblePlayers = allPlayers.filter((p) => {
        // 자신/아군은 항상 표시, 적은 거리+LOS 조건을 만족할 때만 표시.
        if (p.id === viewerId || p.team === viewer.team) return true;
        const dist = distance(viewer.position, p.position);
        if (dist > viewer.visionRadius) return false;
        return hasLineOfSight(viewer.position, p.position, allObstacles);
      });

      const processedPlayers = visiblePlayers.map((p) => {
        if (p.isDisguised && viewer.team === 'cop' && p.id !== viewerId) {
          return { ...p, team: 'cop' as Team, isDisguised: false };
        }
        return p;
      });

      snapshots.set(viewerId, {
        tick: this.tick,
        phase: this.phase,
        matchTimerMs: this.matchTimerMs,
        headStartTimerMs: this.headStartTimerMs,
        players: processedPlayers,
        storages: this.storages,
        jail: this.jail,
        obstacles: allObstacles,
        stolenCoins: this.stolenCoins,
        totalCoins: TOTAL_COINS,
      });
    }

    return snapshots;
  }
}
