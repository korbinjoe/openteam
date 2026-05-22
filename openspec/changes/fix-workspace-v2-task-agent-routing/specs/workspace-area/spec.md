# Spec Delta: Workspace Area

## MODIFIED Requirements

### Requirement: Dual view modes

The workspace MUST derive `viewMode` from the URL: presence of the `?agent=` query parameter selects `agent` mode, absence selects `task-overview`. `viewMode` is NOT stored in the reducer; it is a derived value of `selectedAgentId`. All navigation that toggles view mode MUST be expressed as a `navigate(buildTaskUrl(wsId, taskId, agentId?))` call.

#### Scenario: URL is the single source of truth

**Given** the user is on `/v2/workspace/W/task/T?agent=A`
**When** `WorkspaceProvider` evaluates view state
**Then** `selectedAgentId === 'A'`
**And** `viewMode === 'agent'`

**Given** the user navigates to `/v2/workspace/W/task/T`
**When** `WorkspaceProvider` evaluates view state
**Then** `selectedAgentId === null`
**And** `viewMode === 'task-overview'`

#### Scenario: Page refresh restores the agent view

**Given** the user is viewing agent `A` of task `T` in workspace `W`
**When** the user presses F5
**Then** the URL `/v2/workspace/W/task/T?agent=A` is restored
**And** the workspace mounts directly in `viewMode='agent'` with `selectedAgentId='A'`
**And** the agent 1:1 ChatPane is shown (not the task overview)

#### Scenario: Closing agent view returns to overview without reload

**Given** the user is viewing `?agent=A` for task `T`
**When** the user clicks the task name in the toolbar breadcrumb
**Then** the URL becomes `/v2/workspace/W/task/T` (the `agent` param is dropped)
**And** the workspace switches to `viewMode='task-overview'`
**And** the underlying ChatPane is NOT unmounted (preserving its xterm instance)

### Requirement: Workspace toolbar

A 38px toolbar MUST appear at the top of the workspace area. In agent mode, the toolbar SHOWS a breadcrumb of `{member.name} in {chat.title}` where the task title is a clickable link that drops the `agent` query parameter, followed by a sibling agent dots cluster.

#### Scenario: Toolbar breadcrumb in agent mode

**Given** `viewMode='agent'` with selected member "Reviewer" in task "Auth refactor"
**When** the toolbar renders
**Then** the breadcrumb reads `[pulsing status dot] "Reviewer" "in" [clickable "Auth refactor"]`
**And** clicking the task title navigates to `/v2/workspace/{wsId}/task/{taskId}` (no agent param)

#### Scenario: Sibling agent dots are clickable nav controls

**Given** the selected agent has 2 sibling agents in the same task
**When** the toolbar renders
**Then** a cluster shows up to 4 visible dots (with `+N` overflow when applicable)
**And** each dot is a button with `aria-label="Switch to {agent name}"`
**And** each dot's color matches `chatStatusDot(member.status)`
**And** clicking a dot navigates to `/v2/workspace/{wsId}/task/{taskId}?agent={siblingId}`

#### Scenario: Toolbar tracks selectedAgentId, not chat.primaryAgentId

**Given** the user has switched to a worker agent via sidebar click
**When** the toolbar renders
**Then** the displayed agent name and status reflect the worker (from `members[]`), not the lead
**And** switching to a different sibling updates the toolbar within the same render cycle

### Requirement: Three layout modes

The workspace MUST support three layout configurations. Quad mode behavior branches on `viewMode`:

- `viewMode='agent'` + Quad → tiles up to 4 cross-task chats (the "war-room dashboard" view).
- `viewMode='task-overview'` + Quad → tiles up to 4 members of the current task (the "focus mode" view).

#### Scenario: Quad in agent mode tiles cross-task chats

**Given** `layoutMode='quad'` and `viewMode='agent'`
**When** the workspace renders
**Then** the 2×2 grid is filled by `useQuadChats(4)` cross-task results
**And** clicking a tile navigates to that chat (changing both task and agent)

#### Scenario: Quad in task-overview mode tiles current task's members

**Given** `layoutMode='quad'`, `viewMode='task-overview'`, and the current task has members `[lead, w1, w2]`
**When** the workspace renders
**Then** the 2×2 grid shows three `MiniAgentPane` cells, one per member
**And** the fourth cell renders an `AddAgentSlot` placeholder that opens `AddAgentPicker` for the current task
**And** clicking a member tile navigates to `/v2/workspace/{wsId}/task/{taskId}?agent={memberId}`

#### Scenario: Member-mode MiniAgentPane uses per-member data

**Given** a `MiniAgentPane` is rendered for member `worker-1` of task `T`
**When** the pane renders
**Then** its header shows the member's name, role badge, and status from `chat.members[m]`
**And** its preview shows `member.lastMessage`

## REMOVED Requirements

### Requirement: Stored viewMode in reducer state

**Reason:** `viewMode` and `selectedAgentId` previously lived in reducer state as independent fields, which produced bugs where the two went out of sync (e.g., `OPEN_TASK_OVERVIEW` set `viewMode` but never cleared `selectedAgentId`). `viewMode` is now derived from `selectedAgentId`, which is derived from the URL — making it impossible to represent inconsistent state.

**Migration:** Persisted `viewMode`, `selectedAgentId`, and `selectedTaskId` keys are dropped from the localStorage shape; the restore step silently discards old values via try/catch.

## Related Capabilities

- [chat-members](../chat-members/spec.md) — Sibling dots and member-quad consume `members[]`
- [task-navigation](../task-navigation/spec.md) — Sidebar emits the URL transitions that drive `viewMode`
- [agent-orchestration](../agent-orchestration/spec.md) — Task overview / group chat live inside the workspace area
