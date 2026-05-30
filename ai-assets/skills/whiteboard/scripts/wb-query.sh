#!/bin/bash
# wb-query.sh — Query war-room entries with filters
# Usage: bash wb-query.sh [--types=...] [--tags=...] [--by=...] [--limit=N] [--status=active|archived|superseded] [--since=ISO]
#
# When OPENTEAM_INSTANCE_ID is set, a successful query also advances the cursor
# (active read == known context, next PostToolUse hook won't re-push read entries).

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"
INSTANCE_ID="${OPENTEAM_INSTANCE_ID:-}"

QUERY=""
for arg in "$@"; do
  case "$arg" in
    --types=*)  QUERY+="&types=${arg#*=}" ;;
    --tags=*)   QUERY+="&tags=${arg#*=}" ;;
    --by=*)     QUERY+="&byAgent=${arg#*=}" ;;
    --limit=*)  QUERY+="&limit=${arg#*=}" ;;
    --status=*) QUERY+="&status=${arg#*=}" ;;
    --since=*)  QUERY+="&sinceTs=${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

URL="${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries"
if [ -n "$QUERY" ]; then
  URL+="?${QUERY#&}"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" "$URL")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "War-room query failed: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "$BODY" | jq .

# Advance cursor after successful query (fail-tolerant: failure doesn't affect main output)
if [ -n "$INSTANCE_ID" ]; then
  curl -sS -X POST --max-time 3 \
    -H "Content-Type: application/json" \
    -d "{\"instanceId\":\"${INSTANCE_ID}\"}" \
    "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/cursor" \
    >/dev/null 2>&1 || true
fi
