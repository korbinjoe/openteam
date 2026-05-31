#!/bin/bash
# wb-auto-extract.sh — Stop Hook system-level war-room write fallback
#
# Trigger: Claude Code Stop Hook (Agent turn ends)
# stdin protocol: { session_id, transcript_path, hook_event_name, cwd, stop_hook_active }
#
# Rules (only extract high-confidence events, fingerprint dedup prevents spam):
#   1. No goal in chat war-room and is first turn -> extract <=120 chars from first user message as goal
#   2. This turn used Task tool -> write handoff
#   3. (Removed) artifact now written proactively by Expert
#   4. (Removed) progress now written proactively by Expert
#   5. Last segment contains decision signal -> write decision
#   6. Last segment contains blocker signal -> write open_question
#   7. Last segment contains constraint signal -> write constraint
#
# Writes tagged with by=${OPENTEAM_INSTANCE_ID}:auto to distinguish from Agent's own writes
# All errors are silent (exit 0), never blocks the Agent main flow

set -uo pipefail

# -- Environment check (non-Agent sessions exit silently) --
API_BASE="${EXPERT_API_BASE:-}"
CHAT_ID="${OPENTEAM_CHAT_ID:-}"
INSTANCE_ID="${OPENTEAM_INSTANCE_ID:-}"

if [ -z "$API_BASE" ] || [ -z "$CHAT_ID" ] || [ -z "$INSTANCE_ID" ]; then
  exit 0
fi

# -- Read stdin to get transcript_path --
INPUT=$(cat 2>/dev/null || echo "{}")
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# -- Fingerprint directory (dedup) --
FP_DIR="${HOME}/.openteam/whiteboard/${CHAT_ID}"
mkdir -p "$FP_DIR" 2>/dev/null || exit 0
FP_FILE="${FP_DIR}/.auto-fp.txt"
touch "$FP_FILE" 2>/dev/null || exit 0

# -- Normalize instance id (strip :auto suffix) --
INSTANCE_BASE="${INSTANCE_ID%:auto}"

# -- Causal lookup: choose connection strategy by write type --
find_parent_id() {
  local write_type="$1"
  local parent_id=""

  case "$write_type" in
    decision)
      # decision only connects to goal (not upstream decisions, to avoid unrelated chaining)
      parent_id=$(curl -sS --max-time 2 \
        "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries?types=goal&status=active&limit=1" \
        2>/dev/null | jq -r '.entries[-1].id // empty' 2>/dev/null || echo "")
      ;;
    constraint|open_question)
      # Connect to own most recent decision or global goal
      parent_id=$(curl -sS --max-time 2 \
        "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries?byAgent=${INSTANCE_BASE}&types=decision&status=active&limit=1" \
        2>/dev/null | jq -r '.entries[-1].id // empty' 2>/dev/null || echo "")
      if [ -z "$parent_id" ]; then
        parent_id=$(curl -sS --max-time 2 \
          "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries?types=goal&status=active&limit=1" \
          2>/dev/null | jq -r '.entries[-1].id // empty' 2>/dev/null || echo "")
      fi
      ;;
  esac

  printf "%s" "$parent_id"
}

# -- Write to war-room helper --
write_wb() {
  local type="$1"
  local summary="$2"
  # Normalize + truncate to 120 *characters* (perl -CSD for UTF-8, avoids byte-slice breaking multibyte chars)
  summary=$(printf "%s" "$summary" | tr '\n' ' ' | awk '{gsub(/[[:space:]]+/," "); gsub(/^ +| +$/,""); print}')
  summary=$(printf "%s" "$summary" | perl -CSD -ne 'print substr($_, 0, 120)' 2>/dev/null || printf "%s" "$summary")
  [ -z "$summary" ] && return 0

  # Fingerprint dedup: same type+summary only written once per chat
  local fp
  fp=$(printf "%s" "${type}::${summary}" | shasum 2>/dev/null | awk '{print $1}')
  [ -z "$fp" ] && return 0
  if grep -Fxq "$fp" "$FP_FILE" 2>/dev/null; then
    return 0
  fi

  # Find causal upstream, inject refs
  local parent_id
  parent_id=$(find_parent_id "$type")

  local payload
  if [ -n "$parent_id" ]; then
    payload=$(jq -cn --arg type "$type" --arg by "${INSTANCE_ID}:auto" --arg summary "$summary" --arg ref "$parent_id" \
      '{type:$type, by:$by, summary:$summary, refs:{entries:[$ref]}}' 2>/dev/null) || return 0
  else
    payload=$(jq -cn --arg type "$type" --arg by "${INSTANCE_ID}:auto" --arg summary "$summary" \
      '{type:$type, by:$by, summary:$summary}' 2>/dev/null) || return 0
  fi

  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 3 \
    -X POST "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/entries" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || echo "000")

  # 201 normal / 422 may be goal already exists, both record fingerprint to avoid retry
  if [ "$code" = "201" ] || [ "$code" = "422" ]; then
    printf "%s\n" "$fp" >> "$FP_FILE"
  fi
}

