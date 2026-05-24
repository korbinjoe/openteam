# Design: Realign OpenTeam Information Architecture

This document captures the architecture-review findings that motivate the proposal
and records the decisions taken. It is structured as a focused arch review (per the
`tech-arch-reviewer` review model), narrowed to the IA dimensions: Layered
Architecture, Module Boundaries, API/URL Design, and Evolvability.

---

## I. Executive Summary

| Dimension | Score | Status |
|---|---|---|
| Layered Architecture & Separation of Concerns | C | Warning |
| Module Boundaries & Cohesion | C | Warning |
| Dependency Governance | B | OK |
| Data Flow & State Management | B | OK |
| **API / URL Design & Contracts** | **D** | **Critical** |
| Error Handling & Resilience | B | OK |
| Testability | B | OK |
| Security Architecture | B | OK |
| Evolvability & Technical Debt | C | Warning |
| **Overall (IA-scope only)** | **C** | **Warning** |

### Key Findings (full detail in §II)

1. **[P0] Duplicate route registration.** Every resource page is reachable at
   two URLs (`/agents` and `/workspace/:id/agents`) that render identical content.
   Evidence: `web/App.tsx:56-73`.
2. **[P0] Workspace scope leakage.** Settings, Admin, Updates, Skills are routed
   under `/workspace/:id/*` despite being global-scope concepts. URL implies a
   scope that does not exist in data or behavior.
3. **[P1] Terminology drift.** Four names (`task`, `chat`, `session`, `expert`)
   for two underlying concepts, with inconsistent mapping across URLs, code,
   stores, and UI labels.
4. **[P2] Wrapper indirection.** `web/pages/ResourcePages.tsx` is a 45-line
   pass-through layer whose sole job is to inject route-prefix props that a hook
   already computes elsewhere (`SidebarFooter.tsx`).
5. **[P3] Dead affordance.** Sidebar bell icon has no route
   (`SidebarFooter.tsx:54-56`).
6. **[P3] Demo routes in production tree.** `/demo/mention`, `/demo/queue` are
   inlined into the route table (`App.tsx:45-46`).

### Architecture Strengths (worth keeping)

- **Single layout shell pattern** is sound: `WorkspaceLayout` (chat-aware) and
  `ResourceLayout` (resource-aware) are well-separated and the boundary between
  "the chrome" and "the page body" is clean.
- **`WorkspaceContext` as the single source of truth** for panel state, active
  chat, and selected agent is consistent. The `Outlet` pattern lets resource
  pages share the chrome without coupling to it.
- **Lazy-loaded pages** (`React.lazy` in `App.tsx`) keep the bundle split
  along route boundaries.

---

## II. Detailed Findings

### Finding 1: Duplicate route registration (P0)

**Location**: `web/App.tsx:56-73`

**Current state**:

```tsx
{/* Global routes */}
<Route element={<ResourceLayout />}>
  <Route path="/workspaces" element={<ResourceWorkspacesPage />} />
  <Route path="/agents" element={<ResourceAgentsPage />} />
  <Route path="/skills" element={<SkillsPage />} />
  <Route path="/cron-jobs" element={<ResourceCronJobsPage />} />
  <Route path="/chats" element={<ResourceChatHistoryPage />} />
  <Route path="/settings" element={<SettingsPage />} />
  <Route path="/admin" element={<AdminPage />} />
  <Route path="/updates" element={<UpdateManagerPage />} />
</Route>
{/* Workspace-scoped duplicates */}
<Route path="/workspace/:workspaceId" element={<ResourceLayout />}>
  <Route path="workspaces" element={<ResourceWorkspacesPage />} />
  <Route path="agents" element={<ResourceAgentsPage />} />
  <Route path="skills" element={<SkillsPage />} />
  <Route path="cron-jobs" element={<ResourceCronJobsPage />} />
  <Route path="chats" element={<ResourceChatHistoryPage />} />
  <Route path="settings" element={<SettingsPage />} />
  <Route path="admin" element={<AdminPage />} />
  <Route path="updates" element={<UpdateManagerPage />} />
</Route>
```

**Problem**: Two URLs render identical content. The "scoping" is decorative
— a different `routePrefix` is passed in, but the rendered page body is the
same component instance and same data fetch.

**Impact**:
- URL semantics are non-deterministic. Which is canonical, `/agents` or
  `/workspace/abc/agents`?
- Bookmarks and shared links land in arbitrary scope.
- Adding a new resource page requires editing both branches.
- SSR / SEO / e2e (if added) must handle 2× URL surface.
- Analytics breaks by-URL aggregation.

**Decision**: Eliminate the duplication. Each resource is mounted at exactly one
canonical path, chosen by the actual scope of its data (see Finding 2).

