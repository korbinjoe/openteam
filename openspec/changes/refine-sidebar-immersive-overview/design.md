# Design: Refine Sidebar as Immersive Cross-Workspace Overview

## Architectural Context

The sidebar is a top-level React component tree under `WorkspaceLayout` that reads chat data from `useAllChats` and external CLI sessions from `useExternalCwds` / `useExternalCwdSessions`. Chats are server-stored in SQLite (single source of truth for chat metadata); JSONL files remain the single source of truth for **message bodies** (per project rule). Titles, however, are metadata and live on the `chats` row.

There is no existing client-side derivation layer for titles — chats are rendered with `chat.title` as-is. Adding derivation has two viable seams:

| Option | Where derivation runs | Pros | Cons |
|--------|----------------------|------|------|
| A. Client-only | Inside `TaskRow` render | Zero server change; rolls back easily | Each client re-derives on every render; backfill impossible without server writes; can't drive notifications / breadcrumbs from a coherent title |
| B. Server-side write-back | Server writes derived title to `chats.title` on first user message | Single canonical value; backfill is a one-shot migration; titles flow naturally into breadcrumbs and notifications | Requires server change + a migration; risk of overwriting a user-set title if the user-set path also writes `chat.title` |

**Decision: Option B.** The product intent of the sidebar is "scan workload across workspaces"; that requires a *single* canonical title that breadcrumbs, the workspace toolbar, and the sidebar all agree on. Option A would let those surfaces diverge.

To handle the overwrite risk, we add a `title_is_derived` boolean column. The auto-derivation path only writes when this is `true` (or when `title IS NULL`). Any explicit user rename flips it to `false`, locking the title.

## Data Model Change

Migration `<next>__chat-derived-title.sql`:

```sql
ALTER TABLE chats ADD COLUMN title_is_derived INTEGER NOT NULL DEFAULT 1;

-- Anything that already has a non-placeholder title gets locked.
UPDATE chats
   SET title_is_derived = 0
 WHERE title IS NOT NULL
   AND title != ''
   AND title != 'New Task'
   AND title NOT LIKE '<local-command-%';

-- Backfill: derive a title from the first user message JSONL for rows still marked derived.
-- (Implementation runs in Node via a post-migration script; SQL alone can't read JSONL.)
```

A companion Node script reads each derived row's primary CLI session JSONL, finds the first `user` message, derives a title (see derivation rules below), and updates the row. Batched in chunks of 500 with a single transaction per batch.

## Derivation Rules

Input: the first `user` message string from the chat's primary CLI session JSONL.

1. Strip leading slash-commands: `/foo bar` → `bar`.
2. Strip fenced code blocks (` ``` `) and inline code (`` ` ``).
3. Collapse whitespace to single spaces.
4. Trim leading/trailing punctuation and whitespace.
5. Truncate to 40 visible characters on a word boundary (CJK characters count as 1). Append `…` if truncated.
6. If the result has fewer than 3 visible characters, fall back to `Untitled task`.

The derivation function lives in `shared/deriveTitle.ts` so client (render-time guard) and server (migration + first-message hook) call the same implementation.

## Render-Time Fallback

Even with server backfill, two leakage paths remain:

- Chats created before the backfill ships but with no first user message yet.
- External CLI sessions surfaced via `useExternalCwdSessions` that bypass the server's chat store entirely.

`TaskRow` and `ExternalSessionRow` route the displayed name through a `safeTitle(raw: string | null)` helper that:

- Returns `Untitled task` if the input is null, empty, exactly `New Task`, or matches `/^<local-command-[\w-]*>/`.
- Otherwise returns the input.

## Hover Action Layering

Today's `TaskSessionRows.tsx` swaps the meta region (timestamp + count) for the action group on hover — `hidden group-hover:flex` style. This violates CLAUDE.md hover-layout-shift rule and discards info the user came to read.

New approach for the right-side region of the row:

```
.task-row-meta:        always rendered, opacity-100, pointer-events-none on hover
.task-row-actions:     always rendered, absolute right-0, opacity-0 group-hover:opacity-100
                       layered above .meta with a subtle background gradient mask
```

Effect: meta and actions never compete for space; the meta stays readable; actions appear on hover via opacity-only transition. The hover transition is `transition-opacity duration-100`.

## Add Agent Surface

`Add Agent` graduates from a list row to a button in the hover action group:

| Before | After |
|--------|-------|
| `+ Add Agent` row indented at `pl-9`, always visible | `+` icon in hover actions, tooltip "Add agent (⌘⇧A)" |

To keep discoverability for users who have not yet hovered any task row, the empty-team state in the task overview pane gains a primary `Add agent` CTA (already partially present — verify and reuse).

## Collapsed-Mode Status Strip

Collapsed sidebar (`52px`) currently renders: brand → expand → New Task → spacer → resource icons → settings. We insert a **workspace status strip** between New Task and the spacer:

```
┌──────┐
│ [T]  │  brand
│ ⇆    │  expand
│ +    │  new task
├──────┤
│ ⊙ ●● │  ws "openteam":   2 running, 1 awaiting
│ ⊙ ●  │  ws "infra":      1 running
│ ⊙    │  ws "blog":       (idle, shown muted)
├──────┤
│ ...  │  resources, settings
└──────┘
```

Each row is 28px tall, contains the workspace's first character glyph (color-coded by `isCurrent`) plus up to 3 status dots in priority order (error > awaiting > running). A 4th-and-beyond is rendered as a small `+N` chip. Click → re-expands the sidebar and scrolls the workspace group into view.

To bound the strip when there are many workspaces, the strip shows at most 5 workspaces (sorted by: has-error desc, running desc, recent activity desc). Overflow indicator `+N more` at the bottom.

## Filter vs Command Palette

Rename and re-style the in-sidebar search:

- Placeholder: `Search tasks…` → `Filter tasks…`
- Aria-label: `Search tasks` → `Filter tasks in sidebar`
- Tooltip: `Search tasks (/)` → `Filter sidebar (/)`
- Icon: keep magnifying-glass (familiar), but add a subtle "in scope" indicator (e.g. a tiny `↓` adornment) — alternatively just rely on the text change.

⌘K command palette keeps its `Search` framing because its scope is global (commands, tasks across workspaces, files when extended).

## Decisions

### D1. Server-side derived title (not client-only)

Decided in favour of server-side derivation to give every surface (sidebar, breadcrumb, toolbar, notifications) a single canonical title. See option matrix in *Architectural Context*.

### D2. Lock titles via `title_is_derived` column

Added to prevent the auto-derivation path from overwriting a user-set rename. Simpler than tracking "user touched title" history.

### D3. Hover layering via opacity, not display

Required by the global hover-layout-shift rule (CLAUDE.md) and by the UX-review finding that hover currently destroys readable info.

### D4. Filter (not Search) for the sidebar input

Matches the actual scope (filters the visible list; does not navigate to results). Avoids name-collision with ⌘K Command Palette which *does* navigate.

### D5. Keep the workspace count badge

Earlier instinct was to remove it as "pressure-inducing." Under the immersive-overview intent (recorded in `memory/project_sidebar_design_intent.md`) the count is real workload signal, not noise — kept.

### D6. Collapsed strip caps at 5 workspaces

Vertical real estate is finite at 52px. A hard cap preserves room for the bottom icon group; overflow is surfaced via `+N more`.

## Open Questions

None at this time. All design choices above are committed; if any prove wrong during apply, the implementor flips to the alternative documented in the matrix and updates this file.
