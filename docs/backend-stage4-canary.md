# Backend Stage 4 - Partial Canary by Room Type

Stage 4 기능을 일부 룸 타입에만 점진 적용하기 위한 카나리 정책.

## 정책

- room type 판별:
  - `ranked:abc123` -> `ranked`
  - `ranked-abc123` -> `ranked`
  - 그 외 -> `default`
- 카나리 대상 타입 + 비율 조건을 동시에 만족한 룸에만 Stage 4 기능 적용

## 적용 대상 기능

- `join_room` idempotency 캐시
- room 단위 직렬 처리 큐(message ordering)
- room 메타상태 외부 저장소 동기화
- 정합성 검사 리포트 대상

## 환경변수

- `ENABLE_STAGE4_ROOMTYPE_CANARY=true|false` (기본 `false`)
- `STAGE4_CANARY_ROOM_TYPES=default,ranked` (기본 `default`)
- `STAGE4_CANARY_PERCENT=10` (기본 `10`)

## 관측 포인트

- `/_metrics.operations.stage4Canary`
- `/_state/consistency`

