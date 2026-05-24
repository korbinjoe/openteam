# Tasks: Refine Sidebar as Immersive Cross-Workspace Overview

## Phase 1: Shared title derivation

- [ ] **Create `shared/deriveTitle.ts`** — Pure function `deriveTitle(rawFirstMessage: string | null): string` implementing the 6 rules from `design.md` (strip slash-commands, strip code, collapse whitespace, trim punctuation, truncate to 40 visible chars, fallback `Untitled task`). Export a companion `isPlaceholderTitle(title: string | null): boolean` that matches `null`, `''`, `'New Task'`, and `/^<local-command-[\w-]*>/`.
- [ ] **Unit tests for `deriveTitle`** — Cover: slash-command stripped, code-fence stripped, CJK char counting, 40-char truncation on word boundary with `…` suffix, fewer-than-3-visible-chars fallback, null/empty fallback.

## Phase 2: Server-side title write-back

- [ ] **Add `title_is_derived` column to `chats`** — New migration `server/stores/migrations/<next>__chat-title-is-derived.sql` adding `title_is_derived INTEGER NOT NULL DEFAULT 1` and locking (`= 0`) any row whose `title` is non-placeholder.
- [ ] **Backfill script** — `server/scripts/backfillChatTitles.ts` reading each derived-flag row's primary CLI session JSONL, calling `deriveTitle`, and updating `chats.title` in 500-row transactions. Idempotent (safe to re-run).
- [ ] **Hook first-user-message → title write** — In the chat-session ingest path that observes the first `user` JSONL line for a chat, if `title_is_derived = 1`, write `deriveTitle(message)` back and bump `updatedAt`.
- [ ] **Lock title on user rename** — In the existing rename path (find via `rg "rename" server/`), set `title_is_derived = 0` whenever the user explicitly sets `title`.
- [ ] **Server tests** — Migration upgrades and downgrades cleanly; backfill produces expected titles on a fixture DB; rename path flips the lock flag.

## Phase 3: Client render guard

- [ ] **Create `web/utils/safeTitle.ts`** — Thin wrapper around `isPlaceholderTitle` from `shared/deriveTitle.ts` returning `Untitled task` for placeholders, otherwise the input.
- [ ] **Route `TaskRow` display name through `safeTitle`** — In `web/components/workspace/TaskSessionRows.tsx`, replace direct `chat.title` reads with `safeTitle(chat.title)`. Keep raw `chat.title` for `aria-label` so screen readers still get the canonical id.
- [ ] **Route `ExternalSessionRow` display name through `safeTitle`** — Same treatment in `web/components/workspace/ExternalSessionRow.tsx` for `session.firstUserMessage` / fallback to `session.sessionId`.

## Phase 4: Workspace header visual downgrade

- [ ] **Soften workspace group header** — In `TaskSessionList.tsx` `WorkspaceGroup`, change the header label to `text-[10px] uppercase tracking-wide font-normal text-text-muted`. Apply `text-text-secondary` when `isCurrent`. Drop the `FolderGit` icon color shift (no longer needed when text shift carries the signal).
- [ ] **Verify multi-workspace render** — Manually inspect at 1440×900 with ≥3 workspaces visible; confirm the headers read as soft separators rather than competing primary blocks.

## Phase 5: Hover action layering

- [ ] **Refactor `TaskRow` hover region** — In `TaskSessionRows.tsx`, restructure the right-side region so meta (timestamp + count badge) is always rendered at `opacity-100` and the action group (`+ pin archive`) is layered via `absolute right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100` over a subtle gradient mask. Same for `CompletedRow` and `ExternalSessionRow` where applicable.
- [ ] **Add `+` (Add agent) button into the hover action group** — Replace the dedicated `+ Add Agent` indented row with a button in the same group as pin / archive. Tooltip `Add agent`. Wire to existing `onAddAgent` callback.
- [ ] **Delete the standalone `+ Add Agent` row from `TaskRow`'s expanded agent list** — Verify the empty-team state in the task overview pane still surfaces an `Add agent` CTA (the discoverability fallback). If absent, add it.
- [ ] **Manual visual check** — Confirm hovering a row no longer hides the timestamp; action buttons appear and disappear without horizontal jitter; tab order is preserved.

## Phase 6: Collapsed-mode workspace status strip

- [ ] **Create `CollapsedWorkspaceStrip` component** — File `web/components/workspace/CollapsedWorkspaceStrip.tsx`. Renders up to 5 workspace rows (28px each) sorted by `hasError desc, running desc, recent desc`. Each row: workspace glyph (first char of name, color shift on `isCurrent`) + up to 3 status dots (priority error > awaiting > running) + optional `+N` chip. Overflow indicator `+N more` if total > 5.
- [ ] **Wire into collapsed `TaskSidebar`** — Insert between the New Task button and the spacer in the collapsed branch of `TaskSidebar.tsx`. Click on a workspace row triggers `togglePanel()` + scrolls that workspace group into view (use `scrollIntoView` with the workspace group's ref).
- [ ] **Status-counts derivation** — Add a `useWorkspaceStatusCounts` hook (or extend `useAllChats`) returning `{ wsId, hasError, awaiting, running, recentMs }[]` for all visible workspaces.
- [ ] **Manual check at 1440×900 in collapsed mode** — Verify dots reflect real states across 3+ workspaces; click on a workspace row re-expands and scrolls correctly.

## Phase 7: Filter vs Search disambiguation

- [ ] **Rename in-sidebar search to "Filter"** — In `TaskSidebar.tsx`, change placeholder to `Filter tasks…`, aria-label to `Filter tasks in sidebar`, button tooltip to `Filter sidebar (/)`. Keep `/` keybinding and the magnifying-glass icon.
- [ ] **Verify ⌘K palette wording unchanged** — Confirm `CommandPalette.tsx` still calls itself Search / Command Palette; no rename there.

## Phase 8: Validation & shipping

- [ ] **Run `openspec validate refine-sidebar-immersive-overview --strict`** and resolve issues.
- [ ] **Visual regression** — Take 1440×900 screenshots in 4 states: default, hover, collapsed, with filter active. Diff against pre-change reference; ensure no unintended changes outside the sidebar.
- [ ] **CLAUDE.md compliance self-check** — Confirm no Tailwind arbitrary px values introduced, no hardcoded colors, no `hidden group-hover:flex` patterns added, no files > 500 lines as a result of refactors.
- [ ] **Update `web/components/workspace/CLAUDE.md` if present** — Note the new title-derivation rule (always render via `safeTitle`).
- [ ] **Manual smoke** — Create a new chat; confirm title updates within 1s of the first user message; rename the title; confirm the next message does not overwrite it.
