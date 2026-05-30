#!/bin/bash
# wb-write.sh — Write a new entry to the current chat war-room
# Usage: bash wb-write.sh <type> "<summary>" [tags] [refs-json]

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

TYPE="${1:?Usage: wb-write.sh <type> <summary> [tags] [refs-json]}"
SUMMARY="${2:?Usage: wb-write.sh <type> <summary> [tags] [refs-json]}"
TAGS="${3:-}"
REFS_JSON="${4:-}"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"
BY="${OPENTEAM_INSTANCE_ID:?Environment variable OPENTEAM_INSTANCE_ID is not set}"

PAYLOAD=$(jq -n \
  --arg type "$TYPE" \
  --arg by "$BY" \
  --arg summary "$SUMMARY" \
  --arg tagsStr "$TAGS" \
  --arg refsJson "$REFS_JSON" \
  '{type: $type, by: $by, summary: $summary}
   + (if $tagsStr != "" then {tags: ($tagsStr | split(","))} else {} end)
   + (if $refsJson != "" then {refs: ($refsJson | fromjson)} else {} end)')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "War-room write failed: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "$BODY" | jq -r '"War-room entry written: [\(.entry.type)] \(.entry.summary) (id=\(.entry.id))"'
