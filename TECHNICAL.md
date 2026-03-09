# HEIST - 기술 구현 문서

> 6인 비대칭 실시간 멀티플레이어 게임의 기술적 구현을 설명하는 문서입니다.

---

## 1. 시스템 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                        Monorepo (npm workspaces)                │
│                                                                 │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────┐  │
│  │   @heist/    │   │    @heist/       │   │   @heist/      │  │
│  │   shared     │◄──│  backend-nest    │   │   frontend     │  │
│  │              │◄──│                  │   │                │  │
│  │  Types       │   │  NestJS          │   │  React + Vite  │  │
│  │  Constants   │   │  Socket.IO       │   │  Canvas 2D     │  │
│  │  Map Data    │   │  Game Loop       │   │  Zustand       │  │
│  │  Protocol    │   │  Solana Payout   │   │  Socket.IO     │  │
│  └──────────────┘   └────────┬─────────┘   └───────┬────────┘  │
│                              │                      │           │
└──────────────────────────────┼──────────────────────┼───────────┘
                               │   Socket.IO (WS)     │
                               │◄─────────────────────┘
                               │
                        ┌──────┴──────┐
                        │   Solana    │
                        │   Devnet    │
                        └─────────────┘
```

**서버-권위(Server-Authoritative) 모델**을 채택하여 모든 게임 로직이 서버에서 실행됩니다. 클라이언트는 입력만 전송하고 서버가 계산한 스냅샷을 수신하여 렌더링합니다. 이를 통해 치트 방지와 동기화 일관성을 보장합니다.

---

## 2. 모노레포 구조

npm workspaces 기반 모노레포로 3개 패키지를 관리합니다.

| 패키지 | 역할 | 주요 의존성 |
|--------|------|-------------|
| `@heist/shared` | 타입, 상수, 맵 데이터, 소켓 프로토콜 정의 | TypeScript |
| `@heist/backend-nest` | 게임 서버 (Nest Gateway + 런타임 코어) | NestJS, Socket.IO, @solana/web3.js |
| `@heist/frontend` | 게임 클라이언트 (렌더링, 입력, UI) | React, Vite, Zustand, styled-components, Socket.IO Client |

`@heist/shared`는 Nest 백엔드와 프론트엔드 양쪽에서 참조하여 **타입 안전한 통신 프로토콜**을 보장합니다.

---

## 3. 백엔드 구현

### 3.1 서버 초기화

`NestJS` 애플리케이션 위에서 `Socket.IO Gateway`를 통해 실시간 이벤트를 처리합니다.

```
NestJS (HTTP + WebSocket Gateway)
  └── Socket.IO (WebSocket + long-polling fallback)
       ├── CORS 설정 (프론트엔드 origin 허용)
       └── TypeScript 제네릭으로 타입 안전한 이벤트 처리
```

### 3.2 방(Room) 관리 시스템

```
RoomManager
  ├── rooms: Map<roomId, Room>
  ├── createRoom() → Room
  ├── joinRoom(roomId, socket, playerInfo)
  ├── removeRoom(roomId)
  └── listRooms() → RoomInfo[]

Room
  ├── players: Map<playerId, {socket, name, team, wallet, ready}>
  ├── gameLoop: GameLoop | null
  ├── phase: 'waiting' | 'playing' | 'ended'
  ├── selectTeam(playerId, team)
  ├── setReady(playerId)
  └── startGame() → GameLoop 생성
```

**방 생명주기:**
1. 플레이어가 `join_room` 이벤트로 방 참가
2. 팀 선택(`select_team`) 후 준비(`ready`) 상태로 전환
3. 최소 인원이 준비되면 자동 시작, 빈 자리는 봇으로 충원
4. 게임 종료 또는 비정상 종료 시 방 정리

### 3.3 게임 루프 (20Hz Tick)

```
GameLoop (50ms 간격)
  │
  ├── tick()
  │   ├── 1. 입력 처리 (input_move 반영)
  │   ├── 2. 봇 AI 업데이트 (BotAI.decide())
  │   ├── 3. 물리 연산 (이동 + 충돌 감지)
  │   ├── 4. 스킬 처리 (채널링 진행/완료 판정)
  │   ├── 5. 승리 조건 체크
  │   └── 6. 스냅샷 생성 → 플레이어별 필터링 → 전송
  │
  └── 게임 페이즈 상태 머신
       waiting → head_start (5초) → playing (5분) → ended
