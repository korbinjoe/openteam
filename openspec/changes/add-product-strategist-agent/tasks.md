# Tasks: Add Product Strategist Agent

## 1. Author the agent files

- [x] 1.1 Create `ai-assets/agents/product-strategist/IDENTITY.md` with `name: Product Strategist`, `nickname: Strategist`, `emoji: 🧪`, `animal: meerkat`
- [x] 1.2 Create `ai-assets/agents/product-strategist/SOUL.md` with the following sections:
  - Personality (research-first, evidence-driven, hands off implementation)
  - Tone (casual, decisive)
  - Verbosity (detailed for deliverables, concise in chat)
  - Collaboration Style (war-room writes for `decision` / `constraint` / `artifact` / `open_question`)
  - Hard Limits (no hi-fi visual design — defer to `ui-designer`; no implementation — defer to `fullstack-product-engineer`; no architecture review — defer to `architect`)
- [x] 1.3 Document expected output paths in `SOUL.md` (`research/competitor-scan.md`, `research/user-research.md`, `prd/<feature>.md`)

## 2. Register the agent

- [x] 2.1 Add a `product-strategist` entry to `agents.list` in `openteam.json` with `role: expert`, the description from `proposal.md`, `skills: ["playwright-cli", "whiteboard"]`, and `allowedTools` including `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch`, `AskUserQuestion`
- [x] 2.2 Add `"product-strategist"` to `lead`'s `subAgentNames` in `openteam.json`
- [ ] 2.3 Run the server locally and confirm the agent appears in `AgentRegistry`'s "Loaded agents" log line _(user-driven; requires local app run)_

## 3. UI / locale touch-ups

- [x] 3.1 Add `'product-strategist'` to the emoji map in `cli/tui/constants.ts` (use 🧪 to match `IDENTITY.md`)
- [x] 3.2 Verify there are no other hard-coded agent lists that need extending (grep `cli/`, `web/`, `server/` for `'fullstack-product-engineer'` to find sibling sites)
- [x] 3.3 If a sibling site is found, extend it; otherwise document the absence in the PR description
  - `web/config/avatarAssets.ts` — no entry; `getAvatarUrl` falls back to `/api/avatars/custom/<id>/<style>` for non-default styles. A brush avatar PNG can be generated later via `image-creator`; not required for first launch.
  - `web/utils/teamStorage.ts:DEFAULT_AGENT_ORDER` — curated short list (excludes `architect` and `image-creator` too). New agent falls to position 999, matching existing precedent.
  - `web/config/agentMarkdownTemplates.ts` — used only as a fixed-id preview source in `AgentExamplesPanel` (`fullstack-product-engineer` for AGENTS.md, `soul-architect` for SOUL.md). Not iterated; no entry needed.
  - `web/components/chat/modals/NewChatForm.tsx` and `web/hooks/useChatWebSocket.ts` — default to `fullstack-product-engineer` when no agent is preselected. New agent is one of N options via the registry; no change needed.
  - `web/pages/MentionInputDemo.tsx` — standalone demo page, not registry-driven.

## 4. Validate end-to-end _(user-driven; requires local app run)_

- [ ] 4.1 Start a chat in the local app and confirm `lead` can dispatch a "scan competitors for X" task to the strategist
- [ ] 4.2 Confirm the strategist can use the browser via `playwright-cli` against a public site
- [ ] 4.3 Confirm the strategist writes a `decision` and an `artifact` entry to the war room when producing a PRD
- [ ] 4.4 Confirm the strategist hands off to `ui-designer` when asked for hi-fi visuals (refuses politely and routes via the war room)

## 5. Spec / docs hygiene

- [x] 5.1 Run `openspec validate add-product-strategist-agent --strict` and resolve any reported issues
- [x] 5.2 Update `web/config/agentMarkdownTemplates.ts` if it surfaces an explicit list users edit through the UI (verify before changing) — verified not iterated; no update needed.
- [ ] 5.3 PR description summarises: new agent id, scope cap (PRD + low-fi), boundaries with `ui-designer` / `fullstack-product-engineer` _(prepared at PR-open time)_