### Finding 2: Workspace scope leakage (P0)

**Location**: `web/App.tsx:66-72` (workspace-scoped block).

**Current state**: All 8 resource routes are mirrored under `/workspace/:id/*`,
treating settings, admin, updates, and skills as if they were workspace-scoped.

**Problem**: There is no concept of "settings for workspace X" in the data
model. `SettingsPage`, `AdminPage`, `UpdateManagerPage`, `SkillsPage` read no
workspace-scoped state. The URL `/workspace/abc/settings` does not change the
page's behavior — only what the sidebar highlights.

**Impact**: Users who arrive at `/workspace/abc/settings` reasonably expect a
per-workspace settings view. Confusion is a silent UX cost — it doesn't crash,
but it makes the IA feel arbitrary.

**Decision**: Split resources into two explicit buckets:

| Bucket | Resources | Canonical URL |
|---|---|---|
| **Global** | Settings, Admin, Updates, Skills, Agents (catalog), Agents/:id/edit, Workspaces (list) | `/settings`, `/admin`, `/updates`, `/skills`, `/agents`, `/agents/:id/edit`, `/workspaces` |
| **Workspace-scoped** | Task history, Cron jobs | `/workspace/:id/tasks`, `/workspace/:id/cron-jobs` |

Rationale for the split:
- **Agents catalog is global** because the Agent Library is the same across
  workspaces (agent definitions live in `~/.openteam/agents/` and
  `ai-assets/agents/`, not per-workspace storage).
- **Tasks (chats) are workspace-scoped** because every chat belongs to exactly
  one workspace (`chats.workspace_id` foreign key in the SQLite schema).
- **Cron jobs are workspace-scoped** because schedules dispatch tasks into a
  specific workspace.

### Finding 3: Terminology drift (P1)

**Location**: pervasive (URL paths, store names, type names, UI labels, sidebar
labels).

**Current state**:

| Concept | Storage (code) | URL segment | UI label | Sidebar label |
|---|---|---|---|---|
| Conversation with an agent / task | `chat` (Chat type, chatStore) | `task` (`/workspace/:id/task/:taskId`) | "Task" | "History" → `/chats` |
| Agent definition | `Agent` / `Expert` | `agents` | "Agents" / "Team" | "Team" → `/agents` |
| Scheduled run | `cron` / `CronJob` | `cron-jobs` | "Cron Jobs" | "Schedules" → `/cron-jobs` |

**Problem**: The product surfaces four different names for the same concept
across the URL, the storage layer, and the UI labels.

- The user-facing word is **Task** (in URL `/task/:id`, in sidebar component
  `TaskSidebar`, in `TaskGroupItem`, in dialog "New Task").
- The storage primitive is **Chat** (`chat_id` in DB, `Chat` type, `chatStore`,
  `useWorkspaceChats`).
- The sidebar footer route to the history is labeled **"History"** but the URL
  is `/chats` and the page is `ChatHistoryPage`.

**Impact**: Every contributor (and every AI agent in this workflow) re-learns
the mapping. The `refine-sidebar-immersive-overview` proposal already inherits
this debt: it calls the rows "tasks" but edits the `chatStore`.

**Decision**: Adopt a **two-name discipline**, formalized in `openspec/project.md`:

- **User-facing (URL, label, new component name, new file name)**: `task`.
- **Storage / persistence layer (DB column, type name, store name, hook name)**:
  `chat`.

This is a deliberate decoupling. Renaming `chatStore` to `taskStore`,
`Chat` type to `Task`, `useWorkspaceChats` to `useWorkspaceTasks`, etc. would
touch 80+ files for negligible runtime value. Keeping them is fine — but the
discipline going forward is: no new code introduces "chat" in URLs, labels, or
public-facing names.

The label "History" in the sidebar footer changes to "Task History" to align
with the rest of the UI.

The URL `/chats` is renamed to `/tasks` with a permanent client-side redirect.

### Finding 4: Wrapper indirection layer (P2)

**Location**: `web/pages/ResourcePages.tsx` (full file, 45 lines).

**Current state**: Five thin wrapper components (`ResourceAgentsPage`,
`ResourceAgentEditorPage`, `ResourceCronJobsPage`, `ResourceWorkspacesPage`,
`ResourceChatHistoryPage`) exist solely to call `useParams().workspaceId` and
pass a `routePrefix` prop to the actual page body.

The same logic already exists as a hook in `web/components/workspace/SidebarFooter.tsx:9-12`:

```tsx
const useResourcePrefix = (): string => {
  const { workspaceId } = useWorkspace()
  return workspaceId ? `/workspace/${workspaceId}` : ''
}
```

**Problem**: Two patterns for the same problem (prop injection via wrapper vs
hook), plus an extra component layer between the route and the actual page.

