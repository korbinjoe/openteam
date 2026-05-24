# Proposal: Realign OpenTeam Information Architecture

## Summary

This proposal captures findings from an architecture review of the OpenTeam product's
information architecture (IA) and proposes a targeted realignment. The current IA has
four structural defects — duplicate route registration, conflation of global vs
workspace-scoped resources, terminology drift (`task` / `chat` / `session`), and a
wrapper-page indirection layer that exists only to inject route prefixes. None of
these are blocking bugs; together they erode the predictability of the IA and increase
the per-feature change cost for every downstream proposal that touches navigation
(`refine-sidebar-immersive-overview`, `fix-workspace-v2-task-agent-routing`,
`upgrade-workspace-ui-v2`).

The realignment is non-cosmetic: it changes the URL contract, deletes the
`ResourcePages` wrapper layer, and consolidates resource semantics into two explicit
buckets (workspace-scoped vs global). It does **not** change the visible chrome,
sidebar layout, or any agent/task behavior. Existing in-flight changes are unblocked
because they all touch components, not the route shell.

## Why

The architecture review (recorded in `design.md` of this change) surfaced the
following IA defects, ordered by impact:

### D1 — Duplicate route registration (P0)

`web/App.tsx:56-73` registers every resource page **twice**: once at the top level
(`/agents`, `/skills`, `/cron-jobs`, `/workspaces`, `/chats`, `/settings`, `/admin`,
`/updates`) and once under `/workspace/:workspaceId/*` with the identical leaf path.
Both branches mount the same `ResourceLayout` and the same page component. The only
behavioral difference is the prefix that `ResourcePages.tsx` injects into outbound
links so navigation "stays inside the workspace context."

Consequence: every resource is reachable via two canonical URLs that render
identical content. Bookmarks, deep links, analytics, e2e tests, and external docs
must choose between two equivalent URLs with no rule for which is correct. Adding a
new resource page requires editing the route table in two places.

### D2 — Global resources are routed as if they were workspace-scoped (P0)

The duplicate route tree treats Settings, Admin, Updates, and Skills the same as
Agents, Workspaces, Chats, and Cron-Jobs. But Settings, Admin, and Updates are
**inherently global** (app-level configuration, user account, software updates) —
they have no workspace dimension. Routing them under `/workspace/:workspaceId/*`
implies a per-workspace scope that does not exist in the data model or the page UI.

Consequence: the URL is a lie. Users who land on `/workspace/abc/settings` reasonably
expect "settings for workspace abc" and get "global settings (with workspace abc
highlighted in the sidebar)."

### D3 — Naming drift across the IA (P1)

The product surfaces four different names for two underlying concepts:

| Concept | URL segment | Code name | Store name | UI label | Sidebar label |
|---|---|---|---|---|---|
| Task / Conversation | `task` | `chat` | `chat` | "Task" | "History" (`/chats`) |
| Agent execution | — | `agent` / `expert` | `agent` | "Agent" | "Team" (`/agents`) |
| Scheduled job | `cron-jobs` | `cron` | `cron` | — | "Schedules" |

The mismatch between URL (`/chats`) and sidebar label ("History") and code (`Chat`)
and UI label ("Task") is the most expensive piece — every downstream proposal must
re-learn the mapping. The `refine-sidebar-immersive-overview` proposal already
inherits this debt (it calls them "tasks" in the UI but edits the `chatStore`).

### D4 — Wrapper indirection layer (P2)

`web/pages/ResourcePages.tsx` is a 45-line file whose sole purpose is to wrap each
actual page (`AgentsHubPage`, `AgentEditorPage`, `WorkspacesPage`, `CronJobsPage`,
`ChatHistoryPage`) and inject `routePrefix` / `homePath` props derived from
`useParams().workspaceId`. The same logic already exists as a hook
(`useResourcePrefix` in `web/components/workspace/SidebarFooter.tsx`).

Consequence: every resource page is reachable through two distinct React components
(direct page vs `Resource*Page` wrapper), and the prefix-passing is duplicated as
both a hook and a prop-injection wrapper. Two patterns for the same problem.

### Secondary findings (P2/P3)

- **Demo routes inlined in production routes** (`/demo/mention`, `/demo/queue`) —
  should be dev-gated or moved behind an env flag (`web/App.tsx:45-46`).
