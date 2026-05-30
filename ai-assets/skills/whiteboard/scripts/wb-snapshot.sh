#!/bin/bash
# wb-snapshot.sh — Read the current chat war-room snapshot (goal + active entries)
# Usage: bash wb-snapshot.sh
#
# When OPENTEAM_INSTANCE_ID is set, the server automatically advances cursor = latestSeq,
# so the next PostToolUse hook won't re-push already-read content.

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"
INSTANCE_ID="${OPENTEAM_INSTANCE_ID:-}"

URL="${API_BASE}/api/chats/${CHAT_ID}/whiteboard/snapshot"
if [ -n "$INSTANCE_ID" ]; then
  URL+="?instanceId=${INSTANCE_ID}"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" "$URL")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "War-room snapshot query failed: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "$BODY" | jq .
