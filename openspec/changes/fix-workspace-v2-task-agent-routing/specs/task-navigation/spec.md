# Spec Delta: Task Navigation Sidebar

## MODIFIED Requirements

### Requirement: Task-centric session grouping

The sidebar MUST organize agent sessions into task groups. Each task is an expandable container whose member agents are rendered from `chat.members[]`. Each agent row paints its own status dot, last-activity timestamp, and selection state independently of the parent task row.

#### Scenario: TaskRow click opens the task overview

**Given** the user clicks the task name (not the chevron, not an agent row)
**When** the sidebar handles the click
**Then** the router navigates to `/v2/workspace/{wsId}/task/{taskId}` (no `?agent=` param)
**And** the workspace renders the task overview (group chat + task info sidebar)

#### Scenario: AgentRow click opens that agent's 1:1 view

**Given** the user clicks an agent row nested inside a task
**When** the sidebar handles the click
**Then** the router navigates to `/v2/workspace/{wsId}/task/{taskId}?agent={agentId}`
**And** the workspace renders the agent 1:1 ChatPane backed by that agent's session

#### Scenario: AgentRow renders per-member state, not the rolled-up parent

**Given** a task with three members whose statuses are `['running', 'error', 'idle']`
**When** the sidebar expands the task
**Then** each agent row paints its own status dot from `chat.members[m].status`
**And** each agent row shows its own `lastMessageAt` duration from `chat.members[m].lastMessageAt`
**And** the parent task row continues to show the worst-of rollup (red, because one member is in error)

#### Scenario: AgentRow shows selected styling when active

**Given** the URL contains `?agent=worker-1`
**When** the sidebar renders the task containing `worker-1`
**Then** the row for `worker-1` shows the active-row styling (accent-brand-light text + font-medium)
**And** sibling agent rows in the same task render in the default style

### Requirement: Add Agent entry point

Each expanded task MUST show an "+ Add Agent" row at the bottom of its agent list. The picker opens with the task ID pre-set.

#### Scenario: User clicks Add Agent

**Given** a task is expanded showing its agents
**When** the user clicks the "+ Add Agent" row
**Then** the AddAgentPicker overlay opens with the task ID pre-set

## Related Capabilities

- [chat-members](../chat-members/spec.md) — Source of per-member status used by AgentRow
- [workspace-area](../workspace-area/spec.md) — URL drives viewMode, sidebar emits the URL transitions
- [agent-orchestration](../agent-orchestration/spec.md) — Add Agent picker contract is unchanged
