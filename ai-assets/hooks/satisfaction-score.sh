#!/bin/bash
# satisfaction-score.sh — Stop Hook: compute Mission Satisfaction Score (MSS) from JSONL
#
# Trigger: Claude Code Stop Hook (Agent turn ends)
# stdin protocol: { session_id, transcript_path, hook_event_name, cwd, stop_hook_active }
#
# Extracts user text messages from the JSONL transcript, classifies 7 signal types
# via regex, computes MSS, and appends a one-line summary to the agent's satisfaction log.
#
# Output: ~/.openteam/agents/<agent>/memory/satisfaction.md (append)
#
# All errors are silent (exit 0), never blocks the Agent main flow

set -uo pipefail

AGENT_ID="${OPENTEAM_INSTANCE_ID:-}"
CHAT_ID="${OPENTEAM_CHAT_ID:-}"

if [ -z "$AGENT_ID" ] || [ -z "$CHAT_ID" ]; then
  exit 0
fi

# Strip :auto suffix if present
AGENT_ID="${AGENT_ID%:auto}"

INPUT=$(cat 2>/dev/null || echo "{}")
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Extract user text messages from JSONL
USER_TEXTS=$(jq -r '
  select(.type=="user") |
  (.message.content |
    if type=="string" then .
    else (map(select(.type=="text")) | .[0].text // "")
    end) // empty
' "$TRANSCRIPT" 2>/dev/null)

[ -z "$USER_TEXTS" ] && exit 0

TOTAL_TURNS=$(echo "$USER_TEXTS" | grep -c '.' 2>/dev/null || echo "0")
[ "$TOTAL_TURNS" -eq 0 ] && exit 0

# Signal classification via regex
ESCALATIONS=$(echo "$USER_TEXTS" | grep -cE '为啥还|怎么还|一通.*后|恶心|反复修.*修不好' 2>/dev/null || echo "0")
CORRECTIONS=$(echo "$USER_TEXTS" | grep -cE '不对|错了|重新|没有实现|还是没|没得到解决|你这也没' 2>/dev/null || echo "0")
AESTHETIC_REJ=$(echo "$USER_TEXTS" | grep -cE '太丑|不好看|AI味|不合理|不太直观|浪费空间' 2>/dev/null || echo "0")
ITERATIONS=$(echo "$USER_TEXTS" | grep -cE '改大|改小|改为|太大了|太小了|[0-9]+px' 2>/dev/null || echo "0")
CONTINUES=$(echo "$USER_TEXTS" | grep -cE '继续|开干|实现$|落地$|直接' 2>/dev/null || echo "0")
ACCEPTANCES=$(echo "$USER_TEXTS" | grep -cE '好的|可以|没问题|不错|perfect|great' 2>/dev/null || echo "0")
COMMITS=$(echo "$USER_TEXTS" | grep -ciE '^commit|^提交' 2>/dev/null || echo "0")

# Compute MSS: Σ(signal_weight × count) / user_text_turns × 100
# Role-adjusted: ui-designer gets -0.2 for iterations instead of -0.5
ITER_WEIGHT="-0.5"
if echo "$AGENT_ID" | grep -q "ui-designer"; then
  ITER_WEIGHT="-0.2"
fi

MSS=$(awk "BEGIN {
  score = ($ESCALATIONS * -3.0) + ($CORRECTIONS * -1.5) + ($AESTHETIC_REJ * -1.0) + ($ITERATIONS * $ITER_WEIGHT) + ($CONTINUES * 0.5) + ($ACCEPTANCES * 1.0) + ($COMMITS * 2.0)
  mss = (score / $TOTAL_TURNS) * 100
  printf \"%.1f\", mss
}")

# Rating
RATING="MEDIUM"
if awk "BEGIN { exit ($MSS >= 60) ? 0 : 1 }" 2>/dev/null; then
  RATING="HIGH"
elif awk "BEGIN { exit ($MSS >= 30) ? 0 : 1 }" 2>/dev/null; then
  RATING="MEDIUM-HIGH"
elif awk "BEGIN { exit ($MSS < 0) ? 0 : 1 }" 2>/dev/null; then
  RATING="LOW"
fi

# Append to agent's satisfaction memory
MEMORY_DIR="${HOME}/.openteam/agents/${AGENT_ID}/memory"
mkdir -p "$MEMORY_DIR" 2>/dev/null || exit 0

SAT_FILE="${MEMORY_DIR}/satisfaction.md"
DATE=$(date '+%Y-%m-%d %H:%M')

# Dedup: skip if this chat_id already recorded
if [ -f "$SAT_FILE" ] && grep -qF "$CHAT_ID" "$SAT_FILE" 2>/dev/null; then
  exit 0
fi

# Create header if file doesn't exist
if [ ! -f "$SAT_FILE" ]; then
  printf "# Satisfaction Scores\n\n" > "$SAT_FILE"
fi

printf "## %s — %s\nMSS: %s | Turns: %s | Corrections: %s | Escalations: %s | Iterations: %s | Acceptances: %s | Commits: %s | Rating: %s\n\n" \
  "$CHAT_ID" "$DATE" "$MSS" "$TOTAL_TURNS" "$CORRECTIONS" "$ESCALATIONS" "$ITERATIONS" "$ACCEPTANCES" "$COMMITS" "$RATING" \
  >> "$SAT_FILE"

exit 0
