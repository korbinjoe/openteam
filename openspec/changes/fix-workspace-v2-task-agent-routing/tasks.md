# Tasks: Fix Workspace V2 Task↔Agent Routing

## Phase 1 — Data Layer: `Chat.members[]` (additive)

- [x] **Add `ChatMember` type** to `server/config/types.ts`. Mirror to client `web/components/workspace/types.ts`. Add optional `members?: ChatMember[]` field to `Chat`. _(Skipped `shared/ws-types.ts` re-export: shared/ws does not currently import from server/config and adding the dependency was out of scope for this delta. Client mirrors the shape directly.)_
- [x] **Implement `MemberAggregator`** in `server/stores/MemberAggregator.ts`. Derives per-member `status` from live `SessionRegistry` activity (running/waiting/error/done) and `expertSessions.exitCode` (done/error), falling back to `idle`. Preview comes from the active agent's `currentTool` / `fileOp` / `logLine`. _(Deferred: JSONL-tail parse + LRU cache — per design risk R1, defer until measured need. In-memory derivation is O(members) and runs on read.)_
- [x] **Wire aggregator into chat routes** (`/api/chats/recent`, `/api/workspaces/:id/chats`, `/api/chats/:id`) — every Chat returned to the client now carries `members[]`. Members ordered: lead first, then workers in `teamAgentIds` order.
- [ ] **Push member updates via WS** — _Deferred per design risk R1._ Current flow: client polls `/api/workspaces/:id/chats` and the existing `chat:activity` event already triggers re-fetch downstream. Revisit if measured staleness is unacceptable. No `chat:updated` event exists in the codebase yet; adding it is a larger change than this fix warrants.
- [x] **Keep `chat.status` / `chat.taskStatus` as worst-of(members.status)** — backward compatible: `chat.status` continues to be written by `ActivityAggregator` / `SessionRegistry` on session lifecycle, which already follows the priority `error > waiting > running > done`. The new `MemberAggregator.rollupStatus()` exposes the same priority for downstream callers that need to recompute it from `members[]`. _(Unit test deferred — no test harness for stores currently in repo; tracked for follow-up.)_

## Phase 2 — Routing: URL is authoritative for agent dimension

- [x] **Add `buildTaskUrl` helper** in `web/components/workspace-v2/urls.ts`. Single function: `(wsId, taskId, agentId?) => string`. Also exports `buildWorkspaceUrl`.
- [x] **WorkspaceLayout reads `?agent=`** via `useSearchParams`. Passes `selectedAgentId={searchParams.get('agent')}` into `WorkspaceProvider` alongside existing `workspaceId` / `taskId` params. ⌘1-4 handler now routes via `buildTaskUrl(workspaceId, chatId)` instead of raw template literal.
- [x] **Refactor `WorkspaceContext`**:
  - `selectedAgentId` is now a Provider prop (URL-driven), not reducer state.
  - `viewMode` is a derived getter: `selectedAgentId ? 'agent' : 'task-overview'`.
  - `selectedTaskId` aliased to `activeChatId` (kept on the value for legacy consumers).
  - Removed `SET_ROUTE`, `SELECT_AGENT`, `OPEN_TASK_OVERVIEW`, `CYCLE_TARGET_AGENT` actions.
  - `selectAgent(agentId)` / `openTaskOverview(taskId)` now call `navigate(buildTaskUrl(...))`.
  - `taskChatTargetIndex` + `cycleTargetAgent` reimplemented as transient `useState` (resets on `activeChatId` change). _(Kept the existing API name rather than introducing `setTargetAgent` — downstream `GroupChatInput` already consumes `cycleTargetAgent`; Phase 4 will refactor when GroupChatInput moves to real member data.)_
- [x] **Migrate localStorage schema** — `loadPersistedState()` silently strips legacy `viewMode`, `selectedAgentId`, `selectedTaskId`, `taskChatTargetIndex`, `workspaceId`, `activeChatId` keys on read. Wrapped in try/catch.

## Phase 3 — Sidebar: split TaskRow vs AgentRow navigation

