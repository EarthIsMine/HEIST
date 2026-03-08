# Backend Scaling Checklist

이 문서는 대규모 트래픽 대응을 위한 실행 순서와 단계별 리스크 컷 포인트를 체크하기 위한 운영 문서다.

## 실행 순서

1. 틱 루프 최적화 + 관측성(메트릭/트레이싱)
2. Socket.IO 수평 확장 + Room Affinity
3. 게임룸 샤딩/파티셔닝 고도화
4. 서버 무상태화 + 외부 상태 저장소/메시지 버스

## Stage 1 - 틱 루프 최적화 + 관측성

### 목표

- CPU 병목, 네트워크 병목, 이벤트루프 병목을 분리 식별한다.
- 릴리즈 전후 성능 회귀를 숫자로 확인한다.

### 체크리스트

- [x] tick duration `p50/p95/p99` 수집
- [x] tick drift(스케줄 지연) 수집
- [x] overrun rate(틱 예산 초과율) 수집
- [x] snapshot 생성 시간 수집
- [x] emit 브로드캐스트 시간 수집
- [x] 이벤트루프 지연(mean/max) 수집
- [x] 룸/노드별 메트릭 로그 표준화
- [x] 부하 테스트 시나리오(룸 수, 동시접속 수, 스킬 난사) 정의
- [x] 기준 SLO 문서화

### 리스크 컷 포인트

- [x] `p99 tick duration <= 50ms` 달성 전 다음 단계 진행 금지
- [x] overrun rate `<= 1%` 달성 전 다음 단계 진행 금지
- [x] 배포 후 재접속 실패율/이탈률 악화 시 즉시 롤백

참고 문서: `docs/backend-stage1-loadtest-slo.md`

## Stage 2 - Socket.IO 수평 확장 + Room Affinity

### 목표

- 다중 인스턴스에서 룸 통신 일관성을 유지한다.
- cross-node 브로드캐스트 비용을 제어한다.

### 체크리스트

- [x] Redis adapter 구성
- [ ] load balancer sticky session 설정
- [x] room affinity 라우팅 정책 적용
- [ ] 단일 룸이 여러 노드로 쪼개지지 않도록 검증
- [ ] 장애 시 재연결/재참여 시나리오 점검
- [x] 카나리(일부 룸만) 배포 플래그 적용

### 리스크 컷 포인트

- [ ] cross-node emit 지연 급증 시 롤백
- [ ] 룸 유실/중복 생성 감지 시 롤백
- [ ] sticky session 미보장 환경에서는 전체 전환 금지

참고 문서: `docs/backend-stage2-socket-scaling.md`
검증 런북: `docs/backend-stage2-validation-runbook.md`

인프라 완료 가정으로 Stage 2의 LB/검증은 운영 단계에서 마무리.

## Stage 3 - 게임룸 샤딩/파티셔닝 고도화

### 목표

- 핫 룸/핫 노드 편중을 완화한다.
- 고부하 시간대에도 예측 가능한 지연을 유지한다.

### 체크리스트

- [x] shard key 정책(지역, 룸ID 해시 등) 확정
- [x] 노드별 룸 상한/CPU 상한 기반 배치기 적용
- [x] 핫 샤드 감지 및 신규 룸 우회 정책 적용
- [x] drain/rebalance 운영 절차 문서화

### 리스크 컷 포인트

- [ ] 특정 shard의 p99 지연이 타 shard 대비 과도하면 전환 중단
- [ ] 재배치 시 활성 룸 상태 손실 가능성 발견 시 전환 중단

참고 문서: `docs/backend-stage3-sharding.md`
운영 런북: `docs/backend-stage3-drain-rebalance-runbook.md`

## Stage 4 - 서버 무상태화 + 외부 상태 저장소/메시지 버스

### 목표

- 프로세스 장애 시 룸 상태 복구 가능성을 확보한다.
- 웹소켓 게이트웨이와 게임 상태 처리를 느슨하게 결합한다.

### 체크리스트

- [x] authoritative state 저장 전략(메모리+스냅샷/이벤트소싱) 확정
- [x] 메시지 순서 보장 정책(room partition key) 확정
- [x] idempotency key/중복 처리 규칙 확정
- [x] 장애 복구(runbook)와 데이터 정합성 검사 도구 준비
- [x] 부분 전환(일부 룸 타입) 카나리 실행

### 리스크 컷 포인트

- [x] 상태 정합성 검증 실패 시 즉시 롤백
- [x] 이벤트 중복/역순 처리 비율 기준 초과 시 롤백
- [x] 복구 시간(RTO)/허용 손실(RPO) 미달 시 확장 금지

참고 문서: `docs/backend-stage4-state-strategy.md`
순서 보장 문서: `docs/backend-stage4-message-ordering.md`
복구/정합성 런북: `docs/backend-stage4-recovery-consistency-runbook.md`
카나리 문서: `docs/backend-stage4-canary.md`
리스크 게이트 문서: `docs/backend-stage4-risk-gates.md`
