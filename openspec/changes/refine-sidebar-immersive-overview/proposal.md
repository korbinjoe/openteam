# Proposal: Refine Sidebar as Immersive Cross-Workspace Overview

## Summary

Sharpen the left sidebar (`TaskSidebar`) so it actually delivers the product intent of an **immersive cross-workspace overview**: every workspace and task is always visible regardless of the URL, and the user can scan workload and anomalies at a glance. The current implementation buries the most attention-critical signal — *which task is this?* — behind a placeholder name (`New Task`) shared by every freshly created chat, and the collapsed mode discards all status awareness.

This change has two thrusts:

1. **Task naming (P0)** — Auto-generate human-readable titles for chats from their first user message (and fall back gracefully when raw placeholders leak through), so users can actually distinguish 6 simultaneous `New Task` rows.
2. **Sidebar density and interaction (P1)** — Lower the visual weight of workspace headers, stop replacing meta info on hover, fold `Add Agent` into the hover action area, preserve per-workspace status awareness in the collapsed (52px) mode, and disambiguate the in-sidebar filter from the global ⌘K command palette.

The change is scoped to `web/components/workspace/TaskSidebar.tsx`, `web/components/workspace/TaskSessionList.tsx`, `web/components/workspace/TaskSessionRows.tsx`, the chat store (`server/stores/chatStore.ts` or equivalent) for title backfill, and the chat-creation server path.

## What Changes

Two thrusts, scoped to the sidebar surface only:

1. **Task naming (P0)** — Server-side auto-derived chat titles (from the first user message), one-time backfill for historical chats, lock flag (`title_is_derived`) to protect explicit user renames, render-time fallback (`Untitled task`) for known internal placeholders so strings like `<local-command-caveat-stdin>` never reach the UI.
2. **Sidebar density and interaction (P1)** — Soften workspace group headers into separators (small uppercase muted type), stop replacing meta info on hover (opacity layering instead of `display` toggle), fold `Add Agent` into the hover action group instead of a dedicated row, give the collapsed (52px) sidebar a per-workspace status strip so workload awareness survives the collapse, and rename the in-sidebar input from *Search* to *Filter* so it is clearly distinct from the global ⌘K command palette.

## Why

A UX review on 2026-05-24 surfaced concrete defects against the immersive-overview product intent (recorded in `memory/project_sidebar_design_intent.md`):

- **Identical titles**: 6 of the 10 visible task rows are literally `New Task`, so the sidebar cannot fulfil its primary purpose of "find the task I want to return to." Users currently rely on remembering open-order, which violates the product's "attention-first" principle.
- **Raw placeholder leakage**: A chat titled `<local-command-caveat...>` is rendered as-is, signalling a trust-eroding data quality problem.
- **Hover replaces information**: Hovering a task row replaces the timestamp (`4m`) with action buttons (`+ pin archive`). The user often hovers *because* they want to read the timestamp.
- **Collapsed mode is opaque**: The 52px collapsed sidebar shows only the New Task button and bottom resource icons. All workload signal — running counts, error counts per workspace — disappears. This contradicts the immersive-overview intent.
- **Workspace headers carry too much weight**: In a cross-workspace overview, multiple workspace headers stay on screen permanently. Their current `font-semibold` styling fragments the task list rather than acting as a soft separator.
- **`Add Agent` row competes with real agents**: Each expanded task pads its agent list with a full-width `+ Add Agent` row at the same visual weight as a real agent.
- **Double search entry points**: The `/` sidebar filter and the ⌘K command palette both call themselves "search," with different scopes and behaviors, creating an unclear mental model for new users.

## Goals

