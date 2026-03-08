# Backend Stage 2 - Socket Scaling Start

Stage 2 시작 구현으로 Redis adapter와 room affinity 기본 정책을 백엔드에 반영했다.

## 적용된 항목

- Redis adapter 옵션 활성화
- Room ID 해시 기반 affinity 검증(신규 룸 생성 시)

## 환경변수

- `REDIS_URL`: Redis 연결 URL. 설정 시 Socket.IO Redis adapter 활성화
- `ENABLE_ROOM_AFFINITY=true`: room affinity 검증 활성화
- `ROOM_AFFINITY_TOTAL_NODES`: 전체 노드 수
- `ROOM_AFFINITY_NODE_INDEX`: 현재 노드 인덱스(0 기반)
- `ENABLE_STAGE2_CANARY=true`: Stage2 정책을 일부 룸에만 적용
- `STAGE2_CANARY_PERCENT=10`: Stage2 적용 비율(0~100)

예시:

```bash
REDIS_URL=redis://127.0.0.1:6379
ENABLE_ROOM_AFFINITY=true
ROOM_AFFINITY_TOTAL_NODES=3
ROOM_AFFINITY_NODE_INDEX=1
ENABLE_STAGE2_CANARY=true
STAGE2_CANARY_PERCENT=10
```

## 현재 동작

- `REDIS_URL` 미설정: 단일 노드 adapter 모드로 동작
- affinity 활성화 시, 소유 노드가 아닌 곳에서는 join을 거절하고 재시도 요청
- canary 활성화 시, roomId 해시 버킷 기준 일부 룸에만 Stage2 정책 적용

## 남은 Stage 2 작업

- LB sticky session 실제 설정
- cross-node 룸 조회/참가 플로우 검증
- 카나리 배포 및 장애 시 재연결 시나리오 검증

## Sticky Session 설정 예시

nginx 예시:

```nginx
upstream heist_backend {
    ip_hash;
    server 10.0.0.11:3001;
    server 10.0.0.12:3001;
    server 10.0.0.13:3001;
}

server {
    listen 443 ssl;
    location /socket.io/ {
        proxy_pass http://heist_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

핵심은 `/socket.io` 경로에 대해 같은 클라이언트가 같은 백엔드로 붙도록 sticky를 보장하는 것이다.

## Sticky Session 방식 선택 가이드

- `ip_hash`: 설정이 단순해서 시작점으로 적합
- 단점: NAT/프록시 환경에서 같은 IP로 몰리면 분산이 불균형해질 수 있음
- 대안: L7 LB의 cookie 기반 stickiness(가능하면 우선 고려)

즉, 질문한 것처럼 nginx에서 `ip_hash`로 시작하는 접근은 맞다. 다만 운영 트래픽 특성에 따라 cookie stickiness로 전환 여지를 남겨두는 게 안전하다.

## 체크리스트 완료 기준 (load balancer sticky session)

아래 3개를 만족하면 체크리스트의 `load balancer sticky session 설정`을 완료로 본다.

1. `/socket.io` 경로 sticky 적용 반영
2. 재연결 100회 테스트에서 세션 hop 이상 징후 없음
3. `connection.recent.reconnectFailureRatePct`가 기준치 이내 유지
