#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

DAG_JSON="${1:?Usage: create-workflow.sh '<dag-json>'}"

RESPONSE=$(curl -s -X POST "${EXPERT_API_BASE}/api/workflow/create" \
  -H "Content-Type: application/json" \
  -d "{\"chatId\":\"${OPENTEAM_CHAT_ID}\",\"createdBy\":\"${OPENTEAM_INSTANCE_ID}\",\"dag\":${DAG_JSON}}")

echo "$RESPONSE"
