import type {
  PlayerId,
  RoomId,
  Team,
  Vec2,
  RoomInfo,
  StateSnapshot,
  GameResult,
} from './types';

export interface ClientToServerEvents {
  list_rooms: (
    ack: (rooms: RoomInfo[]) => void,
  ) => void;

  join_room: (
    roomId: RoomId,
    payload: { name: string; walletAddress: string; requestId?: string },
    ack: (result: { ok: boolean; error?: string; retryAfterSec?: number; suggestedRoomId?: string }) => void,
  ) => void;

  confirm_entry: (
    txSignature: string,
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  select_team: (
    team: Team,
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  ready: () => void;

  input_move: (direction: Vec2) => void;

  request_steal: (storageId: string) => void;
  request_break_jail: () => void;
  request_arrest: (targetId: PlayerId) => void;
  request_disguise: () => void;
  request_build_wall: () => void;
  cancel_skill: () => void;
}

export interface ServerToClientEvents {
  room_state: (room: RoomInfo) => void;

  game_started: (payload: {
    yourTeam: Team;
    snapshot: StateSnapshot;
  }) => void;

  state_snapshot: (snapshot: StateSnapshot) => void;

  skill_started: (payload: {
    playerId: PlayerId;
    skill: string;
    targetId: string;
  }) => void;

  skill_interrupted: (payload: {
    playerId: PlayerId;
    reason: string;
  }) => void;

  player_jailed: (playerId: PlayerId) => void;
  player_freed: (playerId: PlayerId) => void;
  player_disguised: (playerId: PlayerId) => void;
  disguise_revealed: (playerId: PlayerId) => void;
  wall_placed: (obstacleId: string) => void;
  wall_removed: (obstacleId: string) => void;
  storage_emptied: (storageId: string) => void;
  cops_stunned: (copIds: PlayerId[]) => void;

  game_ended: (result: GameResult) => void;

  game_aborted: (payload: {
    reason: string;
    refundTxSignatures: string[];
  }) => void;

  kicked: (reason: string) => void;

  error: (payload: { code: string; message: string }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  playerId: PlayerId;
  roomId: RoomId;
  walletAddress: string;
}