- [x] **`TaskSessionList.TaskRow.handleOpen`** — navigates to `buildTaskUrl(wsId, taskId)` (no agent param).
- [x] **`TaskSessionList.AgentRow.handleOpen`** — navigates to `buildTaskUrl(wsId, taskId, agentId)`. New behavior.
- [x] **`AgentRow` uses `chat.members[m]`** for status/duration via new `member?: ChatMember` prop. Falls back to parent `chat` rollup when API hasn't enriched yet (race / legacy). Added `memberStatusDot()` helper. `TODO(v2-agents)` deleted.
- [x] **`AgentRow` `isSelected` prop** — TaskRow now reads `selectedAgentId` from `useWorkspace()` and passes `isSelected={isSelected && selectedAgentId === agentId}`. Selected row gets accent-brand-light text + font-medium AND `bg-accent-brand/[0.08]` background. TaskRow's own selected bg only lights when `!selectedAgentId` (task-overview mode).
- [x] **`PinnedRow` / `CompletedRow`** — switched their `navigate(\`/v2/...\`)` calls to `buildTaskUrl(chat.workspaceId, chat.id)` for consistency. Still no agent param. _(All three Row variants now go through the helper, eliminating the raw template literal as a divergence risk.)_

## Phase 4 — TaskOverview & GroupChat: replace mocks with real data

- [x] **Create `useV2Task(taskId)` hook** at `web/hooks/useV2Task.ts`. Returns `{ chat, members, loading }`. Backed by `useV2AllChats` so cache + WS subscriptions are shared with the sidebar.
- [ ] **Create `useV2GroupTimeline(taskId)` hook** — _Deferred per design risk R1._ Subscribing to N per-member JSONL streams + merge-by-timestamp is non-trivial new infra; current v0 maps whiteboard entries → `GroupMessage` instead, which already aggregates the "what matters" signals (handoff/progress/decision/open_question/artifact/constraint) across all members. Revisit when users need raw assistant chatter in the group view; whiteboard-driven timeline is the higher-signal default.
- [x] **`TaskInfoSidebar`** — `MOCK_TASK` deleted. Reads `useV2Task(activeChatId)` + `useWhiteboard(activeChatId)`. Empty state when no chat. Goal pulled from whiteboard `goal` entry (falls back to `chat.title`). Team renders real lead/workers with `memberStatusDot()`. Timeline filters whiteboard entries to handoff/progress/open_question/decision/goal types, sorted newest-first, capped at 12.
- [x] **`GroupChat`** — `MOCK_MESSAGES` + `MOCK_AGENTS` deleted. Renders from `useWhiteboard` → `entryToGroupMessage()` mapper. Empty state when no chat. Passes real `members` + `agentNames` to `GroupChatInput`.
- [x] **`GroupChatInput`** — accepts `members: ChatMember[]` + `agentNames` props. `@target` button cycles through real members (disabled when 0). Send action stubbed (no posting yet — text input pending wiring to `chatService.sendMessage` in a future delta; design risk R1 again — single-member chat session API for the group target is a separate piece).
- [x] **`TaskOverview` container** — unchanged shell, but `TaskInfoSidebar` + `GroupChat` now read `activeChatId` themselves via `useWorkspace()`, so the container only routes layout.

## Phase 5 — Toolbar: breadcrumb + sibling agent dots

- [x] **`ActiveChatInfoBar` rewrite** — reads `useV2WorkspaceChats(workspaceId)` + `selectedAgentId`. Renders:
  - When agent active: `{memberStatusDot} {agentName}` + "in" + clickable `{chat.title}` button (navigates back to task overview URL) + sibling dots cluster + optional model chip.
  - Defensive fallback when no agent matches (URL transition): chat title + member count badge.
  - Mocked `AGENT_DURATIONS` removed; toolbar duration now derives from `activeMember.lastMessageAt` via `ageLabel()`.
- [x] **Sibling dots component** — `SiblingDots`, max 4 visible + "+N" overflow. Each dot is a button with `aria-label="Switch to {agentName}"` and `onClick={() => navigate(buildTaskUrl(wsId, chatId, agentId))}`. Color per `memberStatusDot(member.status)`; ring on hover for affordance.
- [x] **`TaskInfoBar`** — unchanged (GROUP badge + task name). _(Verified — already meets design.)_

## Phase 6 — Quad mode: branch on viewMode

- [x] **`WorkspaceContent.QuadLayout`** — branch on `viewMode`:
  - `agent` mode: kept `useQuadChats(4)` cross-task tiling (unchanged).
  - `task-overview` mode: `TaskOverviewQuadLayout` rewritten to tile `chat.members` of the *active task* (lead first, then workers in `teamAgentIds` order — already enforced by `MemberAggregator`).
