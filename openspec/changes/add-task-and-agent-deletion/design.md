# Design: Task and Agent-session hard delete

## Problem framing

JSONL files are the single source of truth for conversation messages (project rule, see `CLAUDE.md`). Deleting a task in the UI today drops the SQLite row but the message file the chat referenced through `expertSessions[agentId].cliSessionId` lingers indefinitely. Conversely, the JSONL on disk has no row, so on next adoption pass it could be re-discovered as an "external" chat — confusing recoverable state for the user.

We need symmetric deletion: when a record is gone, its JSONL goes too.

## Architecture overview

```
┌──────────────────────────┐         ┌─────────────────────────────┐
│ ChatHistoryPage          │  HTTP   │ chatRoutes.ts               │
│  - confirm dialog        │ ──────▶ │  DELETE /api/chats/:id      │
│  - "purge files" toggle  │ ?purge  │   ├ remove worktrees        │
└──────────────────────────┘         │   ├ purge JSONLs (new)      │
                                     │   └ chatStore.remove        │
┌──────────────────────────┐         │                             │
│ TaskSessionRows (sidebar)│  HTTP   │  DELETE /api/chats/:id/     │
│  - per-agent row menu    │ ──────▶ │     sessions/:agentId (new) │
└──────────────────────────┘         │   ├ purge that one JSONL    │
                                     │   └ chatStore.update        │
                                     └─────────────────────────────┘
                                                 │
                                                 ▼
                                     ┌─────────────────────────────┐
                                     │ sessionFilePurger.ts (new)  │
                                     │  resolveJsonlPath(session)  │
                                     │   ├ claude → projectKey     │
                                     │   └ codex  → locateRollout  │
                                     │  unlinkSafe(path)           │
                                     │   path-prefix guard         │
                                     └─────────────────────────────┘
```

## Data model

No schema migration. We mutate `chat.expertSessions: Record<agentId, ExpertSessionInfo>` (already JSON-serialized in the `chats` SQLite row) by deleting an entry. JSONL files exist outside the database and are touched only via the purger.

## Key decisions

### Decision 1: `purgeJsonl` is a query flag, not a separate endpoint

**Why:** Keeps the public API surface stable. Older API consumers calling `DELETE /api/chats/:id` keep their current semantics (no JSONL purge). The new UI sets `?purgeJsonl=1` explicitly.

**Alternatives considered:**
- Make purge the new default. Rejected: silently widening blast radius of an existing endpoint is the kind of "free upgrade" that bites users who've scripted against it.
- Separate endpoint `DELETE /api/chats/:id/full`. Rejected: two endpoints diverge over time; the flag keeps logic in one place.

**How to apply:** Web UI always sends `?purgeJsonl=1`. CLI / scripts need to opt in.

### Decision 2: Per-agent endpoint is its own route, not a query mode of chat delete

**Why:** Different blast radius (one session vs entire chat), different status guard (this chat must NOT be currently delegating to that agent), different return shape (updated chat row vs a deletion ack). Folding both into one endpoint hides those rules.

**How to apply:** `DELETE /api/chats/:id/sessions/:agentId`. Returns `{ chat: Chat, purged: { path, deleted } }`.

### Decision 3: Best-effort, not transactional

**Why:** A `unlink` failure (file already gone, permissions, race with another process) should not block record deletion. The user's mental model is "delete this thing"; if the bookkeeping side happens but a stale file lingers, that's recoverable. The reverse (record deleted, file deletion fails because we tried to make it transactional and rolled back the row) is worse — user sees the record still there and tries again.

**How to apply:** Aggregate per-file results into `purged: Array<{ agentId, path, deleted, error? }>` and return alongside success. Frontend surfaces a toast if any entry has `deleted: false && error`.

### Decision 4: Path-prefix guard at the purger boundary

**Why:** Defense in depth. The path resolution today uses `cwdToClaudeProjectKey(session.cwd)`; if `session.cwd` were ever set to `..` or a crafted path, the result could escape the home directory. We never want a delete-a-chat operation to touch anything outside `~/.claude/projects/` or `~/.codex/sessions/`.

**How to apply:** Before `unlink`, normalize and require `path.startsWith(homedir() + '/.claude/projects/')` or `path.startsWith(homedir() + '/.codex/sessions/')`. Reject symlinks via `fs.lstat`.

### Decision 5: Refuse delete on running sessions

**Why:** Deleting the JSONL of a session that the CLI is actively appending to could corrupt in-flight work. A guard requiring `chat.status !== 'running'` for full-task delete and `member.status !== 'running'` for per-agent delete keeps the user from shooting themselves in the foot. The current `DELETE /api/chats/:id` has no such guard — we add it as part of this change but only when `purgeJsonl=1` is set, to avoid breaking pre-existing scripts.

**How to apply:** Status check inside the route handler; 409 Conflict with explanatory body if violated.

## Resolution path (Claude)

```
session.cwd           = "/Users/joebon/work/openteam"
session.cliSessionId  = "abc123-..."
projectKey            = cwdToClaudeProjectKey(cwd)  // "-Users-joebon-work-openteam"
absPath               = ~/.claude/projects/<projectKey>/<cliSessionId>.jsonl
```

## Resolution path (Codex)

```
session.cliSessionId  = "<threadId>" (UUID)
absPath               = locateCodexRollout(threadId)  // walks ~/.codex/sessions tree
                                                       // returns null if not found
```

`locateCodexRollout` already exists at `server/terminal/CodexRolloutLocator.ts`; we just call it.

## Frontend wiring

- `ChatHistoryPage.tsx`:
  - Confirm dialog body line: `Also delete {n} local CLI session files (cannot be undone)`. `n` = `Object.keys(chat.expertSessions ?? {}).length`.
  - Fetch sends `?purgeJsonl=1`.
  - Toast on partial purge failure listing the paths.

- `TaskSessionRows.tsx`:
  - Agent row hover-actions gain a "Remove from task" trash icon (disabled if `agentId === chat.primaryAgentId` or `member.status === 'running'`).
  - On click, call `removeAgentFromChat(chatId, agentId)` → on success, optimistic update of `chat.members` / `chat.expertSessions`.

- `web/services/chatService.ts` (new or extended): `removeAgentFromChat`, `deleteChatWithJsonl`.

## Test plan

- Unit: `sessionFilePurger` against tmpdir-rooted Claude + Codex layouts, including the path-traversal attempt.
- Integration: `DELETE /api/chats/:id?purgeJsonl=1` with a chat that has 2 expert sessions, one Claude one Codex; assert both files unlinked and chat row gone.
- Integration: `DELETE /api/chats/:id/sessions/:agentId` mutates `expertSessions` and removes that one file.
- Integration: 409 on running chat full-delete with purge.
- Integration: 200 on already-missing JSONL (idempotent).
- UI: ChatHistoryPage confirm shows the file count, toast on partial failure.
- UI: Sidebar per-agent remove disabled for primary, action wired for non-primary.
