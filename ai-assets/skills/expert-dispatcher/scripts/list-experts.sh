#!/bin/bash
# list-experts.sh — List all currently running Expert Agents
# Usage: bash list-experts.sh

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CONNECTION_ID="${EXPERT_CONNECTION_ID:-}"

QUERY=""
if [ -n "$CONNECTION_ID" ]; then
  QUERY="?connectionId=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${CONNECTION_ID}'))")"
fi

RESPONSE=$(curl -s "${API_BASE}/api/expert/list${QUERY}")
EXPERTS=$(echo "$RESPONSE" | jq -r '.experts')
COUNT=$(echo "$EXPERTS" | jq 'length')

if [ "$COUNT" = "0" ] || [ "$EXPERTS" = "null" ]; then
  echo "No running Expert Agents."
else
  echo "Running Expert Agents:"
  echo "$EXPERTS" | jq -r '.[] | "- \(.agentId // .agentName // "unknown") (\(.status // "running"))"'
fi
