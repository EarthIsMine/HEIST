import type { Obstacle } from '@heist/shared';
import {
  STEAL_RANGE,
  STEAL_RATE,
  BREAK_JAIL_RANGE,
  BREAK_JAIL_CHANNEL_MS,
  ARREST_RANGE,
  ARREST_COP_COUNT,
  ARREST_STUN_MS,
  DISGUISE_DURATION_MS,
  DISGUISE_COOLDOWN_MS,
  WALL_COST_COINS,
  WALL_DURATION_MS,
  WALL_COOLDOWN_MS,
  WALL_WIDTH,
  WALL_HEIGHT,
  WALL_PLACE_DISTANCE,
  MAP_WIDTH,
  MAP_HEIGHT,
} from '@heist/shared';
import { THIEF_SPAWNS } from '@heist/shared';
import { distance } from './physics.js';
import type { GameState } from './GameState.js';

export interface SkillEvent {
  type: 'skill_started' | 'skill_interrupted' | 'player_jailed' | 'player_freed'
    | 'storage_emptied' | 'cops_stunned' | 'player_disguised' | 'disguise_revealed'
    | 'wall_placed' | 'wall_removed';
  data: Record<string, unknown>;
}

export function tryStartSteal(
  state: GameState,
  playerId: string,
  storageId: string,
): SkillEvent | null {
  if (state.phase === 'head_start') return null;

  const player = state.players.get(playerId);
  if (!player || player.team !== 'thief') return null;
  if (player.isJailed || player.isStunned || player.channeling) return null;

  const storage = state.storages.find((s) => s.id === storageId);
  if (!storage || storage.remainingCoins <= 0) return null;

  const dist = distance(player.position, storage.position);
  if (dist > STEAL_RANGE + storage.radius) return null;

  player.channeling = 'steal';
  player.channelingStart = Date.now();
  player.channelingTarget = storageId;

  // Reveal disguise on skill use
  if (player.isDisguised) {
    player.isDisguised = false;
    player.disguiseUntil = 0;
  }

  return {
    type: 'skill_started',
    data: { playerId, skill: 'steal', targetId: storageId },
  };
}

export function tryStartBreakJail(
  state: GameState,
  playerId: string,
): SkillEvent | null {
  const player = state.players.get(playerId);
  if (!player || player.team !== 'thief') return null;
  if (player.isJailed || player.isStunned || player.channeling) return null;
  if (state.jail.inmates.length === 0) return null;

  const dist = distance(player.position, state.jail.position);
  if (dist > BREAK_JAIL_RANGE + state.jail.radius) return null;

  player.channeling = 'break_jail';
  player.channelingStart = Date.now();
  player.channelingTarget = 'jail';
  player.velocity = { x: 0, y: 0 };

  // Reveal disguise on skill use
  if (player.isDisguised) {
    player.isDisguised = false;
    player.disguiseUntil = 0;
  }

  return {
    type: 'skill_started',
    data: { playerId, skill: 'break_jail', targetId: 'jail' },
  };
}

export function tryArrest(
  state: GameState,
  requestingCopId: string,
  targetThiefId: string,
): SkillEvent[] {
  const events: SkillEvent[] = [];

  const cop = state.players.get(requestingCopId);
  if (!cop || cop.team !== 'cop') return events;
  if (cop.isStunned || cop.isJailed) return events;

  const thief = state.players.get(targetThiefId);
  if (!thief || thief.team !== 'thief') return events;
  if (thief.isJailed) return events;

  // Check distance from requesting cop to thief
  const copDist = distance(cop.position, thief.position);
  if (copDist > ARREST_RANGE) return events;

  // Count cops within arrest range of the thief
  const nearbyCops = state.getCops().filter(
    (c) => !c.isStunned && !c.isJailed && distance(c.position, thief.position) <= ARREST_RANGE,
  );

  if (nearbyCops.length < ARREST_COP_COUNT) return events;

  // Arrest succeeds
  thief.isJailed = true;
  thief.channeling = null;
  thief.channelingTarget = null;
  thief.position = { ...state.jail.position };
  thief.velocity = { x: 0, y: 0 };
  state.jail.inmates.push(targetThiefId);

  // Reveal disguise on arrest
  if (thief.isDisguised) {
    thief.isDisguised = false;
    thief.disguiseUntil = 0;
  }

  events.push({
    type: 'player_jailed',
    data: { playerId: targetThiefId },
  });

  // Stun the participating cops
  const now = Date.now();
  const stunnedCopIds: string[] = [];
  for (const c of nearbyCops) {
    c.isStunned = true;
    c.stunUntil = now + ARREST_STUN_MS;
    c.velocity = { x: 0, y: 0 };
    stunnedCopIds.push(c.id);
  }

  events.push({
    type: 'cops_stunned',
    data: { copIds: stunnedCopIds },
  });

  return events;
}

