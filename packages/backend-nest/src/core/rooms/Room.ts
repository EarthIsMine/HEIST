import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  RoomInfo,
  RoomPlayer,
  Team,
  Vec2,
  GameResult,
} from '@heist/shared';
import { MAX_PLAYERS, ENTRY_FEE_LAMPORTS, COP_COUNT, THIEF_COUNT } from '@heist/shared';
import { GameLoop } from '../game/GameLoop.js';
import type { PlayerInit } from '../game/GameState.js';

import { log } from '../utils/logger.js';

type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const BOT_NAMES_COP = ['Officer Bot', 'Deputy Bot'];
const BOT_NAMES_THIEF = ['Bandit Bot', 'Rogue Bot', 'Shadow Bot', 'Phantom Bot'];

export class Room {
  id: string;
  name: string;
  players: Map<string, RoomPlayer> = new Map();
  socketMap: Map<string, string> = new Map();
  teamPreference: Map<string, Team> = new Map();
  gameLoop: GameLoop | null = null;
  phase: 'filling' | 'head_start' | 'playing' | 'ended' = 'filling';
  onCleanup?: (playerIds: string[]) => void;

  private io: TypedIO;
  private minPlayers: number;

  constructor(id: string, name: string, io: TypedIO, minPlayers: number) {
    this.id = id;
    this.name = name;
    this.io = io;
    this.minPlayers = minPlayers;
  }

  addPlayer(socketId: string, name: string, walletAddress: string): boolean {
    if (this.players.size >= MAX_PLAYERS) return false;
    if (this.phase !== 'filling') return false;

    // Prevent duplicate wallet address
    for (const p of this.players.values()) {
      if (p.walletAddress === walletAddress) return false;
    }

    this.players.set(socketId, {
      id: socketId,
      name,
      walletAddress,
      ready: false,
      confirmed: ENTRY_FEE_LAMPORTS === 0,
      selectedTeam: 'thief',
    });
    this.teamPreference.set(socketId, 'thief');
    this.socketMap.set(socketId, walletAddress);

    this.broadcastRoomState();
    return true;
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
    this.socketMap.delete(socketId);
    this.teamPreference.delete(socketId);

    if (this.gameLoop) {
      log('Room', `Player ${socketId} left during game, converting to bot`);
      this.gameLoop.convertToBot(socketId);
      return;
    }

    this.broadcastRoomState();
  }

  confirmEntry(socketId: string): boolean {
    const player = this.players.get(socketId);
    if (!player) return false;
    player.confirmed = true;
    this.broadcastRoomState();
    return true;
  }

  selectTeam(socketId: string, team: Team): { ok: boolean; error?: string } {
    const player = this.players.get(socketId);
    if (!player) return { ok: false, error: 'Not in room' };

    // Don't count the player's current selection (they're switching)
    let teamCount = 0;
    for (const [id, pref] of this.teamPreference) {
      if (id !== socketId && pref === team) teamCount++;
    }

    const limit = team === 'cop' ? COP_COUNT : THIEF_COUNT;
    if (teamCount >= limit) {
      return { ok: false, error: `${team === 'cop' ? 'Police' : 'Thief'} team is full` };
    }

    this.teamPreference.set(socketId, team);
    player.selectedTeam = team;
    this.broadcastRoomState();
    log('Room', `Player ${socketId} selected team: ${team}`);
    return { ok: true };
  }

  setReady(socketId: string): void {
    const player = this.players.get(socketId);
    if (!player) return;
    player.ready = true;
    this.broadcastRoomState();
    this.checkAllReady();
  }

  handleInputMove(socketId: string, direction: Vec2): void {
    this.gameLoop?.applyInput(socketId, direction);
  }

  handleRequestSkill(socketId: string, skill: string, targetId?: string): void {
    this.gameLoop?.requestSkill(socketId, skill, targetId);
  }

  handleCancelSkill(socketId: string): void {
    this.gameLoop?.cancelSkill(socketId);
  }

  private checkAllReady(): void {
    const realPlayers = [...this.players.values()];
    if (realPlayers.length < this.minPlayers) return;
    const allReady = realPlayers.every((p) => p.ready);
    if (!allReady) return;

    this.startGame();
  }

