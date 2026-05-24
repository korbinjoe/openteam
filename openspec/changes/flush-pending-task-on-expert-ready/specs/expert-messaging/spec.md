# Spec: Expert Messaging — Pending Task Delivery

## ADDED Requirements

### Requirement: User input during the expert starting window is delivered after readiness

Text typed by the user (via `expert:input`) while the targeted expert is in the `starting` state MUST be enqueued and delivered to the expert as soon as it reaches readiness, in arrival order. The system MUST NOT silently drop such input.

#### Scenario: Single message during starting is delivered post-ready

**Given** an expert is dispatched and is in the `starting` state for a chat
**And** the expert has not yet reached readiness (Claude: `cli-session-id` not yet observed; Codex: `markReady` not yet called)
**When** the user sends a non-empty `expert:input` for that expert
**Then** the message is enqueued in the pending-task queue for the composite key
**And** as soon as the readiness boundary for that provider is reached, the message is sent to the expert via `acpClient.prompt`
**And** the queue for that key is drained and emptied

#### Scenario: Multiple messages during starting are delivered in order

**Given** an expert is in the `starting` state
**When** the user sends three `expert:input` messages "A", "B", "C" within the starting window
**Then** the queue contains entries `["A", "B", "C"]` in that order
**And** on readiness, three `acpClient.prompt` calls are issued in the order `A`, then `B`, then `C`
**And** the queue is empty after drain

#### Scenario: Image attachments on a queued message survive the queue

**Given** an expert is in the `starting` state
**When** the user sends `expert:input` with text "look at this" and one image attachment
**Then** the queued entry retains the image's `data` and `mediaType`
**And** the eventual `acpClient.prompt` call includes the image in `images`

### Requirement: Attached experts without a CLI session ID flush queued tasks on `cli-session-id`

When `expert:start` arrives for an agent that is already attached but does not yet have a `cliSessionId` (Claude provider only), any task included in that `expert:start` MUST be enqueued and dispatched on the next `cli-session-id` event for that session.

#### Scenario: Claude attached agent with task before cli-session-id arrives

**Given** a Claude expert is attached on a fresh connection (`ensureAttachedRunning` returns the attached entry)
**And** `attached.cliSessionId` is undefined
**When** an `expert:start` arrives carrying `task: "review the diff"`
**Then** the task is enqueued in the pending-task queue for that key
**And** when the next `cli-session-id` event fires for that session
**Then** the queued task is sent via `acpClient.prompt`
**And** the queue is drained

### Requirement: Pending tasks have a bounded time-to-live

A queued pending task MUST be either delivered or surfaced to the originating connection as an error within `PENDING_TASK_TTL_MS` (30 seconds) of being enqueued. Pending tasks MUST NOT remain in memory indefinitely or be silently discarded.

#### Scenario: Expert never reaches readiness within TTL

**Given** a user sends a message during the `starting` window
**And** `enqueuePendingTask` records the entry and schedules a 30 s timer for the key
**When** 30 seconds elapse without the expert reaching readiness
**Then** the queue for that key is drained
**And** for each drained entry, an `expert:error` message is sent to the entry's `connectionId`
**And** the error payload has `error: 'pending_task_dropped'` and includes `agentId`, `chatId`, and the original `task` text
**And** the queue and timer are cleared

#### Scenario: Successful drain clears the timer

**Given** a queued pending task with a TTL timer scheduled
**When** the readiness boundary fires and the queue is drained successfully
**Then** the TTL timer for that key is cleared
**And** no `pending_task_dropped` error is emitted

### Requirement: Cleanup paths surface queued losses instead of silent deletion

`ExpertSessionStore.cleanup(key)` and `ExpertSessionStore.cleanupWithStop(key, connectionId)` MUST drain any pending task queue for the key and emit a `pending_task_dropped` error for each drained entry, instead of silently deleting the queue. The previously-`delete`-based behavior is replaced.

#### Scenario: cleanupWithStop on a key with queued input

**Given** an expert was in `starting` state with two queued user messages
**When** the user invokes stop (triggering `cleanupWithStop`)
**Then** the queue is drained
**And** each drained entry produces an `expert:error` with `error: 'pending_task_dropped'` and the original task text
**And** the in-memory queue and timer for that key are removed

#### Scenario: cleanup on a key with no queue is a no-op for messaging

**Given** an expert key has no entries in the pending-task queue
**When** `cleanup(key)` runs
**Then** no `expert:error` is emitted
**And** other cleanup behavior (running map, activity, meta) is unchanged

### Requirement: Duplicate `expert:start` during starting does not enqueue redundantly

When an `expert:start` arrives for a key that is already in the `starting` state, the handler MUST NOT enqueue the duplicate task into the pending-task queue. The original `handleStart` invocation's initial-task dispatch is the single source of delivery for that dispatch.

#### Scenario: Duplicate expert:start is a no-op for the queue

**Given** an expert is in the `starting` state with an initial task `"build tests"` in flight via `handleStart`
**When** a duplicate `expert:start` with the same `task: "build tests"` arrives on the same key
**Then** the duplicate is logged and ignored
**And** the pending-task queue for the key remains unchanged
**And** exactly one ACP prompt for `"build tests"` is dispatched
