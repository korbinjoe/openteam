# Proposal: Fix Workspace V2 Task↔Agent Routing & Dual-View Interaction

## Summary

The workspace-v2 UI shipped the visual shell from `upgrade-workspace-ui-v2`,
but the **Task↔Agent dual-view interaction** — the core mental model in
`docs/design/workspace-interactive.html` — is broken end-to-end:

1. Clicking an **agent row** in the sidebar navigates to the same URL as
   clicking the **task name**, so `selectAgent` is never invoked and
   `viewMode` is permanently stuck. The 1:1 agent view is unreachable from
   the sidebar.
2. `TaskOverview` and `GroupChat` render hardcoded **mock data**
   (`MOCK_TASK`, `MOCK_MESSAGES` referencing `agent-1/2/3`). Opening any
   real task shows the same fake auth-flow demo content.
3. The `Chat` data shape exposes only one rolled-up `status` /
   `lastMessageAt`, so every nested agent row in the sidebar shares one
   color. The design's "0.5s glance to locate who needs me" affordance
   collapses.
4. The toolbar in agent mode hardcodes `chat.primaryAgentId`; it never
   tracks `selectedAgentId`, has no clickable breadcrumb back to the task
   overview, and shows no sibling-agent dots.
5. Quad mode tiles **4 different tasks** instead of the **4 members of one
   task**, inverting the design intent of "focus on one task, see whole
   team at once."
6. Command Palette only navigates at task granularity — agent-level jumps
   are missing.

These are not cosmetic gaps — they sever the pulse-mode loop the product
is built around: *return → glance → drill into agent → cross to sibling →
zoom back to task chat → @target reply*.

## Motivation

OpenTeam's product thesis is **the pulse-mode operator**: dispatch many
agents, leave, come back, batch-review. The dual-view (task overview =
coordination, agent 1:1 = drill-down) is the primary affordance for that
loop. With it broken:

- Users cannot reach the group chat that lets them see what their team
  produced while they were away.
- Users cannot tell at a glance which of three agents in a task is the
  one that errored or is waiting on them.
- Users cannot @target a specific agent in the group chat — the input
  cycles through mock IDs unrelated to the actual task members.

The visual layer landed; the interaction wiring did not. This change
finishes the wiring.

## Goals

- **G1** Sidebar splits intent: TaskRow click → task overview, AgentRow
  click → that agent's 1:1 view.
- **G2** URL is the single source of truth for view mode: presence of an
  `agent` selector in the URL determines `viewMode` and `selectedAgentId`;
  page refresh preserves position.
- **G3** `TaskOverview`, `GroupChat`, `TaskInfoSidebar`, `GroupChatInput`
  consume real task/member/whiteboard/message data — no mock constants.
- **G4** `Chat.members[]` exposes per-agent `status`, `role`,
  `lastMessageAt`, `lastMessage` so the sidebar paints each agent row
  independently.
- **G5** Toolbar in agent mode shows: `{agent} in {clickable task name}`
  + sibling agent dots (click to switch agent within the same task).
- **G6** Quad mode in task-overview viewMode tiles that task's members
  (capped at 4 + overflow); agent-mode quad keeps current cross-task
  behavior.
- **G7** Command Palette surfaces agents nested under tasks and routes
  selection to the correct view.

## Non-Goals

- Real-time multi-agent message stream merging at the server level — the
  group chat in this change reads merged client-side from existing
  per-agent JSONL streams.
- War Room re-architecture — keep current per-chat war room; only ensure
  TaskOverview can show it.
- Adding new agent dispatch flows (Add Agent picker already works).
- Rewriting `ChatInstance` — keep V1 chat as the agent 1:1 substrate.

## Approach

**Three layers, one missing dimension in each.**

### Layer 1 — Data: `Chat.members[]`

Server-side, derive a `members: ChatMember[]` field on every `Chat`
emitted to the client. Source of truth = `expertSessions` (already has
per-agent `cliSessionId`) + the corresponding JSONL tail metadata (last
event timestamp, last message status, last tool error). The
`SessionFileWatcher` already parses JSONL per cliSessionId — extend its
aggregation to emit per-member status events.

