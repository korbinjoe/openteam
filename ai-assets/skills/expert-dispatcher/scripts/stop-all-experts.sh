#!/bin/bash
# stop-all-experts.sh — Stop all running Expert Agents
# Usage: bash stop-all-experts.sh

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CONNECTION_ID="${EXPERT_CONNECTION_ID:-}"

PAYLOAD=$(jq -n \
  --arg connectionId "$CONNECTION_ID" \
  '{connectionId: $connectionId}')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/expert/stop-all" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Error: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

# Clean up all taskId files
rm -f "${HOME}/.openteam/tmp/dispatch/"*.taskId 2>/dev/null || true

echo "All Expert Agents stopped."