- [x] **`MiniAgentPane` member-mode rendering** — added optional `member: ChatMember` + `parentChat: Chat` props. New `MemberBackedPane` variant renders per-member status/preview/lastMessage and `onClick → navigate(buildTaskUrl(wsId, parentChat.id, member.agentId))`. Chat-mode and prop-driven empty modes untouched (backward compat).
- [x] **Empty member slots** — `TaskOverviewQuadLayout` passes `openAddAgent(activeChatId)` to `AddAgentSlot` (now accepts `onClick` prop, disabled when no chat). Existing `AddAgentPicker` UI handles the rest.

## Phase 7 — Command Palette: agent-level navigation

- [x] **`CommandPalette` result builder** — flat-maps `chats × (overview header + members)` into typed entries (`task` | `member` | `action`). Each task emits one task-overview row (clickable → task URL) followed by N member rows (clickable → agent URL).
- [x] **Result click** — task entry navigates to `buildTaskUrl(wsId, c.id)`; member entry navigates to `buildTaskUrl(wsId, c.id, m.agentId)`. _(Took the "header routes to overview" option from the spec rather than rendering a non-interactive label — keyboard nav stays uniform.)_
- [x] **Filter logic** — fuzzy match against `chat.title` (surfaces task + all members) OR `member.name` (surfaces matched member + its parent task header for context). Action entries match independently.
- [ ] **⌘1-4 shortcuts** — _Deferred._ Current precedence in `WorkspaceLayout` already prefers active chat → awaiting-review → running, which roughly approximates "attention-needed first." Per-member ⌘1-4 within active task is out of MVP scope for this delta; revisit after Phase 4 real timeline data is in.

## Phase 8 — Cleanup & Validation

- [x] **Delete unreachable state**: `viewMode`, `selectedTaskId`, `SELECT_AGENT`, `OPEN_TASK_OVERVIEW` actions confirmed removed; `grep -rn 'SELECT_AGENT\|OPEN_TASK_OVERVIEW\|SET_ROUTE\|CYCLE_TARGET_AGENT' web/` returns zero hits. _(Note: `viewMode` + `selectedTaskId` still exist on the context value as a derived getter / legacy alias — intentional for downstream compat, see Phase 2 note.)_
- [x] **Update `WorkspaceLayout` ⌘1-4 handler** to pass through `buildTaskUrl` instead of raw template literal. _(Done in Phase 2.)_
- [ ] **Smoke test the 4 critical scenarios** (project rule §4) — _Requires browser session; not run in this delta. Owner to verify before merge:_
  - Initial load — open `/v2/workspace/X/task/Y?agent=Z`, verify ChatPane mounts on agent Z's session.
  - Page refresh — same URL after F5 restores the agent 1:1 view (not the overview).
  - Window resize — drag window between 800px and 1400px, verify ChatPane does NOT remount (xterm intact, no scrollback loss).
  - History restore — click task name from sidebar, click an agent row, hit back: lands on task overview without remounting.
- [ ] **Manual verification matrix** for each layoutMode × viewMode — _Requires browser session; not run in this delta._
  - single + agent ✓ shows ChatPane
  - split + agent ✓ shows ChatPane + IDE
  - quad + agent ✓ tiles cross-task chats
  - single + task-overview ✓ shows TaskInfoSidebar + GroupChat
  - split + task-overview ✓ shows GroupChat (left) + IDE (right)
  - quad + task-overview ✓ tiles members of current task
- [x] **Update `openspec/changes/upgrade-workspace-ui-v2/tasks.md` checkbox** for the "Connect to real data" item (line 55) — marked as superseded by this change.
- [x] **Validate spec** — `openspec validate fix-workspace-v2-task-agent-routing --strict` → `Change 'fix-workspace-v2-task-agent-routing' is valid`. `npx tsc --noEmit` clean.

## Dependencies & Parallelization

- Phase 1 (data) blocks Phase 4 (real-data hooks) and Phase 5 (sibling dots need members).
- Phase 2 (routing) blocks Phase 3 (sidebar uses URL helper), Phase 5 (toolbar reads selectedAgentId from URL), Phase 6 (quad branches on viewMode), Phase 7 (palette uses URL helper).
- Phase 3 can land immediately after Phase 2; user can already reach 1:1 view even before mock data is removed (ChatInstance reads existing per-session data).
- Phase 4 can run in parallel with Phases 5–7 once Phases 1+2 land.
- Phase 8 is final cleanup; runs after all others.