```ts
interface ChatMember {
  agentId: string
  role: 'lead' | 'worker'
  status: 'running' | 'waiting' | 'error' | 'idle' | 'done'
  lastMessageAt: string
  lastMessage?: string         // short preview
  cliSessionId?: string
}
```

Rolled-up `chat.status` / `chat.taskStatus` keep existing semantics
(worst-of-members) — no breaking change for current consumers.

### Layer 2 — Routing: URL carries the agent dimension

URL pattern:
- `/v2/workspace/:workspaceId` → no task selected
- `/v2/workspace/:workspaceId/task/:taskId` → task overview (viewMode='task-overview')
- `/v2/workspace/:workspaceId/task/:taskId?agent=:agentId` → agent 1:1 (viewMode='agent')

Query-string over nested route segment to (a) preserve existing
`/task/:taskId` URLs, (b) avoid registering a new Route, (c) make
"close agent view, return to task" a single param removal.

`WorkspaceProvider` reads `searchParams.get('agent')` alongside route
params and dispatches `SET_ROUTE` with the additional `selectedAgentId`.
`viewMode` becomes derived state: `selectedAgentId ? 'agent' : 'task-overview'`.

### Layer 3 — Views: drop mocks, wire to real data

- `TaskSessionList.TaskRow` click → `navigate('/v2/workspace/{wsId}/task/{tid}')` (no agent param)
- `TaskSessionList.AgentRow` click → `navigate('/v2/workspace/{wsId}/task/{tid}?agent={aid}')`
- `TaskOverview`/`TaskInfoSidebar`/`GroupChat`/`GroupChatInput` accept the
  resolved `Chat` + `members[]` as props (or read from `useV2Task(taskId)`
  hook). All `MOCK_*` constants deleted.
- `GroupChat` merges JSONL events from each member's `cliSessionId` into a
  single timeline sorted by timestamp (client-side; SessionFileWatcher
  already feeds them).
- `WorkspaceToolbar.ActiveChatInfoBar` shows
  `{selectedAgent.name} in {chat.title}` where `chat.title` is a clickable
  link that removes the `agent` query param. Sibling dots render from
  `members.filter(m => m.agentId !== selectedAgentId)`.
- `WorkspaceContent.QuadLayout` branches on `viewMode`: in
  `task-overview` mode use `chat.members.slice(0,4)`, in `agent` mode
  keep the current cross-task quad.
- `CommandPalette` builds results from `chats × chat.members`: tasks are
  parents, agents are leaf items routing to `?agent=…`.

## Risks

- **R1: SessionFileWatcher aggregation cost.** Adding per-member status
  derivation runs on every JSONL append. Mitigation: derive lazily on
  read in `ChatStore.getChat()` for now; cache result keyed by
  `(cliSessionId, lastModified)`. Defer pushing per-member status over
  WebSocket until measured need.
- **R2: URL query-param state-vs-state races.** Existing reducer mutates
  `selectedAgentId` directly via `SELECT_AGENT`. After this change the URL
  is the authority, so `selectAgent` must `navigate(…)` instead of
  dispatching. Mitigation: remove the `SELECT_AGENT` action in favor of a
  reducer-side derivation from `SET_ROUTE`. Document the inversion in
  `design.md`.
- **R3: Backward compat with existing pinned/expanded localStorage.** The
  storage keys (`openteam:v2-task-expanded`, etc.) remain untouched — no
  migration needed.
- **R4: TaskOverview without `selectedTaskId`.** Currently
  `selectedTaskId` is set by `OPEN_TASK_OVERVIEW`; after the inversion
  it's derived from URL `:taskId`. Cleanup: drop `selectedTaskId` from
  state, read directly from `activeChatId` (which already mirrors
  `:taskId`).
- **R5: Mock removal breaks tests.** None of the V2 components are
  covered by tests yet; no test risk. Smoke-test manually in the four
  scenarios from project rules (initial load, refresh, resize, history
  restore).