export function updateChanneling(state: GameState, dt: number, now: number): SkillEvent[] {
  const events: SkillEvent[] = [];

  for (const [, player] of state.players) {
    if (!player.channeling) continue;

    // break_jail is interrupted by movement; steal allows slow movement
    if (player.channeling === 'break_jail' && (player.velocity.x !== 0 || player.velocity.y !== 0)) {
      player.channeling = null;
      player.channelingTarget = null;
      events.push({
        type: 'skill_interrupted',
        data: { playerId: player.id, reason: 'moved' },
      });
      continue;
    }

    if (player.channeling === 'steal') {
      const storage = state.storages.find((s) => s.id === player.channelingTarget);
      if (!storage || storage.remainingCoins <= 0) {
        player.channeling = null;
        player.channelingTarget = null;
        continue;
      }

      // Check range
      const dist = distance(player.position, storage.position);
      if (dist > STEAL_RANGE + storage.radius) {
        player.channeling = null;
        player.channelingTarget = null;
        events.push({
          type: 'skill_interrupted',
          data: { playerId: player.id, reason: 'out_of_range' },
        });
        continue;
      }

      // Drain coins
      const drain = Math.min(STEAL_RATE * dt, storage.remainingCoins);
      storage.remainingCoins -= drain;
      state.stolenCoins += drain;
      state.teamCoins += drain;

      if (storage.remainingCoins <= 0) {
        storage.remainingCoins = 0;
        player.channeling = null;
        player.channelingTarget = null;
        events.push({
          type: 'storage_emptied',
          data: { storageId: storage.id },
        });
      }
    } else if (player.channeling === 'break_jail') {
      // Check range
      const dist = distance(player.position, state.jail.position);
      if (dist > BREAK_JAIL_RANGE + state.jail.radius) {
        player.channeling = null;
        player.channelingTarget = null;
        events.push({
          type: 'skill_interrupted',
          data: { playerId: player.id, reason: 'out_of_range' },
        });
        continue;
      }

      // Check if channel complete
      const elapsed = now - player.channelingStart;
      if (elapsed >= BREAK_JAIL_CHANNEL_MS) {
        // Free all inmates
        for (const inmateId of state.jail.inmates) {
          const inmate = state.players.get(inmateId);
          if (inmate) {
            inmate.isJailed = false;
            // Respawn at thief spawn
            const spawnIndex = state.getThieves().indexOf(inmate);
            const spawn = THIEF_SPAWNS[spawnIndex >= 0 ? spawnIndex % THIEF_SPAWNS.length : 0];
            inmate.position = { ...spawn };
            events.push({
              type: 'player_freed',
              data: { playerId: inmateId },
            });
          }
        }
        state.jail.inmates = [];
        player.channeling = null;
        player.channelingTarget = null;
      }
    }
  }

  return events;
}

export function updateStuns(state: GameState, now: number): void {
  for (const [, player] of state.players) {
    if (player.isStunned && now >= player.stunUntil) {
      player.isStunned = false;
      player.stunUntil = 0;
    }
  }
}

export function cancelPlayerSkill(state: GameState, playerId: string): SkillEvent | null {
  const player = state.players.get(playerId);
  if (!player || !player.channeling) return null;

  player.channeling = null;
  player.channelingTarget = null;
  return {
    type: 'skill_interrupted',
    data: { playerId, reason: 'cancelled' },
  };
}

export function tryDisguise(
  state: GameState,
  playerId: string,
  now: number,
): SkillEvent | null {
  const player = state.players.get(playerId);
  if (!player || player.team !== 'thief') return null;
  if (player.isJailed || player.isStunned || player.channeling) return null;
  if (player.isDisguised) return null;
  if (now < player.disguiseCooldownUntil) return null;

  player.isDisguised = true;
  player.disguiseUntil = now + DISGUISE_DURATION_MS;
  player.disguiseCooldownUntil = now + DISGUISE_DURATION_MS + DISGUISE_COOLDOWN_MS;

  return {
    type: 'player_disguised',
    data: { playerId },
  };
}

export function tryBuildWall(
  state: GameState,
  playerId: string,
  now: number,
): SkillEvent | null {
  const player = state.players.get(playerId);
  if (!player || player.team !== 'thief') return null;
  if (player.isJailed || player.isStunned || player.channeling) return null;
  if (now < player.wallCooldownUntil) return null;
  if (state.teamCoins < WALL_COST_COINS) return null;

  state.teamCoins -= WALL_COST_COINS;

  // Place wall behind the player (opposite of last movement direction)
  let dx = -player.lastDirection.x;
  let dy = -player.lastDirection.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) {
    dx = 0;
    dy = 1;
  } else {
    dx /= len;
    dy /= len;
  }

  const wallX = player.position.x + dx * WALL_PLACE_DISTANCE;
  const wallY = player.position.y + dy * WALL_PLACE_DISTANCE;

  // Wall is perpendicular to facing direction
  const isHorizontalFacing = Math.abs(dx) >= Math.abs(dy);
  const wallW = isHorizontalFacing ? WALL_HEIGHT : WALL_WIDTH;
  const wallH = isHorizontalFacing ? WALL_WIDTH : WALL_HEIGHT;

  const obstacle: Obstacle = {
    id: `wall_${playerId}_${now}`,
    position: {
      x: Math.max(0, Math.min(MAP_WIDTH - wallW, wallX - wallW / 2)),
      y: Math.max(0, Math.min(MAP_HEIGHT - wallH, wallY - wallH / 2)),
    },
    width: wallW,
    height: wallH,
    expiresAt: now + WALL_DURATION_MS,
    ownerId: playerId,
  };

  state.addDynamicObstacle(obstacle);
  player.wallCooldownUntil = now + WALL_COOLDOWN_MS;

  return {
    type: 'wall_placed',
    data: { obstacleId: obstacle.id },
  };
}

export function updateDisguises(state: GameState, now: number): SkillEvent[] {
  const events: SkillEvent[] = [];
  for (const [, player] of state.players) {
    if (player.isDisguised && now >= player.disguiseUntil) {
      player.isDisguised = false;
      player.disguiseUntil = 0;
      events.push({
        type: 'disguise_revealed',
        data: { playerId: player.id },
      });
    }
  }
  return events;
}

export function updateDynamicObstacles(state: GameState, now: number): SkillEvent[] {
  const removed = state.removeExpiredObstacles(now);
  return removed.map((obs) => ({
    type: 'wall_removed' as const,
    data: { obstacleId: obs.id },
  }));
}
