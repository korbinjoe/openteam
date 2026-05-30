#!/bin/bash
# wb-archive.sh — Archive a war-room entry (remove from snapshot)
# Usage: bash wb-archive.sh <entryId>

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

ENTRY_ID="${1:?Usage: wb-archive.sh <entryId>}"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"
BY="${OPENTEAM_INSTANCE_ID:?Environment variable OPENTEAM_INSTANCE_ID is not set}"

PAYLOAD=$(jq -n --arg by "$BY" '{by: $by}')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries/${ENTRY_ID}/archive" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "War-room archive failed: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "Entry ${ENTRY_ID} archived."
