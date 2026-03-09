# Backend Stage 6 - Nest Traffic Rollout Runbook

이 문서는 병행 이관 당시의 카나리 전환 기록이다.
`2026-03-09` 기준으로 full cutover가 완료되어 현재는 100% Nest 단일 경로로 운영한다.

## 현재 상태

- [x] 카나리 단계 이관 기록 보존
- [x] `route=legacy` 경로 제거
- [x] migration 전용 엔드포인트(`/_migrate/*`) 제거

## 현재 스모크 절차

1. 리스크 게이트 확인
- `/_metrics.operations.stage4RiskGates.rollbackRecommended=false`
- `/_metrics.operations.stage4RiskGates.scaleOutAllowed=true`
- `/_metrics.consistency.lastOk=true`

2. 운영 상태 점검
- `GET /health`
- `GET /_state/consistency`
- `GET /_state/rooms`

## 롤백 기준(동일)

- `rollbackRecommended=true`
- `scaleOutAllowed=false`
- `/_state/consistency.ok=false` 또는 연속 실패 증가

## 빠른 실행 명령

```bash
# 서버 실행
npm run dev -w packages/backend-nest
```

```bash
# full-cutover 스모크 체크 실행
npm run canary:smoke -w packages/backend-nest
```
