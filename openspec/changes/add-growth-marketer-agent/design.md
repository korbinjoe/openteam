# Design: Growth Marketer Agent

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  Lead (orchestrator)                                         │
│     │ dispatch task: "promote https://github.com/foo/bar"    │
│     ▼                                                        │
│  growth-marketer (this change)                               │
│     │                                                        │
│     │  uses skill: x-promoter                                │
│     ▼                                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ x-promoter skill                                     │   │
│  │   1. summarize-repo.sh  ──► gh CLI / WebFetch        │   │
│  │   2. draft-tweet.sh     ──► Claude prompt template   │   │
│  │   3. post-tweet.sh      ──► Playwright (persistent)  │   │
│  └──────────────────────────────────────────────────────┘   │
│     │                                                        │
│     ▼                                                        │
│  Outputs:                                                    │
│    - Draft  → ~/.openteam/agents/growth-marketer/drafts/     │
│    - Posted → war-room artifact entry with tweet URL         │
└──────────────────────────────────────────────────────────────┘
```

The agent is a thin orchestrator. The reusable capability lives in the `x-promoter` skill so other agents (e.g. `lead` directly, or a future `community-manager`) can call the same primitives.

## Component layout

### Agent files

| File | Purpose |
|------|---------|
| `ai-assets/agents/growth-marketer/IDENTITY.md` | Identity card: name, nickname, emoji, animal |
| `ai-assets/agents/growth-marketer/SOUL.md` | Personality, tone, collaboration style, core skills, hard limits |
| `ai-assets/agents/growth-marketer/TOOLS.md` | Allowed/forbidden tools, environment constraints |

### Skill files

| File | Purpose |
|------|---------|
| `ai-assets/skills/x-promoter/SKILL.md` | Skill description (frontmatter `name`, `description`, `trigger`) |
| `ai-assets/skills/x-promoter/scripts/summarize-repo.sh` | Pulls repo metadata + README, emits structured JSON to stdout |
| `ai-assets/skills/x-promoter/scripts/draft-tweet.sh` | Reads summary JSON, runs the draft prompt, writes draft .md |
| `ai-assets/skills/x-promoter/scripts/post-tweet.sh` | Playwright runner — opens persistent context, posts, prints URL |
| `ai-assets/skills/x-promoter/prompts/repo-summary.md` | Prompt template: repo facts → angle + 3 proof points |
| `ai-assets/skills/x-promoter/prompts/tweet-draft.md` | Prompt template: angle → tweet draft variants (single + thread) |

### Runtime data layout

```
~/.openteam/
  agents/growth-marketer/
    drafts/
      <owner>-<repo>-<YYYYMMDD-HHMM>.md     # draft + provenance + variants
      <owner>-<repo>-<YYYYMMDD-HHMM>.posted # written after successful post (contains URL)
  browser-profiles/
    x/                                       # Playwright persistent context dir
      Default/...                            # cookies, local storage — gitignored, never logged
```

## Data contracts

### Repo summary JSON (produced by `summarize-repo.sh`)

```jsonc
{
  "repo": { "owner": "foo", "name": "bar", "url": "https://github.com/foo/bar" },
  "meta": {
    "description": "...",
    "primaryLanguage": "TypeScript",
    "stars": 1234,
    "topics": ["ai", "agent"],
    "homepage": "https://bar.dev"
  },
  "readme": {
    "tagline": "first sentence after the H1",
    "highlights": ["bullet 1", "bullet 2", "bullet 3"],
    "excerptForLLM": "first 4000 chars of README, minus badges"
  },
  "recent": {
    "latestReleaseTag": "v1.2.0",
    "latestReleaseHighlights": "..."   // null if no release
  },
  "fetchedAt": "2026-05-24T10:00:00Z"
}
```

### Tweet draft markdown (produced by `draft-tweet.sh`)

```markdown
# Draft: foo/bar — 2026-05-24 10:00

source: https://github.com/foo/bar
lang: en
mode: single   # single | thread
variants_picked: A

