# Backend Stage 1 - Load Test & SLO

Stage 1(틱 루프 최적화 + 관측성) 완료 판정을 위한 부하 테스트 시나리오와 SLO 기준 문서다.

## 측정 지표

- `tick.p95`, `tick.p99`, `tick.max` (ms)
- `drift.p95` (ms)
- `overrunRate` (%)
- `eventLoop.maxMs` (ms)
- `/health` 상태(`ok` 또는 `degraded`)
- `connection.recent.reconnectFailureRatePct` (%)
- `connection.recent.joinFailureRatePerMin`

## 부하 테스트 시나리오

1. Baseline
- 조건: 1개 룸, 6명(실유저 또는 봇) 10분 플레이
- 목적: 정상 상태 기준치 측정

2. Normal Peak
- 조건: 20개 룸 동시 운영, 룸당 6명, 스킬 사용 일반 빈도
- 목적: 예상 피크에서 안정성 검증

3. Stress
- 조건: 50개 룸 동시 운영, 룸당 6명, 이동 입력/스킬 이벤트 고빈도
- 목적: 한계 구간의 열화 양상 확인

4. Spike
- 조건: 1분 내 다수 룸 급증(예: 0 -> 30개), 5분 유지
- 목적: 급격한 세션 증가 대응 확인

5. Recovery
- 조건: Stress 종료 후 트래픽을 Baseline으로 복귀
- 목적: 성능 회복 시간/잔류 지연 확인

## Stage 1 SLO (승인 게이트)

- `tick.p99 <= 50ms` (10분 윈도우)
- `overrunRate <= 1%` (10분 윈도우)
- `eventLoop.maxMs <= 100ms` (10분 윈도우)
- `/health`가 테스트 시간의 `99%` 이상 `ok`
- `reconnectFailureRatePct <= 5%` (5분 윈도우)
- `joinFailureRatePerMin <= 0.5` (5분 윈도우, 과부하 차단 미사용 기준)

하나라도 미달이면 Stage 2 진행 금지.

## 운영 규칙

- 카나리 구간에서 먼저 측정 후 전체 반영
- 회귀 발생 시 직전 릴리즈로 즉시 롤백
- SLO 미달 상태에서 신규 룸 확장 금지

## 즉시 롤백 조건

- `reconnectFailureRatePct > 10%`가 5분 이상 지속
- `joinFailureRatePerMin > 2`가 5분 이상 지속
- `/health=degraded` 상태가 5분 이상 지속
