#!/usr/bin/env bash
set -euo pipefail

STATUS="${1:-}"
QUERY=""
if [ -n "$STATUS" ]; then
  QUERY="?status=${STATUS}"
fi

RESPONSE=$(curl -s "${EXPERT_API_BASE}/api/workflow/list${QUERY}")

echo "$RESPONSE"
