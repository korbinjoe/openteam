# Capability: Peer-to-Peer Agent Handoff

Bounded, opt-in Expert → Expert task dispatch within a single chat. Peer handoff is a controlled exception to the strict Supervisor pattern: it permits an Expert to hand a task to another Expert without round-tripping through the Lead, while preserving Lead visibility, budget control, and an auditable dispatch chain.

This capability depends on `multi-agent-orchestration` (state machine), `agent-messaging` (canonical task states + `dispatchChain` envelope field), and `agent-evolution` (TaskBudgetTracker) — all introduced by the in-flight `review-multi-agent-collab` change.

## ADDED Requirements

### Requirement: Per-Agent Handoff Policy

Each Expert Agent SHALL have an optional `handoffPolicy` configuration with two fields: `allowedTargets` (a list of Agent IDs the Expert MAY hand off to) and `maxDepth` (an optional override of the global default chain depth). An Agent without a `handoffPolicy` MUST NOT initiate any peer handoff. Policies are loaded from `openteam.json` at server start; runtime changes require a server restart.

#### Scenario: Agent with no policy cannot hand off

- **Given** Expert `image-creator` has no `handoffPolicy` field in `openteam.json`
- **When** `image-creator` invokes `handoff-to-expert.sh fullstack-product-engineer "..."`
- **Then** the server returns 403 with reason `policy_violation`
- **And** the source Expert's mailbox receives a `task:failed` event citing the policy violation

#### Scenario: Agent with policy can hand off to listed targets

- **Given** Expert `code-reviewer` has `handoffPolicy.allowedTargets = ["fullstack-product-engineer"]`
- **When** `code-reviewer` invokes `handoff-to-expert.sh fullstack-product-engineer "fix the issues"`
- **Then** the server validates and starts a new `fullstack-product-engineer` task
- **And** returns the child `taskId` and the resulting `dispatchChain`

#### Scenario: Target outside allowed list is rejected

- **Given** Expert `code-reviewer` has `handoffPolicy.allowedTargets = ["fullstack-product-engineer"]`
- **When** `code-reviewer` invokes `handoff-to-expert.sh ui-designer "..."`
- **Then** the server returns 403 with reason `policy_violation`
- **And** no task is created

---

### Requirement: Server-Enforced Dispatch Chain

Every `task:*` message SHALL carry a non-null `dispatchChain: string[]` listing Agent IDs from the originating Lead-issued dispatch to the current Agent. The server SHALL append the source Agent ID on every successful peer handoff. Producers MUST NOT mutate `dispatchChain` client-side; the server is the single writer.

#### Scenario: Lead-originated task has chain of length 1

- **Given** the Lead dispatches `architect` via `start-expert.sh`
- **When** the task is created
- **Then** the resulting `TaskEnvelope.dispatchChain = ["lead"]`

#### Scenario: Peer handoff appends to chain

- **Given** task with `dispatchChain = ["lead", "architect"]` is running on `architect`
- **When** `architect` hands off to `fullstack-product-engineer`
- **Then** the child task's `dispatchChain = ["lead", "architect", "fullstack-product-engineer"]`
- **And** every message emitted by `fullstack-product-engineer` for that task carries that exact chain

---

### Requirement: Bounded Chain Depth

The server SHALL reject any peer handoff whose resulting `dispatchChain.length` would exceed the effective `maxDepth`. Effective `maxDepth` is `min(perAgentMaxDepth, globalMaxDepth)` where `globalMaxDepth = OPENTEAM_HANDOFF_MAX_DEPTH` env var (default 2, ceiling 3). Depth 1 (`["lead"]`) is the Lead-originated case; depth 2 (`["lead", "A"]`) is the running Expert case; depth 3 (`["lead", "A", "B"]`) is the deepest peer-handoff result allowed by default.

#### Scenario: Default depth allows one peer handoff

- **Given** default config (`maxDepth = 2`)
- **And** task with `dispatchChain = ["lead", "architect"]`
- **When** `architect` hands off to `fullstack-product-engineer`
- **Then** the child chain becomes `["lead", "architect", "fullstack-product-engineer"]` (length 3)
- **And** the handoff is accepted because the *handoff API call* enforces `dispatchChain.length < maxDepth` at *receive* time, with `maxDepth=2` interpreted as "at most 2 peer handoffs from the original Lead dispatch" — see depth-exceeded scenario for the rejection edge

