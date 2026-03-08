# Backend Stage 4 - Risk Cut Gates

Stage 4 리스크 컷 포인트를 운영 게이트로 코드화한 문서.

## 게이트 정책

1. 정합성 실패 시 즉시 롤백 권고
- 기준: `consistency.consecutiveFailures > STAGE4_MAX_CONSISTENCY_FAILURES`

2. 이벤트 중복/역순 처리 비율 초과 시 롤백 권고
- 현재 계측: join idempotency 중복률(`idempotency.duplicateRatePct`)
- 기준: `duplicateRatePct > STAGE4_MAX_DUPLICATE_RATE_PCT`

3. 복구 목표(RTO/RPO) 미달 시 확장 금지
- 기준:
  - `recovery.lastRtoSec <= STAGE4_MAX_RTO_SEC`
  - `recovery.lastRpoEvents <= STAGE4_MAX_RPO_EVENTS`
- 최근 드릴 기록이 없으면 `scaleOutAllowed=false`로 처리

## 설정값

- `STAGE4_MAX_CONSISTENCY_FAILURES` (기본 `0`)
- `STAGE4_MAX_DUPLICATE_RATE_PCT` (기본 `5`)
- `STAGE4_MAX_RTO_SEC` (기본 `300`)
- `STAGE4_MAX_RPO_EVENTS` (기본 `0`)
- `CONSISTENCY_CHECK_INTERVAL_MS` (기본 `30000`)

## 관측/운영 API

- `GET /_metrics`
  - `operations.stage4RiskGates`
  - `consistency`
  - `idempotency`
  - `recovery`
- `POST /_state/recovery-drill`
  - body: `{ "rtoSec": number, "rpoEvents": number }`

