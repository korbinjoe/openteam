# Proposal: Add Growth Marketer Agent

## Summary

Add a new built-in agent `growth-marketer` to `ai-assets/agents/` that takes a GitHub repository URL, researches and summarises the project, drafts an engaging X (Twitter) post (or short thread), and uses a Playwright-driven browser session to post it on X — with a default draft-then-approve gate to avoid mis-posts.

## Motivation

OpenTeam already ships agents that cover product, engineering, design, devops, review, image generation and coaching. There is no built-in for **outbound growth / promotion** — the loop a solo "AI super-individual" runs after shipping: surface what just shipped, turn it into a compelling external message, and actually post it.

Today the user has to leave the OpenTeam loop and switch tools to do this:

- Read a repo's README, CHANGELOG, recent commits to figure out the angle.
- Hand-write a hook tweet that respects 280 chars while still being interesting.
- Open a browser, log into X, paste, hit post.

This contradicts the pulse-mode thesis — dispatch the marketer alongside an engineer, come back to a posted tweet (or a draft pending one click).

## Goals

1. **One new built-in agent** `growth-marketer` registered in `openteam.json`, discoverable as a sub-agent of `lead`.
2. **Self-contained workspace** at `ai-assets/agents/growth-marketer/` with `IDENTITY.md`, `SOUL.md`, and (optionally) `TOOLS.md` matching existing conventions.
3. **Single end-to-end skill** that runs: GitHub repo → summary → tweet draft → (approval) → posted on X. Implemented as a new skill `ai-assets/skills/x-promoter/` so the capability is reusable by other agents.
4. **Persistent X login state** — the agent uses a dedicated Playwright user-data dir (`~/.openteam/browser-profiles/x/`) so the user logs into X once and the agent reuses the session across runs.
5. **Default draft-then-approve gate** — the agent stops at "tweet drafted, open this URL or call `--confirm` to post". Auto-post is opt-in via an explicit `autoPost=true` parameter.
6. **War-room aware** — writes `decision` (angle/positioning choice), `artifact` (the posted tweet URL + draft path), `open_question` (when angle is unclear), and `constraint` (e.g. X login expired) per the existing whiteboard protocol.
7. **No engineering / product scope creep** — the marketer does not edit product code, does not write PRDs, does not run analytics; it strictly owns the "turn this repo into a posted tweet" loop.

## Non-Goals

- **Cross-platform posting** (LinkedIn, Mastodon, Reddit, Bilibili, Jike, etc.) — X only in this change. Multi-platform can be a follow-up that adds new adapters.
- **Scheduled posting / posting queues / drip campaigns** — single one-shot posts only.
- **Analytics / engagement tracking** — no impression metrics, no reply monitoring.
- **High-fidelity images, posters, video** — text-only in this change. Image attachments can be a follow-up that delegates to `image-creator`.
- **Account growth strategy / audience targeting plans** — the agent produces *a tweet*, not a marketing plan.
- **Bypassing X rate limits / using unofficial APIs** — strictly browser automation against the real `x.com` web UI.

## Approach

### Agent identity

```
id:       growth-marketer
name:     Growth Marketer
nickname: Promoter
emoji:    📣
animal:   peacock   # high-signal display
role:     expert
```

### File layout (new)

```
ai-assets/agents/growth-marketer/
  IDENTITY.md        # name, nickname, emoji, animal — matches product-strategist format
  SOUL.md            # Personality, Tone, Verbosity, Collaboration Style, Hard Limits
  TOOLS.md           # Allowed / Forbidden tools, env constraints

ai-assets/skills/x-promoter/
  SKILL.md           # Skill description and trigger conditions (Skill discovery format)
  scripts/
    summarize-repo.sh    # gh CLI / WebFetch wrapper → JSON summary
    draft-tweet.sh       # passes summary into Claude prompt → tweet draft file
    post-tweet.sh        # Playwright script: open x.com, paste, click Post, capture URL
  prompts/
    repo-summary.md      # prompt template for repo → angle + facts
    tweet-draft.md       # prompt template for draft (single + thread variants)
```

### `openteam.json` registration

Append to `agents.list` and to `lead.subAgentNames`:

```jsonc
{
  "id": "growth-marketer",
  "name": "Growth Marketer",
  "description": "Promotes a given GitHub project on X. Summarises the repo, drafts an engaging tweet (or short thread), and posts it via a persistent browser session. Defaults to draft-then-approve.",
  "workspace": "./ai-assets/agents/growth-marketer",
  "role": "expert",
  "skills": ["x-promoter", "playwright-cli", "whiteboard"],
  "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch", "AskUserQuestion"]
}
```