- **Sidebar footer label/route divergence** — `Team → /agents`,
  `Schedules → /cron-jobs`, `History → /chats`. Reasonable as user-facing labels,
  but URLs should at minimum match one of the labels so direct-link sharing is
  intuitive (`web/components/workspace/SidebarFooter.tsx:18-25,48`).
- **Bell icon has no route** (`SidebarFooter.tsx:54-56`) — present in the chrome but
  no destination; UI promises something the IA does not deliver.
- **Root redirect creates back-button chain** — `/` → `WorkspaceRedirect` →
  `/workspace/:last` is two navigations in one click; back-button returns to the
  redirect, which re-runs and bounces back. Acceptable, but worth marking as a
  known IA constraint.

## What Changes

Three concrete IA edits, ordered by safety:

### Change 1 — Resources mount at top-level URLs only

The duplicate route registration is collapsed. Every resource page (`/settings`,
`/admin`, `/updates`, `/skills`, `/agents`, `/agents/:id/edit`, `/workspaces`,
`/cron-jobs`, `/tasks`) mounts at exactly one top-level URL.

This is stricter than the originally proposed "two buckets" split. Investigation
during implementation revealed that even the pages we initially classified as
workspace-scoped — task history and cron-jobs — actually fetch cross-workspace
data: `ChatHistoryPage` calls `/api/chats/recent` (all workspaces), `CronJobsPage`
calls `/api/cron-jobs` (all workspaces). The displayed content does not change
based on which workspace the user came from. Mounting them at top level makes
the URL contract honest.

The `/workspace/:workspaceId/*` prefix is reserved for routes whose rendering
actually changes with the workspace: the workspace shell (`/workspace/:id`) and
the per-task view (`/workspace/:id/task/:taskId`).

All deleted workspace-scoped variants get a `<Navigate replace>` redirect to
their canonical top-level URL so bookmarks keep working.

### Change 2 — Collapse the `ResourcePages` wrapper layer

Delete `web/pages/ResourcePages.tsx`. With every resource page mounting at a
single top-level URL (Change 1), there is no longer any need for route-prefix
injection at all — the originally planned `useRoutePrefix` hook becomes
unnecessary. Each affected page (`AgentsHubPage`, `AgentEditorPage`,
`WorkspacesPage`, `CronJobsPage`, `ChatHistoryPage`, `NewChatForm`,
`NewChatFullDialog`) drops its `routePrefix` / `workspaceRoutePrefix` /
`agentsRoutePrefix` / `chatSegment` / `homePath` props and uses module-level
constants instead.

Net effect: one consistent pattern (module constants), the wrapper layer and
all five prefix-prop slots disappear, page signatures shrink by 1–3 props each.

### Change 3 — Normalize on `task` as the user-facing name; keep `chat` only as the
storage primitive

The URL contract uses `task`. The UI label uses "Task". The sidebar footer label
for the `/chats` route changes from "History" to "Task History" and the route is
renamed `/chats` → `/tasks` (with a permanent redirect for backward compatibility,
since chats are bookmarkable).

Code names (`chatStore`, `Chat` type, `useWorkspaceChats`) **stay as-is**. The
storage layer's primitive name is decoupled from the user-facing IA term. This
mirrors how many products separate "post" (storage) from "story" (UI). The
discipline is: never expose `chat` in a URL, label, or new component name going
forward; refactoring existing code names is out of scope for this change (and
would be high-cost, low-value).

## Goals

- **G1** — One canonical URL per resource. No resource is reachable at two URLs
  rendering identical content.
- **G2** — URL scope matches data scope. The `/workspace/:id/` prefix is reserved
  for routes whose rendering changes per workspace; resource pages that show
  cross-workspace data mount at top level only.
- **G3** — Page components do not receive route-prefix props. The wrapper
  layer (`ResourcePages.tsx`) and all `routePrefix` / `chatSegment` / `homePath`
  prop slots are removed.
- **G4** — The user-facing name "Task" is used consistently in URLs, labels, and
  net-new component names. `chat` survives only in storage/code (chatStore, Chat
  type, useChat hooks).
- **G5** — Every entry point in the sidebar maps to a destination. Dead affordances
  (the bell with no route) are either wired up or removed.
- **G6** — Demo routes do not appear in the production route table.

## Non-Goals

- **No visible chrome changes.** Sidebar layout, footer icons, workspace shell,
  toolbar are untouched. (Those are owned by `refine-sidebar-immersive-overview`
  and `upgrade-workspace-ui-v2`.)
