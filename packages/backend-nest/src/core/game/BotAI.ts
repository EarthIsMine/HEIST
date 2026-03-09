import type { Player, Storage, Team, Vec2 } from '@heist/shared';
import {
  STEAL_RANGE,
  ARREST_RANGE,
  BREAK_JAIL_RANGE,
  TICK_MS,
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
} from '@heist/shared';
import type { GameState } from './GameState.js';
import { distance } from './physics.js';

interface BotState {
  id: string;
  targetPos: Vec2 | null;
  actionCooldown: number;
  wanderTimer: number;
}

export class BotAI {
  private bots: Map<string, BotState> = new Map();
  private botIds: Set<string> = new Set();

  registerBot(botId: string): void {
    this.botIds.add(botId);
    this.bots.set(botId, {
      id: botId,
      targetPos: null,
      actionCooldown: 0,
      wanderTimer: 0,
    });
  }

  isBot(playerId: string): boolean {
    return this.botIds.has(playerId);
  }

  update(
    state: GameState,
    requestSkill: (botId: string, skill: string, targetId?: string) => void,
  ): void {
    for (const [botId, bot] of this.bots) {
      const player = state.players.get(botId);
      if (!player || player.isJailed || player.isStunned) {
        state.setPlayerDirection(botId, { x: 0, y: 0 });
        continue;
      }

      if (player.channeling) {
        state.setPlayerDirection(botId, { x: 0, y: 0 });
        continue;
      }

      bot.actionCooldown = Math.max(0, bot.actionCooldown - TICK_MS);

      if (player.team === 'thief') {
        this.updateThiefBot(state, player, bot, requestSkill);
      } else {
        this.updateCopBot(state, player, bot, requestSkill);
      }
    }
  }

  private updateThiefBot(
    state: GameState,
    player: Player,
    bot: BotState,
    requestSkill: (botId: string, skill: string, targetId?: string) => void,
  ): void {
    // Priority 1: If teammates are jailed and we're near jail, break them out
    if (state.jail.inmates.length > 0) {
      const jailDist = distance(player.position, state.jail.position);
      if (jailDist <= BREAK_JAIL_RANGE + state.jail.radius) {
        if (bot.actionCooldown <= 0) {
          requestSkill(bot.id, 'break_jail');
          bot.actionCooldown = 500;
        }
        state.setPlayerDirection(bot.id, { x: 0, y: 0 });
        return;
      }
    }

    // Priority 2: Find nearest storage with coins and go steal
    const nearestStorage = this.findNearestStorageWithCoins(state, player);
    if (nearestStorage) {
      const dist = distance(player.position, nearestStorage.position);

      if (dist <= STEAL_RANGE + nearestStorage.radius) {
        // In range - steal
        if (bot.actionCooldown <= 0) {
          requestSkill(bot.id, 'steal', nearestStorage.id);
          bot.actionCooldown = 500;
        }
        state.setPlayerDirection(bot.id, { x: 0, y: 0 });
        return;
      }

      // Move toward storage
      this.moveToward(state, bot.id, player.position, nearestStorage.position);
      return;
    }

    // Priority 3: If teammates jailed, go to jail
    if (state.jail.inmates.length > 0) {
      this.moveToward(state, bot.id, player.position, state.jail.position);
      return;
    }

    // Wander randomly
    this.wander(state, player, bot);
  }

  private updateCopBot(
    state: GameState,
    player: Player,
    bot: BotState,
    requestSkill: (botId: string, skill: string, targetId?: string) => void,
  ): void {
    // Find nearest non-jailed thief
    const thieves = state.getThieves().filter((t) => !t.isJailed);
    if (thieves.length === 0) {
      this.wander(state, player, bot);
      return;
    }

    let nearestThief: Player | null = null;
    let minDist = Infinity;
    for (const t of thieves) {
      const d = distance(player.position, t.position);
      if (d < minDist) {
        minDist = d;
        nearestThief = t;
      }
    }

    if (!nearestThief) return;

    // If close enough, try arrest
    if (minDist <= ARREST_RANGE && bot.actionCooldown <= 0) {
      requestSkill(bot.id, 'arrest', nearestThief.id);
      bot.actionCooldown = 1000;
    }

    // Chase the thief
    this.moveToward(state, bot.id, player.position, nearestThief.position);
  }

  private moveToward(state: GameState, botId: string, from: Vec2, to: Vec2): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) {
      state.setPlayerDirection(botId, { x: 0, y: 0 });
      return;
    }
    state.setPlayerDirection(botId, { x: dx / len, y: dy / len });
  }

  private wander(state: GameState, player: Player, bot: BotState): void {
    bot.wanderTimer -= TICK_MS;
    if (bot.wanderTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      bot.targetPos = {
        x: PLAYER_RADIUS + Math.random() * (MAP_WIDTH - PLAYER_RADIUS * 2),
        y: PLAYER_RADIUS + Math.random() * (MAP_HEIGHT - PLAYER_RADIUS * 2),
      };
      bot.wanderTimer = 2000 + Math.random() * 3000;
    }

    if (bot.targetPos) {
      this.moveToward(state, bot.id, player.position, bot.targetPos);
    }
  }

  private findNearestStorageWithCoins(state: GameState, player: Player): Storage | null {
    let nearest: Storage | null = null;
    let minDist = Infinity;
    for (const s of state.storages) {
      if (s.remainingCoins <= 0) continue;
      const d = distance(player.position, s.position);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    }
    return nearest;
  }
}
