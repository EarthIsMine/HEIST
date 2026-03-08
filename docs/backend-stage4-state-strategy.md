# Backend Stage 4 - State Strategy (Phase 1)

Stage 4 시작 단계로, 메모리 authoritative 상태 + 외부 메타상태 저장 전략을 코드에 반영했다.

## 전략

1. authoritative game state는 기존처럼 메모리(게임 루프)에서 유지
2. 복구/운영 가시성 목적의 room 메타상태를 외부 저장소에 동기화
3. 외부 저장소 장애 시에도 게임 진행은 유지(비차단, 로그 경고)

## 구현 범위

- `RoomStateRepository` 추상화
  - backend: `memory` 또는 `redis`
- 동기화 데이터
  - `roomId`, `phase`, `players`, `shardId`, `updatedAt`
- 조회 API
  - `GET /_state/rooms`
- join idempotency(Phase 1)
  - `join_room` payload의 `requestId` 기준 단기 중복 제거
  - 동일 requestId 재전송 시 동일 ack 결과 반환

## 환경변수

- `STATE_STORE_BACKEND=memory|redis` (기본 `memory`)
- `REDIS_URL` (redis 모드에서 필요)
- `JOIN_IDEMPOTENCY_TTL_MS` (기본 `30000`)
- `ENABLE_STAGE4_ROOMTYPE_CANARY` (기본 `false`)
- `STAGE4_CANARY_ROOM_TYPES` (기본 `default`)
- `STAGE4_CANARY_PERCENT` (기본 `10`)

## 파일

- `packages/backend/src/state/RoomStateRepository.ts`
- `packages/backend/src/rooms/RoomManager.ts`
- `packages/backend/src/server.ts`

## 다음 단계(Phase 2+)

- 카나리 비율 확장(10% -> 25% -> 50% -> 100%) 운영 계획 고도화