**Impact**:
- Five page components have unnecessary prop signatures
  (`agentsRoutePrefix`, `workspaceRoutePrefix`, `homePath`, `chatSegment`)
  that exist purely to support the wrapper layer.
- New contributors must learn that `AgentsHubPage` is "the real page" but
  `ResourceAgentsPage` is "the one mounted in the route table."
- `chatSegment="task"` is passed to every caller — a sign that the prop is
  vestigial (the route segment is now always `task`, never `chat`).

**Decision**: Delete `ResourcePages.tsx`. Move the prefix hook to a shared
location (`web/components/workspace/urls.ts`, rename to `useRoutePrefix`).
Update the five page components to call the hook directly.

After Finding 2 is applied, the prefix hook itself becomes simpler: for
**global** pages it always returns `''`; for **workspace-scoped** pages it
always returns `/workspace/:id` because the route guarantees a workspaceId
exists in `useParams()`. The "fall back if no workspace" branch goes away.

### Finding 5: Dead affordance (P3)

**Location**: `web/components/workspace/SidebarFooter.tsx:54-56`.

```tsx
<IconBtn title="Notifications">
  <Bell size={14} />
</IconBtn>
```

No `onClick`. No route. The bell is purely visual.

**Decision**: Out of scope for this change (cosmetic, not structural). Flagged
for the next sidebar pass. Not blocking.

### Finding 6: Demo routes in production tree (P3)

**Location**: `web/App.tsx:45-46`.

```tsx
<Route path="/demo/mention" element={<MentionInputDemo />} />
<Route path="/demo/queue" element={<QueuedMessagesBarDemo />} />
```

**Decision**: Gate behind `import.meta.env.DEV` so production builds do not
ship the demo bundles. Low-effort, included in tasks.md.

---

## III. Scenario Analysis

### Scenario A: User shares a `/settings` link with a teammate

- **Current**: User on `/workspace/abc/settings` copies the URL and pastes it.
  Teammate clicks; if teammate's last-visited workspace is different, the URL
  still works but their sidebar highlights a workspace they don't expect.
- **After this change**: User on `/settings` (global) copies and shares. URL is
  the same for everyone. No workspace ambiguity.

### Scenario B: First-time user arrives at root `/`

- **Current**: `WorkspaceRedirect` runs. localStorage empty → fetches
  `/api/workspaces` → if list is empty, redirects to `/workspaces`. If list is
  non-empty, redirects to the first workspace.
- **After this change**: Unchanged. Root redirect behavior is explicitly a
  non-goal.

### Scenario C: Adding a new global resource page (e.g., "Billing")

- **Current**: Add two route entries (one global, one workspace-scoped). Add
  a wrapper in `ResourcePages.tsx` if it needs prefix awareness. Add a sidebar
  entry. Three places.
- **After this change**: Add one route entry to the global block. Add the
  sidebar entry. The page calls `useRoutePrefix()` only if it actually needs to
  build links into workspace-scoped pages. Two places, with the wrapper layer
  gone entirely.

### Scenario D: Adding a new workspace-scoped resource page (e.g., "Files")

- **Current**: Same as C — add to both branches.
- **After this change**: Add one entry under the `/workspace/:id` block. The
  page reads `workspaceId` from `useParams()` directly; the router guarantees
  it is present.

---

## IV. Decisions Log (ADRs)

### ADR-1: All resource pages mount at top-level URLs only

- **Context**: Today every resource has two URLs (global and workspace-scoped).
  The original review hypothesis was a two-bucket split: global resources stay
  top-level, workspace-scoped resources (tasks, cron-jobs) move under
  `/workspace/:id/`. Implementation investigation invalidated the hypothesis:
  both `ChatHistoryPage` and `CronJobsPage` fetch cross-workspace data
  (`/api/chats/recent`, `/api/cron-jobs`) and render identically regardless of
  which workspace the user came from. There are no per-workspace resource pages.
- **Decision**: Mount every resource page (`/settings`, `/admin`, `/updates`,
  `/skills`, `/agents`, `/agents/:id/edit`, `/workspaces`, `/cron-jobs`,
  `/tasks`) at a single top-level URL. Reserve the `/workspace/:id/*` prefix
  for routes whose rendering actually changes per workspace: the workspace
  shell (`/workspace/:id`) and the per-task view
  (`/workspace/:id/task/:taskId`). Every removed workspace-scoped URL gets a
  client-side `<Navigate replace>` to its new canonical top-level URL.
- **Alternatives considered**:
  - **A. Two-bucket split (the original plan)**: keep tasks/cron-jobs under
    `/workspace/:id/`. Rejected after discovering the pages already display
    cross-workspace data; the workspace prefix would be a URL lie.
  - **B. Keep duplicates, mark canonical**: Solves SEO only, not contributor or
    bookmark confusion. Rejected.
