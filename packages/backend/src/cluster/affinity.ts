function hashRoomId(roomId: string): number {
  // 룸ID를 안정적으로 분산하기 위한 경량 해시(FNV 계열)
  let hash = 2166136261;
  for (let i = 0; i < roomId.length; i += 1) {
    hash ^= roomId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getRoomOwnerNode(roomId: string, totalNodes: number): number {
  if (totalNodes <= 1) return 0;
  // 같은 roomId는 항상 같은 노드 인덱스로 매핑된다.
  return hashRoomId(roomId) % totalNodes;
}

export function isRoomOwnedByThisNode(roomId: string): boolean {
  // affinity 미사용이면 모든 노드에서 허용한다.
  const enabled = process.env.ENABLE_ROOM_AFFINITY === 'true';
  if (!enabled) return true;

  const totalNodes = parseInt(process.env.ROOM_AFFINITY_TOTAL_NODES || '1', 10);
  const thisNode = parseInt(process.env.ROOM_AFFINITY_NODE_INDEX || '0', 10);
  // 설정이 비정상이면 안전하게 차단하지 않고 허용한다(운영 중 전면 장애 방지).
  if (!Number.isFinite(totalNodes) || totalNodes <= 1) return true;
  if (!Number.isFinite(thisNode) || thisNode < 0 || thisNode >= totalNodes) return true;

  return getRoomOwnerNode(roomId, totalNodes) === thisNode;
}