```

**틱 레이트 20Hz (50ms)** 를 선택한 이유:
- 실시간 반응성과 서버 부하의 균형
- 타 게임 서버(15~30Hz)와 유사한 업데이트 빈도
- 각 틱마다 전체 게임 상태를 시뮬레이션하고 클라이언트에 전송

### 3.4 물리 시스템

#### 이동 처리
```
movePlayer(player, direction, dt)
  1. 입력 방향 벡터 정규화
  2. 속도 = PLAYER_SPEED × 이동속도배율 (채널링 시 0.4배)
  3. 다음 위치 = 현재 위치 + 방향 × 속도 × dt
  4. 장애물 충돌 체크 (AABB)
  5. 맵 경계 클램핑
  6. 위치 업데이트
```

#### 충돌 감지 (AABB)
플레이어와 장애물 모두 축 정렬 바운딩 박스(Axis-Aligned Bounding Box)로 처리합니다. X축과 Y축을 독립적으로 체크하여 벽 미끄러짐(wall sliding)을 구현합니다.

#### 시야(LOS) 계산
```
hasLineOfSight(from, to, obstacles)
  1. from→to 선분 생성
  2. 모든 장애물 사각형과 선분-사각형 교차 테스트
  3. 하나라도 교차하면 false (시야 차단)
  4. 교차 없으면 true (시야 확보)
```

선분-사각형 교차 테스트는 사각형의 4개 변에 대해 선분-선분 교차를 계산합니다.

### 3.5 스킬 시스템

각 스킬은 독립된 함수로 모듈화되어 있습니다.

| 스킬 | 함수 | 로직 |
|------|------|------|
| **Steal** | `tryStartSteal()` | 저장소 근접 확인 → 채널링 시작 (5초) → 틱마다 코인 5개 회수 → 저장소 비면 완료 |
| **Break Jail** | `tryStartBreakJail()` | 감옥 근접 확인 → 수감자 존재 확인 → 채널링 (5초) → 동료 전원 석방 |
| **Arrest** | `tryArrest()` | 도둑 근접 확인 → 즉시 체포 → 도둑 감옥 텔레포트 → 경찰 2초 스턴 |
| **Disguise** | `tryDisguise()` | 즉시 발동 → 10초간 적에게 경찰로 표시 → 쿨다운 30초 |
| **Build Wall** | `tryBuildWall()` | 코인 10개 소모 → 임시 장애물 생성 (120x20px, 15초) → 쿨다운 10초 |

**채널링 시스템**: Steal과 Break Jail은 채널링 스킬로, 시작 시점에 `channelingSkill`과 `channelingStart`를 기록하고 각 틱에서 경과 시간을 확인하여 완료를 판정합니다. 플레이어가 범위를 벗어나거나 Space키로 취소하면 채널링이 중단됩니다.

### 3.6 스냅샷 필터링 (안티치트)

서버에서 클라이언트로 전송되는 상태 스냅샷은 **플레이어별로 필터링**됩니다.

```
createFilteredSnapshot(fullState, playerId)
  1. 요청 플레이어의 팀과 위치 확인
  2. 아군은 항상 포함
  3. 적 플레이어는 다음 조건을 모두 충족해야 포함:
     a. 거리가 시야 반경 이내
     b. LOS(Line of Sight) 확보 (장애물 미차단)
  4. 변장(Disguise) 중인 도둑은 경찰 팀으로 표시
```

이 방식으로 클라이언트는 자신이 볼 수 있는 적만 수신하므로, 클라이언트 측 핵(맵핵 등)이 불가능합니다.

### 3.7 봇 AI

빈 플레이어 슬롯을 채우는 AI 봇 시스템입니다.

```
BotAI.decide(bot, gameState)
  도둑 봇:
    1. 수감된 동료가 있으면 → 감옥으로 이동 → Break Jail
    2. 가장 가까운 저장소로 이동 → Steal
    3. 근처에 적이 보이면 회피

  경찰 봇:
    1. 시야 내 가장 가까운 도둑 탐색
    2. 발견 시 → 추적 → 근접하면 Arrest
    3. 미발견 시 → 랜덤 순찰
