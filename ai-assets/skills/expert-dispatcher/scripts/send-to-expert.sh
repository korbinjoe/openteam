#!/bin/bash
# send-to-expert.sh — Send a message to a running Expert Agent
# Usage: bash send-to-expert.sh <agentId> "<message>"

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

AGENT_ID="${1:?Usage: send-to-expert.sh <agentId> <message>}"
MESSAGE="${2:?Usage: send-to-expert.sh <agentId> <message>}"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CONNECTION_ID="${EXPERT_CONNECTION_ID:-}"

# Append carriage return to simulate terminal input
PAYLOAD=$(jq -n \
  --arg agentId "$AGENT_ID" \
  --arg data "${MESSAGE}"$'\r' \
  --arg connectionId "$CONNECTION_ID" \
  '{agentId: $agentId, data: $data, connectionId: $connectionId}')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/expert/input" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Error: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "Message sent to expert ${AGENT_ID}."
