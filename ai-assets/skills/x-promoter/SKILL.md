---
name: x-promoter
description: >
  Turn a public GitHub repo into a posted X (Twitter) tweet. Three primitives:
  `summarize-repo.sh` (gh/WebFetch → structured JSON), `draft-tweet.sh` (JSON → 3
  variants, ≤280 chars each, with provenance), `post-tweet.sh` (Playwright,
  persistent profile, draft-then-approve, posts a single tweet or a 2–5 tweet
  thread). Triggered when the user asks to promote, tweet, or "post on X" a
  given GitHub project.
allowed-tools: Bash
---

# x-promoter — GitHub repo → X tweet

This skill is the end-to-end primitive the `growth-marketer` agent composes. Other agents may call the individual scripts directly when they only need one phase.

## Primitives

| Script | Input | Output |
|--------|-------|--------|
| `scripts/summarize-repo.sh <repoUrl>` | A `https://github.com/<owner>/<repo>` URL | Structured JSON on stdout |
| `scripts/draft-tweet.sh --summary <path> [--lang en\|zh] [--thread] [--style hook\|narrative]` | A summary JSON file | Markdown draft at `~/.openteam/agents/growth-marketer/drafts/<owner>-<repo>-<ts>.md` |
| `scripts/post-tweet.sh --draft <path> [--variant A\|B\|C] [--confirm]` | A draft markdown file | Without `--confirm`: prints `would post: <body>` (exit 11). With `--confirm`: posts via Playwright, prints permalink URL on success (exit 0) |

## Defaults that matter

- **Draft-then-approve.** `post-tweet.sh` is a dry-run unless `--confirm` is passed. There is no global override.
- **Persistent profile.** The Playwright user-data dir is `~/.openteam/browser-profiles/x/`. Log in once interactively; cookies persist across runs. The dir is created with mode `0700` and walked to restrict every file to owner-only.
- **Headed by default.** `post-tweet.mjs` launches Chromium with `headless: false` because X aggressively challenges headless contexts. Override by exporting `X_HEADLESS=1` only if you have verified your account is not gated.
- **Locale-aware selectors.** Composer / Add-post / Post / View link locators use ARIA-name regexes that cover English, Chinese (zh-CN), Japanese, and Korean X UIs. If your X interface is in another locale and a selector fails (exit 20), extend the regex bank in `scripts/post-tweet.mjs` rather than switching to CSS selectors.
- **No credential reads.** The skill never asks for or stores a password, an API token, or a session cookie. Only the browser profile dir holds session state.
- **One post per invocation.** The post script posts exactly one tweet (or one thread) and exits. No queues, no scheduling, no retry loops.
- **ARIA-role selectors only.** Composer / Post button are located by `getByRole`, never CSS class names — X's classes rotate, ARIA roles survive redesigns longer.

## Typical flow

```bash
# 1. Summarize
scripts/summarize-repo.sh https://github.com/foo/bar > /tmp/bar.json

# 2. Draft (single tweet, English, hook style)
scripts/draft-tweet.sh --summary /tmp/bar.json
# → ~/.openteam/agents/growth-marketer/drafts/foo-bar-20260524-1003.md

# 3. Dry run (always do this first)
scripts/post-tweet.sh --draft ~/.openteam/agents/growth-marketer/drafts/foo-bar-20260524-1003.md
# → would post: <body>   (exit 11)

# 4. Real post (user-approved)
scripts/post-tweet.sh --draft ... --variant A --confirm
# → https://x.com/<handle>/status/...
```

## Exit codes (post-tweet.sh)

| Code | Meaning |
|------|---------|
| 0    | Posted; permalink URL on stdout |
| 10   | Login required (redirected to /login). Constraint written to war-room. |
| 11   | Dry run — no `--confirm` flag. `would post: ...` printed. |
| 20   | UI selector failed. Screenshot saved next to the draft; constraint written. No retry. |
| 30   | Invalid draft (missing variant, body > 280 chars, malformed file). |

## One-time login

Sessions live in `~/.openteam/browser-profiles/x/`. To set up:

```bash
# Open a real headed Chromium against the persistent profile and log in.
node -e '
  const { chromium } = require("playwright");
  (async () => {
    const ctx = await chromium.launchPersistentContext(
      require("os").homedir() + "/.openteam/browser-profiles/x",
      { headless: false }
    );
    await ctx.newPage().then(p => p.goto("https://x.com/login"));
  })();
'
# Log in, solve any captcha, then close the window.
```

To wipe the session (logout + re-auth from scratch):

```bash
rm -rf ~/.openteam/browser-profiles/x
```

## Boundaries

- Posts to X only. Other platforms are out of scope for this skill — add a sibling skill (`linkedin-promoter`, `mastodon-promoter`) when needed.
- Does not generate images. Text-only tweets in v1. Image attachments are a clean follow-up that delegates to `image-creator`.
- Does not schedule posts. One invocation = one post (or one thread) = one exit.
- Does not auto-reply, monitor mentions, or measure engagement.
