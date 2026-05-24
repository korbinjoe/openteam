# Spec Delta: ia-naming

## ADDED Requirements

### Requirement: User-facing concept of agent work is named "mission"

All URLs, UI labels, dialog titles, button copy, tooltip text, route params, page-component file names, and net-new TypeScript identifiers that refer to the user-facing concept of "a unit of agent work" SHALL use the word "mission" (or "Mission" / "missions" / "Missions" depending on grammar position).

#### Scenario: A user opens mission history

- **WHEN** the user clicks the History entry in the sidebar from any context
- **THEN** the URL is `/missions`
- **AND** the sidebar tooltip reads "Mission History"
- **AND** the page heading reads "Missions"

#### Scenario: A user opens a specific mission inside a workspace

- **WHEN** the user opens a mission from any entry point
- **THEN** the URL is `/workspace/:workspaceId/mission/:missionId`
- **AND** the route param destructures as `missionId`, not `taskId`

#### Scenario: A new component or file references the user-facing concept

- **WHEN** a contributor introduces a new component, file, URL segment, prop name, or rendered UI label that refers to a unit of agent work
- **THEN** the name uses "mission" / "Mission"
- **AND** the existing storage-layer code (`chatStore`, `Chat` type, `useWorkspaceChats`, `/api/chats/*`) is referenced from the new code without being renamed

### Requirement: Storage layer continues to use "chat"

Storage-layer identifiers SHALL remain unrenamed by this change. The database table `chats`, the `chat_id` columns, the TypeScript types `Chat` and `ChatRecord`, the hooks `useWorkspaceChats` / `useChatTabs` / `useChatActions`, the modules `chatStore` / `chatService`, the HTTP endpoints `/api/chats/*`, and the JSONL session keys (`expert_sessions`) SHALL all continue to use "chat".

#### Scenario: A new feature reads mission data

- **WHEN** a contributor implements a new feature that displays missions in the UI
- **THEN** the feature fetches via `/api/chats/*` HTTP endpoints
- **AND** uses the existing `Chat` / `ChatRecord` TypeScript types
- **AND** maps the storage-layer field names to mission-named props at the component boundary

### Requirement: Claude SDK tool names are excluded from the rename

The Claude Code SDK tool labels `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop` declared in `web/config/identityToolOptions.ts` SHALL NOT be renamed by this change. These identifiers refer to externally-defined Claude tool names, not to the user-facing concept of agent work.

#### Scenario: An agent identity is configured

- **WHEN** the user configures which Claude SDK tools an agent can call
- **THEN** the tool list rendered in the configuration UI includes the literal tokens `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`
- **AND** these labels are unaffected by the user-facing-concept rename

### Requirement: Backward-compatible URL redirects for renamed routes

When this change renames a URL path, the application SHALL serve a client-side redirect to the new canonical URL so existing bookmarks land on a working page.

#### Scenario: User opens a legacy task URL

- **WHEN** the user opens any of `/tasks`, `/chats`, `/workspace/:id/tasks`, `/workspace/:id/chats`
- **THEN** the application immediately navigates to `/missions`

#### Scenario: User opens a legacy per-task URL

- **WHEN** the user opens `/workspace/:wsId/task/:tid`
- **THEN** the application immediately navigates to `/workspace/:wsId/mission/:tid` (the id is preserved)
