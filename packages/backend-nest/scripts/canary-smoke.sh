#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"
MAX_TRIES="${MAX_TRIES:-500}"

ALLOW=""
DENY=""

canary=$(curl -s "${BASE_URL}/_metrics" | jq '.migration.nestTrafficCanary')
enabled=$(echo "$canary" | jq -r '.enabled')
strict=$(echo "$canary" | jq -r '.strict')
percent=$(echo "$canary" | jq -r '.percent')

echo "[canary-smoke] enabled=$enabled strict=$strict percent=$percent"

# 같은 타입(default) 내에서 allow/deny 후보를 찾는다.
for i in $(seq 1 "$MAX_TRIES"); do
  rid="default:smoke-$i"
  allowed=$(curl -s "${BASE_URL}/_migrate/room/decision?roomId=${rid}" | jq -r '.decision.allowed')
  if [[ "$allowed" == "true" && -z "$ALLOW" ]]; then
    ALLOW="$rid"
  fi
  if [[ "$allowed" == "false" && -z "$DENY" ]]; then
    DENY="$rid"
  fi
  # 특수케이스(0%,100%,disabled)에서는 한쪽만 있어도 충분하다.
  if [[ "$enabled" != "true" || "$percent" == "0" || "$percent" == "100" ]]; then
    if [[ -n "$ALLOW" || -n "$DENY" ]]; then
      break
    fi
  else
    if [[ -n "$ALLOW" && -n "$DENY" ]]; then
      break
    fi
  fi
done

# 모드별 기대 동작 검증:
# - disabled: allow만 검증
# - 100%: allow만 검증
# - 0%: deny만 검증(strict=true 전제)
# - 그 외: allow/deny 둘 다 검증
if [[ "$enabled" != "true" || "$percent" == "100" ]]; then
  if [[ -z "$ALLOW" ]]; then
    echo "[canary-smoke] allow roomId 탐색 실패(전체 허용 모드)" >&2
    exit 1
  fi
  echo "[canary-smoke] ALLOW=$ALLOW"
  allow_resp=$(curl -s -X POST "${BASE_URL}/_migrate/room/join" \
    -H 'content-type: application/json' \
    -d "{\"roomId\":\"${ALLOW}\",\"walletAddress\":\"wallet-allow\"}")
  allow_ok=$(echo "$allow_resp" | jq -r '.ok == true')
  if [[ "$allow_ok" != "true" ]]; then
    echo "[canary-smoke] allow 검증 실패" >&2
    echo "$allow_resp" | jq . >&2
    exit 1
  fi
  echo "[canary-smoke] allow 검증 성공"
elif [[ "$percent" == "0" ]]; then
  if [[ -z "$DENY" ]]; then
    echo "[canary-smoke] deny roomId 탐색 실패(전체 차단 모드)" >&2
    exit 1
  fi
  echo "[canary-smoke] DENY=$DENY"
  deny_resp=$(curl -s -X POST "${BASE_URL}/_migrate/room/join" \
    -H 'content-type: application/json' \
    -d "{\"roomId\":\"${DENY}\",\"walletAddress\":\"wallet-deny\"}")
  if [[ "$strict" == "true" ]]; then
    deny_ok=$(echo "$deny_resp" | jq -r '.route == "legacy" and .ok == false')
    if [[ "$deny_ok" != "true" ]]; then
      echo "[canary-smoke] deny 검증 실패(strict=true)" >&2
      echo "$deny_resp" | jq . >&2
      exit 1
    fi
  fi
  echo "[canary-smoke] deny 검증 성공"
else
  if [[ -z "$ALLOW" || -z "$DENY" ]]; then
    echo "[canary-smoke] allow/deny roomId 탐색 실패(혼합 모드)" >&2
    exit 1
  fi
  echo "[canary-smoke] ALLOW=$ALLOW"
  echo "[canary-smoke] DENY=$DENY"
  deny_resp=$(curl -s -X POST "${BASE_URL}/_migrate/room/join" \
    -H 'content-type: application/json' \
    -d "{\"roomId\":\"${DENY}\",\"walletAddress\":\"wallet-deny\"}")
  allow_resp=$(curl -s -X POST "${BASE_URL}/_migrate/room/join" \
    -H 'content-type: application/json' \
    -d "{\"roomId\":\"${ALLOW}\",\"walletAddress\":\"wallet-allow\"}")
  deny_ok=$(echo "$deny_resp" | jq -r '.route == "legacy" and .ok == false')
  allow_ok=$(echo "$allow_resp" | jq -r '.ok == true')
  if [[ "$deny_ok" != "true" ]]; then
    echo "[canary-smoke] deny 검증 실패" >&2
    echo "$deny_resp" | jq . >&2
    exit 1
  fi
  if [[ "$allow_ok" != "true" ]]; then
    echo "[canary-smoke] allow 검증 실패" >&2
    echo "$allow_resp" | jq . >&2
    exit 1
  fi
  echo "[canary-smoke] join 게이트 검증 성공"
fi

metrics=$(curl -s "${BASE_URL}/_metrics")
rollback=$(echo "$metrics" | jq -r '.operations.stage4RiskGates.rollbackRecommended')
scaleout=$(echo "$metrics" | jq -r '.operations.stage4RiskGates.scaleOutAllowed')
consistency=$(echo "$metrics" | jq -r '.consistency.lastOk')

echo "[canary-smoke] rollbackRecommended=$rollback"
echo "[canary-smoke] scaleOutAllowed=$scaleout"
echo "[canary-smoke] consistency.lastOk=$consistency"

echo "[canary-smoke] 완료"
