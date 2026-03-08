export type NestTrafficDecision = {
  roomId: string;
  roomType: string;
  enabled: boolean;
  allowed: boolean;
  percent: number;
  allowedRoomTypes: string[];
  bucket: number;
  reason: string;
};

function hashPercent(input: string): number {
  // roomId 해시 버킷(0~99)을 고정해 같은 룸이 항상 같은 판정을 받게 한다.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function getRoomType(roomId: string): string {
  if (roomId.includes(':')) return roomId.split(':', 1)[0];
  if (roomId.includes('-')) return roomId.split('-', 1)[0];
  return 'default';
}

export function getNestTrafficDecision(roomId: string): NestTrafficDecision {
  const enabled = process.env.NEST_TRAFFIC_CANARY_ENABLED === 'true';
  const roomType = getRoomType(roomId);
  const allowedRoomTypes = (process.env.NEST_TRAFFIC_CANARY_ROOM_TYPES || 'default')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const percentRaw = parseInt(process.env.NEST_TRAFFIC_CANARY_PERCENT || '10', 10);
  const percent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, percentRaw)) : 10;
  const bucket = hashPercent(roomId);

  if (!enabled) {
    return {
      roomId,
      roomType,
      enabled,
      allowed: true,
      percent,
      allowedRoomTypes,
      bucket,
      reason: 'canary-disabled',
    };
  }

  if (!allowedRoomTypes.includes(roomType)) {
    return {
      roomId,
      roomType,
      enabled,
      allowed: false,
      percent,
      allowedRoomTypes,
      bucket,
      reason: 'room-type-not-allowed',
    };
  }

  if (percent === 0) {
    return {
      roomId,
      roomType,
      enabled,
      allowed: false,
      percent,
      allowedRoomTypes,
      bucket,
      reason: 'percent-0',
    };
  }

  if (percent === 100) {
    return {
      roomId,
      roomType,
      enabled,
      allowed: true,
      percent,
      allowedRoomTypes,
      bucket,
      reason: 'percent-100',
    };
  }

  const allowed = bucket < percent;
  return {
    roomId,
    roomType,
    enabled,
    allowed,
    percent,
    allowedRoomTypes,
    bucket,
    reason: allowed ? 'bucket-allowed' : 'bucket-denied',
  };
}

