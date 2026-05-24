# Tasks: Hard-delete tasks and agent sessions with their JSONL files

## Phase 1: Server — purger and routes

- [x] 1.1 Create `server/services/sessionFilePurger.ts` exporting `resolveExpertSessionJsonl(session: ExpertSessionInfo)` and `purgeExpertSessionJsonl(session: ExpertSessionInfo)` (with path-prefix guard + symlink reject).
- [x] 1.2 Extend `DELETE /api/chats/:id` in `server/routes/chat/chatRoutes.ts` to accept `?purgeJsonl=1`. When set, iterate `expertSessions`, call the purger per session, return `{ success, purged: [...] }`. Reject (409) if `chat.status === 'running'`.
- [x] 1.3 Add `DELETE /api/chats/:id/sessions/:agentId` route. Validates chat + session exist, refuses on running member, calls purger, removes the agent key from `expertSessions`, persists via `chatStore.update`, returns `{ chat, purged }`.
- [x] 1.4 Add structured logs (provider, chatId, agentId, path, outcome) for every purge attempt.

## Phase 2: Server — tests

- [x] 2.1 Unit test `sessionFilePurger`: Claude file resolved + unlinked; Codex file resolved via `locateCodexRollout` + unlinked; missing file returns `deleted: false, error: null`; path traversal attempt rejected.
- [x] 2.2 Integration test `DELETE /api/chats/:id?purgeJsonl=1` against a tmpdir-rooted fixture with one Claude + one Codex session.
- [x] 2.3 Integration test `DELETE /api/chats/:id/sessions/:agentId` — chat row updated, file removed, idempotent on re-call.
- [x] 2.4 Integration test 409 on running-chat full delete.

## Phase 3: Frontend — services + UI

- [x] 3.1 Add `deleteChatWithJsonl(chatId)` and `removeAgentFromChat(chatId, agentId)` helpers in `web/services/chatService.ts`.
- [x] 3.2 Update `web/pages/ChatHistoryPage.tsx` confirm dialog body to surface JSONL count; pass `?purgeJsonl=1` on the DELETE; warn on partial failure listing paths.
- [x] 3.3 Update `web/components/workspace/TaskSessionRows.tsx`: per-agent row hover Trash button, disabled for `primaryAgentId` and for `member.status === 'running'`. Wire to `removeAgentFromChat`.
- [x] 3.4 After per-agent remove succeeds, dispatch `openteam:chat-updated` so `useAllChats` refreshes the sidebar.

## Phase 4: Verification

- [x] 4.1 Run `tsc --noEmit` on server and web — server only produces pre-existing errors (unrelated files); web passes clean. New files (`sessionFilePurger.ts`, `chatService.ts`, `chatRoutes.ts` edits, `TaskSessionRows.tsx` edits, `ChatHistoryPage.tsx` edits, `icons.tsx`) introduce zero new errors.
- [ ] 4.2 Manual smoke: create a chat with 2 agents (Claude + Codex), delete via UI with purge — confirm both `.jsonl` files gone from `~/.claude/projects/...` and `~/.codex/sessions/...`.
- [ ] 4.3 Manual smoke: per-agent remove from sidebar — confirm only that agent's file gone; chat sidebar updates; primary agent button disabled.
- [x] 4.4 Run `openspec validate add-task-and-agent-deletion --strict` clean.

## Dependencies

- Phase 2 depends on Phase 1.
- Phase 3 can start in parallel with Phase 2 once Phase 1 is merged.
- Phase 4 depends on Phases 1–3.

## Notes

- 4.2 and 4.3 require a live dev environment with both Claude Code and Codex CLI sessions — left for the user to verify on their machine.
- Manual confirmation (`window.confirm`) is used for the per-agent remove since the workspace sidebar has no toast / dialog primitive yet.
- Console warnings replace toast notifications for partial purge failures pending a project-wide toast utility.
