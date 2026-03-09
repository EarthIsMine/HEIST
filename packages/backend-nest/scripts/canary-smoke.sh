#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"

echo "[cutover-smoke] base_url=${BASE_URL}"

health=$(curl -s "${BASE_URL}/health")
health_ok=$(echo "$health" | jq -r '.status == "ok" or .status == "degraded"')
if [[ "$health_ok" != "true" ]]; then
  echo "[cutover-smoke] /health 검증 실패" >&2
  echo "$health" | jq . >&2
  exit 1
fi
echo "[cutover-smoke] /health 검증 성공"

metrics=$(curl -s "${BASE_URL}/_metrics")
generated_at=$(echo "$metrics" | jq -r '.generatedAt')
if [[ "$generated_at" == "null" || -z "$generated_at" ]]; then
  echo "[cutover-smoke] /_metrics generatedAt 누락" >&2
  echo "$metrics" | jq . >&2
  exit 1
fi

rollback=$(echo "$metrics" | jq -r '.operations.stage4RiskGates.rollbackRecommended')
scaleout=$(echo "$metrics" | jq -r '.operations.stage4RiskGates.scaleOutAllowed')
consistency_last_ok=$(echo "$metrics" | jq -r '.consistency.lastOk')
echo "[cutover-smoke] rollbackRecommended=$rollback"
echo "[cutover-smoke] scaleOutAllowed=$scaleout"
echo "[cutover-smoke] consistency.lastOk=$consistency_last_ok"

consistency=$(curl -s "${BASE_URL}/_state/consistency")
consistency_ok=$(echo "$consistency" | jq -r '.ok')
if [[ "$consistency_ok" != "true" && "$consistency_ok" != "false" ]]; then
  echo "[cutover-smoke] /_state/consistency 응답 스키마 검증 실패" >&2
  echo "$consistency" | jq . >&2
  exit 1
fi
echo "[cutover-smoke] /_state/consistency 검증 성공 (ok=${consistency_ok})"

rooms_state=$(curl -s "${BASE_URL}/_state/rooms")
rooms_has_count=$(echo "$rooms_state" | jq -r 'has("count") and has("backend") and has("rooms")')
if [[ "$rooms_has_count" != "true" ]]; then
  echo "[cutover-smoke] /_state/rooms 응답 스키마 검증 실패" >&2
  echo "$rooms_state" | jq . >&2
  exit 1
fi
echo "[cutover-smoke] /_state/rooms 검증 성공"
echo "[cutover-smoke] 완료"
