function hashPercent(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function getRoomType(roomId: string): string {
  // roomId 규약 예시:
  // - "ranked:abc123" -> type=ranked
  // - "ranked-abc123" -> type=ranked
  if (roomId.includes(':')) return roomId.split(':', 1)[0];
  if (roomId.includes('-')) return roomId.split('-', 1)[0];
  return 'default';
}

export function isStage4EnabledForRoom(roomId: string): boolean {
  const canaryEnabled = process.env.ENABLE_STAGE4_ROOMTYPE_CANARY === 'true';
  if (!canaryEnabled) return true;

  const type = getRoomType(roomId);
  const allowedTypes = (process.env.STAGE4_CANARY_ROOM_TYPES || 'default')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!allowedTypes.includes(type)) return false;

  const percent = parseInt(process.env.STAGE4_CANARY_PERCENT || '10', 10);
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 10;
  if (safePercent === 0) return false;
  if (safePercent === 100) return true;

  return hashPercent(roomId) < safePercent;
}

