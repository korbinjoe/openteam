# Design — Flush Pending Task on Expert Ready

## Problem Recap

`ExpertSessionStore.pendingTask` is written but never read in production. The store has all the methods to consume (`consumePendingTask`, `consumePendingTaskWithTimer`) and a timer subsystem (`setPendingTaskTimer` / `clearPendingTaskTimer`), but only the `clear*` half of the timer API is reachable from production code (in `ExpertHandler.detachConnection`). Result: messages typed during the `starting` window are accepted by the WS handler, queued in memory, then deleted.

## Code Inventory

| File:Line | Call | Status |
|---|---|---|
| `server/ws/ExpertDirectInput.ts:121` | `store.setPendingTask(key, cleanMessage)` | Production write |
| `server/ws/ExpertLifecycle.ts:134` | `store.setPendingTask(key, task)` | Production write |
| `server/ws/ExpertLifecycle.ts:164` | `store.setPendingTask(key, task.trim())` | Production write |
| `server/ws/ExpertHandler.ts:451` | `store.clearPendingTaskTimer(key)` | Production no-op (timer never set) |
| `server/ws/ExpertSessionStore.ts:160-195` | `setPendingTask` / `consumePendingTask` / `consumePendingTaskWithTimer` / `setPendingTaskTimer` | API surface |
| `server/__tests__/ExpertSessionStore.test.ts:124-187` | `consumePendingTask*` | **Only consumers exist in tests** |

Cleanup paths that delete-without-consuming:
- `ExpertSessionStore.cleanup()` — `this.pendingTask.delete(key)` at line 207.
- `ExpertSessionStore.cleanupWithStop()` — `this.pendingTask.delete(key)` at line 237.

## Decision 1 — Queue, not single slot

`pendingTask: Map<string, string>` allows only one in-flight queued message per key. The realistic flow during a 1–3 s cold start has the user typing, hitting Enter, then typing again. Today the second message overwrites the first. Switch to:

```ts
interface PendingTaskEntry {
  task: string
  images?: Array<{ data: string; mediaType: string }>
  enqueuedAt: number
  connectionId: string  // for error routing on TTL expiry
}
private pendingTask = new Map<string, PendingTaskEntry[]>()
```

Public API:
- `enqueuePendingTask(key, entry)` — replaces `setPendingTask`. Pushes onto the per-key array.
- `drainPendingTasks(key): PendingTaskEntry[]` — replaces `consumePendingTask`. Returns full array, deletes key.
- `drainPendingTasksWithTimer(key)` — clears timer + drains.
- Existing `hasPendingTask` / `getPendingTask` retained for tests; `getPendingTask` returns the **first** entry's `task` for back-compat with the existing test, or we update the test (preferred, since the API is internal).

The `ExpertLifecycle.ts:134` path (duplicate `expert:start` during starting) intentionally does **not** enqueue duplicates — it overwrites because it's the same dispatch retried. Keep that behavior with a path-level "replace last entry if connectionId matches and the queue is non-empty" flag, OR simply drop the enqueue at that site (the original task is already in-flight via `handleStart`). Choosing **drop the enqueue at ExpertLifecycle.ts:134**: a duplicate `expert:start` with the same task is the dispatcher retrying, and the original `handleStart` call's initial-task path already covers it. This shrinks scope to the two paths that genuinely produce data loss.

## Decision 2 — Where to drain

Two readiness boundaries exist; pick **one per provider** to avoid double-send:

| Provider | Drain site | Why |
|---|---|---|
| `claude` | `ExpertEventWiring.ts` `cli-session-id` handler | Claude prompts are gated on knowing `cliSessionId` (mirrors existing `attached.cliSessionId` check at `ExpertLifecycle.ts:163`). |
| `codex` | `ExpertLifecycle.handleStart` after `markReady()` + `clearStarting()` | Codex passes the task as a CLI arg, no `cli-session-id` event in the same shape. |

The drain function is a single helper:

```ts
function flushPendingTasks(deps: { store, acpClient, sessionId, agentId, chatId, sendTo, connectionId }) {
  const drained = deps.store.drainPendingTasksWithTimer(key)
  for (const entry of drained) {
    deps.acpClient
      .prompt(deps.sessionId, entry.task, entry.images?.map(i => ({ data: i.data, mimeType: i.mimeType })))
      .catch(err => deps.sendTo(entry.connectionId, {
        type: 'expert:error',
        payload: { agentId, chatId, error: 'pending_task_failed', message: String(err), task: entry.task },
      }))
  }
}
```

Codex caveat: ACP `prompt` for Codex behaves the same as Claude (the difference is only spawn-time CLI arg vs runtime prompt). Drained tasks for Codex go through `acpClient.prompt` like any other follow-up.

## Decision 3 — TTL + observable failure

`enqueuePendingTask` schedules a 30 s timer per key. On expiry:
1. Drain the queue.
2. For each entry, emit `expert:error` (via `sendTo(entry.connectionId, …)`) with payload `{ error: 'pending_task_dropped', task, agentId, chatId, message: '...' }`.
3. Remove the timer.

`cleanup()` and `cleanupWithStop()` are updated to **drain into the same error channel** instead of `delete`-ing. This is the unified loss-detection point: queued input is either delivered, retried, or surfaced as an error.

The TTL is a hardcoded constant `PENDING_TASK_TTL_MS = 30_000`. Not a setting — same rationale as `setPendingTaskTimer`: bounded, in-memory, debug-friendly.

Reason 30 s and not larger: cold start of a Claude expert with `ACPClient.initialize` typically completes in under 5 s; 30 s is 6× the worst observed. Going larger increases the silent-tail without operational benefit. The error message tells the user to re-send.

## Decision 4 — Front-end UX surface

`expert:error` with `error: 'pending_task_dropped'` carries `task` so the UI can render a non-blocking inline notice: *"Message not delivered — agent didn't start in time. [Retry]"*. The retry button just re-sends the same text. This is one small UI affordance; out-of-scope details land in the spec delta below, not here.

## Test Strategy

Unit tests, in `server/__tests__/`:
- `ExpertSessionStore.test.ts` — update existing pendingTask tests; add ordered-drain test, TTL expiry test.
- `ExpertLifecycle.test.ts` (new or extend existing) — wire up a fake `ACPClient` recording `prompt` calls; assert that an enqueued task pre-`clearStarting` results in an ACP prompt after `markReady`.
- `ExpertEventWiring.test.ts` (new) — `cli-session-id` event drains for Claude provider.

Integration test (manual checklist in tasks.md):
- Cold-start a Claude expert in a chat; type three messages within 1 s of dispatch; observe all three arrive in order on the agent side (verified via JSONL inspection or agent stdout).
- Same for Codex.
- Force a start failure (bad `cwd`); confirm `pending_task_dropped` error reaches the WS client with the queued text.

## Decisions

- **Pending task is a queue, not a slot.** Multiple direct inputs during `starting` are all delivered, in order.
- **Drain happens at provider-specific readiness boundary** — Claude on `cli-session-id`, Codex on `markReady`. Single drain site per path; no double-send.
- **Drop the `ExpertLifecycle.ts:134` enqueue site** — duplicate `expert:start` with the same task is already covered by the initial-task dispatch in `handleStart`.
- **TTL = 30 s, hardcoded.** On expiry, surface `expert:error` with `error: 'pending_task_dropped'` and the queued text so the UI can offer retry.
- **`cleanup()` / `cleanupWithStop()` drain-with-error** instead of `delete`. Loss is observable, never silent.
