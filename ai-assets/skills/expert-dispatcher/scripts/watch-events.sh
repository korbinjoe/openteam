#!/bin/bash
# watch-events.sh — SSE event stream subscription (recommended alternative to watch-inbox.sh)
# Only pushes terminal-state events to Monitor, filtering out intermediate states and heartbeats

set -uo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

API_BASE="${EXPERT_API_BASE:?Environment variable EXPERT_API_BASE is not set}"
CHAT_ID="${OPENTEAM_CHAT_ID:?Environment variable OPENTEAM_CHAT_ID is not set}"
INSTANCE_ID="${OPENTEAM_INSTANCE_ID:-lead}"

curl -sN "${API_BASE}/api/expert/events?chatId=${CHAT_ID}" | while IFS= read -r line; do
  # Skip SSE heartbeats and empty lines
  [[ -z "$line" || "$line" == ": heartbeat" ]] && continue
  # Extract JSON after data: prefix
  [[ "$line" =~ ^data:\ (.+)$ ]] || continue
  json="${BASH_REMATCH[1]}"
  # Extract type field to determine if this is a terminal-state event
  type=$(echo "$json" | jq -r '.type // empty' 2>/dev/null)
  case "$type" in
    phase)
      phase=$(echo "$json" | jq -r '.phase // empty' 2>/dev/null)
      case "$phase" in
        completed|waiting_input|waiting_confirmation|failed)
          agentId=$(echo "$json" | jq -r '.agentId // empty' 2>/dev/null)
          echo "[${phase}] from=${agentId}"
          ;;
      esac
      ;;
    task:input_required|task:completed|task:failed)
      from=$(echo "$json" | jq -r '.from // empty' 2>/dev/null)
      summary=$(echo "$json" | jq -r '.summary // .error // empty' 2>/dev/null)
      short_type="${type#task:}"
      echo "[${short_type}] from=${from} summary=\"${summary}\""
      ;;
  esac
done
