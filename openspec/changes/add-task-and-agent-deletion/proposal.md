# Proposal: Hard-delete tasks and agent sessions with their JSONL files

## Summary

Extend the existing chat-deletion path so a user can fully purge a task (chat) — including the local CLI JSONL files for every expert session it owns — and add a finer-grained "remove single agent from a task" operation that nukes that one agent's expert session and its JSONL. Today the records survive but the JSONL files keep accumulating in `~/.claude/projects/...` and `~/.codex/sessions/...`.

## Motivation

In pulse-mode usage the user creates many short-lived tasks per day and rotates agents in/out of them. Two pain points compound:

1. Deleting a chat from `ChatHistoryPage` removes the SQLite row but leaves dozens of JSONL files behind. Disk usage grows monotonically; users who try to reclaim space have to hand-delete files across two CLI tools' opaque directory layouts.
2. There is no way to drop a single misfiring agent from a task — the only escape today is to delete the whole chat. That collides with the "trust recoverable, blast-radius small" principle: a single bad expert pollutes the task and there is no clean recovery short of nuking the lot.

## Goals

1. **Task hard-delete** — `DELETE /api/chats/:id?purgeJsonl=true` removes the chat record, its worktrees (existing behavior), AND every JSONL referenced by its `expertSessions` map.
2. **Per-agent session removal** — new `DELETE /api/chats/:id/sessions/:agentId` removes one entry from `chat.expertSessions` and unlinks that one JSONL.
3. **Cross-provider** — both Claude (`~/.claude/projects/<key>/<id>.jsonl`) and Codex (`~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`) JSONLs are handled.
4. **Best-effort cleanup** — a missing JSONL file is not an error; the record deletion still succeeds. Failures are logged with the file path so the user can clean up manually if needed.
5. **Confirmation UI** — destructive nature surfaced in the dialog ("This will also delete N local CLI session files").

## Non-Goals

- Trash / recycle-bin semantics. JSONL deletion is hard `unlink`; recoverability is out of scope.
- Deleting the global agent definition (`DELETE /api/agents/:id`) does **not** change behavior — it does not now and will not retroactively scan for cross-chat JSONLs to delete. Agent-level cleanup in this proposal is strictly chat-scoped.
- A bulk cleanup tool ("nuke every JSONL not referenced by any chat") — separate orphan-reaper concern, not blocking this change.
- Migrating the SOT off JSONL — the project rule keeps JSONL as the single source of truth for messages; we just delete on the user's command.

## Approach

### Server

- New helper `server/services/sessionFilePurger.ts` exporting `purgeExpertSessionJsonl(session: ExpertSessionInfo): Promise<{ deleted: boolean; path: string | null; error?: string }>`. Resolves the JSONL path the same way `chatRoutes.ts` already does (Claude via `cwdToClaudeProjectKey`; Codex via `locateCodexRollout`), then `unlink` it. Missing file → `deleted: false, error: null`.
- `DELETE /api/chats/:id` accepts `?purgeJsonl=1` (default ON for new clients; opt-out for backwards compatibility). When set, iterates `chat.expertSessions` and calls the purger per session. Aggregated result included in the JSON response so the UI can show "deleted N JSONL files".
- New `DELETE /api/chats/:id/sessions/:agentId`:
  - 404 if chat or expert session missing.
  - Calls the purger for that one session.
  - Mutates `chat.expertSessions` to drop the agent key, persists via `chatStore.update`.
  - Returns updated chat row + purge result.
- All file operations clamped to `homedir() + '/.claude'` and `homedir() + '/.codex'` prefixes — defense-in-depth path validation before any `unlink`.

### Web

- `ChatHistoryPage` confirm dialog gains a "Also delete N local CLI session files" line; passes `purgeJsonl=1` on the DELETE.
- `TaskSessionRows` (sidebar) — agent rows expose a context-menu / hover-action "Remove from task" that calls the new per-agent endpoint. After success, the chat row re-fetches; if the removed agent was `primaryAgentId` we surface a non-blocking toast warning (UI prevents the click in that case).
- Single new service helper `removeAgentFromChat(chatId, agentId)` in `web/services/`.

### Safety

- Path-prefix guard in the purger; never follow symlinks (`fs.lstat` + reject).
- Per-call structured logs (chat id, agent id, provider, resolved path, outcome) for auditing.
- All deletions are idempotent — re-issuing on an already-deleted resource still 200s with a no-op result.

## Risks

| Risk | Mitigation |
|------|-----------|
| Wrong file deleted (path resolution bug) | Strict path-prefix check + provider-specific resolver reused from existing `chatRoutes.ts`/`CodexRolloutLocator.ts` (no new path math). |
| User accidentally nukes an in-flight session | Refuse per-agent delete when that session is currently `running` per `MemberAggregator`; require chat to be `stopped`/`idle` for full task delete (today's behavior plus this guard). |
| Codex daily-folder scan misses on old sessions | `locateCodexRollout` already walks the entire sessions tree as a fallback. Reuse as-is. |
| Frontend deletes primary agent and breaks the chat | Disable the per-agent remove for `primaryAgentId` in UI; backend still allows it (advanced/CLI use) but logs a warning. |
| Breaking external API consumers of `DELETE /api/chats/:id` | New behavior is gated behind `purgeJsonl` query flag; default keeps current semantics for the legacy endpoint. UI passes the flag explicitly. |
