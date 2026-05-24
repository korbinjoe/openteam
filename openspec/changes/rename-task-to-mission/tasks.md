# Tasks: Rename user-facing "task" to "mission"

Sequenced into three implementation phases plus validation. The whole rename
ships as a single PR; phases are an ordering hint, not separate PRs.

## Phase A — Routes, contracts, i18n, ADR

- [ ] A.1 In `web/App.tsx`, mount `/missions` (canonical) → `ChatHistoryPage`;
      rewrite `/tasks` and `/chats` as `<Navigate to="/missions" replace />`.
- [ ] A.2 In `web/App.tsx`, replace
      `<Route path="/workspace/:workspaceId/task/:taskId" element={<WorkspaceLayout />} />`
      with the `mission/:missionId` form, plus a
      `<Navigate replace>` redirect from the legacy `task/:taskId` URL that
      preserves the params via a small redirect component.
- [ ] A.3 In `web/App.tsx`, redirect
      `/workspace/:workspaceId/tasks` and `/workspace/:workspaceId/chats` to
      `/missions`.
- [ ] A.4 In `web/components/workspace/urls.ts`, rename `buildTaskUrl` →
      `buildMissionUrl`. Update the URL it builds from `/task/{id}` to
      `/mission/{id}`.
- [ ] A.5 In `web/layouts/WorkspaceLayout.tsx`, change
      `useParams<{ workspaceId?: string; taskId?: string }>()` →
      `{ workspaceId?: string; missionId?: string }`; pass `missionId` into
      `WorkspaceProvider activeChatId={...}`.
- [ ] A.6 Update every caller of `buildTaskUrl` to `buildMissionUrl`.
- [ ] A.7 In `web/locales/en/common.json`, rename `nav.taskHistory` to
      `nav.missionHistory` (value "Mission History"). Update
      `nav.chatHistory` value to "Mission History" so any unmigrated caller
      renders the new copy.
- [ ] A.8 In `web/locales/en/chat.json`, rename rendered values that refer to
      tasks: `history.title` → "Missions"; any "task"/"Task" inside rendered
      strings → "mission"/"Mission".
- [ ] A.9 In `web/locales/en/workspace.json` (and any other en namespace),
      replace user-visible "Task" with "Mission" / "task" with "mission".
      Leave keys alone; only rename rendered values.
- [ ] A.10 Update `web/components/workspace/SidebarFooter.tsx` History tooltip
      from "Task History" to "Mission History".
- [ ] A.11 Update `web/components/nav/AppSidebar.tsx` history nav entry:
      `path: '/tasks'` → `'/missions'`,
      `labelKey: 'common:nav.taskHistory'` → `'common:nav.missionHistory'`,
      `match: (p) => p === '/tasks'` → `(p) => p === '/missions'`.
- [ ] A.12 Update `openspec/project.md` ADR-2 narrative: the user-facing term
      changes from "task" to "mission"; storage stays "chat".

## Phase B — File renames

- [ ] B.1 Rename `web/components/workspace/TaskSidebar.tsx` →
      `MissionSidebar.tsx`. Rename `TaskSidebarProps` → `MissionSidebarProps`,
      default export name → `MissionSidebar`.
- [ ] B.2 Rename `TaskInfoSidebar.tsx` → `MissionInfoSidebar.tsx`. Rename
      props/component identifiers.
- [ ] B.3 Rename `TaskSessionList.tsx` → `MissionSessionList.tsx`. Rename
      `TaskSessionListProps` → `MissionSessionListProps`.
- [ ] B.4 Rename `TaskSessionRows.tsx` → `MissionSessionRows.tsx`. Rename any
      exported helpers.
- [ ] B.5 Rename `TaskGroupItem.tsx` → `MissionGroupItem.tsx`. Rename
      `TaskGroupItemProps` → `MissionGroupItemProps`,
      `TaskGroupItem` → `MissionGroupItem`.
- [ ] B.6 Rename hook `web/hooks/useTaskPinArchive.ts` →
      `useMissionPinArchive.ts`. Rename hook export, `TaskOrgState` →
      `MissionOrgState`, `TaskPinArchiveApi` → `MissionPinArchiveApi`.
- [ ] B.7 Update every importer in
      `WorkspaceLayout.tsx`, `ResourceLayout.tsx`, `WorkspaceContent.tsx`,
      `WorkspaceToolbar.tsx`, `CommandPalette.tsx`, `MiniAgentPane.tsx`,
      `ExternalSessionRow.tsx`, and any other file caught by grep.

## Phase C — Identifier renames

- [ ] C.1 Replace route param `taskId` → `missionId` across props, state,
      function signatures, and `useParams` destructuring.
- [ ] C.2 Replace state field `taskCount` → `missionCount`,
      `taskStatus` → `missionStatus`, `taskStatusOf`/`taskStatusColor` →
      `missionStatusOf`/`missionStatusColor`,
      `taskMatch` → `missionMatch`, `taskInProgress` → `missionInProgress`,
      `taskOrg` → `missionOrg`, `taskSummary` → `missionSummary`,
      `tasksToNextLevel` → `missionsToNextLevel`,
      `tasksToUpgrade` → `missionsToUpgrade`,
      `tasksFailed`/`tasksCompleted` → `missionsFailed`/`missionsCompleted`,
      `taskAndMemberEntries` → `missionAndMemberEntries`.
- [ ] C.3 Replace any `task-*` CSS class names referring to our domain with
      `mission-*` (grep for `className.*task` in JSX).
- [ ] C.4 Skip Claude SDK tool names in `web/config/identityToolOptions.ts`:
      `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`,
      `TaskStop` MUST remain unrenamed.
- [ ] C.5 Skip storage-layer names: `Chat`, `ChatRecord`, `chats`,
      `useWorkspaceChats`, `useChatTabs`, `chatStore`, `chatService`,
      `/api/chats/*`, `expert_sessions`. These MUST remain unrenamed.

## Phase D — Validation

- [ ] D.1 Run `openspec validate rename-task-to-mission --strict`.
- [ ] D.2 Run `npx tsc --noEmit`. Resolve any compile errors in-place.
- [ ] D.3 Grep `web/` for stray user-facing "task" references:
      `grep -rn 'task' web --include='*.tsx' --include='*.ts'` filtered by
      "not in identityToolOptions, not in chat-storage names, not in
      Claude-tool i18n keys". Confirm zero leftovers.
- [ ] D.4 Verify `/tasks`, `/chats`, `/workspace/:id/task/:tid`,
      `/workspace/:id/tasks`, `/workspace/:id/chats` all redirect to the
      `/missions*` canonical form.
- [ ] D.5 Write a one-paragraph note to the war-room (`decision` type)
      recording the term update and link to the new ADR-2 narrative.
