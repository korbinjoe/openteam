# Design: Workspace V2 Task↔Agent Routing & Member Model

## Architectural Snapshot

```
URL (SoT for navigation)
  /v2/workspace/:wsId/task/:taskId?agent=:agentId
            │            │              │
            ▼            ▼              ▼
   workspaceId    activeChatId   selectedAgentId
            │            │              │
            └────────────┴──────────────┘
                         ▼
               WorkspaceProvider
                  (derives viewMode)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   TaskSidebar    WorkspaceToolbar   WorkspaceContent
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                       Single        Split         Quad
                    (ChatPane /   (Chat | IDE)   (members)
                     GroupChat)
                          │
                          ▼
                   useV2Task(taskId)
                   returns: { chat, members[], goal, timeline }
                          │
                          ▼
                     Server: ChatStore
                   Chat.members[] derived
                   from expertSessions + JSONL tails
```

## Decisions

### D1 — URL query-param for agent dimension (over nested route)

**Choice**: `?agent=:agentId` query param instead of
`/task/:taskId/agent/:agentId`.

**Why**:
- Preserves all existing `/v2/workspace/:wsId/task/:taskId` URLs (no
  redirect needed; pinned items, history, command palette routes survive).
- "Close agent view → back to task overview" = remove one URL param.
  With nested routes we'd have to either pop the segment manually or
  introduce a second `<Route>` that re-mounts the layout.
- React Router v6's `useSearchParams` gives us a stable hook; no new
  `<Route>` registration in `App.tsx`.

**How to apply**: `WorkspaceLayout` reads
`useSearchParams().get('agent')`, threads it into `WorkspaceProvider` as
`selectedAgentId`. All navigation calls use a helper
`buildTaskUrl(wsId, taskId, agentId?)`.

### D2 — `viewMode` becomes derived state, not stored

**Choice**: Drop `viewMode` from reducer state. Compute
`viewMode = selectedAgentId ? 'agent' : 'task-overview'` inside the
provider.

**Why**:
- Eliminates the entire class of bugs where `viewMode` and
  `selectedAgentId` get out of sync (the current `OPEN_TASK_OVERVIEW`
  action sets viewMode but not selectedAgentId, leading to inconsistent
  state).
- Single source: URL → selectedAgentId → viewMode. No reducer action can
  invent a `viewMode` that contradicts the URL.

**How to apply**: Remove `SET_ROUTE` setting viewMode; remove
`OPEN_TASK_OVERVIEW`/`SELECT_AGENT` actions; expose `selectAgent` and
`openTaskOverview` as navigation helpers that call `navigate(...)`.

### D3 — Server-derived `Chat.members[]`, not client-side join

**Choice**: Compute members on the server in `ChatStore.getChat()` /
`getChatsByWorkspace()`, return as part of `Chat`.

**Why**:
- The JSONL tail parse needed for status/lastMessageAt belongs server-
  side anyway (the SessionFileWatcher is already there). Doing it
  client-side would require shipping per-agent JSONL chunks just to
  derive a status dot — wasteful.
- Keeps `Chat` shape self-contained: V1 ChatInstance, sidebar, command
  palette all read the same field. No second hook needed.

**How to apply**: Extend `ChatStore` row→Chat mapping; introduce
`MemberAggregator` service that maintains an LRU cache keyed by
`(cliSessionId, lastModifiedTime)`. Push member-status updates over the
existing chat-update WS event when SessionFileWatcher detects a JSONL
change.

### D4 — `GroupChat` reads merged messages client-side

**Choice**: `GroupChat` calls `useV2GroupTimeline(taskId)` which
subscribes to each member's `cliSessionId` JSONL stream (via existing
WS event topic) and merges client-side by timestamp.

**Why**:
- Server-side merge would require a new WS topic and duplicate the data
  already flowing per-agent. Client merge is O(n) and only runs when the
  user has a task overview open.
- Falls out naturally from existing per-session subscriptions.

**How to apply**: Reuse `SessionFileWatcher` subscription logic.
Aggregation belongs in a hook, not a component. `GroupChat` becomes a
pure renderer of `{ messages, members }`.