```

### 3.8 Solana 블록체인 연동

#### 에스크로 입금 검증
```
verifyEscrowDeposit(txSignature, walletAddress)
  1. 트랜잭션 서명으로 온체인 확인
  2. 송금자 지갑 주소 일치 확인
  3. 입금액 검증
  4. 성공 시 게임 참가 허용
```

#### 승자 정산
```
distributePayout(winners, totalPool)
  1. 게임 종료 시 승리 팀 결정
  2. 에스크로 지갑에서 승리 팀원에게 균등 분배
  3. 트랜잭션 서명 반환
```

#### 환불 처리
비정상 종료(서버 크래시, 플레이어 대량 이탈 등) 시 모든 참가자에게 에스크로 금액을 자동 환불합니다.

---

## 4. 프론트엔드 구현

### 4.1 렌더링 파이프라인

Canvas 2D 기반 커스텀 렌더러로, **레이어 기반 아키텍처**를 사용합니다.

```
Renderer (requestAnimationFrame 루프)
  │
  ├── Camera.update(targetPlayer)     # 카메라 위치 갱신
  │
  ├── ctx.save() + ctx.translate()    # 카메라 변환 적용
  │
  ├── Layer 1: MapLayer.draw()        # 배경, 장애물, 저장소, 감옥
  ├── Layer 2: EntityLayer.draw()     # 플레이어 스프라이트 (방향별)
  ├── Layer 3: EffectLayer.draw()     # 시각 이펙트 (체포, 채널링 등)
  │
  ├── ctx.restore()                   # 카메라 변환 해제
  │
  └── Layer 4: FogLayer.draw()        # 안개 오버레이 (스크린 좌표)
```

#### HiDPI 지원
```javascript
const dpr = window.devicePixelRatio || 1;
canvas.width = displayWidth * dpr;
canvas.height = displayHeight * dpr;
ctx.scale(dpr, dpr);
```
캔버스의 물리적 해상도를 디스플레이 비율에 맞게 조정하여 레티나 디스플레이에서도 선명한 렌더링을 보장합니다.

#### 카메라 시스템
로컬 플레이어를 화면 중앙에 고정하고, 맵 경계에서 카메라가 넘어가지 않도록 클램핑합니다.

```
Camera.update(target)
  offset.x = clamp(target.x - screenWidth/2, 0, mapWidth - screenWidth)
  offset.y = clamp(target.y - screenHeight/2, 0, mapHeight - screenHeight)
```

### 4.2 Fog of War 렌더링

안개 시스템은 전체 화면을 어둡게 칠한 후, 플레이어 시야 영역만 투명하게 잘라내는 방식입니다.

```
FogLayer.draw()
  1. 전체 캔버스를 반투명 검정으로 채움
  2. globalCompositeOperation = 'destination-out'
  3. 플레이어 위치 중심으로 방사형 그라디언트 원 그리기
  4. 그라디언트 영역이 안개를 "지우는" 효과
  5. globalCompositeOperation 복원
```

시야 반경에 따라 그라디언트의 크기가 달라지며, 가장자리로 갈수록 자연스럽게 어두워집니다.

### 4.3 상태 관리 (Zustand)

```typescript
// 게임 상태
useGameStore {
  localPlayerId    // 현재 플레이어 ID
  myTeam           // 소속 팀 (cop | thief)
  snapshot         // 서버에서 수신한 최신 게임 스냅샷 (20Hz 갱신)
  gameResult       // 게임 종료 결과
  showResultModal  // 결과 모달 표시 여부
  floatingMessage  // 화면 중앙 알림 메시지
}