- **Consequences**: One canonical URL per resource. The `useRoutePrefix` hook
  originally proposed for Phase 2 becomes unnecessary — with no per-workspace
  resource pages, no prefix-injection mechanism is needed. Workspace-scoped
  bookmarks for resource pages break, mitigated by `<Navigate replace>`
  redirects shipped in the same change.

### ADR-2: Two-name discipline (UI = task, Storage = chat)

- **Context**: Renaming `chatStore` + `Chat` type + `useChats*` across 80+
  files is high-cost and risk-prone. But the UI already uses "task" everywhere.
- **Decision**: Freeze the storage layer's name as `chat`. Forbid new use of
  `chat` in URLs, labels, or new public-facing component/file names. Document
  the contract in `openspec/project.md`.
- **Alternatives considered**:
  - **A. Big-bang rename to `task`**: Touches every store, every hook, every
    type, every test. ~80 files, weeks of conflict-resolution with in-flight
    proposals. Rejected.
  - **B. Big-bang rename to `chat`**: Sidebar component renames, dialog renames,
    URL change to `/chat/:id`. Also breaks user expectations because the
    product already says "task." Rejected.
  - **C. Tolerate the drift**: Status quo. Every future contributor pays the
    same learning tax. Rejected as the cheapest short-term but most expensive
    long-term option.
- **Consequences**: Requires ongoing discipline. Worth a CLAUDE.md / project.md
  note so AI agents enforce it on each new PR.

### ADR-3: Delete `ResourcePages.tsx` and eliminate route-prefix props entirely

- **Context**: The wrapper layer's only job was to inject route-prefix props
  (`agentsRoutePrefix`, `workspaceRoutePrefix`, `chatSegment`, `homePath`) into
  each page so the page could compose URLs that "stayed in the workspace
  context." Once ADR-1 collapsed every resource to a single top-level URL, the
  prefix is always the empty string and the segment is always `task` — there
  is nothing left to inject.
- **Decision**: Delete `web/pages/ResourcePages.tsx`. Drop all
  `routePrefix` / `workspaceRoutePrefix` / `agentsRoutePrefix` / `chatSegment` /
  `homePath` props from the five page components and the two chat modal
  components. Replace with module-level constants (`AGENTS_BASE = '/agents'`,
  `WORKSPACE_BASE = '/workspace'`, `TASK_SEGMENT = 'task'`, `HOME_PATH = '/'`).
- **Alternatives considered**:
  - **A. Add a `useRoutePrefix` hook (originally planned)**: now pointless —
    the hook would unconditionally return `''`. Rejected.
  - **B. Keep wrappers, delete the hook**: irrelevant; the hook is also being
    removed.
- **Consequences**: Seven components (5 pages + 2 chat modals) lose 1–3 props
  each. The wrapper file disappears. There is now exactly one place each route
  fragment lives: a `const` at the top of the file that uses it.

### ADR-4: Rename `/chats` → `/tasks` with backward-compatible redirect

- **Context**: The route segment `/chats` is the last user-facing place where
  "chat" leaks. Renaming aligns with the two-name discipline (ADR-2).
- **Decision**: Add `<Route path="/chats" element={<Navigate to="/tasks" replace />}>`
  alongside the new `/tasks` route. Same for workspace-scoped variant.
- **Consequences**: Bookmarks survive. URL becomes consistent with `/task/:id`
  (singular detail) and `/tasks` (list). One less place where "chat" surfaces.

---

## V. Summary Matrix (IA-scope)

| Dimension | P0 | P1 | P2 | P3 | Status After Realignment |
|---|---|---|---|---|---|
| API / URL Design & Contracts | 2 | 0 | 0 | 1 | OK (D goes away) |
| Module Boundaries & Cohesion | 0 | 0 | 1 | 1 | OK |
| Evolvability & Technical Debt | 0 | 1 | 0 | 1 | OK |

---

## VI. Out of Scope (Flagged for Future Work)

- **Sidebar bell with no route** — wire to a notifications surface or remove.
- **Two-hop root redirect** (`/` → `WorkspaceRedirect` → `/workspace/:last`) —
  acceptable, but a single-render decision would be cleaner.
- **`/workspace/:id/workspaces`** — conceptually odd (workspace list inside a
  workspace). Kept for sidebar consistency; revisit if confusion is reported.
- **Notch panel** (`web/notch-panel/`) is a separate React app with its own
  `index.html` and routing — not covered by this review. Worth a follow-up
  review to confirm the IA boundary between main app and notch.
- **Big-bang rename of `chatStore` / `Chat` type** — explicitly deferred per
  ADR-2.
