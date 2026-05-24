# Capability: Multi-Agent Orchestration Contract

A single source-of-truth specification of OpenTeam's multi-Agent orchestration: topology, dispatch lifecycle, role boundaries, termination guarantees, and escalation rules. The contract is owned by this spec, not by individual agent prompts. Agent SOUL.md/IDENTITY.md files MAY reference this spec but MUST NOT redefine its contents.

## ADDED Requirements

### Requirement: Supervisor Topology

The system SHALL run a Supervisor topology with exactly one `lead` Agent and zero-or-more parallel Worker (Expert) Agents per chat. The Lead is the only Agent permitted to dispatch tasks; Workers MUST NOT dispatch to other Workers.

#### Scenario: Single Lead dispatches to parallel Workers

- **Given** a chat with a `lead` Agent and three Experts (e.g., `fullstack-product-engineer`, `architect`, `code-reviewer`)
- **When** the Lead invokes `start-expert.sh` three times
- **Then** three independent Expert sub-processes start
- **And** each Expert reports back to `lead` via its own `{instanceId}→lead.jsonl` mailbox
- **And** no Expert opens a mailbox to another Expert

#### Scenario: Worker-to-Worker handoff is rejected

- **Given** an Expert `architect` attempts to write to `~/.openteam/mailbox/{chatId}/architect→fullstack-product-engineer.jsonl`
- **When** the message is delivered
- **Then** the recipient Expert SHALL ignore non-Lead `task:*` messages
- **And** the contract considers this a violation that the protocol layer logs but does not enforce at the filesystem level (Workers run with mailbox write access; enforcement is by convention + prompt)

---

### Requirement: Lead Role Boundary

The `lead` Agent SHALL NOT execute tools that mutate the filesystem or external systems. Its `allowedTools` set is restricted to read/query/dispatch tools (`Read`, `Glob`, `Grep`, `Bash` for read-only commands, `AskUserQuestion`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, plus dispatch scripts under `expert-dispatcher` skill). All implementation work SHALL be delegated to Expert Agents.

#### Scenario: Lead delegates code changes

- **Given** the user asks the Lead to "fix the SSE filter bug in expertRoutes.ts"
- **When** the Lead processes the request
- **Then** the Lead SHALL dispatch the work to an Expert (e.g., `fullstack-product-engineer`) via `start-expert.sh`
- **And** the Lead SHALL NOT call `Edit` or `Write` directly

#### Scenario: Lead read-only Bash is allowed

- **Given** the Lead needs to check current git status
- **When** the Lead runs `git status` via Bash
- **Then** the call succeeds because `git status` is non-mutating
- **And** mutating Bash invocations (e.g., `git commit`, `rm`) MUST be delegated to an Expert

---

### Requirement: Dispatch Lifecycle State Machine

Every dispatched task SHALL traverse a defined state machine: `submitted → working → (input-required ↔ working)* → (completed | failed | canceled)`. No task MAY terminate in `working`, `input-required`, or `submitted`. The state names match A2A/ACP canonical terminology (see `agent-messaging` capability).

#### Scenario: Happy-path lifecycle

- **Given** the Lead dispatches a task to Expert `architect`
- **When** the Expert accepts and works to completion
- **Then** the mailbox emits `task:submitted → task:accepted → task:working* → task:completed`
- **And** the final `task:completed` message carries a `summary` field

#### Scenario: Failure terminates lifecycle

- **Given** an Expert encounters an unrecoverable error
- **When** the Expert reports `task:failed`
- **Then** the task lifecycle terminates
- **And** the `task:failed` message carries a `failureReason` field
- **And** the Lead MAY re-dispatch a new task (with a new `taskId`) but MUST NOT resume the failed one

#### Scenario: Cancellation terminates lifecycle

- **Given** a task is in `working` state
- **When** the Lead sends `task:canceled`
- **Then** the Expert SHALL stop work within bounded time (≤ 30 seconds)
- **And** the task lifecycle terminates
- **And** the Expert process MAY remain alive for a follow-up task or MAY be torn down

---

### Requirement: Termination Guarantee

Every dispatched task SHALL reach one of `completed | failed | canceled` within bounded time. The system SHALL NOT leave tasks in `working` state indefinitely without producing a `task:working` heartbeat at least every 5 minutes; a task with no heartbeat for >5 minutes SHALL be classified as `failed` with `failureReason: "no-heartbeat-timeout"`.

#### Scenario: Stalled Expert is reaped

- **Given** an Expert in `working` state stops emitting `task:working` heartbeats
- **When** 5 minutes elapse with no message
- **Then** the system SHALL emit `task:failed` with `failureReason: "no-heartbeat-timeout"`
- **And** the Expert process MAY be terminated by the lifecycle manager

#### Scenario: Long-running task with heartbeats survives

- **Given** an Expert runs for 30 minutes and emits `task:working` every 60 seconds
- **When** the task is observed
- **Then** the task remains in `working` state
- **And** no timeout fires

---

### Requirement: Escalation Path

When an Expert blocks on a decision it cannot resolve, it SHALL emit `task:input-required` to the Lead. The Lead SHALL either (a) answer with a `query/response` exchange, (b) cancel the task with `task:canceled`, or (c) escalate to the human user via the chat UI when the Lead also cannot decide. Escalation MUST NOT silently stall.

#### Scenario: Expert blocks, Lead resolves

- **Given** an Expert emits `task:input-required` with `question: "Should I use Postgres or SQLite?"` and `options: ["postgres", "sqlite"]`
- **When** the Lead receives the message
- **Then** the Lead SHALL respond with a `response` message carrying the choice
- **And** the Expert SHALL resume work with `task:working`

#### Scenario: Lead escalates to user

- **Given** an Expert blocks on a product decision the Lead cannot make
- **When** the Lead receives `task:input-required`
- **Then** the Lead SHALL surface the question to the user via the chat interface
- **And** the task remains in `input-required` until resolved
- **And** the Lead SHALL NOT silently drop the message

---

### Requirement: Orchestration Contract Code Anchor

A typed contract file at `server/contract/OrchestrationContract.ts` SHALL export canonical constants for `TaskState`, `DispatchLifecycle`, and `EscalationPath`. The mailbox protocol, SSE filter, and dispatcher scripts SHALL import from this file rather than redefining constants inline.

#### Scenario: Single source of truth

- **Given** the codebase needs to reference the canonical task state names
- **When** `expertRoutes.ts`, `MailboxManager.ts`, and `check-inbox.sh` need a state constant
- **Then** the TypeScript files SHALL import from `server/contract/OrchestrationContract`
- **And** the shell script SHALL be regenerated from the same source (or hold an asserted-on-startup check)
- **And** a contract test SHALL verify constants match `shared/agent-message-types.ts`
