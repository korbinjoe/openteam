# Spec Delta: ia-navigation

## ADDED Requirements

### Requirement: Canonical URL per resource page

Every resource page in the application SHALL be reachable at exactly one canonical URL. The route table SHALL NOT mount the same page component at two distinct URLs that render identical content.

#### Scenario: A user navigates to a resource

- **WHEN** the user clicks the Settings entry in the sidebar from any context
- **THEN** the URL becomes `/settings`
- **AND** there is no other URL in the application that mounts `SettingsPage`

#### Scenario: A user navigates to task history

- **WHEN** the user clicks the History entry in the sidebar from any context
- **THEN** the URL becomes `/tasks`
- **AND** there is no other URL in the application that mounts `ChatHistoryPage`

### Requirement: Resource pages mount at top-level URLs only

All resource pages (`agents`, `agents/:id/edit`, `skills`, `cron-jobs`, `tasks`, `workspaces`, `settings`, `admin`, `updates`) SHALL be mounted at top-level URLs. The `/workspace/:workspaceId/...` URL prefix SHALL be reserved for routes whose rendering changes based on the workspace (the workspace shell and `task/:taskId` sub-route).

#### Scenario: Resource pages display cross-workspace data

- **GIVEN** the resource pages `agents`, `skills`, `cron-jobs`, `tasks`, `workspaces`
- **WHEN** the user navigates to any of these pages
- **THEN** the page fetches data from cross-workspace endpoints (e.g., `/api/chats/recent`, `/api/cron-jobs`, `/api/agents`) and is identical regardless of which workspace is active in the sidebar
- **AND** the canonical URL has no `/workspace/:workspaceId/` prefix

### Requirement: Backward-compatible URL redirects

When this change deletes a URL path that was previously valid, the application SHALL serve a client-side redirect to the new canonical URL so that existing bookmarks continue to land on a working page.

#### Scenario: User opens a legacy workspace-scoped resource URL

- **WHEN** the user opens a bookmark `https://app/workspace/abc/settings` (or `/agents`, `/skills`, `/cron-jobs`, `/chats`, `/admin`, `/updates`, `/workspaces`)
- **THEN** the application immediately navigates to the canonical top-level URL
- **AND** the user sees the resource page without an error state

#### Scenario: User opens a legacy top-level chat URL

- **WHEN** the user opens a bookmark `https://app/chats`
- **THEN** the application navigates to `/tasks` via a client-side redirect

### Requirement: Page components do not receive route-prefix props

Resource page components (`AgentsHubPage`, `AgentEditorPage`, `CronJobsPage`, `WorkspacesPage`, `ChatHistoryPage`, `NewChatForm`, `NewChatFullDialog`) SHALL NOT accept `routePrefix`, `workspaceRoutePrefix`, `agentsRoutePrefix`, `chatSegment`, or `homePath` props. Internal navigation targets SHALL be derived from module-level constants instead of injected route fragments. The wrapper layer `web/pages/ResourcePages.tsx` SHALL NOT exist.

#### Scenario: A resource page builds an internal link

- **GIVEN** a resource page such as `ChatHistoryPage` rendered at `/tasks`
- **WHEN** the page needs to navigate to a task within a workspace
- **THEN** it composes the URL from module-level constants (`WORKSPACE_BASE`, `TASK_SEGMENT`) rather than from a prop
- **AND** the page renders identically regardless of how it was reached

### Requirement: Naming contract separates user-facing terms from storage primitives

All URLs, UI labels, dialog titles, and net-new component or file names that refer to a conversation with an agent SHALL use the word `task`, and storage-layer identifiers (database column `chat_id`, the `Chat` TypeScript type, hooks named `useWorkspaceChats`, the `chatStore` module, the `/api/chats/...` HTTP endpoints) SHALL remain unrenamed by this change.

#### Scenario: A user opens the task history

- **WHEN** the user clicks the sidebar entry for task history
- **THEN** the URL is `/tasks`
- **AND** the sidebar tooltip reads "Task History"
- **AND** the page heading reads "Tasks"

#### Scenario: A new feature adds a public-facing reference to a conversation

- **WHEN** a contributor introduces a new component, file, URL segment, or UI label referring to a conversation with an agent
- **THEN** the name uses "task", not "chat"
- **AND** the existing storage-layer code (`chatStore`, `Chat` type, `useWorkspaceChats`, `/api/chats/...`) is referenced from the new code without being renamed

### Requirement: Demo routes are not present in production builds

Development-only demo routes SHALL be conditionally registered only when `import.meta.env.DEV` is true. Production builds SHALL NOT include the corresponding lazy-loaded chunks in the route table.

#### Scenario: User navigates to a demo URL in production

- **GIVEN** a production build (`import.meta.env.PROD === true`)
- **WHEN** the user navigates to `/demo/mention` or `/demo/queue`
- **THEN** the URL falls through the route table
- **AND** the application does not load the demo chunk
