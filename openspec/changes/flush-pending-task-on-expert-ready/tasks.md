# Tasks — Flush Pending Task on Expert Ready

## Phase 1 — Store API rework

- [ ] 1.1 In `server/ws/ExpertSessionStore.ts`, define `PendingTaskEntry { task; images?; enqueuedAt; connectionId }` and switch `pendingTask` from `Map<string, string>` to `Map<string, PendingTaskEntry[]>`.
- [ ] 1.2 Replace `setPendingTask(key, task)` with `enqueuePendingTask(key, entry)`; preserve order, push to tail.
- [ ] 1.3 Replace `consumePendingTask(key)` with `drainPendingTasks(key): PendingTaskEntry[]`; replace `consumePendingTaskWithTimer` with `drainPendingTasksWithTimer`.
- [ ] 1.4 Add `PENDING_TASK_TTL_MS = 30_000` constant; have `enqueuePendingTask` schedule (or refresh) the per-key timer using existing `setPendingTaskTimer`.
- [ ] 1.5 Update `cleanup(key)` and `cleanupWithStop(key, connectionId)` to **drain into a returned array** instead of silently `delete`-ing the queue. Surface drained entries via the existing return shape so callers can route errors.
- [ ] 1.6 Keep `hasPendingTask` (true iff queue non-empty) and `getPendingTask` (deprecated; returns first entry's `task` or undefined) for transitional test coverage.

## Phase 2 — Drain at readiness boundaries

- [ ] 2.1 Create `flushPendingTasks(deps)` helper in `server/ws/ExpertEventWiring.ts` (private to that module) that drains via `store.drainPendingTasksWithTimer(key)` and dispatches each entry via `acpClient.prompt`, routing failures to `expert:error` with `error: 'pending_task_failed'`.
- [ ] 2.2 In `ExpertEventWiring.ts`, inside the `streamManager.on('cli-session-id', …)` handler, call `flushPendingTasks` for Claude provider after the `cliSessionId` is recorded on the entry.
- [ ] 2.3 In `ExpertLifecycle.ts` `handleStart`, after `acpClient.markReady()` + `store.clearStarting(key)`, call `flushPendingTasks` for Codex provider only (Claude is handled at 2.2).
- [ ] 2.4 Confirm initial-task dispatch (`ExpertLifecycle.ts:346-365`) still runs **before** the drain — same prompt order: initial task first, then queued direct inputs in arrival order.

## Phase 3 — TTL + error surfaces

- [ ] 3.1 Implement TTL timer body in `ExpertSessionStore.enqueuePendingTask`: on expiry, drain and surface the entries via a registered "loss listener" callback (set up by `ExpertLifecycle` / `ExpertHandler` at construction time so the store stays decoupled from WS).
- [ ] 3.2 Wire the loss listener in `ExpertHandler` to emit `expert:error { error: 'pending_task_dropped', agentId, chatId, task }` to each entry's `connectionId` via `sendTo`.
- [ ] 3.3 Wire the same loss-listener path for drained entries from `cleanup` / `cleanupWithStop` so stop/disconnect during `starting` surfaces dropped queued input.
- [ ] 3.4 Add `pending_task_dropped` and `pending_task_failed` to `shared/ws-types.ts` typed `expert:error` `error` enum if such an enum exists; otherwise, document the new error codes inline.

## Phase 4 — Call-site fixes

- [ ] 4.1 `server/ws/ExpertDirectInput.ts:121` — replace `store.setPendingTask(key, cleanMessage)` with `store.enqueuePendingTask(key, { task: cleanMessage, images, enqueuedAt: Date.now(), connectionId })`.
- [ ] 4.2 `server/ws/ExpertLifecycle.ts:134` — **drop the enqueue** for the duplicate-`expert:start`-during-starting branch. Keep the early return; add comment explaining the initial-task dispatch already covers this path.
- [ ] 4.3 `server/ws/ExpertLifecycle.ts:164` — replace `store.setPendingTask(key, task.trim())` with `store.enqueuePendingTask(key, { task: task.trim(), images: payload.images, enqueuedAt: Date.now(), connectionId })`.
- [ ] 4.4 Verify `ExpertHandler.detachConnection` still calls `clearPendingTaskTimer(key)` — it stays correct since the timer API is unchanged. No-op cleanup if the key has no timer.

## Phase 5 — Tests

- [ ] 5.1 Update `server/__tests__/ExpertSessionStore.test.ts` — replace `setPendingTask` / `consumePendingTask` cases with `enqueuePendingTask` / `drainPendingTasks`; add ordered-drain test (3 entries, order preserved); add TTL-expiry test using fake timers.
- [ ] 5.2 Add `server/__tests__/ExpertSessionStore.cleanup.test.ts` — assert `cleanup` and `cleanupWithStop` return drained entries instead of silently deleting.
- [ ] 5.3 Add `server/__tests__/ExpertEventWiring.flush.test.ts` — Claude provider: `cli-session-id` event drains the queue and calls `acpClient.prompt` once per entry, in order.
- [ ] 5.4 Add a Codex-flavored test: `markReady` + `clearStarting` triggers `flushPendingTasks` for Codex; Claude path does NOT drain at `markReady`.
- [ ] 5.5 Failure path test: `acpClient.prompt` rejects → `expert:error { error: 'pending_task_failed', task }` is emitted to the originating `connectionId` only.
- [ ] 5.6 `npm run typecheck` passes.

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
