# Spec Delta: Agent Orchestration UX

## MODIFIED Requirements

### Requirement: Task Overview with Group Chat

When viewing a task (not a single agent), the workspace MUST show a merged timeline of all agent activities sourced from real per-member JSONL streams. No mock data MAY be rendered.

#### Scenario: Group chat reads real merged timeline

**Given** task `T` has members with `cliSessionId`s `[abc, def]`
**When** the user opens task overview
**Then** `useV2GroupTimeline(T)` subscribes to each member's JSONL stream
**And** events from both streams are merged into a single timeline sorted by timestamp
**And** events are classified into `GroupMessage` types (system, handoff, start, text, tool-call, done, error, waiting, progress)

#### Scenario: Empty state when task has no members

**Given** the user navigates to a task with no active members yet
**When** `GroupChat` renders
**Then** an empty state placeholder is shown
**And** no `MOCK_MESSAGES` content appears

### Requirement: Group Chat input with @agent targeting

The group chat input MUST receive `members: ChatMember[]` as a prop and target real agents from that list. No mock agent IDs MAY be referenced.

#### Scenario: Target cycles through real members

**Given** task members `[Fullstack (lead), Reviewer, Shield]`
**When** the user clicks the `@target` button
**Then** the target cycles through the real members in order
**And** sending the message posts to the targeted member's chat session

### Requirement: Task Info Sidebar in overview mode

When in task overview (single layout), a 200px info panel MUST appear on the left. The panel reads from real chat data via `useV2Task(taskId)`; no mock task constant MAY be present.

#### Scenario: Sidebar derives from real chat

**Given** task overview is active for a real task `T`
**When** the info sidebar renders
**Then** the Goal section shows `chat.title` and the workspace label
**And** the Team section shows real members with the lead highlighted (LEAD badge + purple tint) and workers below with hierarchy indicators
**And** clicking a member name navigates to `?agent={memberId}` for that task
**And** the Timeline section is derived from whiteboard `handoff` + `progress` + `error` entries (via `useWhiteboard`)

#### Scenario: Empty state when task is missing

**Given** the `activeChatId` resolves to a null chat
**When** the `TaskInfoSidebar` renders
**Then** an empty state is shown
**And** no `MOCK_TASK` content appears

### Requirement: Command Palette

A global ⌘K overlay MUST surface results at the agent granularity, nested under their parent task.

#### Scenario: Results flat-map tasks × members

**Given** the user opens the command palette with 2 active tasks, each having 3 members
**When** the palette renders
**Then** the results group shows each task as a non-clickable section header
**And** under each task header, every member appears as a clickable row
**And** clicking a member row navigates to `/v2/workspace/{wsId}/task/{taskId}?agent={memberId}`

#### Scenario: Fuzzy filter matches task or member name

**Given** the palette is open and the user types a query
**When** the result list filters
**Then** matching either `chat.title` or `member.name` surfaces the parent task header alongside any matching member rows
**And** non-matching tasks and members are hidden

#### Scenario: ⌘1-4 prefers attention-needed members of active task

**Given** an active task `T` with one member in `waiting` and others `running`
**When** the user presses `⌘1`
**Then** the quick-jump precedence first surfaces attention-needed members within `T` before falling back to other tasks
**And** the precedence is documented in the keymap comment

## Related Capabilities

- [chat-members](../chat-members/spec.md) — Source of real member data replacing all mocks
- [task-navigation](../task-navigation/spec.md) — Sidebar entry points map onto the same URL pattern used by palette and breadcrumb
- [workspace-area](../workspace-area/spec.md) — Task overview renders inside the workspace area
