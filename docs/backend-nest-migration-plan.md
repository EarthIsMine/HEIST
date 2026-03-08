# Backend Nest Migration Plan

기존 `packages/backend`(Express + Socket.IO)를 유지한 채 `packages/backend-nest`를 병행 운영하며 단계적으로 이관한다.

## 원칙

- Big-bang 전환 금지, 단계별 카나리 전환
- 단계 완료마다 커밋 + 실행 검증
- 관측/리스크 게이트(`/_metrics`, `/_state/*`) 먼저 이식 후 트래픽 이관

## 단계

1. Nest 병행 실행 골격 [완료]
- Nest 앱 신규 패키지 생성
- `/health`, `/_metrics`, `/_state/consistency` 기초 엔드포인트 제공
- (옵션) legacy 백엔드 read-proxy 연결

2. 공통 운영 엔드포인트 이식 [진행중]
- Stage1~4 운영 엔드포인트를 Nest에 동일 스키마로 제공
- 모니터링 대시보드가 Nest/legacy 구분 없이 읽도록 정렬

3. Room Lifecycle API 이식 [진행중]
- `join_room` 관련 검증/아이템포턴시/샤딩 게이트를 Nest 서비스로 이식
- 카나리 룸 타입만 Nest 경로 사용

4. 실시간 이벤트 계층 이식 [진행중]
- Socket Gateway를 Nest로 추가
- room partition ordering/queue 정책 반영

5. 상태 저장/복구 체계 이식
- `RoomStateRepository` 및 정합성 검사 도구 이식
- 복구 드릴 API 및 risk gate 연동

6. 점진 트래픽 전환
- `10% -> 25% -> 50% -> 100%` 룸 타입/비율 카나리
- 게이트 위반 시 즉시 롤백

## 완료 기준

- Stage4 리스크 게이트를 Nest에서도 동일 충족
- legacy backend 의존 read/write 경로 제거
- 운영 엔드포인트/대시보드 완전 이관

## 현재 상태

- 완료: 1단계
- 완료: 2단계(운영 엔드포인트 확장)
- 진행중: 4단계(Socket Gateway에 `confirm_entry/select_team/ready`까지 이식)
- 다음: 5단계(상태 저장/복구 체계 이식)

## 2단계 환경변수

- `NEST_LEGACY_READ_PROXY=true|false`
- `NEST_LEGACY_WRITE_PROXY=true|false`
- `LEGACY_BACKEND_URL=http://127.0.0.1:3001`
