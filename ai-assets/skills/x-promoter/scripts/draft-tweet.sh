#!/usr/bin/env bash
# draft-tweet.sh — assemble the draft prompt + summary JSON for the calling agent.
#
# The actual LLM call is performed by the agent that invokes this skill —
# this script only prepares the prompt bundle and reserves the output path.
# The agent must then write the rendered draft markdown to the printed path.
#
# Usage:
#   draft-tweet.sh --summary <path> [--lang en|zh] [--thread] [--style hook|narrative|contrarian]
#
# Stdout: a single instruction block the agent feeds to its model. The last
#         line is `OUTPUT_PATH=<absolute path>` — the agent writes the draft
#         markdown to that exact path.
# Exit:   0 success, 2 bad args, 4 summary file unreadable.

set -euo pipefail

SUMMARY=""
LANG="en"
MODE="single"
STYLE="hook"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary) SUMMARY="${2:-}"; shift 2 ;;
    --lang)    LANG="${2:-en}"; shift 2 ;;
    --thread)  MODE="thread"; shift ;;
    --single)  MODE="single"; shift ;;
    --style)   STYLE="${2:-hook}"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$SUMMARY" || ! -r "$SUMMARY" ]]; then
  echo "error: --summary <path> required and readable" >&2
  exit 4
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 4
fi

OWNER=$(jq -r '.repo.owner' "$SUMMARY")
REPO=$(jq -r '.repo.name'  "$SUMMARY")
URL=$(jq  -r '.repo.url'   "$SUMMARY")

if [[ -z "$OWNER" || -z "$REPO" || "$OWNER" == "null" || "$REPO" == "null" ]]; then
  echo "error: summary missing repo.owner / repo.name" >&2
  exit 4
fi

TS=$(date +%Y%m%d-%H%M)
DRAFTS_DIR="${HOME}/.openteam/agents/growth-marketer/drafts"
mkdir -p "$DRAFTS_DIR"
OUTPUT_PATH="${DRAFTS_DIR}/${OWNER}-${REPO}-${TS}.md"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT_PATH="${SCRIPT_DIR}/../prompts/tweet-draft.md"

if [[ ! -r "$PROMPT_PATH" ]]; then
  echo "error: prompt template missing at $PROMPT_PATH" >&2
  exit 4
fi

cat <<EOF
# x-promoter: draft instruction

You are about to draft a tweet using the prompt template and summary below.
Write the rendered markdown draft to the absolute path on the last line.
Do not modify the path. Do not add any other files.

## Parameters
- lang: ${LANG}
- mode: ${MODE}
- style: ${STYLE}
- repo.url: ${URL}

## Prompt template (verbatim)
$(cat "$PROMPT_PATH")

## Summary JSON (verbatim)
\`\`\`json
$(cat "$SUMMARY")
\`\`\`

## Hard requirements before writing the draft
- Every variant tweet body MUST be ≤280 characters. Count, re-count, tighten if needed.
- The Provenance section MUST cite the summary fields each Variant A claim came from.
- Output is markdown matching the template exactly. No code fences around the whole document.

OUTPUT_PATH=${OUTPUT_PATH}
EOF
