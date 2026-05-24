# Proposal: Rename user-facing "task" to "mission"

## Summary

The just-shipped `realign-information-architecture` change established a naming
contract (ADR-2): the user-facing surface uses `task`, the storage layer keeps
`chat`. This change updates the **user-facing** half of that contract from
`task` to `mission`. The storage half is unchanged.

The rename covers URLs, UI labels, i18n strings, component file names, and
TypeScript identifiers that refer to the user-facing concept of "a unit of
work an agent is performing for me". It does not touch the database, HTTP
endpoints, or any type/hook/module whose name is the storage primitive.

## Why

- "Mission" matches the product positioning ("AI 超级个体的操作系统" — the user
  dispatches *missions* to an AI fleet, not *tasks*) better than the
  workmanlike "task". The home page already exposes a `MissionControl`
  component built on this premise.
- We just paid the cost of a UI-vs-storage split (ADR-2). The discipline is
  cheap to evolve once: change the UI half, leave the storage half. Postponing
  this rename means every new contributor has to learn "task is the UI term,
  except where it conflicts with what the marketing copy says."
- The set of identifiers / files / strings is bounded (~40 files after
  filtering Claude SDK tool names like `TaskCreate`/`TaskUpdate` which are not
  our domain concept) and the change is mechanical.

## What Changes

### URL contract

| Before | After |
|--------|-------|
| `/tasks` | `/missions` |
| `/workspace/:wsId/task/:taskId` | `/workspace/:wsId/mission/:missionId` |
| `/workspace/:wsId/tasks` (legacy redirect) | `/workspace/:wsId/missions` (legacy redirect) |

`/tasks`, `/chats`, `/workspace/:wsId/task/:taskId`, `/workspace/:wsId/tasks`,
`/workspace/:wsId/chats` all serve `<Navigate replace>` to the new canonical
URL.

### UI labels

`Tasks` / `Task History` / `New Task` / "task" anywhere user-visible →
`Missions` / `Mission History` / `New Mission` / "mission".

`web/locales/en/chat.json` `history.title` and similar values rename the
rendered string. `web/locales/en/common.json` `nav.taskHistory` →
`nav.missionHistory`.

### Component files (renamed; all importers updated)

- `web/components/workspace/TaskSidebar.tsx` → `MissionSidebar.tsx`
- `web/components/workspace/TaskInfoSidebar.tsx` → `MissionInfoSidebar.tsx`
- `web/components/workspace/TaskSessionList.tsx` → `MissionSessionList.tsx`
- `web/components/workspace/TaskSessionRows.tsx` → `MissionSessionRows.tsx`
- `web/components/workspace/TaskGroupItem.tsx` → `MissionGroupItem.tsx`
- `web/hooks/useTaskPinArchive.ts` → `useMissionPinArchive.ts`

### Identifier renames

- Route param `taskId` → `missionId`
- Hooks/helpers `buildTaskUrl` → `buildMissionUrl`, `useTaskPinArchive` → `useMissionPinArchive`
- TS types `TaskOrgState`, `TaskRowProps`, `TaskGroupItemProps`,
  `TaskSessionListProps`, `TaskSidebarProps`, `TaskPinArchiveApi` → `Mission*`
- CSS class names `task-*` → `mission-*` if any
- WorkspaceContext field `activeChatId` is preserved (storage primitive); the
  *URL-derived* identifier flowing into context becomes `missionId`

### Storage layer (unchanged)

- DB: `chats` table, `chat_id` columns
- Types: `Chat`, `ChatRecord`
- Hooks: `useWorkspaceChats`, `useChatActions`, `useChatTabs`
- Modules: `chatStore`, `chatService`
- HTTP: `/api/chats/*`, `/api/workspaces/:id/chats`
- JSONL session keys (`expert_sessions` records keyed by chat id)

### Excluded from rename

- `web/config/identityToolOptions.ts` `TaskCreate` / `TaskList` / `TaskGet` /
  `TaskUpdate` / `TaskOutput` / `TaskStop` — these are Claude Code SDK tool
  names; renaming them would break the agent tool surface.
- `web/components/home/MissionControl.tsx` — already uses Mission.

## Goals

- **G1** — All user-facing references to a unit of agent work read "Mission".
- **G2** — All storage-layer identifiers continue to read `chat`.
- **G3** — No bookmark of the old URL surface returns 404; every removed path
  serves a `<Navigate replace>` redirect.
- **G4** — `openspec/project.md` ADR-2 updates to record the new contract:
  UI = `mission`, storage = `chat`. No future code introduces "task" as a
  user-facing term.

## Non-Goals

- No database migration. `chats` table stays.
- No HTTP endpoint rename. `/api/chats/*` stays.
- No change to the in-memory or persisted shape of `Chat` records.
- No rename of Claude SDK tool names.

## Approach

Single PR, three implementation phases, then validation.

1. **Phase A — Routes, contracts, i18n, ADR.** Add `/missions` canonical,
   redirect `/tasks` → `/missions`. Add `/workspace/:wsId/mission/:missionId`,
   redirect the legacy `task` form. Rename `buildTaskUrl` → `buildMissionUrl`
   and update its single import site. Update `WorkspaceLayout`'s
   `useParams<{taskId}>` → `useParams<{missionId}>`. Rename the en i18n keys
   that become user-visible. Update `openspec/project.md` ADR-2 narrative.

2. **Phase B — File renames.** Move 5 component files + 1 hook file. Update
   every importer (~10 files).

3. **Phase C — Identifier renames.** Apply `taskId` → `missionId` and the type
   renames listed above. CSS classes `task-*` → `mission-*` where they refer
   to our domain.

4. **Phase D — Validation.** `openspec validate --strict`, `tsc --noEmit`,
   final grep for stray task references in user-facing strings.

## Risks

- **R1 — Compile-time blast radius.** `taskId` is referenced in ~17 files;
  `TaskSidebar` etc. in ~13. Mitigation: TypeScript strict catches every miss;
  the change ships as one PR so no half-migrated state lands on `main`.
- **R2 — i18n drift in non-en locales.** Other locales (zh/ja/ko/de/fr/es/pt)
  retain "task" until a translator pass. Mitigation: English is the canonical
  source per project convention; non-en is updated in a follow-up.
- **R3 — Whiteboard / war-room semantics.** Whiteboard messages persist
  literal task language (e.g., progress messages with "task done"). These are
  audit-log artifacts; we do not rewrite history. New entries follow the new
  naming.
- **R4 — Identity tool name collision.** Claude SDK tool labels in
  `identityToolOptions.ts` (`TaskCreate` etc.) must NOT be renamed.
  Implementation must explicitly exclude that file from sweeping rename.
