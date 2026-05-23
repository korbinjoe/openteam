# Tasks — External Session Adoption

## Phase 1 — Schema & Backend Foundation

- [x] 1.1 Migration `v21.ts` — create `external_dir_index` table + indexes
- [x] 1.2 Migration `v21.ts` — create `external_session_index` table + indexes
- [x] 1.3 Migration `v21.ts` — `chats.source NOT NULL DEFAULT 'native'`, `chats.external_cwd` (idempotency comes from `idx_esi_session`, not chats)
- [x] 1.4 Update `server/stores/chats.ts` types and CRUD for new columns
- [x] 1.5 Add `external_session_scan.enabled` setting (default true)

## Phase 2 — Tier 1 Directory Enumeration

- [x] 2.1 Create `server/services/DirectoryEnumerator.ts` skeleton
- [x] 2.2 Implement Claude path: project-key-to-cwd reverse + readdir + stat aggregate
- [x] 2.3 Implement `readFirstLine(path, cap)` utility (single read, hard byte cap)
- [x] 2.4 Implement Codex path: walk YYYY/MM/DD, line-1 parse, group by cwd
- [x] 2.5 mtime-cursor warm scan: skip codex files unchanged since last_scanned
- [x] 2.6 Upsert `external_dir_index` rows (per-cwd aggregate)
- [x] 2.7 Hook enumerator kickoff into `AsyncBoot.ts` post-listen `setImmediate`, gated on `isExternalScanEnabled()`
- [x] 2.8 chokidar watcher on `~/.claude/projects/` and `~/.codex/sessions/` (depth 2, debounced 500 ms)
- [x] 2.9 Broadcast WS `external-dirs:ready` after enumeration
- [x] 2.10 Broadcast WS `external-dirs:changed` on watcher events (provider list in payload)
- [ ] 2.11 Unit tests: projectKeyToCwd round-trip, readFirstLine cap behavior, codex meta parse
- [ ] 2.12 Perf test: cold enumeration on 3,578-file fixture < 200 ms total, < 100 ms longest event-loop block

## Phase 3 — Tier 2 Lazy Session Listing

- [x] 3.1 Create `server/services/scanner/SessionPager.ts` — paginated header parsing per cwd
- [x] 3.2 Implement `parseClaudeHeader` / `parseCodexHeader` — 8 KB cap, extract first user message
- [x] 3.3 Cache layer: check `(file_mtime, size)` against `external_session_index` before re-parse
- [x] 3.4 Mtime keyset pagination query (DESC, limit+1 to detect hasMore)
- [x] 3.5 Filter out adopted sessions (`adopted_chat_id IS NOT NULL`) from response

## Phase 4 — API

- [x] 4.1 `GET /api/sidebar/groups` — workspaces + unmatched dirs (tier 1 only)
- [x] 4.2 `GET /api/external-cwds/:cwd/sessions?cursor=&limit=` — paginated tier 2
- [x] 4.3 `POST /api/external-sessions/:id/adopt` — idempotent, decrement dir count
- [x] 4.4 `POST /api/external-cwds/hide` (+ /unhide) — toggle hidden flag
- [x] 4.5 Adoption matches cwd → workspace via repository path prefix; auto-creates a workspace when no match (chats schema requires NOT NULL workspace_id)

## Phase 5 — Frontend (unified-list refactor, "Plan B")

Pivoted away from a separate "Local Sessions" sub-section: every workspace
group now interleaves native chats with un-adopted external rows in one
mtime-DESC list. Cross-cwd merge happens server-side via
`GET /api/workspaces/:id/external-sessions` (SessionPager.listForCwds).

- [x] 5.1 New hook `useExternalCwds` — top-level dir aggregates (Tier 1)
- [x] 5.2 New hook `useExternalCwdSessions(cwd, enabled)` — lazy paginated per-cwd (Tier 2)
- [x] 5.2a New hook `useWorkspaceExternalSessions(wsId, enabled)` — workspace-scoped unified feed
- [x] 5.3 Subscribe to `external-dirs:ready` / `external-dirs:changed` for refetch
- [x] 5.4 `ExternalSessionRow` component — shape-mirrors TaskRow (chevron slot + dot + title + provider badge + age)
- [x] 5.5 "Load more" button (20/page) at end of any list with `hasMore`
- [x] 5.6 `WorkspaceGroup` (cross-ws mode) + `UnifiedSessionList` interleave (single-ws mode)
- [x] 5.6b Unmatched-cwd groups (`ExternalCwdGroup`): collapsed-by-default per session, not persisted
- [x] 5.7 Click on `ExternalSessionRow` → adopt → navigate to chat
- [x] 5.8 `ProviderBadge` (claude=purple / codex=green)
- [ ] 5.9 Per-cwd hide affordance + restore in settings page (deferred)
- [ ] 5.10 `react-virtual` when expanded list > 50 rows (deferred; current expansion limited by pagination)
- [ ] 5.11 Settings UI: toggle for `external_session_scan.enabled` (deferred)

## Phase 6 — Resume Path Verification

- [x] 6.1 `ExpertResumeHandler` already handles adopted chats — it only reads `chats.expertSessions[*].{cliSessionId, provider, cwd}`; nothing gates on `source === 'external'`. Adoption writes the exact shape resume expects.
- [x] 6.2 Claude path: adoption stores `cliSessionId = <jsonl basename>` (UUID); `readMessagesFromJsonl` builds `~/.claude/projects/<cwdToClaudeProjectKey(cwd)>/<cliSessionId>.jsonl` — matches scanner discovery.
- [x] 6.3 Codex path: adoption stores `cliSessionId = <threadId UUID>` (captured by `CODEX_ROLLOUT_RE`); `findRolloutInDir` matches via `endsWith('-${threadId}.jsonl')` across 7-day fast path then full-tree fallback.
- [ ] 6.4 cwd-no-longer-exists handling: pre-existing behavior surfaces `expert:resume-failed` reason `cwd_not_found`; replay-from-jsonl could in principle work without cwd existing but currently doesn't fall back. Deferred.

## Phase 7 — Verification & Polish

- [ ] 7.1 Cold-boot perf check on dev machine: sidebar paint ≤ +30 ms
- [ ] 7.2 Directory expand perf: first 20 sessions ≤ 250 ms cold, ≤ 50 ms warm
- [ ] 7.3 Memory check: in-memory state ≤ 2 MB at rest (no expansions)
- [ ] 7.4 Manual QA: 4-scenario xterm checklist (initial / refresh / resize / history resume) on adopted external chat
- [ ] 7.5 Verify unique index prevents duplicate adoption
- [ ] 7.6 Verify scanner survives `~/.claude/projects` not existing
- [ ] 7.7 Verify scanner survives one corrupt file without crashing the batch
- [ ] 7.8 Update `openspec/specs/` with finalized spec deltas
- [ ] 7.9 Write `review.md` after self-review

## Phase 8 — Out-of-Scope Tracking

- [ ] 8.1 File follow-up: search-in-external-sessions (Cmd-K coverage)
- [ ] 8.2 File follow-up: auto-suggest workspace creation from heavy external cwds
- [ ] 8.3 File follow-up: bulk adopt operations
