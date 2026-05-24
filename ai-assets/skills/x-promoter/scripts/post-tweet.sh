#!/usr/bin/env bash
# post-tweet.sh — post a drafted tweet (or short thread) to X via a persistent
# Playwright browser session. Defaults to dry run; --confirm to actually post.
#
# Usage:
#   post-tweet.sh --draft <path> [--variant A|B|C] [--confirm]
#
# Exit codes (also documented in SKILL.md):
#   0   posted, permalink URL on stdout
#   10  login required — pre-flight redirected to /login; constraint written
#   11  dry run — no --confirm flag passed; printed "would post: <body>"
#   20  UI selector failed; screenshot saved next to draft; constraint written
#   30  invalid draft (missing variant, body > 280 chars, malformed)
#   2   bad args

set -euo pipefail

DRAFT=""
VARIANT=""
CONFIRM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --draft)   DRAFT="${2:-}"; shift 2 ;;
    --variant) VARIANT="${2:-}"; shift 2 ;;
    --confirm) CONFIRM=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$DRAFT" || ! -r "$DRAFT" ]]; then
  echo "error: --draft <path> required and readable" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- 1. parse draft ----------------------------------------------------------
MODE=$(awk '/^mode:/ { print $2; exit }' "$DRAFT" | tr -d '\r')
PICKED=$(awk '/^variants_picked:/ { print $2; exit }' "$DRAFT" | tr -d '\r')
[[ -z "$VARIANT" ]] && VARIANT="$PICKED"
[[ -z "$VARIANT" ]] && VARIANT="A"
[[ -z "$MODE"    ]] && MODE="single"

# Extract body between `## Variant <X>` (with optional " (picked)") and the next `## `.
BODY=$(awk -v v="$VARIANT" '
  $0 ~ "^## Variant " v "( \\(picked\\))?$" { capture=1; next }
  capture && /^## / { exit }
  capture { print }
' "$DRAFT" | awk 'NF { found=1 } found' | sed -e :a -e '/^$/{$d;N;ba' -e '}')

if [[ -z "$BODY" ]]; then
  echo "error: variant $VARIANT not found in $DRAFT" >&2
  exit 30
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required for JSON escaping" >&2
  exit 30
fi

# Split body into tweets: blank-line separated for thread mode, single tweet otherwise.
# python3's json.dumps handles all required escapes (quotes, backslashes, control chars, unicode).
if [[ "$MODE" == "thread" ]]; then
  TWEETS_JSON=$(printf '%s' "$BODY" | python3 -c '
import json, re, sys
body = sys.stdin.read()
tweets = [t.strip() for t in re.split(r"\n\s*\n", body) if t.strip()]
sys.stdout.write(json.dumps(tweets))
')
else
  TWEETS_JSON=$(printf '%s' "$BODY" | python3 -c '
import json, sys
sys.stdout.write(json.dumps([sys.stdin.read().strip()]))
')
fi

# Validate ≤280 chars per tweet.
COUNT_ERR=$(node -e '
  const t = JSON.parse(process.argv[1]);
  for (let i = 0; i < t.length; i++) {
    if ([...t[i]].length > 280) {
      console.log(`tweet ${i+1} is ${[...t[i]].length} chars (> 280)`); process.exit(1);
    }
  }
' "$TWEETS_JSON" 2>&1) || {
  echo "error: $COUNT_ERR" >&2
  exit 30
}

# ---- 2. dry run --------------------------------------------------------------
if [[ "$CONFIRM" -eq 0 ]]; then
  i=1
  node -e '
    const t = JSON.parse(process.argv[1]);
    t.forEach((b, i) => console.log(`would post [${i+1}/${t.length}]: ${b}`));
  ' "$TWEETS_JSON"
  exit 11
fi

# ---- 3. real post via Playwright --------------------------------------------
WB_WRITE="${SCRIPT_DIR}/../../whiteboard/scripts/wb-write.sh"
write_wb() {
  local type="$1" summary="$2"
  if [[ -x "$WB_WRITE" && -n "${OPENTEAM_CHAT_ID:-}" && -n "${EXPERT_API_BASE:-}" && -n "${OPENTEAM_INSTANCE_ID:-}" ]]; then
    bash "$WB_WRITE" "$type" "$summary" "x-promoter" >/dev/null 2>&1 || true
  fi
}

PROFILE_DIR="${HOME}/.openteam/browser-profiles/x"
FAILURE_PNG="${DRAFT%.md}-failure.png"

set +e
URL=$(TWEETS_JSON="$TWEETS_JSON" PROFILE_DIR="$PROFILE_DIR" FAILURE_PNG="$FAILURE_PNG" \
      node "${SCRIPT_DIR}/post-tweet.mjs")
RC=$?
set -e

case "$RC" in
  0)
    echo "$URL"
    write_wb "artifact" "posted tweet: $URL (draft: $DRAFT)"
    exit 0
    ;;
  10)
    write_wb "constraint" "X session logged out; user must log in once at ${PROFILE_DIR}"
    exit 10
    ;;
  20)
    write_wb "constraint" "X selector failure; screenshot at ${FAILURE_PNG}"
    exit 20
    ;;
  *)
    echo "error: post-tweet.mjs exited with code $RC" >&2
    exit "$RC"
    ;;
esac
