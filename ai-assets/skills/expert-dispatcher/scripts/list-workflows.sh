#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

STATUS="${1:-}"
QUERY=""
if [ -n "$STATUS" ]; then
  QUERY="?status=${STATUS}"
fi

RESPONSE=$(curl -s "${EXPERT_API_BASE}/api/workflow/list${QUERY}")

echo "$RESPONSE"
