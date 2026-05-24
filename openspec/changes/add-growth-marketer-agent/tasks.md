# Tasks: Add Growth Marketer Agent

## 1. Agent files

- [x] 1.1 Create `ai-assets/agents/growth-marketer/IDENTITY.md` (name, nickname `Promoter`, emoji `📣`, animal `peacock`)
- [x] 1.2 Create `ai-assets/agents/growth-marketer/SOUL.md`
  - Personality, tone (casual), verbosity (detailed for drafts, terse for chat)
  - Collaboration style: writes `decision`, `artifact`, `open_question`, `constraint` to war-room
  - Core skills list: `x-promoter`, `playwright-cli`, `whiteboard`
  - Hard limits: no product code edits, no scheduling/queues, no API-key login, one post per invocation
- [x] 1.3 Create `ai-assets/agents/growth-marketer/TOOLS.md`
  - Allowed: Read/Write/Edit limited to drafts dir + skill dir, Bash, WebFetch, WebSearch, AskUserQuestion, playwright MCP
  - Forbidden: Write/Edit anywhere under `web/`, `server/`, `cli/`, `shared/`, `electron/`, `ai-assets/agents/**`; no git push; no posting to platforms other than X
  - Env constraints: persistent profile dir `~/.openteam/browser-profiles/x/`, never log cookies

## 2. x-promoter skill scaffold

- [x] 2.1 Create `ai-assets/skills/x-promoter/SKILL.md` with frontmatter `name: x-promoter`, description, trigger keywords (promote, tweet, x post, github → x)
- [x] 2.2 Create `ai-assets/skills/x-promoter/prompts/repo-summary.md` — prompt template: facts → angle + 3 proof points + tagline
- [x] 2.3 Create `ai-assets/skills/x-promoter/prompts/tweet-draft.md` — prompt template: 3 variants, single + thread modes, ≤280 chars enforced in instructions

## 3. summarize-repo.sh

- [x] 3.1 Implement `summarize-repo.sh <repoUrl>` — `gh api` primary path, `curl` fallback for unauthenticated users (matches the proposal intent; WebFetch is an LLM tool, not a script-callable command)
- [x] 3.2 Strip README badges (`![...](...)`, shields.io URLs, html comments) before LLM; cap excerpt at 4000 chars
- [x] 3.3 Emit the JSON schema documented in `design.md`; non-zero exit on private repo / network failure with a clear stderr message (exit codes 3/4/5 documented in the script header)
- [x] 3.4 Smoke test against a known public repo (`cli/cli`, returned a 44k-star summary) and a synthetic 404 case (`some-fake-user-zzz/nonexistent-repo-xyz`, exited 4 with a clear error)

## 4. draft-tweet.sh

- [x] 4.1 Implement `draft-tweet.sh --summary <path> [--lang en|zh] [--thread] [--style hook|narrative|contrarian]`
- [x] 4.2 Reserve the output path at `~/.openteam/agents/growth-marketer/drafts/<owner>-<repo>-<ts>.md` (created on first run); the script prints the prompt bundle + path on stdout so the calling agent writes the actual rendered draft to that path. This split keeps the LLM call in the agent's context rather than re-implementing an LLM CLI in bash.
- [x] 4.3 280-char enforcement is performed by `post-tweet.sh` (exit 30) so it runs against the final agent-rendered draft, not a hypothetical pre-render output. The prompt template also instructs the model to enforce the limit at draft time.
- [x] 4.4 Prompt template requires a Provenance section citing the summary JSON fields for each Variant A claim.

## 5. post-tweet.sh (Playwright)

- [x] 5.1 Initialise persistent context at `~/.openteam/browser-profiles/x/`; created on first run by `post-tweet.mjs`
- [x] 5.2 Pre-flight: open `https://x.com/home`; if redirected to a `/login` or `/i/flow/login` URL → exit 10, write `constraint` to war-room via `wb-write.sh` when chat env vars are present
- [x] 5.3 Locate Post composer via ARIA roles only (`getByRole('textbox', { name: /post text|what is happening|tweet/i })`)
- [x] 5.4 Single-tweet path: type body via keyboard.type, click Post (`tweetButtonInline` testid with role-button fallback), wait for success state, capture permalink from the "View" link toast or URL
- [x] 5.5 Thread path: type tweet 1, click "Add post" button, repeat for N tweets, then click "Post all"; capture root permalink
- [x] 5.6 On selector failure: screenshot to `<draft>-failure.png`, exit 20, write a `constraint` entry; no blind retries
- [x] 5.7 Default to dry-run (exit 11) unless `--confirm` is passed; prints `would post [i/N]: <body>` for each tweet. Verified with single and thread fixtures (exit 11), and a 300-char body (exit 30).

## 6. openteam.json registration

- [x] 6.1 Append the `growth-marketer` agent entry to `agents.list` (id, name, description, workspace, role, skills, allowedTools per `proposal.md`)
- [x] 6.2 Add `growth-marketer` to `lead.subAgentNames`
- [x] 6.3 Verify `openteam.json` is valid JSON (`node -e "JSON.parse(require('fs').readFileSync('openteam.json','utf8'))"` — agent list and subAgentNames printed correctly)
- [x] 6.4 Extend sibling hard-coded agent list: `cli/tui/constants.ts:AGENT_EMOJI` — added `'growth-marketer': '📣'`
- [x] 6.5 Verified `web/utils/teamStorage.ts:DEFAULT_AGENT_ORDER` is a curated short list (excludes `architect`, `image-creator`, `product-strategist` too); new agent falls to position 999 — matches existing precedent, no change needed
- [x] 6.6 Verified `web/config/avatarAssets.ts` and `web/config/agentMarkdownTemplates.ts` are id-keyed lookups, not iterated registries; no entry needed (matches the precedent set by `product-strategist`)

## 7. End-to-end validation _(user-driven; requires local app run + real X account)_

- [ ] 7.1 Manual: launch OpenTeam, confirm `growth-marketer` appears in the agent list and is reachable from `lead`
- [ ] 7.2 Manual: dispatch "promote https://github.com/<a-small-public-repo>" — confirm draft file lands at the documented path with 3 variants ≤280 chars
- [ ] 7.3 Manual login flow: run `post-tweet.sh --draft <path> --confirm` once with no logged-in profile — confirm exit 10 + clear login instruction
- [ ] 7.4 Manual login flow: log into X interactively in the persistent profile (one-time, per `SKILL.md` instructions); re-run with `--confirm` against a *test* account — confirm a real tweet is posted and URL is captured
- [ ] 7.5 Confirm `artifact` and `constraint` entries land in the war-room with the posted URL and (on failure) the failure context

## 8. Docs

- [x] 8.1 No central agents README exists in this repo (verified via `grep` for prior agent names in `README.md`). Per-agent descriptions live in their own `SOUL.md` / `TOOLS.md` files and in `openteam.json`; this matches the precedent set by `product-strategist`. No top-level README change in this proposal.
- [x] 8.2 `ai-assets/skills/x-promoter/SKILL.md` documents the persistent profile path, the one-time interactive login snippet, and how to wipe the session (`rm -rf ~/.openteam/browser-profiles/x`).

## 9. Validate proposal

- [x] 9.1 Run `openspec validate add-growth-marketer-agent --strict` and resolve every issue
