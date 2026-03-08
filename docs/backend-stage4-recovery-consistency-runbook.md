# Backend Stage 4 - Recovery & Consistency Runbook

Stage 4의 장애 복구 절차와 데이터 정합성 검사 도구 사용법.

## 목적

- 프로세스 장애/재시작 상황에서 룸 메타상태 복구 가능성을 높인다.
- 메모리 authoritative 상태와 외부 저장소 상태의 불일치를 빠르게 탐지한다.

## 사전조건

- `STATE_STORE_BACKEND=memory|redis`
- redis 사용 시 `REDIS_URL` 설정
- 운영 점검 엔드포인트 접근 가능
  - `GET /_state/rooms`
  - `GET /_state/consistency`

## 장애 복구 절차

1. 장애 노드 격리
- 필요 시 `ENABLE_NODE_DRAIN=true`로 신규 유입 차단

2. 상태 점검
- `/_state/rooms`로 외부 저장소의 active room 메타상태 확인
- `/_state/consistency`로 정합성 리포트 확인

3. 재시작/복구
- 프로세스 재시작
- `/_metrics`, `/health`, `/_state/consistency` 순서로 정상화 확인

4. 복구 판정
- `/_state/consistency.ok=true`
- `missingInRepository`, `staleInRepository`, `mismatched` 모두 비어있음

## 데이터 정합성 검사 도구

엔드포인트:

- `GET /_state/consistency`

응답 핵심 필드:

- `ok`: 정합성 통과 여부
- `missingInRepository`: 런타임에는 있는데 저장소에 없는 룸
- `staleInRepository`: 저장소에는 있는데 런타임에 없는 룸
- `mismatched`: phase/players/shardId 불일치 목록

## 운영 액션 가이드

- `missingInRepository` 발생:
  - 저장소 쓰기 실패 로그(`StateStore`) 점검
  - 저장소 연결/권한 확인

- `staleInRepository` 발생:
  - 비정상 종료 후 cleanup 누락 가능성 점검
  - 필요 시 해당 roomId 메타상태 수동 정리

- `mismatched` 발생:
  - 룸 lifecycle 이벤트(join/disconnect/cleanup) 타이밍 점검
  - 빈도가 높으면 릴리즈 롤백 고려

