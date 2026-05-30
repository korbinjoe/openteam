#!/bin/bash
# wb-supersede.sh — Supersede an old entry with a new one (old entry marked as superseded)
# Usage: bash wb-supersede.sh <entryId> <type> "<summary>"

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

ENTRY_ID="${1:?Usage: wb-supersede.sh <entryId> <type> <summary>}"
TYPE="${2:?Usage: wb-supersede.sh <entryId> <type> <summary>}"
SUMMARY="${3:?Usage: wb-supersede.sh <entryId> <type> <summary>}"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"
BY="${OPENTEAM_INSTANCE_ID:?Environment variable OPENTEAM_INSTANCE_ID is not set}"

PAYLOAD=$(jq -n \
  --arg type "$TYPE" \
  --arg by "$BY" \
  --arg summary "$SUMMARY" \
  '{type: $type, by: $by, summary: $summary}')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries/${ENTRY_ID}/supersede" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "War-room supersede failed: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "$BODY" | jq -r '"Superseded \(.entry.id) -> new entry: [\(.entry.type)] \(.entry.summary)"'
