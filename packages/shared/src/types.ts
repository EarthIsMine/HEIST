export type PlayerId = string;
export type RoomId = string;
export type Team = 'cop' | 'thief';
export type Phase = 'lobby' | 'head_start' | 'playing' | 'ended';
export type SkillType = 'steal' | 'break_jail' | 'arrest' | 'disguise' | 'build_wall';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  id: PlayerId;
  walletAddress: string;
  name: string;
  team: Team;
  position: Vec2;
  velocity: Vec2;
  lastDirection: Vec2;
  visionRadius: number;
  isJailed: boolean;
  isStunned: boolean;
  stunUntil: number;
  channeling: SkillType | null;
  channelingStart: number;
  channelingTarget: string | null;
  connected: boolean;
  isDisguised: boolean;
  disguiseUntil: number;
  disguiseCooldownUntil: number;
  wallCooldownUntil: number;
}

export interface Obstacle {
  id: string;
  position: Vec2;
  width: number;
  height: number;
  expiresAt?: number;
  ownerId?: string;
}

export interface Storage {
  id: string;
  position: Vec2;
  radius: number;
  totalCoins: number;
  remainingCoins: number;
}

export interface Jail {
  position: Vec2;
  radius: number;
  inmates: PlayerId[];
}

export interface RoomPlayer {
  id: PlayerId;
  name: string;
  walletAddress: string;
  ready: boolean;
  confirmed: boolean;
  selectedTeam: Team;
}

export interface RoomInfo {
  id: RoomId;
  name: string;
  players: RoomPlayer[];
  maxPlayers: number;
  entryFeeLamports: number;
}

export interface StateSnapshot {
  tick: number;
  phase: Phase;
  matchTimerMs: number;
  headStartTimerMs: number;
  players: Player[];
  storages: Storage[];
  jail: Jail;
  obstacles: Obstacle[];
  stolenCoins: number;
  teamCoins: number;
  totalCoins: number;
}

export type WinReason =
  | 'all_coins_stolen'
  | 'all_thieves_jailed'
  | 'time_expired';

export interface GameResult {
  winningTeam: Team;
  reason: WinReason;
  stolenCoins: number;
  payoutLamports: number;
  payoutTxSignatures: string[];
}