# -- Extract the last segment of this turn (tail 200 lines is enough to cover one turn) --
LAST_CHUNK=$(tail -n 200 "$TRANSCRIPT" 2>/dev/null || echo "")
[ -z "$LAST_CHUNK" ] && exit 0

# -- Rule 1: goal fallback (first turn + no goal in war-room) --
HAS_GOAL=$(curl -s --max-time 3 "${API_BASE}/api/chats/${CHAT_ID}/whiteboard/snapshot" 2>/dev/null \
  | jq -r '.goal // empty' 2>/dev/null || echo "")

if [ -z "$HAS_GOAL" ]; then
  # Truncate to 300 *characters* (not bytes) to avoid splitting multibyte chars
  FIRST_USER=$(head -n 20 "$TRANSCRIPT" 2>/dev/null \
    | jq -r 'select(.type=="user") | (.message.content | if type=="string" then . else (map(select(.type=="text")) | .[0].text // "") end) // empty' 2>/dev/null \
    | head -n 1 \
    | perl -CSD -ne 'print substr($_, 0, 300)' 2>/dev/null)
  if [ -n "$FIRST_USER" ]; then
    write_wb "goal" "$FIRST_USER"
  fi
fi

# -- Rule 2: handoff (Task/Agent tool call or Bash calling start-expert.sh) --
HANDOFF=$(printf "%s\n" "$LAST_CHUNK" \
  | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and (.name=="Task" or .name=="Agent")) | "→ \(.input.subagent_type // "agent") \(.input.description // "task")"' 2>/dev/null \
  | tail -n 1)

if [ -z "$HANDOFF" ]; then
  HANDOFF=$(printf "%s\n" "$LAST_CHUNK" \
    | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command // empty' 2>/dev/null \
    | grep -E 'start-expert\.sh|send-to-expert\.sh' \
    | head -n 1 \
    | sed -E 's/.*start-expert\.sh\s+(\S+)\s+"?([^"]*)"?.*/→ \1 \2/' \
    | sed -E 's/.*send-to-expert\.sh\s+(\S+)\s+"?([^"]*)"?.*/→ \1 \2/' \
    | head -n 1)
fi

if [ -n "$HANDOFF" ]; then
  write_wb "handoff" "$HANDOFF"
fi

# -- Rules 3 & 4 removed (artifact/progress no longer auto-extracted, now written by Expert) --

LAST_TEXT=$(printf "%s\n" "$LAST_CHUNK" \
  | jq -s '[.[] | select(.type=="assistant")] | last | (.message.content // []) | [.[] | select(.type=="text") | .text] | last // empty' -r 2>/dev/null \
  | tr '\n' ' ')

# -- Rule 5: decision (last segment contains decision signal) --
if printf "%s" "$LAST_TEXT" | grep -qE "decided|chosen|finalized|adopting|decision:|decided to"; then
  SENTENCE=$(printf "%s" "$LAST_TEXT" \
    | awk 'BEGIN{RS="[.!?]"} /decided|chosen|finalized|adopting|decision:|decided to/ {print; exit}')
  [ -z "$SENTENCE" ] && SENTENCE="$LAST_TEXT"
  write_wb "decision" "$SENTENCE"
fi

# -- Rule 6: open_question (last segment contains blocker signal) --
if printf "%s" "$LAST_TEXT" | grep -qE "need confirmation|pending|blocked|needs decision|awaiting"; then
  SENTENCE=$(printf "%s" "$LAST_TEXT" \
    | awk 'BEGIN{RS="[.!?]"} /need confirmation|pending|blocked|needs decision|awaiting/ {print; exit}')
  [ -z "$SENTENCE" ] && SENTENCE="$LAST_TEXT"
  write_wb "open_question" "$SENTENCE"
fi

# -- Rule 7: constraint (last segment contains constraint signal) --
if printf "%s" "$LAST_TEXT" | grep -qE "constraint|limitation|hard requirement|must not exceed|must not|cannot exceed"; then
  SENTENCE=$(printf "%s" "$LAST_TEXT" \
    | awk 'BEGIN{RS="[.!?]"} /constraint|limitation|hard requirement|must not exceed|must not|cannot exceed/ {print; exit}')
  [ -z "$SENTENCE" ] && SENTENCE="$LAST_TEXT"
  write_wb "constraint" "$SENTENCE"
fi

exit 0
