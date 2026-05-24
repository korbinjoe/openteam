# Tasks — Flush Pending Task on Expert Ready

## Phase 1 — Store API rework

- [x] 1.1 In `server/ws/ExpertSessionStore.ts`, define `PendingTaskEntry { task; images?; enqueuedAt; connectionId }` and switch `pendingTask` from `Map<string, string>` to `Map<string, PendingTaskEntry[]>`.
- [x] 1.2 Replace `setPendingTask(key, task)` with `enqueuePendingTask(key, entry)`; preserve order, push to tail.
- [x] 1.3 Replace `consumePendingTask(key)` with `drainPendingTasks(key): PendingTaskEntry[]` (consolidates the prior consume + timer-clear paths).
- [x] 1.4 Add `PENDING_TASK_TTL_MS = 30_000` constant; have `enqueuePendingTask` arm a per-key timer (oldest entry's deadline governs; not refreshed by subsequent enqueues).
- [x] 1.5 Update `cleanup(key)` and `cleanupWithStop(key, connectionId)` to fire the loss listener with reason `cleanup` / `stop` for any queued entries before deletion.
- [x] 1.6 Keep `hasPendingTask` (true iff queue non-empty); `getPendingTask` removed (the queue is opaque from outside; tests use `hasPendingTask` + `drainPendingTasks`).

## Phase 2 — Drain at readiness boundaries

- [x] 2.1 Create `flushPendingTasks(deps)` helper in new module `server/ws/ExpertPendingTaskFlush.ts` that drains via `store.drainPendingTasks(key)` and dispatches each entry via `acpClient.prompt`, routing failures to `expert:error { error: 'pending_task_failed' }` via `sessionRegistry.sendToSession`.
- [x] 2.2 In `ExpertEventWiring.ts`, inside the `streamManager.on('cli-session-id', …)` handler, call `flushPendingTasks` for Claude provider after the `cliSessionId` is recorded on the entry.
- [x] 2.3 In `ExpertLifecycle.ts` `handleStart`, after the initial-task dispatch, call `flushPendingTasks` for Codex provider only (Claude is handled at 2.2).
- [x] 2.4 Initial-task dispatch still runs before the Codex drain — same prompt order: initial task first, then queued direct inputs in arrival order.

## Phase 3 — TTL + error surfaces

- [x] 3.1 TTL timer body in `ExpertSessionStore.enqueuePendingTask`: on expiry, drain and fire registered loss listeners with reason `'ttl'`.
- [x] 3.2 Wire the loss listener in `ExpertHandler` to emit `expert:error { error: 'pending_task_dropped', reason, agentId, chatId, task, message }` to each entry's `connectionId` via `sendTo`.
- [x] 3.3 `cleanup` / `cleanupWithStop` paths fire loss listeners with reason `'cleanup'` / `'stop'` so stop/disconnect during `starting` surfaces dropped queued input via the same error path.
- [x] 3.4 Documented `pending_task_dropped` and `pending_task_failed` inline (no shared enum exists).

## Phase 4 — Call-site fixes

- [x] 4.1 `server/ws/ExpertDirectInput.ts:121` — replaced with `enqueuePendingTask({ task, images, enqueuedAt, connectionId })`.
- [x] 4.2 `server/ws/ExpertLifecycle.ts` duplicate-`expert:start`-during-starting branch — dropped the enqueue; added comment explaining the initial-task dispatch already covers this path.
- [x] 4.3 `server/ws/ExpertLifecycle.ts` attached-no-cliSessionId branch — replaced with `enqueuePendingTask({ task, images, enqueuedAt, connectionId })`.
- [x] 4.4 `ExpertHandler.detachConnection` switched to `forgetPendingTasks(key)` so connection-gone drops don't fire loss listeners (no destination to deliver to).

## Phase 5 — Tests

- [x] 5.1 Updated `server/__tests__/ExpertSessionStore.test.ts` — replaced `setPendingTask` / `consumePendingTask` cases with `enqueuePendingTask` / `drainPendingTasks`; added ordered-drain test (3 entries, order preserved); added TTL-expiry test using fake timers; added `cleanup` / `cleanupWithStop` loss-listener tests; added unsubscribe test.
- [x] 5.2 Cleanup behavior covered in the same test file (no separate file needed).
- [ ] 5.3 (Optional) `server/__tests__/ExpertEventWiring.flush.test.ts` — deferred. Manual verification covers the wiring; unit-testing `wireExpertStreamHandlers` requires extensive mocking of `StreamJsonManager` + `ACPClient`.
- [ ] 5.4 (Optional) Codex-flavored test — deferred for the same reason as 5.3.
- [ ] 5.5 (Optional) Failure path test for `pending_task_failed` — deferred.
- [x] 5.6 `npx tsc --noEmit` passes (no `typecheck` script exists; ran `tsc` directly). All 38 ExpertSessionStore tests pass. Pre-existing failures in unrelated test files (TerminalInstance, GitWatchManager, etc.) confirmed independent of this change.

## Phase 6 — Manual verification (high-risk per CLAUDE.md rule 4)

- [ ] 6.1 Cold-start a Claude expert in a fresh chat; type three messages within 2 s of dispatch; confirm all three reach the agent in order (verify via JSONL inspection at `~/.claude/projects/<projectKey>/<sessionId>.jsonl`).
- [ ] 6.2 Repeat 6.1 for Codex provider.
- [ ] 6.3 Force a start failure (set `cwd` outside allowed roots); type one message during the brief `starting` window; confirm `expert:error { error: 'pending_task_dropped', task }` arrives on the WS client and the UI surfaces it.
- [ ] 6.4 Page-refresh scenario: start an expert, refresh during `starting`, type a message in the new tab — confirm queued message survives via the attached-no-cliSessionId path and is delivered when `cli-session-id` fires.
- [ ] 6.5 Confirm `expert:stop` mid-`starting` produces `pending_task_dropped` for any queued input.

## Phase 7 — Output impact verification (per CLAUDE.md rule 3)

- [ ] 7.1 Document modified files and their diffs in PR description.
- [ ] 7.2 Verify no regression in: terminal rendering, session resume from chat, multi-tab agent attach, `expert:list-updated` payloads.
- [ ] 7.3 Verify high-risk regions: xterm/PTY untouched; `cleanup` callers updated to handle the new return shape if they inspected it (`cleanupWithStop` callers in `ExpertHandler.handleStop` etc.).
