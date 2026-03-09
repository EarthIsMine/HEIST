# HEIST

6인 비대칭 실시간 전략 게임. 도둑 4명 vs 경찰 2명이 Solana 온체인 정산으로 대결합니다.

## 게임 규칙

### 팀 구성
- **도둑 (Thief)** x4 — 맵 곳곳의 저장소에서 코인을 훔친다
- **경찰 (Cop)** x2 — 도둑을 체포하여 감옥에 보낸다

### 승리 조건
| 팀 | 조건 |
|---|---|
| 도둑 | 모든 코인(300개)을 훔치면 승리 |
| 경찰 | 도둑 4명 전원 수감 **또는** 10분 타이머 종료 시 승리 |

### 게임 흐름
1. **Head Start (5초)** — 경찰은 대기, 도둑만 이동 가능 (훔치기는 불가)
2. **Playing** — 본 게임 시작. 제한 시간 10분

### 스킬
| 스킬 | 대상 | 설명 |
|---|---|---|
| **Steal** | 도둑 전용 | 저장소 근처에서 코인을 훔침. 이동 속도 40%로 감소하며 채널링 |
| **Break Jail** | 도둑 전용 | 감옥 근처에서 6초 채널링하여 동료를 탈옥시킴 |
| **Arrest** | 경찰 전용 | 근접한 도둑을 즉시 체포하여 감옥으로 이송 |

### Fog of War (시야 시스템)
- 경찰 시야 반경: 280px / 도둑 시야 반경: 220px
- 적 팀은 시야 내에 있고 장애물에 가려지지 않아야 보임
- 서버에서 플레이어별 필터링하여 전송 (보안)

### 맵 구조 (2400x2400)
- **저장소 6개** — 맵 외곽에 균등 배치, 각 50코인
- **감옥** — 맵 중앙 (1200, 1200)
- **엄폐물** — 저장소를 감싸는 U자형 방 (출입구 1개), 중간 은신처, 감옥 주변 기둥
- 장애물은 이동을 차단하고 시야(LOS)도 차단

### 조작
| 키 | 동작 |
|---|---|
| WASD / 방향키 | 이동 |
| Space | 스킬 사용 (가장 가까운 대상 자동 선택) / 채널링 중이면 취소 |

## 기술 스택

| 영역 | 기술 |
|---|---|
| 모노레포 | npm workspaces |
| 공유 타입 | `@heist/shared` (TypeScript) |
| 백엔드 | NestJS, Socket.IO |
| 프론트엔드 | React, Vite, Zustand, styled-components |
| 렌더링 | Canvas 2D (HiDPI 지원, devicePixelRatio) |
| 블록체인 | Solana (devnet), @solana/web3.js |

## 프로젝트 구조

```
packages/
├── shared/          # 공유 타입, 상수, 맵 데이터, 프로토콜
│   └── src/
│       ├── types.ts       # Player, Obstacle, StateSnapshot 등
│       ├── constants.ts   # 게임 밸런스 상수
│       ├── map.ts         # 저장소, 스폰, 감옥, 장애물 배치
│       └── protocol.ts    # Socket.IO 이벤트 타입
├── backend-nest/    # Nest 게임 서버
│   └── src/
│       ├── gateway/           # Socket.IO Gateway
│       ├── web/               # health/metrics/state 엔드포인트
│       ├── services/          # 런타임 서비스
│       └── core/              # 게임 코어(Room/GameLoop/Observability)
└── frontend/        # 게임 클라이언트
    └── src/
        ├── canvas/
        │   ├── Renderer.ts        # 렌더 파이프라인
        │   ├── Camera.ts          # 카메라 추적
        │   └── layers/
        │       ├── MapLayer.ts    # 맵, 저장소, 감옥, 장애물 렌더링
        │       ├── EntityLayer.ts # 플레이어 스프라이트
        │       ├── EffectLayer.ts # 이펙트
        │       └── FogLayer.ts   # Fog of War 오버레이
        ├── input/
        │   └── keyboard.ts    # WASD + Space 입력 처리
        ├── components/game/
        │   ├── HUD.tsx        # 타이머, 카운트다운, 점수
        │   └── SkillBar.tsx   # 스킬 버튼 UI
        ├── net/
        │   ├── socket.ts      # Socket.IO 연결
        │   └── handlers.ts    # 서버 이벤트 핸들러
        └── stores/
            └── useGameStore.ts # Zustand 상태 관리
```

## 실행

```bash
# 의존성 설치
npm install

# 공유 패키지 빌드
npm run build -w packages/shared

# 개발 서버 실행 (백엔드 + 프론트엔드 동시)
npm run dev
```

- 백엔드: `http://localhost:8081`
- 프론트엔드: `http://localhost:5173`

## 게임 밸런스 상수

| 상수 | 값 | 설명 |
|---|---|---|
| `PLAYER_SPEED` | 260 | 기본 이동 속도 |
| `STEAL_MOVE_SPEED_MULTIPLIER` | 0.4 | 훔치기 중 이동 속도 배율 |
| `BREAK_JAIL_CHANNEL_MS` | 6,000 | 탈옥 채널링 시간 |
| `ARREST_COP_COUNT` | 1 | 체포에 필요한 경찰 수 |
| `ARREST_STUN_MS` | 5,000 | 체포 실패 시 스턴 시간 |
| `COP_VISION_RADIUS` | 280 | 경찰 시야 반경 |
| `THIEF_VISION_RADIUS` | 220 | 도둑 시야 반경 |
| `HEAD_START_MS` | 5,000 | 경찰 대기 시간 |
| `MATCH_DURATION_MS` | 600,000 | 매치 제한 시간 (10분) |
