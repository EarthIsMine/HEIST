# Backend Stage 6 - Nest Traffic Rollout Runbook

Nest 병행 이관의 마지막 단계로, 트래픽을 `10% -> 25% -> 50% -> 100%`로 점진 전환한다.

## 현재 체크포인트

- [x] `10%` + `strict=true` 동작 검증 완료
- [x] 비대상 룸은 `route=legacy`로 거절 확인
- [x] 대상 룸은 Nest 수용(`ok=true`) 확인

## 승격 절차

1. 비율 변경
- `NEST_TRAFFIC_CANARY_PERCENT=25` (다음 단계는 `50`, `100`)

2. 스모크 검증
- `/_migrate/room/decision`으로 allow/deny roomId 확보
- `/_migrate/room/join`으로 allow/deny 각각 기대 결과 확인
- `0%`/`100%` 특수 케이스는 단방향(deny-only/allow-only) 검증으로 자동 처리

3. 리스크 게이트 확인
- `/_metrics.operations.stage4RiskGates.rollbackRecommended=false`
- `/_metrics.operations.stage4RiskGates.scaleOutAllowed=true`
- `/_metrics.consistency.lastOk=true`

4. 관측 유지
- 단계별 최소 30분 관측 후 다음 비율로 승격

## 롤백 기준

- `rollbackRecommended=true`
- `scaleOutAllowed=false`
- `/_state/consistency.ok=false` 또는 연속 실패 증가

## 빠른 실행 명령

```bash
# 서버 실행 예시(25% 단계)
NEST_TRAFFIC_CANARY_ENABLED=true \
NEST_TRAFFIC_CANARY_STRICT=true \
NEST_TRAFFIC_CANARY_PERCENT=25 \
NEST_TRAFFIC_CANARY_ROOM_TYPES=default \
npm run dev -w packages/backend-nest
```

```bash
# 스모크 체크 자동 실행
npm run canary:smoke -w packages/backend-nest
```
