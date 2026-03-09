# Backend Nest Full Cutover Checklist

비운영(개발) 환경에서 `packages/backend`를 제거하고 `packages/backend-nest`로 완전 전환하기 위한 작업 순서.

## 원칙

- 순서를 건너뛰지 않는다.
- 각 단계 완료 시 최소 스모크 테스트를 수행한다.
- 롤백이 필요하면 해당 단계 커밋으로 되돌린다.
- 단계별 수행이 끝날 때마다 커밋한다.
- 커밋 제목 형식은 `feat:`/`fix:`/`refactor:` + 한글 설명으로 통일한다.
- 코드 주석은 블록 단위로 맥락이 보이게 작성하고, 주석 문구는 한글로 작성한다.

## 1) 기준선 고정 (브랜치/백업)

- [x] 전환 전용 브랜치 생성 (`feat/nest-full-cutover`)
- [x] 현재 동작 상태 태그 또는 커밋 SHA 기록
- [x] `.env`/배포 변수 스냅샷 저장

완료 기준:
- [x] 되돌릴 기준점이 명확하다.

## 2) 실행 엔트리 Nest 기준으로 통일

- [x] 루트 `package.json`에서 `dev` 기본 백엔드를 `backend-nest`로 전환
- [x] `build/start` 관련 스크립트가 Nest 산출물(`dist/main.js`) 기준인지 확인
- [x] PM2/프로세스 매니저 설정(`ecosystem.config.cjs`)이 Nest 엔트리 기준인지 정렬
- [x] README 실행 가이드를 Nest 기준으로 수정

완료 기준:
- [x] `npm run dev` 시 프론트 + Nest 조합으로 정상 구동된다.

## 3) 네트워크/프록시 라우팅 단일화

- [x] Nginx/Ingress 설정에서 legacy 업스트림 의존 제거
- [x] WebSocket 업그레이드 경로가 Nest 포트로 향하는지 검증
- [x] 로컬/스테이징 포트 충돌 여부 확인

완료 기준:
- [x] HTTP + WS 모두 Nest만 타고 동작한다.

## 4) 기능 동등성 스모크 테스트

- [x] 로비 진입/방 생성/방 참가
- [x] 게임 시작/틱 진행/결과 처리
- [x] 재연결(소켓 끊김 후 재입장) 시나리오
- [x] 운영 엔드포인트 (`/health`, `/_metrics`, `/_state/*`) 응답 검증
- [x] `scripts/canary-smoke.sh` 재사용 가능 시 Nest 대상 실행

완료 기준:
- [x] 사용자 핵심 플로우에서 blocker 이슈가 없다.

## 5) 카나리 토글 제거 및 상수화

- [x] `NEST_TRAFFIC_CANARY_*` 기반 분기 코드 제거 또는 `always nest`로 단순화
- [x] `route=legacy` 반환 경로 제거
- [x] migration 전용 엔드포인트(`/_migrate/*`) 유지/삭제 여부 결정 후 반영

완료 기준:
- [x] 런타임 라우팅 의사결정이 더 이상 legacy를 참조하지 않는다.

## 6) 레거시 backend 의존 코드 정리

- [x] 프론트/스크립트/문서에서 `packages/backend` 참조 전수 검색 (`rg "packages/backend|dev:backend"`)
- [x] CI 명령에서 legacy 경로 제거
- [x] 배포 설정(예: Railway/Vercel/컨테이너) legacy 엔트리 제거

완료 기준:
- [x] 코드/설정/문서에 legacy 실행 경로가 남아있지 않다.

## 7) legacy 패키지 제거

- [x] `packages/backend` 디렉터리 제거
- [x] 워크스페이스 의존성 정리 후 `npm install` 재실행
- [x] 타입체크/빌드 재검증 (`npm run typecheck`, `npm run build`)

완료 기준:
- [x] 모노레포가 Nest 단일 백엔드로 정상 빌드된다.

## 8) 최종 검증 및 릴리즈 준비

- [x] 로컬 E2E 스모크 1회 이상 재실행
- [x] 모니터링 대시보드/알람 경로가 Nest 지표 기준인지 확인
- [x] 전환 결과 문서화 (`what changed`, `known issues`, `rollback point`)

완료 기준:
- [x] 다음 개발 사이클에서 legacy 없이 기능 개발 가능하다.

## 권장 커밋 분할

- [x] Commit A: `feat: 실행 엔트리/문서 전환`
- [x] Commit B: `refactor: 라우팅 및 카나리 분기 단순화`
- [x] Commit C: `fix: 레거시 backend 제거 후 CI/배포 경로 정리`

## 빠른 검증 명령

```bash
npm run dev
npm run typecheck
npm run build
npm run canary:smoke -w packages/backend-nest
```
