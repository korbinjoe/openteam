#!/bin/bash
# stop-expert.sh — Stop a running Expert Agent
# Usage: bash stop-expert.sh <agentId>

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

AGENT_ID="${1:?Usage: stop-expert.sh <agentId>}"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CONNECTION_ID="${EXPERT_CONNECTION_ID:-}"
CHAT_ID="${OPENTEAM_CHAT_ID:-}"

PAYLOAD=$(jq -n \
  --arg agentId "$AGENT_ID" \
  --arg connectionId "$CONNECTION_ID" \
  --arg chatId "$CHAT_ID" \
  '{agentId: $agentId, connectionId: $connectionId, chatId: $chatId}')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/expert/stop" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Error: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

# Clean up taskId file
rm -f "${HOME}/.openteam/tmp/dispatch/${AGENT_ID}.taskId"

echo "Expert ${AGENT_ID} stopped."
