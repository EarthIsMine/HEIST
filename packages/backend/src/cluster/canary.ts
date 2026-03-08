function hashPercent(roomId: string): number {
  // roomId 기반 고정 해시로 0~99 버킷을 만든다.
  let hash = 2166136261;
  for (let i = 0; i < roomId.length; i += 1) {
    hash ^= roomId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function isStage2EnabledForRoom(roomId: string): boolean {
  const canaryEnabled = process.env.ENABLE_STAGE2_CANARY === 'true';
  if (!canaryEnabled) return true;

  const percent = parseInt(process.env.STAGE2_CANARY_PERCENT || '10', 10);
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 10;
  if (safePercent === 0) return false;
  if (safePercent === 100) return true;

  // 같은 roomId는 항상 동일한 canary 판정을 받는다.
  return hashPercent(roomId) < safePercent;
}

