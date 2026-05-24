# Flush Pending Task on Expert Ready

## Summary

Repair the half-implemented "pending task" queue in `ExpertSessionStore` so that user messages typed (or `expert:start` payloads delivered) during an expert's `starting` window are flushed to the agent the instant it becomes ready, instead of being silently discarded by `cleanup()`/`cleanupWithStop()`.

## Why

`ExpertSessionStore` exposes `setPendingTask`, `consumePendingTask`, and `consumePendingTaskWithTimer`. Production code calls `setPendingTask` in three places — but **no production code ever calls `consumePendingTask*`**. The queued message is never delivered:

- `server/ws/ExpertDirectInput.ts:121` — user types into the agent while it is still in `starting`. Message is queued, then dropped on cleanup.
- `server/ws/ExpertLifecycle.ts:134` — a duplicate `expert:start` arrives during `starting`, with a `task`. Task is queued, then dropped.
- `server/ws/ExpertLifecycle.ts:164` — an attached agent has no `cliSessionId` yet (Claude provider). Task is queued, then dropped.

Both `cleanup()` and `cleanupWithStop()` `delete` the `pendingTask` entry without consuming it. The only place anything `pendingTask`-shaped is touched in production is `ExpertHandler.detachConnection` calling `clearPendingTaskTimer` — and the timer itself is never set in production, only in tests.

User-visible impact:

- Type a message in the chat box right after dispatching an agent — it appears in the UI, then never makes it to the agent. The agent runs only on the *initial* task passed to `handleStart`, so the user sees their follow-up text vanish.
- The starting window is short for warm starts, but easily 1–3 s on cold start with `ConfigCompiler` + `ACPClient.initialize`. Power users batch-type during this window — it's exactly the "pulse-mode" pattern this product is built for.

## What Changes

- **`ExpertSessionStore`** — `pendingTask` becomes a per-key ordered queue (`Map<string, PendingTaskEntry[]>`); `setPendingTask` → `enqueuePendingTask`; `consumePendingTask*` → `drainPendingTasks*`; `cleanup` and `cleanupWithStop` drain and surface losses instead of silently `delete`-ing.
- **`ExpertEventWiring.ts`** — `cli-session-id` handler drains the queue and sends each entry via `acpClient.prompt` for Claude provider.
- **`ExpertLifecycle.ts`** — `handleStart`, after `markReady` + `clearStarting`, drains the queue for Codex provider only (Claude is drained at `cli-session-id`); the duplicate-`expert:start`-during-starting branch (line 134) stops enqueuing — that path is already covered by the initial-task dispatch.
- **`ExpertDirectInput.ts:121`** — switches to `enqueuePendingTask` with images and `connectionId` carried on the entry.
- **TTL** — new `PENDING_TASK_TTL_MS = 30_000` constant; on expiry, queued entries are surfaced via a new `expert:error { error: 'pending_task_dropped', task, agentId, chatId }` to the originating connection. Same channel is used when `cleanup` / `cleanupWithStop` drain a non-empty queue.
- **No new feature flags, no new persistence, no migration.**

## Goals

1. Any text the user sends while an expert is `starting` is delivered to that expert as soon as it is ready, in arrival order.
2. Any `task` payload arriving on a duplicate `expert:start` during `starting` is delivered as well (single coalesced message — last-write-wins per key, since these are duplicates of the same dispatch).
3. Pending tasks queued because an attached expert is missing its `cliSessionId` are flushed when `cli-session-id` is observed.
4. A pending task that never gets a chance to flush (start fails, expert exits before ready, connection drops) is observably either delivered, surfaced as an error to the user, or expired with a TTL — never silently swallowed.
5. The fix preserves "JSONL is the single source of truth" — no new persistence layer; the queue stays in-memory.

## Non-Goals

- Not reworking `ACPClient` or the prompt API.
- Not changing how the *initial* task is sent inside `handleStart` (lines 346–365). The fix layers on top of the existing initial-task dispatch.
- Not adding a generic message queue across reconnects. If the user disconnects mid-`starting`, the in-memory queue can be discarded — they can re-send.
- Not coalescing multiple direct-input messages into one prompt. Multiple direct-inputs during `starting` produce multiple ACP prompts, in order.
- Not adding new feature flags. This is a bug fix.

## Approach

Three changes, all behind the existing `ExpertSessionStore` API surface:

**1. Replace single-slot `pendingTask` with an ordered queue per `key`.**
Direct input arriving during `starting` may fire multiple times; today's `setPendingTask` overwrites silently. Switch the underlying type from `Map<string, string>` to `Map<string, string[]>` (with `images` retained per item). Rename `setPendingTask` → `enqueuePendingTask` to make the contract explicit; `consumePendingTask*` become "drain all". Tests are updated in lockstep.

**2. Drain the queue at the two existing readiness boundaries.**
- In `ExpertLifecycle.handleStart`, immediately after `acpClient.markReady()` + `store.clearStarting(key)` and after the initial-task dispatch, drain the queue and send each entry via `acpClient.prompt`.
- In `ExpertEventWiring`'s `cli-session-id` handler, drain the queue (this covers the attached-but-no-cliSessionId path; for Claude provider the prompt is safe to send only once the CLI session is known, matching the existing gate at `ExpertLifecycle.ts:163`).

**3. TTL-bounded pending entries.**
When `enqueuePendingTask` fires, also schedule (via the existing `setPendingTaskTimer` infra) a 30-second timer per key. On expiry, drain the queue and emit an `expert:error` to the originating connection so the user sees that their queued input was dropped (network/start failure). On successful drain, clear the timer. On `cleanup`/`cleanupWithStop`, drain to an error channel rather than silently dropping.

## Risks

| Risk | Mitigation |
|---|---|
| Double-send: queue drained both at `markReady` and at `cli-session-id` | Single drain site per provider — for Claude, drain only at `cli-session-id`; for Codex, drain at `markReady`. Provider known at `handleStart`. |
| Drained prompt arrives before ACP session is fully usable | Order of ops in `handleStart` already enforces `markReady` before drain; `prompt` failure goes through the existing `expert:error` path. |
| Queued tasks for an expert that fails to start get silently dropped | New explicit error emission on TTL expiry / `cleanup` drain — user sees a `pending_task_dropped` error with the queued text included so they can re-send. |
| Race between `cli-session-id` event and a fresh direct input arriving microseconds later | After draining, `setPendingTask` continues to enqueue normally; a subsequent direct input goes through the running-expert path (`existing && !modelChanged`) since `clearStarting` already ran. No double-send. |
| Memory growth if many starts time out | TTL bounds queue lifetime to 30 s per key; `cleanup` paths drain & clear. |

## Decisions Locked

- **TTL = 30 s, hardcoded constant** (`PENDING_TASK_TTL_MS`). Not a setting. Cold-start `ConfigCompiler` + `ACPClient.initialize` is comfortably under 5 s in practice; 30 s gives 6× headroom without a long silent tail. If field reports show MCP cold-cache starts pushing past 30 s, bump in a follow-up — not now.
- **`pending_task_dropped` carries the queued `task` text.** UI surfaces a non-blocking inline notice with one-click retry that re-sends the same text. This is the leave-friendly shape: the user comes back to a clear "your message didn't send — retry" affordance, not a vanished input.
