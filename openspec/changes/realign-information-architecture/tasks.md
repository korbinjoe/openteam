# Tasks: Realign Information Architecture

Sequenced into three independent phases plus validation. Each phase is independently
revertible and shippable as its own PR.

## Phase 1 — Collapse duplicate route registration; all resources mount top-level

- [x] 1.1 In `web/App.tsx`, delete every workspace-scoped duplicate of a resource
      page from the `<Route path="/workspace/:workspaceId" element={<ResourceLayout />}>`
      sub-tree (`/workspace/:id/settings`, `/admin`, `/updates`, `/skills`, `/agents`,
      `/agents/:id/edit`, `/workspaces`, `/cron-jobs`, `/chats`).
- [x] 1.2 Keep one canonical top-level mount per resource page under a single
      `<ResourceLayout>` block (`/settings`, `/admin`, `/updates`, `/skills`,
      `/agents`, `/agents/:id/edit`, `/workspaces`, `/cron-jobs`, `/chats`).
- [x] 1.3 Add backward-compatible client-side `<Navigate replace>` redirects from
      every deleted workspace-scoped path to its top-level canonical URL.
- [x] 1.4 Preserve the agent id in `/workspace/:wsId/agents/:id/edit` redirect via
      a tiny `LegacyAgentEditorRedirect` component that reads `useParams<{id}>()`.
- [x] 1.5 Update `web/components/workspace/SidebarFooter.tsx` so every resource
      button emits an absolute path (no `useResourcePrefix` hook).
- [x] 1.6 Delete the `useResourcePrefix` hook from `SidebarFooter.tsx` entirely
      (with every resource at top-level there is no prefix to compute).
- [x] 1.7 Gate demo routes behind `import.meta.env.DEV`:
      `{import.meta.env.DEV && (<><Route path="/demo/mention" ... /><Route path="/demo/queue" ... /></>)}`.

## Phase 2 — Collapse the `ResourcePages` wrapper layer

- [x] 2.1 Remove `agentsRoutePrefix` prop from `web/pages/AgentsHubPage.tsx`; add
      module-level constant `const AGENTS_BASE = '/agents'`; replace usages.
- [x] 2.2 Remove `agentsRoutePrefix` prop from `web/pages/AgentEditorPage.tsx`;
      same module-constant treatment.
- [x] 2.3 Remove `workspaceRoutePrefix` / `chatSegment` props from
      `web/pages/CronJobsPage.tsx`; add `WORKSPACE_BASE` / `TASK_SEGMENT` constants;
      simplify target URL builder.
- [x] 2.4 Remove `workspaceRoutePrefix` prop from `web/pages/WorkspacesPage.tsx`;
      add `WORKSPACE_BASE` constant.
- [x] 2.5 Remove `workspaceRoutePrefix` / `homePath` / `chatSegment` props from
      `web/pages/ChatHistoryPage.tsx`; add `WORKSPACE_BASE` / `TASK_SEGMENT` /
      `HOME_PATH` constants; drop the now-dead "isV2" branch.
- [x] 2.6 Remove `routePrefix` / `chatSegment` props from
      `web/components/chat/modals/NewChatFullDialog.tsx` and stop forwarding them
      to `NewChatForm`.
- [x] 2.7 Remove `routePrefix` / `chatSegment` props from
      `web/components/chat/modals/NewChatForm.tsx`; add `WORKSPACE_BASE` /
      `TASK_SEGMENT` constants; clean dependency array.
- [x] 2.8 Strip the now-unused `routePrefix="/workspace"` / `chatSegment="task"`
      props from `<NewChatFullDialog>` in `web/layouts/ResourceLayout.tsx` and
      `web/layouts/WorkspaceLayout.tsx`.
- [x] 2.9 Update `web/App.tsx` imports: import the page components directly.
- [x] 2.10 Delete `web/pages/ResourcePages.tsx`.

## Phase 3 — Normalize on `task` (URLs and labels), preserve `chat` in storage

- [x] 3.1 In `web/App.tsx`, mount `/tasks` as the canonical top-level route for
      `ChatHistoryPage`; rewrite the existing `/chats` route as
      `<Navigate to="/tasks" replace />`.
- [x] 3.2 In `web/App.tsx`, point the legacy `/workspace/:workspaceId/chats`
      redirect to `/tasks` (not `/chats`); add a `/workspace/:workspaceId/tasks`
      redirect for symmetry.
- [x] 3.3 Update `web/components/workspace/SidebarFooter.tsx` History icon
      navigation target from `/chats` to `/tasks`.
- [x] 3.4 Update the History icon `title` attribute from "History" to
      "Task History".
- [x] 3.5 Update `web/components/nav/AppSidebar.tsx` History nav item:
      `path: '/chats'` → `'/tasks'`, `labelKey: 'common:nav.chatHistory'` →
      `'common:nav.taskHistory'`, `match: (p) => p === '/chats'` →
      `(p) => p === '/tasks'`.
- [x] 3.6 Update `web/locales/en/common.json`: add `nav.taskHistory: "Task History"`
      and update the existing `nav.chatHistory` value to "Task History" so any
      stale caller renders the new copy.
- [x] 3.7 Update `web/locales/en/chat.json`: rename the rendered value of
      `history.title` from "Chat History" to "Tasks".
- [x] 3.8 Create `openspec/project.md` with a "Naming Contract" section recording
      ADR-2: user-facing terms always use "task"; storage / type / hook / API
      names keep "chat"; new code never introduces "chat" in URLs or UI labels.

## Phase 4 — Validation

- [x] 4.1 Run `openspec validate realign-information-architecture --strict`.
- [x] 4.2 Grep `web/` for stray `/chats` references in routing/navigation code;
      confirm only the redirect rules in `App.tsx` and storage-layer
      `/api/chats/...` calls remain.
- [x] 4.3 Write a one-paragraph note to the war-room (`decision` type) recording
      the two-name discipline and link to ADR-2.
