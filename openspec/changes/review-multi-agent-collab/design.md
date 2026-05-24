# Design — Review Multi-Agent Collab

## Context

OpenTeam targets a single AI super-individual driving a 5–10 agent team in pulse-mode batches. The current collab mechanism evolved organically: dispatcher skill → mailbox files → whiteboard → plan.md → per-agent memory. Each piece was added to solve a real problem and works in isolation, but there is no document that says *"the orchestration is a Supervisor topology with these dispatch states, these escalation paths, and these termination guarantees."* New agents reverse-engineer the rules.

The feizhu-share research corpus is unusually directly applicable because (a) it includes a 痛点 report grounded in 50K+ GitHub stars of attention-management tooling, and (b) it surveys the protocol space (MCP/A2A/ACP) and orchestration patterns (Supervisor/Swarm/Hierarchical/etc.) with concrete framework references.

The review-driven question this design answers: **which of the surveyed patterns/protocols are worth adopting, which are not, and how do we lock in the parts that are already correct?**

## Decisions

### Decision 1: Keep Supervisor topology; do not move to Swarm or Hierarchical

**Decision**: Single Lead + parallel Worker experts stays. No handoff between peers, no multi-tier manager hierarchy.

**Alternatives considered**:
- *Swarm (handoff between peers)*: gives flexibility but the 多Agent编排模式调研 documents "loss of global state visibility" and "debug difficulty" (`多Agent编排模式调研.md:228-235`). For a single operator who wants pulse-mode visibility, losing global state is a regression.
- *Hierarchical (Director → Managers → Workers)*: justified only at 50+ agents (`多Agent编排模式调研.md:328`). OpenTeam has 9.

**Consequences**:
- Lead remains the single bottleneck — this is a feature for attention management, not a bug to fix.
- When agent count crosses ~15 or specialization clusters form (e.g., "design team" vs "infra team"), revisit. Today: not yet.

### Decision 2: Align task-state vocabulary with A2A/ACP; do not adopt the transport

**Decision**: Rename internal task states to match the A2A/ACP canonical names so future interop is cheap; keep mailbox files + SSE as the transport.

**Why**: A2A and ACP both converged on `submitted → working → input-required → completed | failed | canceled` (`A2A协议调研.md:112-118`, `ACP协议调研.md:97-105`). OpenTeam currently uses an ad-hoc mix (`task:progress`, `task:idle`, `task:blocked`, `task:milestone`). Aligning names costs little; emitting JSON-RPC + Agent Cards would cost a lot and gain nothing for a single-machine use case.

**Mapping**:

| Current | New canonical | Notes |
|---|---|---|
| `task:assign` | `task:submitted` | Lead → Expert |
| `task:progress` | `task:working` (default) | drop separate `task:idle` (use `working` with empty phase) |
| `task:milestone` | `task:working` with `milestone` field | reduce type count |
| `task:blocked` | `task:input-required` (when waiting on user) OR `task:working` with `blocked=true` | distinguishes blocker types |
| `task:completed` | `task:completed` | unchanged |
| `task:failed` | `task:failed` | unchanged |
| `task:input_required` | `task:input-required` | hyphen-style |

Old names accepted as aliases for one release; emit deprecation log.

### Decision 3: Episodic memory = index over existing `plan.md`/`result.md`, not a new store

**Decision**: Build a read-only index of `~/.openteam/tasks/{taskId}/result.md` files per agent, surfaced as a pre-task lookup hook ("similar tasks you completed: …"). Do not introduce a vector DB.

**Why**: The substrate is already there (`server/mailbox/ExecutionPlanManager.ts:22`). The Agent记忆系统调研 calls out that "episodic memory = task trajectories" (`Agent记忆系统调研.md:99-106`) and that EvolveR / CASCADE achieve their gains from indexing trajectories, not from new storage (`Agent自我进化机制调研.md:84-120`). Adding a vector DB is a big infrastructure jump that the data volume (~tens to low hundreds of tasks per user) does not justify.

**Implementation sketch**:
- `EpisodicMemoryIndex.ts` in `server/memory/` reads `result.md` summaries on completion, stores `{agentId, taskId, title, summary, outcome, tags}` in SQLite (new table, ~one row per task).
- Pre-task hook: when `start-expert.sh` fires, the expert's first prompt is augmented with top-3 prior completed tasks for that agent matching the task description (BM25 or simple token overlap; vector is overkill).
- Per-agent isolation: index is keyed by `agentId`; no cross-agent reads.

**Alternatives rejected**:
- *Vector embedding store*: 10× the infra for a corpus that fits in RAM.
- *Cross-agent index*: a privacy footgun for no concrete benefit at current scale.

### Decision 4: Guardrail = per-task token budget + UI ledger; not a tool firewall

**Decision**: Add `taskBudget.tokens` and `taskBudget.cost` fields to `TaskEnvelope`. The expert lifecycle tracks cumulative consumption (already done via `ExpertTokenTracker`) and hits two thresholds: **soft warn at 75%** (write `task:warning` to mailbox), **hard pause at 100%** (suspend expert, emit `task:input-required` asking the Lead/user to extend or terminate).

**Why not Aegis-style tool firewall**: Aegis intercepts every tool call and classifies (`AI超级个体工作痛点调研.md:120`). Powerful, but it's a separate large project. Token/cost budget is the highest-ROI guardrail because the 痛点 evidence is overwhelmingly cost-focused (Cursor \$1,400, Flutter \$3,167 incidents). Tool-call interception can come later as a separate capability.

**UI surface**: `team-status.sh` already returns per-expert phase + currentTool; add `cost.tokensUsed`, `cost.tokensBudget`, `cost.usdEstimate`. The UI's expert list adds a single running line. No new panel.