- **No rename of `chatStore` / `Chat` type / `useWorkspaceChats`.** Code names
  stay; only URL paths and user-facing labels change.
- **No new workspace-scoped resources.** Admin, Settings, Updates, Skills stay
  global; we are not introducing per-workspace settings in this change.
- **No re-architecture of `WorkspaceContext` / `ChatTabContext`.** The state stays
  exactly as it is.
- **No change to the `/` root redirect behavior.** The two-hop redirect is
  flagged as a known IA constraint but not addressed here.

## Approach

The change ships as a single PR per change-bucket (1, 2, 3 above), in the listed
order. Each is independently revertible:

1. **Route-tree split** — modify `web/App.tsx` only. Add `301`-style permanent
   client-side redirects (`<Navigate replace>`) for the deleted
   `/workspace/:id/settings`, `/admin`, `/updates`, `/skills`, `/agents`, and
   `/agents/:id/edit` paths so existing bookmarks survive. Verify in browser
   that every sidebar entry still works in both expanded and collapsed sidebar
   modes, and that direct-typing a `/workspace/abc/settings` URL redirects to
   `/settings` without flicker. Update `SidebarFooter.tsx` so the four "global"
   resource buttons do not call `useResourcePrefix()` — they emit absolute
   paths.

2. **Wrapper-layer collapse** — delete `web/pages/ResourcePages.tsx`. Move
   `useResourcePrefix` from `SidebarFooter.tsx` to `web/components/workspace/urls.ts`
   and rename to `useRoutePrefix`. Update the five page components to call the
   hook. Update `App.tsx` to import pages directly rather than `Resource*Page`
   re-exports. Verify the same five resource pages still navigate correctly from
   the sidebar.

3. **Task naming** — rename the route segment `/chats` → `/tasks` and add a
   `<Navigate to="/tasks" replace>` redirect for `/chats`. Rename
   `ChatHistoryPage`'s exposed `chatSegment="task"` prop default to match
   (currently every caller passes `chatSegment="task"` already, so this is a
   no-op for behavior — just deletes the prop). Update sidebar label
   "History" → "Task History".

Each change ends with a manual verification pass against the rule from
`CLAUDE.md` (xterm initial load / refresh / resize / recovery) — these are
route-shell changes so terminal behavior should not regress, but the check is
included in `tasks.md`.

## Risks

- **R1 — Bookmark breakage.** Renaming `/chats` → `/tasks` and removing
  workspace-scoped variants of global pages invalidates any saved URL. Mitigation:
  client-side `Navigate` redirects for every removed path; redirects ship in the
  same PR as the removal so there is no window during which the old URL 404s.
- **R2 — Coupling with in-flight changes.** Three open proposals touch
  navigation surfaces (`refine-sidebar-immersive-overview`,
  `fix-workspace-v2-task-agent-routing`, `upgrade-workspace-ui-v2`). Mitigation:
  this change is scoped to `App.tsx`, `ResourcePages.tsx`, and five page
  component signatures — it does not touch `TaskSidebar`, `WorkspaceLayout`,
  `WorkspaceContent`, or any component the in-flight changes are editing.
  Conflicts at merge time should be limited to the route table.
- **R3 — Storage/UI naming divergence becomes a long-term wart.** Keeping
  `Chat` as the storage primitive while exposing only "Task" to users requires
  ongoing discipline. Mitigation: add a one-line note to `openspec/project.md`
  recording the naming contract, so future agents do not re-introduce
  "chat" into URLs or labels.
- **R4 — The `/workspace/:id/workspaces` route is conceptually weird** (a
  workspace list inside a workspace). Kept because the sidebar
  consistently shows it as a resource entry. Flagged as a P2 to revisit if a
  user complains; not blocking.

## Affected Code

- `web/App.tsx` — route table split, redirect rules, demo routes gated.
- `web/pages/ResourcePages.tsx` — deleted.
- `web/components/workspace/urls.ts` — `useRoutePrefix` hook added.
- `web/components/workspace/SidebarFooter.tsx` — global resource buttons emit
  absolute paths; "History" label → "Task History".
- `web/pages/AgentsHubPage.tsx`, `AgentEditorPage.tsx`, `WorkspacesPage.tsx`,
  `CronJobsPage.tsx`, `ChatHistoryPage.tsx` — consume `useRoutePrefix` hook,
  drop prefix props from signatures.
- `openspec/project.md` — append IA naming contract (task = UI, chat = storage).
