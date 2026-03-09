function hashRoomId(roomId: string): number {
  // 룸ID를 균일 분산하기 위한 경량 해시(FNV 계열)
  let hash = 2166136261;
  for (let i = 0; i < roomId.length; i += 1) {
    hash ^= roomId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getShardId(roomId: string, shardCount: number): number {
  if (shardCount <= 1) return 0;
  return hashRoomId(roomId) % shardCount;
}

export function buildSuggestedRoomId(shardId: number): string {
  const suffix = Date.now().toString(36).slice(-5);
  return `room-s${shardId}-${suffix}`;
}