#### Scenario: Exceeding depth is rejected

- **Given** default config (`maxDepth = 2`)
- **And** task with `dispatchChain = ["lead", "architect", "fullstack-product-engineer"]`
- **When** `fullstack-product-engineer` attempts to hand off to `code-reviewer`
- **Then** the server returns 403 with reason `depth_exceeded`
- **And** the source Expert's mailbox receives `task:failed` for the source task with the depth-exceeded reason
- **And** no child task is created

#### Scenario: Per-Agent maxDepth overrides global

- **Given** `architect.handoffPolicy.maxDepth = 1` and `globalMaxDepth = 3`
- **When** `architect` attempts to hand off any task with chain longer than `["lead"]`
- **Then** the server uses `min(1, 3) = 1` and rejects with `depth_exceeded`

---

### Requirement: Cycle Prevention

The server SHALL reject any peer handoff whose target Agent ID already appears in the current `dispatchChain`.

#### Scenario: Direct cycle rejected

- **Given** task with `dispatchChain = ["lead", "architect", "fullstack-product-engineer"]`
- **When** `fullstack-product-engineer` attempts to hand off to `architect`
- **Then** the server returns 403 with reason `cycle`
- **And** no child task is created

#### Scenario: Self-handoff rejected

- **Given** task with `dispatchChain = ["lead", "architect"]`
- **When** `architect` attempts to hand off to `architect`
- **Then** the server returns 403 with reason `cycle`

---

### Requirement: Budget Inheritance

A peer-handoff child task's budget SHALL be carved from the parent task's *remaining* budget. The server SHALL reject the handoff if (a) the requested child budget exceeds parent remaining budget, (b) the requested child budget falls below `MIN_HANDOFF_BUDGET` (default 5000 tokens), or (c) `OPENTEAM_HANDOFF_REQUIRE_BUDGET=1` (production default) AND the parent task has no budget set. Unused child budget SHALL be refunded to the parent on child task completion.

#### Scenario: Budget under floor is rejected

- **Given** parent task has 10000 tokens remaining and `MIN_HANDOFF_BUDGET = 5000`
- **When** Expert hands off requesting 3000 tokens
- **Then** the server returns 403 with reason `budget_insufficient` and detail "below minimum"

#### Scenario: Budget exceeding parent remaining is rejected

- **Given** parent task has 4000 tokens remaining
- **When** Expert hands off requesting 8000 tokens
- **Then** the server returns 403 with reason `budget_insufficient` and detail "exceeds parent remaining"

#### Scenario: Successful handoff carves and refunds budget

- **Given** parent task has 50000 tokens remaining; child handoff requests 20000
- **When** the handoff is accepted
- **Then** parent remaining drops to 30000 immediately
- **And** when the child task completes having used 12000 tokens, parent remaining returns to 38000

#### Scenario: Missing parent budget rejected in production

- **Given** `OPENTEAM_HANDOFF_REQUIRE_BUDGET=1` and parent task has no `budget` field
- **When** any peer handoff is attempted
- **Then** the server returns 403 with reason `budget_insufficient` and detail "parent has no budget"

---

### Requirement: Mandatory Lead Visibility (CC)

For every peer-handoff-spawned task, the mailbox SHALL automatically write a copy of every lifecycle terminal message (`task:submitted | task:completed | task:failed | task:input-required`) to the file `{spawnedAgent}→lead.jsonl`, in addition to the primary parent-mailbox write. Working-state messages (`task:working`) MUST NOT be cc'd. CC'd messages SHALL be marked with `payload.cc = true` so consumers can distinguish them.

#### Scenario: Handoff submission cc'd to Lead

- **Given** `architect` hands off to `fullstack-product-engineer` for `taskId = task-xyz`
- **When** the child task is created
- **Then** `task:submitted` is written to BOTH `fullstack-product-engineer→architect.jsonl` AND `fullstack-product-engineer→lead.jsonl`
- **And** the Lead-bound copy carries `payload.cc = true`

#### Scenario: Working-state messages are not cc'd

- **Given** `fullstack-product-engineer` is running a handoff-spawned task
- **When** it emits `task:working` messages every few seconds
- **Then** those messages are written ONLY to `fullstack-product-engineer→architect.jsonl`
- **And** the Lead's mailbox is not flooded with progress updates

#### Scenario: Child failure is visible to Lead

