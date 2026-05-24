#!/usr/bin/env bash
# summarize-repo.sh — fetch GitHub repo metadata + README excerpt as structured JSON.
#
# Usage:   summarize-repo.sh <https://github.com/owner/repo>
# Output:  JSON to stdout (schema in ai-assets/skills/x-promoter/SKILL.md)
# Exit:    0 success, 2 bad args, 3 not a github URL, 4 private/404, 5 network failure

set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "usage: summarize-repo.sh <https://github.com/owner/repo>" >&2
  exit 2
fi

# Parse owner/repo from the URL (accepts trailing slash or .git suffix).
if [[ ! "$URL" =~ ^https?://github\.com/([^/]+)/([^/?#]+) ]]; then
  echo "error: not a github.com URL: $URL" >&2
  exit 3
fi
OWNER="${BASH_REMATCH[1]}"
REPO="${BASH_REMATCH[2]%.git}"
CANONICAL_URL="https://github.com/${OWNER}/${REPO}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 5
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required (for utf-8 safe truncation)" >&2
  exit 5
fi

# Truncate by code points, not bytes, so multi-byte chars are never split.
utf8_head() {
  local limit="$1"
  python3 -c 'import sys; sys.stdout.write(sys.stdin.read()[:int(sys.argv[1])])' "$limit"
}

# ---- 1. metadata --------------------------------------------------------------
META_JSON=""
if command -v gh >/dev/null 2>&1; then
  if META_JSON=$(gh api "repos/${OWNER}/${REPO}" 2>/dev/null); then
    :
  else
    META_JSON=""
  fi
fi

if [[ -z "$META_JSON" ]]; then
  if ! META_JSON=$(curl -sf -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${OWNER}/${REPO}" 2>/dev/null); then
    echo "error: repo not accessible (private or 404): ${CANONICAL_URL}" >&2
    exit 4
  fi
fi

DESCRIPTION=$(jq -r '.description // ""' <<<"$META_JSON")
PRIMARY_LANG=$(jq -r '.language // ""' <<<"$META_JSON")
STARS=$(jq -r '.stargazers_count // 0' <<<"$META_JSON")
TOPICS=$(jq -c '.topics // []' <<<"$META_JSON")
HOMEPAGE=$(jq -r '.homepage // ""' <<<"$META_JSON")
DEFAULT_BRANCH=$(jq -r '.default_branch // "main"' <<<"$META_JSON")

# ---- 2. README ----------------------------------------------------------------
README_RAW=""
for branch in "$DEFAULT_BRANCH" "main" "master"; do
  for name in README.md README.MD Readme.md readme.md; do
    if README_RAW=$(curl -sf "https://raw.githubusercontent.com/${OWNER}/${REPO}/${branch}/${name}" 2>/dev/null); then
      break 2
    fi
  done
done

clean_readme() {
  # Strip image badges, html comments, and shields.io / badge.fury / badgen links;
  # collapse excessive blank lines; cap at 4000 code points (utf-8 safe).
  local input="$1"
  printf '%s' "$input" \
    | sed -E 's#!\[[^]]*\]\([^)]*\)##g' \
    | sed -E 's#<!--[^>]*-->##g' \
    | sed -E 's#\[!\[[^]]*\]\([^)]*\)\]\([^)]*\)##g' \
    | sed -E 's#https?://(img\.shields\.io|badge\.fury\.io|badgen\.net|shields\.io)[^ )]*##g' \
    | awk 'NF { blank=0; print; next } { if (!blank) print; blank=1 }' \
    | utf8_head 4000
}

README_CLEAN=$(clean_readme "$README_RAW")

# Tagline: first non-empty, non-heading, non-badge line.
README_TAGLINE=$(printf '%s\n' "$README_CLEAN" \
  | awk 'NF && $0 !~ /^#/ && $0 !~ /^>/ && $0 !~ /^\!\[/ && $0 !~ /^\[!/ { print; exit }')

# Highlights: first 3 bullet lines.
README_HIGHLIGHTS_JSON=$(printf '%s\n' "$README_CLEAN" \
  | awk '/^[[:space:]]*[-*][[:space:]]+/ { sub(/^[[:space:]]*[-*][[:space:]]+/,""); print; n++; if (n>=3) exit }' \
  | jq -R -s 'split("\n") | map(select(length > 0))')

# ---- 3. latest release --------------------------------------------------------
RELEASE_TAG=""
RELEASE_HIGHLIGHTS=""
if RELEASE_JSON=$(curl -sf -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" 2>/dev/null); then
  RELEASE_TAG=$(jq -r '.tag_name // ""' <<<"$RELEASE_JSON")
  RELEASE_HIGHLIGHTS=$(jq -r '.body // ""' <<<"$RELEASE_JSON" | utf8_head 800)
fi

# ---- 4. emit JSON -------------------------------------------------------------
jq -n \
  --arg owner "$OWNER" \
  --arg name "$REPO" \
  --arg url "$CANONICAL_URL" \
  --arg description "$DESCRIPTION" \
  --arg primaryLanguage "$PRIMARY_LANG" \
  --argjson stars "$STARS" \
  --argjson topics "$TOPICS" \
  --arg homepage "$HOMEPAGE" \
  --arg tagline "$README_TAGLINE" \
  --argjson highlights "$README_HIGHLIGHTS_JSON" \
  --arg excerptForLLM "$README_CLEAN" \
  --arg latestReleaseTag "$RELEASE_TAG" \
  --arg latestReleaseHighlights "$RELEASE_HIGHLIGHTS" \
  --arg fetchedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    repo:   { owner: $owner, name: $name, url: $url },
    meta:   {
      description: $description,
      primaryLanguage: $primaryLanguage,
      stars: $stars,
      topics: $topics,
      homepage: $homepage
    },
    readme: {
      tagline: $tagline,
      highlights: $highlights,
      excerptForLLM: $excerptForLLM
    },
    recent: {
      latestReleaseTag:        (if $latestReleaseTag == "" then null else $latestReleaseTag end),
      latestReleaseHighlights: (if $latestReleaseHighlights == "" then null else $latestReleaseHighlights end)
    },
    fetchedAt: $fetchedAt
  }'
