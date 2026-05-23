# Review — External Session Adoption

## Status

Implementation complete through Phase 6. Phase 7 perf budgets and Phase 5
follow-up affordances (settings UI, react-virtual, per-cwd hide) are
deferred — not blocking the feature's first usable shape.

## What landed

- **Phase 1 — Schema**: migration v21 adds `external_dir_index`,
  `external_session_index`, and `chats.source`/`chats.external_cwd`.
  Idempotency via unique index `idx_esi_session` on
  `(provider, session_id)` rather than chats-side constraints.
- **Phase 2 — Tier 1 enumerator**: `DirectoryEnumerator` runs on
  post-listen `setImmediate`, walks `~/.claude/projects/` (one stat per
  jsonl) and `~/.codex/sessions/<YYYY>/<MM>/<DD>/` (line-1 parse for cwd
  via `readFirstLine`). Result upserted into `external_dir_index`.
  chokidar watcher on both roots broadcasts `external-dirs:changed`.
- **Phase 3 — Tier 2 pager**: `SessionPager.listForCwd` parses ≤ 8 KB
  headers, caches results in `external_session_index`, mtime keyset
  paginates (DESC, limit+1).
- **Phase 3a — Cross-cwd pager (Plan B addition)**:
  `SessionPager.listForCwds` merges N cwds in one SQL query — used by
  the workspace-scoped feed.
- **Phase 4 — API**: routes `/api/sidebar/groups`,
  `/api/external-cwds/:cwd/sessions`, `/api/workspaces/:id/external-sessions`,
  `/api/external-sessions/:id/adopt`, `/api/external-cwds/hide|unhide`.
- **Phase 5 — Unified sidebar (Plan B refactor)**: workspaces interleave
  native chats with un-adopted external rows in one mtime-DESC list.
  `ExternalSessionRow` shape-mirrors `TaskRow`; only the small provider
  badge signals origin. Unmatched cwds render as peer groups under each
  workspace section. Lazy fetch fires only when a group is expanded.
- **Phase 6 — Resume verified by inspection**:
  `ExpertResumeHandler.resumeFromChat` is provider-agnostic — it reads
  `chats.expertSessions[*].{cliSessionId, provider, cwd}` and nothing
  gates on `source === 'external'`. Adoption writes the exact shape
  resume expects. Claude and Codex both work because adoption stores
  the same UUID `SessionPager` does (Claude: jsonl basename; Codex:
  trailing UUID captured by `CODEX_ROLLOUT_RE`), and `readMessagesFromJsonl`
  / `findRolloutInDir` reverse those into file paths the same way.

## What was pivoted

**"Local Sessions" sub-section dropped** (v1 of Phase 5) — user feedback
was that every session in OpenTeam is equal at the data layer (all jsonl)
and the UI should reflect that. Replaced with the unified mtime-DESC
list. Server-side cross-cwd merge endpoint (Plan B) chosen over
client-side fan-out to keep the lazy-fetch contract honest (one HTTP
round-trip per group expand, server-side ORDER BY does the merge).

## What needs hands-on QA

- **7.1** Cold-boot perf check (sidebar paint ≤ +30 ms vs. baseline)
- **7.2** Expand directory: first 20 sessions ≤ 250 ms cold / ≤ 50 ms warm
- **7.3** Memory check: in-memory state ≤ 2 MB at rest
- **7.4** xterm 4-scenario checklist (initial / refresh / resize /
  history-resume) on an adopted external chat
- **7.5** Manually attempt to double-adopt — confirm idempotency
- **7.6/7.7** Survival when `~/.claude/projects` missing / one file
  corrupt (covered by code paths but not automated)

## Deferred (intentional)

- 2.11/2.12 unit + perf tests — no test harness changes wanted in this
  PR; covered separately if regressions show up
- 5.9 per-cwd hide affordance in settings page — index already has
  `hidden` flag + hide/unhide routes; UI is incremental
- 5.10 `react-virtual` — current pagination caps expanded list to ~20
  rows per "Load more"; not yet needed
- 5.11 settings UI toggle for `external_session_scan.enabled` — setting
  exists, no UI yet
- 6.4 cwd-no-longer-exists graceful fallback — current `cwd_not_found`
  error surfaces correctly; replay-from-jsonl-without-cwd is a
  pre-existing limitation worth a separate change

## Files touched (final)

```
server/stores/migrations/v21.ts             (new — schema)
server/stores/ChatStore.ts                  (source / externalCwd CRUD)
server/config/types.ts                      (Chat extensions)
server/lib/settings.ts                      (external_session_scan)
server/services/scanner/DirectoryEnumerator.ts  (tier 1)
server/services/scanner/SessionPager.ts     (tier 2 + listForCwds)
server/services/scanner/readHead.ts         (8 KB cap utility)
server/routes/external/externalSessionRoutes.ts  (API surface)
server/ws/ExternalScanWatcher.ts            (chokidar)
server/AsyncBoot.ts                         (kickoff)
shared/projectKey.ts                        (cwd↔projectKey helpers)
web/hooks/useExternalCwds.ts                (tier 1 client)
web/hooks/useExternalCwdSessions.ts         (tier 2 client per cwd)
web/hooks/useWorkspaceExternalSessions.ts   (workspace-scoped feed)
web/components/workspace/TaskSessionList.tsx  (unified list refactor)
web/components/workspace/ExternalSessionRow.tsx  (TaskRow visual parity)
web/services/WebSocketEventMap.ts           (external-dirs:* events)
```