- **Given** a handoff-spawned task fails
- **When** the child Expert emits `task:failed`
- **Then** the Lead's mailbox receives a cc'd copy
- **And** the SSE stream `/api/expert/events` forwards the cc'd terminal to the Lead's connection

---

### Requirement: Whiteboard Audit Trail

The server SHALL write a `handoff` whiteboard entry for every accepted peer handoff. The entry payload SHALL include `{ from, to, sourceTaskId, childTaskId, summary, chain }`. Rejected handoff attempts SHALL NOT produce whiteboard entries — they are observability events, not consensus events.

#### Scenario: Successful handoff writes whiteboard entry

- **Given** `architect` successfully hands off to `fullstack-product-engineer`
- **When** the handoff is accepted
- **Then** a whiteboard entry of type `handoff` is appended with `{ from: "architect", to: "fullstack-product-engineer", sourceTaskId, childTaskId, summary, chain: ["lead", "architect", "fullstack-product-engineer"] }`

#### Scenario: Rejected handoff writes no whiteboard entry

- **Given** `architect` attempts a handoff that violates policy
- **When** the server rejects the request
- **Then** no whiteboard entry is created
- **And** the rejection appears in server logs and (if streamed) on the SSE event channel

---

### Requirement: User Kill Switches

The system SHALL provide two independent disable mechanisms: (a) a global env var `OPENTEAM_DISABLE_PEER_HANDOFF=1` that causes the server to reject every peer handoff with reason `disabled`; (b) a per-dispatch flag `--no-handoff` on the original Lead-issued `start-expert.sh` invocation that propagates through `dispatchChain` metadata and disables peer handoff for all descendants of that root task. Either mechanism SHALL be sufficient to fall back to pure Supervisor behavior.

#### Scenario: Global kill switch disables all handoffs

- **Given** `OPENTEAM_DISABLE_PEER_HANDOFF=1` is set
- **When** any Expert with a valid `handoffPolicy` invokes `handoff-to-expert.sh`
- **Then** the server returns 403 with reason `disabled`

#### Scenario: Per-task no-handoff flag disables descendants

- **Given** the Lead dispatches a root task with `start-expert.sh architect "..." --no-handoff`
- **When** `architect` attempts to hand off to `fullstack-product-engineer`
- **Then** the server returns 403 with reason `disabled`
- **And** the rejection reason cites the inherited `--no-handoff` flag

---

### Requirement: Dispatch Tree Visibility

The `team-status.sh` server endpoint SHALL return a `dispatchTrees` array per chat, where each entry represents one root task and includes the full descendant chain with status, current Agent, tokens used, and remaining budget. The Lead Agent SHALL be able to fetch this view at any time without reading mailbox files directly.

#### Scenario: Dispatch tree shows full chain

- **Given** root task `task-abc` was dispatched from Lead to `architect`, who handed off to `fullstack-product-engineer`
- **When** the Lead invokes `team-status.sh`
- **Then** the response includes a `dispatchTrees` entry for `task-abc` with both nodes, each carrying status (`completed | working | ...`), tokens, and budget remaining

#### Scenario: Multiple parallel root tasks

- **Given** the Lead dispatched 3 root tasks; one of them produced a peer handoff
- **When** the Lead invokes `team-status.sh`
- **Then** the response contains 3 `dispatchTrees` entries; one shows a 2-node chain, two show single-node chains

---

### Requirement: UI Dispatch Chain Surface

The workspace UI SHALL render the `dispatchChain` of any active task as a horizontal breadcrumb on the task card. Each breadcrumb segment SHALL be clickable and navigate to that Agent's session view. The active (leaf) Agent SHALL be visually emphasized.

#### Scenario: Length-1 chain shows just the Agent

- **Given** a task with `dispatchChain = ["lead", "fullstack-product-engineer"]`
- **When** the task card renders
- **Then** the breadcrumb displays `lead → fullstack-product-engineer` with `fullstack-product-engineer` bolded

#### Scenario: Length-3 chain shows full path

- **Given** a task with `dispatchChain = ["lead", "architect", "fullstack-product-engineer"]`
- **When** the task card renders
- **Then** the breadcrumb displays `lead → architect → fullstack-product-engineer` with the leaf bolded
- **And** clicking `architect` navigates to its session view

#### Scenario: Rejected handoff surfaces as toast

- **Given** an Expert attempts a handoff that the server rejects
- **When** the rejection event reaches the UI
- **Then** a non-modal toast appears with the reason and a link to the source Agent's session
