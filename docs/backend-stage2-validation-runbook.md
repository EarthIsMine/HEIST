# Backend Stage 2 - Validation Runbook

Stage 2 항목(Sticky session, room split 방지, 재연결 점검)을 실제로 확인하기 위한 실행 절차다.

## 사전조건

- Redis 사용 가능(`REDIS_URL`)
- 최소 2개 백엔드 인스턴스
- affinity 설정
  - `ENABLE_ROOM_AFFINITY=true`
  - `ROOM_AFFINITY_TOTAL_NODES=<N>`
  - `ROOM_AFFINITY_NODE_INDEX=<0..N-1>`
- canary 테스트 시
  - `ENABLE_STAGE2_CANARY=true`
  - `STAGE2_CANARY_PERCENT=<10~20 권장>`

## 1) Sticky Session 검증

참고 설정 파일: `infra/nginx/heist-sticky-session.conf.example`

1. LB sticky 설정 적용 후 두 클라이언트를 같은 네트워크에서 접속
2. 웹소켓 업그레이드 요청이 반복 재연결 시 동일 백엔드로 유지되는지 확인
3. sticky 해제 상태와 비교해 재연결 실패율 차이 측정

판정:
- 재연결 시 백엔드 hop이 비정상적으로 자주 발생하면 실패

## 2) 단일 룸 split 방지 검증

1. 동일 `roomId`로 여러 클라이언트를 거의 동시에 join
2. 소유 노드가 아닌 인스턴스는 `Room is assigned to another node`를 반환하는지 확인
3. 실제 게임 시작 후 동일 roomId가 복수 인스턴스에서 생성되지 않았는지 로그 확인

판정:
- 동일 roomId가 2개 이상 노드에서 동시에 생성되면 실패

## 3) 장애 시 재연결/재참여 점검

1. 플레이 중 인스턴스 1대를 강제 종료
2. 클라이언트 자동 재연결 후 join 재시도가 정상 동작하는지 확인
3. `/_metrics`의 아래 지표를 5~10분 관찰
  - `connection.recent.reconnectFailureRatePct`
  - `connection.recent.joinFailureRatePerMin`
  - `/health` status

판정:
- `reconnectFailureRatePct`가 10% 이상으로 5분 지속 시 실패
- `/health=degraded`가 5분 이상 지속 시 실패

## 4) 카나리 배포 점검

1. `ENABLE_STAGE2_CANARY=true`, `STAGE2_CANARY_PERCENT=10`으로 시작
2. 30~60분 관찰 후 문제 없으면 25% -> 50% -> 100% 단계 상승
3. 단계마다 reconnect/join 실패율, 룸 split 여부를 기록

롤백:
- 지표 악화 또는 룸 split 발생 시 즉시 canary 비율을 이전 단계로 복구