// 로비 상태
useLobbyStore {
  currentRoom      // 현재 참가 중인 방 정보
  roomPlayerCount  // 방 인원 수
}
```

Zustand를 선택한 이유:
- Redux 대비 보일러플레이트 최소화
- React 외부(소켓 핸들러, 렌더러)에서도 `getState()`로 직접 접근 가능
- 20Hz로 갱신되는 게임 상태에 적합한 가벼운 구독 모델

### 4.4 입력 처리

```
keyboard.ts
  ├── keydown/keyup 이벤트 리스너
  ├── 현재 눌린 키 Set 관리
  ├── 방향 벡터 계산 (WASD/방향키 조합)
  │   └── 대각선 이동 시 정규화 (속도 일정)
  ├── Space: 스킬 사용 / 채널링 취소
  ├── Q: 변장 (도둑 전용)
  └── E: 벽 설치 (도둑 전용)

MobileDPad.tsx (모바일)
  ├── 터치 시작/이동/종료 이벤트
  ├── 조이스틱 영역 내 터치 위치 → 방향 벡터 변환
  └── input_move 이벤트로 서버에 전송
```

입력은 틱 레이트(20Hz)에 맞춰 서버로 전송됩니다. 키 입력마다 즉시 전송하지 않고 배칭하여 네트워크 부하를 줄입니다.

### 4.5 소켓 통신 계층

```
socket.ts
  └── Socket.IO 클라이언트 싱글톤 인스턴스 생성

handlers.ts
  ├── onGameStarted()    → useGameStore 초기화
  ├── onStateSnapshot()  → useGameStore.snapshot 갱신
  ├── onSkillStarted()   → 이펙트 트리거
  ├── onPlayerJailed()   → 알림 표시
  ├── onPlayerFreed()    → 알림 표시
  ├── onGameEnded()      → 결과 모달 표시
  └── onGameAborted()    → 환불 안내 표시
```

### 4.6 컴포넌트 구조

```
App.tsx
  ├── SolanaProvider (지갑 어댑터)
  ├── SocketProvider (소켓 초기화)
  └── Router
       ├── / → LobbyPage
       │       ├── RoomCard (방 목록)
       │       ├── 팀 선택 UI
       │       └── WalletButton (Phantom 지갑 연결)
       │
       └── /game → GamePage
               ├── GameCanvas (Canvas 2D 렌더링)
               ├── HUD (타이머, 코인 카운트)
               ├── SkillBar (스킬 버튼)
               ├── MobileDPad (모바일 조이스틱)
               └── ResultModal (게임 결과)
```

---

## 5. 실시간 통신 프로토콜

### 5.1 클라이언트 → 서버

| 이벤트 | 파라미터 | 설명 |
|--------|----------|------|
| `list_rooms` | - | 방 목록 요청 |
| `join_room` | `roomId, {name, walletAddress}` | 방 참가 |
| `confirm_entry` | `txSignature` | Solana 입금 트랜잭션 확인 |
| `select_team` | `'cop' \| 'thief'` | 팀 선택 |
| `ready` | - | 준비 완료 |
| `input_move` | `{dx, dy}` | 이동 입력 (20Hz) |
| `request_steal` | `storageId` | 훔치기 시작 |
| `request_break_jail` | - | 탈옥 시작 |
| `request_arrest` | `targetId` | 체포 요청 |
| `request_disguise` | - | 변장 발동 |
| `request_build_wall` | - | 벽 설치 |
| `cancel_skill` | - | 채널링 취소 |

### 5.2 서버 → 클라이언트

| 이벤트 | 파라미터 | 설명 |
|--------|----------|------|
| `room_state` | `RoomInfo` | 로비 상태 갱신 |
| `game_started` | `{yourTeam, snapshot}` | 게임 시작 알림 |
| `state_snapshot` | `StateSnapshot` | 게임 상태 (20Hz, 플레이어별 필터링) |
| `skill_started` | `playerId, skill, targetId` | 스킬 발동 알림 |
| `player_jailed` | `playerId` | 도둑 수감 |
| `player_freed` | `playerId` | 도둑 탈옥 |
| `player_disguised` | `playerId` | 변장 발동 |
| `wall_placed` | `obstacleId` | 벽 설치 |
| `game_ended` | `GameResult` | 게임 종료 + 결과 |
| `game_aborted` | `reason, refundTxSignatures` | 비정상 종료 + 환불 정보 |

### 5.3 데이터 흐름

```
[클라이언트 입력]                  [서버 처리]                    [클라이언트 렌더링]

 WASD 입력 ─────► input_move ────► GameLoop.tick()
                                   ├── 물리 연산
                                   ├── 스킬 처리
                                   ├── 승리 판정
                                   └── 스냅샷 생성
                                        │
                                        ▼
                               필터링(Fog of War)
                                        │
                   state_snapshot ◄─────┘
                        │
                        ▼
                 Zustand Store 갱신
                        │
                        ▼
                 Canvas 렌더링
