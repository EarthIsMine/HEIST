# Backend Stage 3 - Drain/Rebalance Runbook

Stage 3의 `drain/rebalance 운영 절차`를 앱 코드 기준으로 수행하기 위한 런북.

## 목적

- 트래픽이 몰린 노드에서 신규 유입을 줄이고 룸을 자연스럽게 비운다.
- 상태 손실 없이 노드 재배치/점검을 진행한다.

## 관련 설정

- `ENABLE_NODE_DRAIN=true`
- `DRAIN_ALLOW_EXISTING_ROOM_JOIN=true|false`

의미:

- `ENABLE_NODE_DRAIN=true`: drain 모드 활성화(신규 룸 생성 차단)
- `DRAIN_ALLOW_EXISTING_ROOM_JOIN=true`: 기존 룸 재참여 허용(완만한 drain)
- `DRAIN_ALLOW_EXISTING_ROOM_JOIN=false`: 기존 룸 재참여도 차단(빠른 drain)

## 절차

1. 대상 노드에서 `ENABLE_NODE_DRAIN=true` 적용
2. 운영 정책에 따라 `DRAIN_ALLOW_EXISTING_ROOM_JOIN` 설정
3. `/_metrics`에서 아래를 관찰
- `operations.nodeDrain`
- `rooms.count`
- `connection.recent.reconnectFailureRatePct`
4. `rooms.count`가 목표치(예: 0 또는 저수준)까지 감소하면 노드 점검/재배치 수행
5. 점검 후 drain 해제(`ENABLE_NODE_DRAIN=false`)

## 롤백 조건

- drain 후 `reconnectFailureRatePct` 급등(예: 10% 이상 5분 지속)
- drain 상태에서 join 실패율 급증으로 사용자 영향이 커질 때

## 주의사항

- `DRAIN_ALLOW_EXISTING_ROOM_JOIN=false`는 빠르지만 사용자 체감 영향이 크다.
- 가능하면 카나리 노드부터 drain 절차를 검증 후 전체 적용한다.