- **G1**: Every chat row shows a distinguishable, human-readable title within 1 second of the first user message landing.
- **G2**: Pre-existing chats with placeholder titles get a one-time backfill so historical rows are also readable.
- **G3**: Raw placeholder strings (matching `<local-command-caveat...>` and similar internal markers) are filtered or replaced with a friendly fallback.
- **G4**: Workspace headers visually behave as soft separators rather than primary blocks; the active workspace remains visually anchored.
- **G5**: Hovering a task row reveals action buttons *in addition to* — not in place of — existing meta info (timestamp, count).
- **G6**: `Add Agent` is no longer a standalone row; it surfaces as the existing hover action area on the task row.
- **G7**: Collapsed sidebar shows a compact per-workspace status strip (running / awaiting / error counts) so workload awareness survives the collapse.
- **G8**: Sidebar's in-list filter is renamed and visually scoped so it is clearly distinct from the global ⌘K command palette.

## Non-Goals

- Changing the workspace grouping model itself (the sidebar still lists every workspace; the URL stays a shareable pointer, not a filter).
- Replacing the ⌘K command palette or its keybinding.
- Touching the right-side IDE panel, toolbar, or chat pane.
- Multi-workspace selection / batch operations on tasks.
- Onboarding flows or empty-state illustrations.
- Removing the per-workspace count badge (it carries real "workload at a glance" signal under the immersive-overview intent).

## Approach

### Task naming

- Add a `derivedTitle` derivation at the store layer: when a chat's `title` is empty/placeholder, derive from the first user message (truncate to ~40 chars on a word boundary; strip code-block fences and leading `/` slash-commands).
- One-time migration in `server/stores/migrations/` rewrites historical rows with placeholder titles to their derived titles where possible.
- Add a render-time guard in `TaskRow` / `ExternalSessionRow` that catches strings starting with `<local-command-` (or matching the known placeholder set) and substitutes a friendly fallback like `Untitled task`.

### Sidebar density and interaction

- Soften workspace header typography: drop `font-semibold` → regular weight with `uppercase tracking-wide text-[10px]` in muted color, with an opacity bump for `isCurrent`.
- Refactor hover action area so meta (timestamp, count badge) stays visible and action buttons (`+ pin archive`) layer above with an `opacity-0 group-hover:opacity-100` shift — no layout shift, no information loss (also satisfies the global "hover layout shift detection" rule in CLAUDE.md).
- Remove the dedicated `Add Agent` row. Add a `+` button to the task-row hover action group (alongside pin / archive).
- Collapsed sidebar gains a status strip: one row per workspace with a workspace glyph + 1-3 colored dots reflecting per-workspace counts (running / awaiting / error). Clicking a dot scrolls to and reveals that workspace when re-expanded.
- Rename the in-sidebar `Search tasks` field to `Filter` (input placeholder + aria-label + tooltip). The keybinding stays `/`.

## Risks

- **Title backfill cost**: A single SQL UPDATE over a `chats` table touching every placeholder row could be slow on large databases. Mitigation: scope migration to rows where `title IS NULL OR title = 'New Task'`, batch in chunks of 500.
- **Derived title quality**: Short / non-Latin / emoji first messages may produce poor titles. Mitigation: keep `Untitled task` fallback when derivation yields fewer than 3 visible characters.
- **Collapsed-mode density**: A workspace with many active jobs could push more than 1 dot, risking horizontal overflow at 52px. Mitigation: max 3 dots, cap with `+N` indicator at 4th.
- **Loss of the visible `+ Add Agent` affordance**: Discoverability drops for first-time users. Mitigation: surface "Add agent" as the first item in the empty-team state inside the task overview pane, so the affordance is not exclusive to the hover area.

## Affected Code

- `web/components/workspace/TaskSidebar.tsx` — collapsed-mode status strip, search → filter rename.
- `web/components/workspace/TaskSessionList.tsx` — workspace header typography downgrade.
- `web/components/workspace/TaskSessionRows.tsx` — hover layering (opacity instead of replacement), Add Agent button in hover group, placeholder filtering.
- `web/components/workspace/ExternalSessionRow.tsx` — same placeholder filtering.
- `server/stores/chatStore.ts` (or equivalent) — `derivedTitle` accessor, write-path that auto-fills `title` on first user message.
- `server/stores/migrations/<next-version>__backfill-chat-titles.sql` — one-time backfill.
- `shared/ws-types.ts` — extend `Chat` shape with `derivedTitle` if the derivation runs server-side.