```

---

## 6. 맵 데이터 구조

`@heist/shared`의 `map.ts`에 정적으로 정의됩니다.

```
맵 크기: 2400 x 2400 px

저장소 (6개, 각 50코인)
  ├── 맵 외곽에 균등 배치
  └── U자형 방 구조 (입구 1개, 3면 벽)

감옥 (1개)
  └── 맵 중앙 (1200, 1200)

장애물 (Obstacle[])
  ├── 정적 장애물: 저장소 벽, 은신처, 감옥 기둥
  └── 동적 장애물: 플레이어가 설치한 임시 벽 (15초 후 소멸)

스폰 위치
  ├── 도둑: 맵 모서리 4곳
  └── 경찰: 감옥 근처
```

---

## 7. 보안 설계

| 위협 | 대응 |
|------|------|
| **맵핵 (전체 적 위치 노출)** | 서버 측 Fog of War 필터링 — 시야 밖 적 데이터 미전송 |
| **스피드핵 (이동 속도 조작)** | 서버 권위 물리 — 클라이언트 입력은 방향만, 속도는 서버 계산 |
| **자동 조준 (스킬 자동 사용)** | 스킬 유효성을 서버에서 검증 (거리, 쿨다운, 팀 확인) |
| **중복 접속** | 동일 지갑 주소로 다중 방 참가 차단 |
| **입금 위조** | Solana 온체인 트랜잭션 검증 |

---

## 8. 배포 구성

### 개발 환경
```bash
 npm install          # 의존성 설치
 npm run dev          # 백엔드(8081) + 프론트엔드(3000) 동시 실행
```

### 프로덕션 배포

| 대상 | 플랫폼 | 설정 파일 |
|------|--------|-----------|
| 프론트엔드 | Vercel | `vercel.json` — Vite 빌드 후 CDN 배포 |
| 백엔드 | Railway | `railway.json` — Node.js 앱, `/health` 헬스체크 |
| 셀프호스팅 | PM2 | `ecosystem.config.cjs` — 프로세스 관리, 메모리 제한, 로깅 |

### 환경 변수

| 변수 | 용도 |
|------|------|
| `ESCROW_SECRET_KEY` | 에스크로 지갑 비밀키 (정산/환불용) |
| `VITE_SERVER_URL` | 프론트엔드에서 백엔드 접속 URL |
| `PORT` | 백엔드 서버 포트 (기본 8081) |

---

## 9. 안정성 및 예외 처리

| 상황 | 처리 |
|------|------|
| **플레이어 연결 끊김** | 봇으로 자동 전환, 게임 계속 진행 |
| **서버 종료 (SIGTERM/SIGINT)** | 진행 중인 게임 중단 + 참가비 자동 환불 |
| **다수 플레이어 이탈** | 게임 중단(abort) + 환불 처리 |
| **WebSocket 재연결** | Socket.IO 자동 재연결, 동일 지갑 주소로 세션 복구 |

---

## 10. 기술 스택 요약

```
Frontend                          Backend                         Shared
─────────────────────            ─────────────────────            ──────────────
React 18.3                       Node.js + Express                TypeScript
Vite 6.1 (빌드)                  Socket.IO 4.8 (실시간)           Types
Zustand 5.0 (상태)               @solana/web3.js 1.98            Constants
styled-components 6.1            tsx (개발 실행)                   Map Data
Canvas 2D (렌더링)               PM2 (프로덕션)                   Protocol
Socket.IO Client 4.8
@solana/wallet-adapter
```

**총 소스 코드:** ~4,700 LoC (TypeScript/TSX)