### Decision 5: Orchestration spec lives in `openspec/specs/multi-agent-orchestration/`, not in agent prompts

**Decision**: The orchestration contract is owned by the openspec, not by individual agent SOUL.md files. Agent prompts may reference it but must not redefine it.

**Why**: Today each agent's SOUL.md / IDENTITY.md re-states pieces of the contract (heartbeat rules, mailbox format, war-room rules). Drift is inevitable. The spec becomes the source of truth; prompts are generated/templated against it.

**Migration**: Out of scope for this proposal — the spec is added first; prompt regeneration is a downstream change.

## Architecture

### Current state (descriptive)

```
                      ┌────────────────────────────────┐
                      │ Lead Agent (claude/codex)      │
                      │  - expert-dispatcher skill     │
                      │  - whiteboard read/write       │
                      └──────────────┬─────────────────┘
                                     │ HTTP /api/expert/*
                                     ▼
                      ┌────────────────────────────────┐
                      │ server (Express + WS)          │
                      │  - ExpertHandler (lifecycle)   │
                      │  - MailboxManager (jsonl)      │
                      │  - WhiteboardManager (chat)    │
                      │  - ExecutionPlanManager        │
                      └──────────────┬─────────────────┘
                                     │ stdio (PTY)
                                     ▼
                      ┌────────────────────────────────┐
                      │ Expert Agent (cli sub-process) │
                      │  - reads plan.md               │
                      │  - writes mailbox jsonl        │
                      │  - per-agent memory/           │
                      └────────────────────────────────┘

  Filesystem state:
   ~/.openteam/mailbox/{chatId}/{from}→{to}.jsonl     (point-to-point)
   ~/.openteam/whiteboard/{chatId}/entries.jsonl      (chat-wide blackboard)
   ~/.openteam/tasks/{taskId}/{plan,result}.md        (per-task scratch)
   ai-assets/agents/<id>/memory/{MEMORY.md, daily}    (per-agent long-term)
```

### Target state (this proposal)

Same boxes, four additions inside `server/`:

- `server/contract/OrchestrationContract.ts` — typed constants for canonical states + dispatch lifecycle (referenced by mailbox, SSE, dispatcher scripts)
- `server/memory/EpisodicMemoryIndex.ts` + new SQLite table `episodic_tasks` (one row per completed task)
- `server/budget/TaskBudgetTracker.ts` — wraps `ExpertTokenTracker`, emits soft-warn at 75% / hard-pause at 100%
- Patches to `expertRoutes.ts` SSE filter + `check-inbox.sh` to emit/parse the full canonical state set

No new transport, no new top-level directory.

## Data Models

### `TaskEnvelope` additions

```ts
interface TaskEnvelope {
  // ... existing fields
  budget?: {
    maxInputTokens?: number   // null = unlimited
    maxOutputTokens?: number
    maxUsd?: number
  }
}
```

### New table: `episodic_tasks` (migration v22)

```sql
CREATE TABLE episodic_tasks (
  id TEXT PRIMARY KEY,            -- taskId
  agent_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,                   -- pulled from result.md "## Summary"
  outcome TEXT NOT NULL,          -- 'completed' | 'failed' | 'canceled'
  tags TEXT,                      -- JSON array
  tokens_used INTEGER,
  usd_cost REAL,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE INDEX idx_episodic_agent_completed ON episodic_tasks(agent_id, completed_at DESC);
CREATE INDEX idx_episodic_outcome ON episodic_tasks(agent_id, outcome);
```

### Canonical message types

After this proposal:

| Type | Direction | Required payload |
|---|---|---|
| `task:submitted` | Lead → Expert | `TaskEnvelope` |
| `task:accepted` | Expert → Lead | `{ taskId }` |
| `task:working` | Expert → Lead | `{ taskId, phase, milestone?, blocked? }` |
| `task:input-required` | Expert → Lead | `{ taskId, question, options? }` |
| `task:warning` | Expert → Lead | `{ taskId, kind: 'budget'|..., detail }` |
| `task:completed` | Expert → Lead | `{ taskId, summary, artifacts? }` |
| `task:failed` | Expert → Lead | `{ taskId, failureReason, recoverable? }` |
| `task:canceled` | Lead → Expert | `{ taskId, reason }` |
| `query` / `response` | bidirectional | unchanged |
| `handoff` / `artifact` | unchanged |

Removed: `task:progress` (merged into `task:working`), `task:milestone` (field on `task:working`), `task:blocked` (becomes `task:input-required` or `task:working{blocked:true}`), `task:idle` (becomes `task:working` with empty phase).

## Trade-offs Acknowledged

- **Naming churn costs real work.** Renaming `task:progress` → `task:working` will require updates in `check-inbox.sh`, `expertRoutes.ts:349-358`, several agent skill files, and any UI that filters by type. The benefit is a single state machine that matches industry standards and removes 4 redundant types. Worth it before more agents land.
- **Episodic memory adds a database table per task.** At ~100 tasks/month/user the storage is negligible. The risk is staleness — old task summaries may mislead. Mitigation: pre-task lookup includes the timestamp; results older than 30 days are deprioritized.
- **Budget hard-pause can block legitimate long tasks.** Default budget is `null` (unlimited) — the guardrail is opt-in per task. Lead can set budgets when dispatching; user can extend at the pause.
- **Spec sits above implementation.** The orchestration spec being the source of truth means we're now obligated to update it when implementation changes. This is the right trade for stopping prompt drift but it adds review cost.

## Open Questions

None blocking. Future questions tracked separately:

- When to revisit Hierarchical topology — what's the agent-count threshold?
- Whether to expose A2A-compatible HTTP endpoints externally — depends on cross-team use cases.
- Whether the episodic index should support cross-chat queries — depends on user feedback.
