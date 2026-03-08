# Backend Stage 3 - App-Level Sharding

인프라 테스트가 어려운 상황에서 애플리케이션 코드 기준으로 먼저 적용한 Stage 3 항목 정리.

## 적용된 항목

- shard key 정책: `roomId` 해시 기반 샤드 매핑
- 노드 룸 상한: `MAX_ACTIVE_ROOMS`
- 샤드 룸 상한: `MAX_ROOMS_PER_SHARD`
- 핫샤드 우회: `suggestedRoomId` 반환(클라이언트 입력 자동 갱신)

## 환경변수

- `SHARD_COUNT` (기본 `16`)
- `MAX_ACTIVE_ROOMS` (기본 `200`)
- `MAX_ROOMS_PER_SHARD` (기본 `25`)
- `ENABLE_HOT_SHARD_SUGGESTION` (기본 `true`)
- `ENABLE_NODE_DRAIN` (기본 `false`)
- `DRAIN_ALLOW_EXISTING_ROOM_JOIN` (기본 `true`)

## 동작 요약

1. 신규 룸 생성 요청 시 `roomId -> shardId` 계산
2. 노드 전체 룸 상한 초과 시 생성 거절
3. 대상 샤드가 상한 초과면 생성 거절 + 대체 roomId 제안
4. 룸 생성/삭제마다 샤드 로드 메트릭 갱신

`/_metrics`의 `sharding` 블록에서 샤드별 룸 수를 확인할 수 있다.

drain/rebalance 절차는 `docs/backend-stage3-drain-rebalance-runbook.md`를 따른다.
