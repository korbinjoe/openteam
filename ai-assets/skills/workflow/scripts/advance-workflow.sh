#!/usr/bin/env bash
set -euo pipefail

# advance-workflow.sh — Start all ready tasks in a workflow
# Usage: advance-workflow.sh '<workflowId>'
# Called by Lead after reviewing a completed task to push the DAG forward.

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

WORKFLOW_ID="${1:?Usage: advance-workflow.sh '<workflowId>'}"

RESPONSE=$(curl -s -X POST "${EXPERT_API_BASE}/api/workflow/${WORKFLOW_ID}/advance" \
  -H "Content-Type: application/json")

SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
STARTED=$(echo "$RESPONSE" | jq -r '.started // []')
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')

if [ "$SUCCESS" = "true" ]; then
  COUNT=$(echo "$STARTED" | jq 'length')
  echo "Advanced workflow ${WORKFLOW_ID}: ${COUNT} task(s) started"
  echo "$STARTED" | jq -r '.[]' 2>/dev/null | while read -r tid; do
    echo "  → started: $tid"
  done
else
  echo "Failed to advance workflow: ${ERROR:-unknown error}"
  exit 1
fi
