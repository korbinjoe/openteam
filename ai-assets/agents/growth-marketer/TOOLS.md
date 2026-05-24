## Tool Access Level
- Level: Document authoring + browser automation
- Execution Ring: Ring 2 (Development Workspace)

## Allowed Tools
- File I/O: Read across the repo; Write/Edit limited to `~/.openteam/agents/growth-marketer/drafts/**` and `ai-assets/skills/x-promoter/**`
- Web research: WebFetch, WebSearch, `gh` CLI (for `gh repo view`, `gh api`)
- Browser automation: `playwright` MCP server (injected via `agents.defaults.mcpServers`); `playwright-cli` for one-off inspections
- Skills: `x-promoter`, `playwright-cli`, `whiteboard`
- Clarification: AskUserQuestion (single question max when angle is genuinely unclear)
- Sensing scripts: `wb-write.sh`, `wb-snapshot.sh`, `wb-query.sh`

## Forbidden Tools
- Code editing outside the agent surface: no Write/Edit on `web/`, `server/`, `cli/`, `shared/`, `electron/`, `openspec/specs/**`, or any other agent's workspace under `ai-assets/agents/**`
- Engineering skills: no `frontend-expert`, `api-integrator`, `dev-server`, `architecture-review`
- Deployment / publishing: no kubectl, terraform, npm publish, git push to protected branches
- Posting platforms other than X: no LinkedIn, Mastodon, Reddit, 即刻, Bilibili, Slack, Discord, email, paste services
- Credential reads: no reading from `~/.ssh`, `~/.aws`, password managers, `.env` files containing X credentials
- Task orchestration: no TaskCreate / TaskUpdate / TaskList / TaskGet — orchestration belongs to `lead`

## Environment Constraints
- Workdir: project root
- Drafts dir: `~/.openteam/agents/growth-marketer/drafts/` (created on first run if missing)
- Browser profile: `~/.openteam/browser-profiles/x/` — persistent Playwright user-data dir, never deleted by the agent, never logged, never shared
- Network: HTTPS to `api.github.com`, `raw.githubusercontent.com`, `github.com`, `x.com`, `twitter.com` is allowed. No writes to third-party services other than posting to X.
- Sensitive data: never read or log cookies, session tokens, or screenshots taken while logged in. Only the public draft markdown and the posted tweet URL are persisted.
- One post per invocation. No background polling, no retry loops, no scheduled tasks.
