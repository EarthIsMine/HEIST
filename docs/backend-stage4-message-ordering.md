# Backend Stage 4 - Message Ordering Policy

Stage 4의 메시지 순서 보장 정책은 `roomId`를 파티션 키로 삼고, 룸 단위 직렬 실행 큐를 적용한다.

## 정책

- partition key: `roomId`
- 처리 모드: `serialized-per-room`
- 목적: 같은 룸에서 동시 입력이 들어와도 서버 적용 순서를 결정적으로 유지

## 코드 반영

- `RoomManager`에 room operation queue 추가
- 대상 이벤트:
  - `ready`
  - `input_move`
  - `request_skill`
  - `cancel_skill`
  - `disconnect`

파일:

- `packages/backend/src/rooms/RoomManager.ts`
- `packages/backend/src/observability/MetricsRegistry.ts` (`/_metrics.operations.messageOrdering`)

## 한계

- 프로세스 내부 순서 보장이다.
- 멀티 노드 환경의 전역 순서 보장은 여전히 room affinity/sticky session/adapter 구성에 의존한다.

