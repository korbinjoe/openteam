#!/bin/bash
# handoff.sh — Transfer task to a more appropriate Agent
# Usage: bash handoff.sh <targetAgentId> "<task>" "<context-json>"
# Exit 0 on success (caller should exit cleanly)
# Exit 1 on failure (caller should continue working)

set -uo pipefail

TARGET_AGENT="${1:?Usage: handoff.sh <targetAgentId> <task> <context-json>}"
TASK="${2:?Usage: handoff.sh <targetAgentId> <task> <context-json>}"
CONTEXT="${3:-{}}"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
INSTANCE_ID="${OPENTEAM_INSTANCE_ID:?Environment variable OPENTEAM_INSTANCE_ID is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/api/expert/handoff" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg from "$INSTANCE_ID" \
    --arg to "$TARGET_AGENT" \
    --arg chatId "$CHAT_ID" \
    --arg task "$TASK" \
    --argjson context "$CONTEXT" \
    '{from: $from, to: $to, chatId: $chatId, task: $task, context: $context}')")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "HANDOFF_OK: Task transferred to $TARGET_AGENT"
  echo "$BODY"
  exit 0
else
  echo "HANDOFF_FAILED: HTTP $HTTP_CODE — $BODY" >&2
  exit 1
fi
