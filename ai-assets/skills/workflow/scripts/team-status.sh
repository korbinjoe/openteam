#!/bin/bash
# team-status.sh — Query real-time status of all Experts in the current Chat
# Usage: bash team-status.sh

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"

ENCODED_CHAT=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${CHAT_ID}'))")
RESPONSE=$(curl -s "${API_BASE}/api/expert/team-status?chatId=${ENCODED_CHAT}")

ALL_COMPLETED=$(echo "$RESPONSE" | jq -r '.allCompleted')
AGENTS=$(echo "$RESPONSE" | jq -r '.agents // []')
COUNT=$(echo "$AGENTS" | jq 'length')

if [ "$COUNT" = "0" ]; then
  echo "No running experts."
  exit 0
fi

echo "Team status (${COUNT} experts):"
echo "$AGENTS" | jq -r '.[] |
  (if .phase == "completed" or .phase == "waiting_input" then "done"
   elif .phase == "waiting_confirmation" then "wait"
   elif .phase == "tool_running" then "tool"
   else "work" end) + " " +
  .agentName + " | " + .phase +
  (if .currentTool then " -> " + .currentTool else "" end) +
  " | tools " + (.toolCompleted|tostring) + "/" + (.toolCount|tostring) +
  (if .cost then " | $" + (.cost|tostring) else "" end) +
  (if .lastMessage then "\n   > " + (.lastMessage|.[0:80]) else "" end)'

if [ "$ALL_COMPLETED" = "true" ]; then
  echo ""
  echo "All experts completed."
fi
