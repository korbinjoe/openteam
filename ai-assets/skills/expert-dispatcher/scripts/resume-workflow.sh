#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_ID="${1:?Usage: resume-workflow.sh <workflow-id>}"

RESPONSE=$(curl -s -X POST "${EXPERT_API_BASE}/api/workflow/resume" \
  -H "Content-Type: application/json" \
  -d "{\"workflowId\":\"${WORKFLOW_ID}\",\"chatId\":\"${OPENTEAM_CHAT_ID}\"}")

echo "$RESPONSE"