### D5 — Quad mode behavior depends on viewMode

**Choice**:
- `viewMode='agent'` + Quad → tile up to 4 cross-task chats (current
  behavior, preserved for the "watch many at once" use case).
- `viewMode='task-overview'` + Quad → tile up to 4 **members of the
  current task**.

**Why**:
- Both behaviors are useful in different contexts. Cross-task quad is
  the "war-room dashboard" view; task-member quad is the "focus mode"
  view from the design.
- Branching on existing state avoids a third layout mode.

**How to apply**: `WorkspaceContent.QuadLayout` reads `viewMode` and
swaps the source for `MiniAgentPane`. Member-quad clicks drill into
`?agent=…`, cross-task quad clicks navigate to a different task.

### D6 — Toolbar sibling dots are per-member nav controls

**Choice**: In agent mode, toolbar renders a cluster of small dots, one
per **non-selected** member; click switches `?agent=…` to that member.

**Why**:
- The design's "+2" cluster reads as "two siblings, glance at their
  status, click to switch." Implementing it as direct nav matches that
  affordance — no menu, no popover.
- Reuses `Chat.members[]` from D3.

**How to apply**: `ActiveChatInfoBar` consumes
`useV2Task(activeChatId)` and renders dots with `onClick={() =>
navigate(buildTaskUrl(wsId, taskId, m.agentId))}`.

### D7 — Drop `MOCK_TASK` / `MOCK_MESSAGES`

**Choice**: Delete all mock constants in `TaskInfoSidebar.tsx`,
`GroupChat.tsx`, `GroupChatInput.tsx`. Components become parameterless
or accept a `taskId` and resolve through `useV2Task`.

**Why**:
- Mocks have already shipped to users. They are not a placeholder; they
  are user-facing wrong data.
- Keeping mocks as fallback hides real-data bugs.

**How to apply**: Components throw `EmptyState` if `taskId` resolves to
nothing, never fall back to mock data.

## Data Contracts

### `Chat.members` (new server-emitted field)

```ts
interface ChatMember {
  agentId: string
  role: 'lead' | 'worker'
  status: 'running' | 'waiting' | 'error' | 'idle' | 'done'
  lastMessageAt: string          // ISO; falls back to chat.lastMessageAt
  lastMessage?: string           // truncated preview, <=120 chars
  cliSessionId?: string          // present once the agent has started
}
```

Backward compat: existing `chat.status` / `chat.taskStatus` remain
populated as `worst-of(members.status)`. Existing consumers that read
those fields are unaffected.

### URL helper

```ts
function buildTaskUrl(wsId: string, taskId: string, agentId?: string): string {
  const base = `/v2/workspace/${wsId}/task/${taskId}`
  return agentId ? `${base}?agent=${encodeURIComponent(agentId)}` : base
}
```

Used by: TaskSessionList rows, Toolbar breadcrumb/sibling dots,
CommandPalette results, MiniAgentPane click handler.

## Migration

1. Land `Chat.members[]` server-side first (additive, no breaking
   change). All existing consumers continue to work.
2. Land URL routing change + provider derivation. Sidebar starts using
   `selectAgent` → navigate. From this point the dual-view is reachable.
3. Replace TaskOverview/GroupChat mocks with real data hook. From this
   point the dual-view is correct.
4. Toolbar breadcrumb + sibling dots.
5. Quad mode branching.
6. Command Palette agent rows.

Each step is independently shippable and each restores one observable
piece of the design.

## Validation

For each step, verify the four xterm/PTY-adjacent scenarios from project
rule §4:
- Initial load (fresh URL)
- Page refresh (URL state restored)
- Window resize (layout reflows without remounting ChatInstance)
- History restore (back/forward across task↔agent transitions)

ChatInstance is mounted by `ChatPane`; navigation between task overview
and agent view must NOT remount it (it owns the xterm). Confirmed by
keeping `ChatPane` in the React tree across viewMode transitions and
only toggling its visibility via parent layout.
