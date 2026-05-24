# OpenTeam — Project Context for OpenSpec

This file captures cross-cutting conventions that span multiple specs. Read it before
authoring or amending a change proposal.

## Naming Contract (ADR-2)

OpenTeam separates **user-facing terms** from **storage primitives**. The two layers
evolved at different times and do not need to share vocabulary.

| Layer | Term | Where it appears |
|-------|------|------------------|
| User-facing | **mission** | URLs (`/missions`, `/workspace/:id/mission/:missionId`), sidebar labels, page titles, button copy, i18n strings, code identifiers (`missionId`, `MissionSidebar`, `useMissionPinArchive`, `selectedMissionId`) |
| Storage / wire | **chat** | Database tables (`chats`, `chat_*`), HTTP API paths (`/api/chats/...`), TypeScript types around persistence (`ChatRecord`, `useWorkspaceChats`), JSONL session keys |
| External SDK | **task** | Claude Code SDK tool names (`TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`) — these are owned by the SDK and MUST NOT be renamed |

### Rules for new code

1. New URLs and route paths **MUST** use `mission`. Never introduce a new `/chat`,
   `/chats`, or `/task` URL segment.
2. New UI strings (labels, titles, tooltips, i18n keys' rendered values) **MUST**
   use "mission" / "Mission" / "Missions". `chat` is reserved for the message-list
   primitive (the conversation pane inside an open mission is still "Chat").
3. New TypeScript identifiers in the product layer (state, hooks, components,
   navigation params) **MUST** use `mission` (e.g., `missionId`, `selectedMissionId`,
   `MissionSidebar`).
4. Existing storage layer names (table columns, API endpoints, `Chat*` types tied
   directly to persistence, JSONL session keys) **MUST NOT** be renamed
   opportunistically — they require a dedicated migration change.
5. Claude Code SDK tool names (`TaskCreate`, etc.) **MUST NOT** be renamed — they
   are externally defined by the agent runtime contract.
6. When a legacy `/tasks` or `/chats` URL needs to be preserved, add a client-side
   `<Navigate to="/missions" replace>` redirect rather than dual-mounting the page.

### Why

`chat` was the original storage primitive (one conversation with one agent). The
product evolved into multi-agent coordination where the conversation is a sub-component
of a larger unit of work. We initially called that unit "task", but "task" collides
with the Claude SDK's `TaskCreate`/`TaskList` tool names — same word, two unrelated
concepts (a unit of agent work vs. a to-do item the agent is tracking). Renaming the
user-facing concept to "mission" disambiguates: the product runs **missions**, agents
internally manage **tasks** (to-dos) within a mission. Storage stays `chat` because
renaming a SQLite schema and JSONL session keyspace is a much larger change than is
warranted by terminology alone.