## Variant A (picked)
<tweet body, ≤280 chars>

## Variant B
<tweet body, ≤280 chars>

## Variant C
<tweet body, ≤280 chars>

## Provenance
- tagline: "..."  (README L1)
- proof: "1.2k stars in 3 weeks"  (gh repo view)
- proof: "v1.2.0 ships persistent agent memory"  (CHANGELOG)
```

### Post invocation contract (`post-tweet.sh`)

```
post-tweet.sh --draft <path-to-draft.md> [--variant A|B|C] [--confirm]

Exit codes:
  0  posted, URL printed to stdout
  10 login required (writes constraint entry, prints login instruction)
  11 dry run only (no --confirm); prints "would post: <body>"
  20 X UI selector failed; writes the screenshot path; non-fatal for the agent
```

## Decisions

1. **Skill over inline scripts.** A new `x-promoter` skill is created instead of putting bash inline in SOUL.md. This makes the primitives reusable by other agents and keeps the agent file small.

2. **Persistent browser profile per platform.** `~/.openteam/browser-profiles/x/` is dedicated to X. This isolates blast radius (e.g. clearing it only logs out X) and makes future LinkedIn / Mastodon adapters trivially additive.

3. **Never store credentials, only cookies.** The agent never asks for username/password and never reads from a password manager. The user logs in interactively into the persistent profile (one-time), and the agent reuses the resulting cookies. This is the only auth path.

4. **Default to draft-then-approve.** `autoPost=false` is the default. Rationale: a mis-posted tweet on a real account is hard to walk back, and the user is the one whose name is on the account. Auto-post is opt-in per invocation, not a global setting.

5. **Selectors via accessibility roles.** `post-tweet.sh` uses Playwright `getByRole('textbox', { name: 'Post text' })` style locators. Reason: X's CSS class names are minified and rotate; ARIA roles survive redesigns longer. When they do break, isolate the fix to one file.

6. **One post per invocation.** The skill posts exactly one tweet (or one thread) per call and exits. No background polling, no queue. Rationale: minimizes both the "automation pattern" footprint that X anti-abuse looks for, and the cost of a bug (worst case = one bad tweet, not a flood).

7. **War-room writes are conservative.** Only `decision` (chosen angle/variant), `artifact` (posted URL), `open_question` (angle unclear), `constraint` (login expired / selector broken). No `progress` spam — that's covered by the Stop-hook auto-extraction.

## Alternatives considered

- **Use X API directly instead of browser automation.** Rejected: X API v2 paid tiers + app approval are friction the user doesn't want for a personal-account promo loop. Browser automation against an already-logged-in session is simpler and account-portable.

- **Put summary+draft+post into one monolithic script.** Rejected: separating them lets the user re-draft from a cached summary without re-fetching, and lets future agents call just `summarize-repo.sh` without dragging in Playwright.

- **Generate images via image-creator in v1.** Rejected for scope. Text-only is the smallest valuable slice; image attachment is a clean follow-up that doesn't change v1 contracts.

- **Schedule posts via cron.** Rejected. Out of scope — that's a posting-queue product, not a promotion agent. If/when needed, it belongs in a separate skill (`post-scheduler`).

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| X UI selectors break | ARIA-role locators; isolate selectors to one file; failure → screenshot + clear error, never a silent retry loop |
| Login expires mid-task | Pre-flight check (`/home` redirects to `/login`) → exit 10 + constraint entry; never attempt to log in programmatically |
| Account suspended for automation | Hard cap of one post per invocation; no scheduled / repeated posting in this change; clearly documented in SOUL.md |
| Cookies leaked | Browser profile dir is never read by other scripts; never logged; never uploaded to LLM context (only the public draft markdown is in context) |
| Bad summary → bad tweet | Provenance section in the draft cites README/meta sources; user reviews before posting under default mode |
| Repo is private / requires auth | `summarize-repo.sh` fails fast with a clear error; agent does not attempt to bypass with credentials |
