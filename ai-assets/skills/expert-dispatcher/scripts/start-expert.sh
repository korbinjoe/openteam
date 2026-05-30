#!/bin/bash
# start-expert.sh — Start an Expert Agent and assign a task
# Usage: bash start-expert.sh <agentId> "<task>" [instanceSuffix]

set -euo pipefail

AGENT_ID="${1:?Usage: start-expert.sh <agentId> <task> [instanceSuffix]}"
TASK="${2:?Usage: start-expert.sh <agentId> <task> [instanceSuffix]}"
INSTANCE_SUFFIX="${3:-}"

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CONNECTION_ID="${EXPERT_CONNECTION_ID:-}"
CHAT_ID="${OPENTEAM_CHAT_ID:-}"
INSTANCE_ID="${OPENTEAM_INSTANCE_ID:-lead}"

# Build JSON payload
PAYLOAD=$(jq -n \
  --arg agentId "$AGENT_ID" \
  --arg task "$TASK" \
  --arg instanceSuffix "$INSTANCE_SUFFIX" \
  --arg connectionId "$CONNECTION_ID" \
  --arg chatId "$CHAT_ID" \
  --arg dispatcherInstanceId "$INSTANCE_ID" \
  --arg cwd "$(pwd)" \
  '{
    agentId: $agentId,
    task: $task,
    connectionId: $connectionId,
    chatId: $chatId,
    dispatcherInstanceId: $dispatcherInstanceId,
    cwd: $cwd
  } + (if $instanceSuffix != "" then {instanceSuffix: $instanceSuffix} else {} end)')

# Send start request
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/api/expert/start" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Error: HTTP ${HTTP_CODE}" >&2
  echo "$BODY" >&2
  exit 1
fi

# Extract key info
TASK_ID=$(echo "$BODY" | jq -r '.taskId // empty')
SESSION_ID=$(echo "$BODY" | jq -r '.sessionId // empty')
AGENT_NAME=$(echo "$BODY" | jq -r '.agentName // empty')
ALREADY_RUNNING=$(echo "$BODY" | jq -r '.alreadyRunning // false')
RESULT_INSTANCE_ID=$(echo "$BODY" | jq -r '.instanceId // empty')

# Save taskId for subsequent queries
if [ -n "$TASK_ID" ]; then
  TASK_DIR="${HOME}/.openteam/tmp/dispatch"
  mkdir -p "$TASK_DIR"
  EFFECTIVE_ID="${RESULT_INSTANCE_ID:-$AGENT_ID}"
  echo "$TASK_ID" > "${TASK_DIR}/${EFFECTIVE_ID}.taskId"
fi

# Output result
if [ "$ALREADY_RUNNING" = "true" ]; then
  echo "Expert ${AGENT_ID} is already running (session: ${SESSION_ID}). No need to start again, use check-inbox.sh to monitor status."
else
  INSTANCE_INFO=""
  if [ -n "$RESULT_INSTANCE_ID" ] && [ "$RESULT_INSTANCE_ID" != "$AGENT_ID" ]; then
    INSTANCE_INFO=" (instance: ${RESULT_INSTANCE_ID})"
  fi
  TASK_INFO=""
  if [ -n "$TASK_ID" ]; then
    TASK_INFO="\nTask ID: ${TASK_ID}"
  fi
  echo -e "Expert ${AGENT_ID}${INSTANCE_INFO} started and task assigned.${TASK_INFO}\n\nUse check-inbox.sh to monitor expert status."
fi