  private startGame(): void {
    log('Room', `Starting game in room ${this.id} with bots`);

    const teamAssignments = new Map<string, Team>();
    let copCount = 0;
    let thiefCount = 0;

    for (const id of this.players.keys()) {
      const preferred = this.teamPreference.get(id) || 'thief';
      let assigned: Team;

      if (preferred === 'cop' && copCount < COP_COUNT) {
        assigned = 'cop';
      } else if (preferred === 'thief' && thiefCount < THIEF_COUNT) {
        assigned = 'thief';
      } else if (copCount < COP_COUNT) {
        assigned = 'cop';
      } else {
        assigned = 'thief';
      }

      teamAssignments.set(id, assigned);
      if (assigned === 'cop') copCount++;
      else thiefCount++;
    }

    const botIds: string[] = [];
    const playerInits: PlayerInit[] = [];

    for (const [socketId, p] of this.players) {
      playerInits.push({
        id: socketId,
        walletAddress: p.walletAddress,
        name: p.name,
        team: teamAssignments.get(socketId)!,
      });
    }

    // Fill cops with bots
    let botCopIdx = 0;
    while (copCount < COP_COUNT) {
      const botId = `bot_cop_${botCopIdx}`;
      playerInits.push({
        id: botId,
        walletAddress: 'bot',
        name: BOT_NAMES_COP[botCopIdx % BOT_NAMES_COP.length],
        team: 'cop',
      });
      botIds.push(botId);
      copCount++;
      botCopIdx++;
    }

    // Fill thieves with bots
    let botThiefIdx = 0;
    while (thiefCount < THIEF_COUNT) {
      const botId = `bot_thief_${botThiefIdx}`;
      playerInits.push({
        id: botId,
        walletAddress: 'bot',
        name: BOT_NAMES_THIEF[botThiefIdx % BOT_NAMES_THIEF.length],
        team: 'thief',
      });
      botIds.push(botId);
      thiefCount++;
      botThiefIdx++;
    }

    log('Room', `Players: ${playerInits.map((p) => `${p.name}(${p.team})`).join(', ')}`);
    log('Room', `Bots: ${botIds.length}`);

    this.gameLoop = new GameLoop(
      playerInits,
      (snapshots) => {
        // GameLoop가 미리 만든 player별 스냅샷을 그대로 전달해 재계산을 피한다.
        for (const [socketId] of this.players) {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            const snapshot = snapshots.get(socketId);
            if (snapshot) {
              socket.emit('state_snapshot', snapshot);
            }
          }
        }
      },
      (result: GameResult) => {
        this.phase = 'ended';
        this.io.to(this.id).emit('game_ended', result);
        log('Room', `Game ended: ${result.winningTeam} wins (${result.reason})`);
        this.cleanup();
      },
      (event) => {
        if (event.type === 'player_jailed') {
          this.io.to(this.id).emit('player_jailed', event.data.playerId as string);
        } else if (event.type === 'player_freed') {
          this.io.to(this.id).emit('player_freed', event.data.playerId as string);
        } else if (event.type === 'player_disguised') {
          this.io.to(this.id).emit('player_disguised', event.data.playerId as string);
        } else if (event.type === 'disguise_revealed') {
          this.io.to(this.id).emit('disguise_revealed', event.data.playerId as string);
        } else if (event.type === 'wall_placed') {
          this.io.to(this.id).emit('wall_placed', event.data.obstacleId as string);
        } else if (event.type === 'wall_removed') {
          this.io.to(this.id).emit('wall_removed', event.data.obstacleId as string);
        }
      },
      botIds,
      this.id,
    );

    for (const [socketId] of this.players) {
      const team = teamAssignments.get(socketId)!;
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('game_started', {
          yourTeam: team,
          snapshot: this.gameLoop.getSnapshot(),
        });
      }
    }

    this.phase = 'head_start';
    this.gameLoop.start();
  }

  private broadcastRoomState(): void {
    this.io.to(this.id).emit('room_state', this.toRoomInfo());
  }

  toRoomInfo(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      players: [...this.players.values()],
      maxPlayers: MAX_PLAYERS,
      entryFeeLamports: ENTRY_FEE_LAMPORTS,
    };
  }

  private cleanup(): void {
    this.gameLoop?.stop();
    this.gameLoop = null;

    const playerIds = [...this.players.keys()];

    // Remove all players from the Socket.IO room so they can rejoin fresh
    for (const socketId of playerIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.leave(this.id);
        socket.data.roomId = '';
      }
    }
    this.players.clear();
    this.socketMap.clear();
    this.teamPreference.clear();

    this.onCleanup?.(playerIds);
    log('Room', `Room ${this.id} cleaned up`);
  }

  abort(reason: string): void {
    if (!this.gameLoop) return;
    log('Room', `Aborting game in room ${this.id}: ${reason}`);
    this.io.to(this.id).emit('game_aborted', {
      reason,
      refundTxSignatures: [],
    });
    this.cleanup();
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }
}