`playwright` MCP is already injected via `agents.defaults.mcpServers`, so no new MCP entry.

### End-to-end flow (single invocation)

```
input: { repoUrl, lang?="en", style?="hook", thread?=false, autoPost?=false }

1. Summarize repo
   - Try `gh repo view <repoUrl> --json name,description,stargazerCount,primaryLanguage,topics,homepageUrl`
   - Read README.md (and CHANGELOG.md / package.json if present) via raw github content
   - Distil: what the project is, what's new, why someone should care, 3 concrete proof points

2. Draft tweet
   - Run repo-summary → tweet-draft prompt chain
   - Constraints: ≤ 280 chars per tweet, hook-first, 1–2 hashtags max, link last
   - Output to `~/.openteam/agents/growth-marketer/drafts/<repo>-<timestamp>.md`
   - Optionally generate 2–3 variants and write a `decision` entry naming the picked one

3. Post (gated)
   - If autoPost=false (default): print the draft + the file path, write a `progress` entry "draft ready, awaiting approval", stop
   - If autoPost=true OR user calls the skill with --confirm <draft-path>:
     - Launch Playwright with persistent context at `~/.openteam/browser-profiles/x/`
     - If not logged in (detected via redirect to /login): write a `constraint` entry "X login expired", print instructions for the user to log in once, stop
     - Open https://x.com/home, click Post, paste each tweet (thread: paste + click "Add" between tweets), click Post
     - Capture the posted tweet URL from the toast / navigation
     - Write an `artifact` entry with the tweet URL and draft path
```

### Boundaries with existing agents

| Activity | Owner |
|----------|-------|
| Decide what's worth shipping | product-strategist |
| Write/refactor product code | fullstack-product-engineer |
| Generate a poster image | image-creator (called explicitly when scope grows) |
| Deploy a build | devops-engineer |
| **Summarise a shipped repo and post it on X** | **growth-marketer** |

### Defaults chosen (worth flagging)

| Decision | Default | Why |
|----------|---------|-----|
| Send mode | Draft-then-approve | Attention-first, avoids mis-posts; auto-post is opt-in |
| Output shape | Single tweet, optional 2–5 tweet thread | Covers the common case without thread-chaining complexity in v1 |
| Images | Text only | Smallest scope; image attachments are a clean follow-up |
| Language | English default, `lang=zh` for Chinese | X main audience is English; explicit override available |
| Login flow | Persistent profile under `~/.openteam/browser-profiles/x/` | User logs in once interactively; agent reuses cookies; never asks for or stores password |

If any of these defaults disagree with the user's intent, they can be flipped by editing `proposal.md` and `tasks.md` before implementation starts.

## Risks

- **X UI churn** — selectors used by `post-tweet.sh` will break when X redesigns. Mitigation: use accessibility roles (`role=textbox name="Post text"`) over CSS selectors; isolate selectors in one file; document last-verified-on date in the skill.
- **Login state expiry / lockout** — sessions expire; suspicious automation can trigger captcha or lockout. Mitigation: detect login screen → emit `constraint` and stop, never attempt to brute through; throttle to one post per invocation; no background polling.
- **Account safety** — automated posting can violate X's automation rules if abused. Mitigation: scope is one explicit user-initiated post per invocation, not a posting queue / bot; documented in SOUL.md hard limits.
- **Repo summary quality** — bad summaries → bad tweets. Mitigation: ground every claim in repo facts (README excerpt, version bump, star count) cited in the draft file; user can reject draft before posting.
- **Credential leakage** — never log cookies, screenshots of logged-in state, or session tokens. Mitigation: explicit allow-list of what the post-tweet script writes to disk (draft + posted URL only); browser profile dir excluded from any sharing.

## Open Questions

1. Should the agent also support attaching a single image (repo screenshot via `playwright-cli`) as a v1.1, or keep that strictly out of scope until requested?
2. Should the draft-to-post handoff use a CLI confirm (`--confirm <path>`) or a war-room `open_question` that the user resolves via the UI? (Leaning CLI for v1 simplicity.)
3. Which X account does the persistent profile target — the user's personal account, or a separate OpenTeam-branded one? (Profile dir is per-account; needs naming if more than one.)
