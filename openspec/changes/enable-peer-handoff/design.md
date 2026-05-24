# Design — Enable Peer-to-Peer Agent Handoff

## Context

OpenTeam runs a Supervisor topology: one `lead` Agent + parallel Experts, all dispatched and observed through the Lead. The protocol layer reserves a `handoff` message type and a `HandoffPayload` (`shared/agent-message-types.ts:152`), but no production path exists — only the Lead has the `expert-dispatcher` skill, and `ai-assets/hooks/wb-post-tool-write.sh:62-67` actively *rejects* handoff chains.

The product reason to keep that lock has been single-pane visibility: the user wants one Lead to look at, not a forest. The product reason to open it now is that Lead-mediated round trips have become measurable Lead overhead — every `code-reviewer → fix` or `architect → implement` chain re-incurs a Lead LLM call to re-decide what is mechanical glue.

This design opens peer handoff with bounds tight enough that the user's mental model stays "I dispatched 3 tasks; the system tells me when they're done." Internally those 3 tasks may have spawned 5 sub-tasks; externally the user sees an aggregated view rooted at the original dispatch.

## Decisions

### Decision 1: Peer handoff is opt-in per Agent via `handoffPolicy`, not a global flag

**Decision**: Each Expert in `openteam.json` declares `handoffPolicy: { allowedTargets: [...], maxDepth?: number }`. Default is no policy = no handoff allowed. The server rejects any handoff whose target is not in the source's `allowedTargets`.

**Why**: A global on/off switch is too coarse. The realistic patterns are pairs/trees (review→fix, design→implement), not "everyone can hand to everyone." Per-Agent allow-lists let the operator explicitly model which collaborations are sanctioned, which keeps the dispatch graph readable. They also make abuse impossible to accidentally enable: adding a new Expert defaults to no peer-handoff power.

**Alternatives rejected**:
- *Global flag*: ships footguns. Any Expert could hand to any Expert; policy lives in prompts only.
- *Skill-level allow-list*: less precise; an Expert may have multiple skills and we want the policy keyed to identity, not capability.

### Decision 2: Dispatch chain is server-enforced, not prompt-trusted

**Decision**: Every `task:*` message carries `dispatchChain: string[]` of Agent IDs from the originating Lead-issued task to the current Agent. The server appends to the chain on every successful handoff and rejects:
- depth > `maxDepth` (default 2, ceiling 3 — i.e., `lead → A → B` is the deepest allowed by default)
- any target already in the existing chain (cycle detection)
- any target not in the source's `handoffPolicy.allowedTargets`

**Why**: The bounds are the safety net. Putting them in prompts is unreliable — an Expert that mis-reads its policy will silently violate it. Putting them in the API endpoint makes them a structural guarantee. The chain is also the audit trail surfaced to the UI and to the whiteboard.

**Default depth = 2 rationale**: `lead → A → B` covers all the realistic patterns surveyed (review→fix, design→implement, scaffold→polish). Depth 3 (`lead → A → B → C`) is allowed only by explicit per-Agent override and is the absolute ceiling. Depth 4+ is structurally impossible.

### Decision 3: Lead is cc'd on every peer-handoff lifecycle terminal

**Decision**: When a handoff-spawned task emits `task:submitted | task:completed | task:failed | task:input-required`, the mailbox automatically writes a copy to `{spawned-agent}→lead.jsonl` in addition to the source-of-truth `{spawned-agent}→{parent-agent}.jsonl`. Working-state messages (`task:working`) are NOT cc'd — they would flood the Lead's inbox.

**Why**: This preserves the Lead's role as the single observation point without forcing the Lead to be the dispatcher. The Lead can intervene, suspend, or report up to the user without ever knowing peer handoff happened structurally — to the Lead it looks like "a task started and finished; I can see the chain on the envelope."

**Alternatives considered**:
- *No cc*: Lead loses visibility, breaks the single-pane UX promise.
- *Full cc including `task:working`*: floods Lead inbox; defeats the latency win of peer handoff.

### Decision 4: Budget is inherited, never extended

**Decision**: A peer-handoff task's `budget.tokens` and `budget.usd` MUST be ≤ the parent task's *remaining* budget at handoff time. Server enforces this. If parent has no budget set (legacy dispatch), child handoff is rejected unless `OPENTEAM_HANDOFF_REQUIRE_BUDGET=0` (off by default, on in production).

**Why**: Without this, a user who sets a $1 cap on the original Lead dispatch can find that A handed to B handed to C, each setting its own $1, for a total of $3. Inheritance is the only way to make the original cap meaningful. It also forces the originating Lead to size budgets generously enough for the expected handoff fan-out — a nudge toward thinking about the chain at dispatch time.

**Floor**: A `MIN_HANDOFF_BUDGET` (default: 5000 tokens, $0.05) prevents handoffs with vanishing budget that would just pause immediately on the budget-exceeded guardrail.

### Decision 5: User has both per-task and global kill switches

**Decision**:
- `start-expert.sh --no-handoff` flag: this specific dispatch and all its descendants run with `handoffPolicy = none` regardless of `openteam.json`
- `OPENTEAM_DISABLE_PEER_HANDOFF=1` env var: server-wide hard disable

**Why**: Trust escalation. Until the user has built confidence, they need a one-click way to lock the system back into pure Supervisor mode. The per-task flag is the "I want this one task to behave the old way" lever; the env var is the "something is wrong, freeze the new behavior project-wide" lever.

### Decision 6: Whiteboard records the chain, not the rejection

**Decision**: Replace the existing `wb-post-tool-write.sh:62-67` rejection logic with *recording* logic. Every successful handoff writes a whiteboard entry of type `handoff` with payload `{ from: A, to: B, sourceTaskId, summary, chain: [...] }`. Failed handoffs (policy/depth/cycle) write nothing to the whiteboard — they are observability events, logged, not consensus events.

**Why**: The whiteboard is the durable audit substrate; recording handoffs there gives downstream Agents and the user an immutable record of who did what. Logging only successes keeps it readable. Failures show up in the SSE event stream and the team-status API, where they belong.

### Decision 7: UI shows the full chain, not just the leaf

**Decision**: The workspace UI's task card displays `lead → architect → fullstack-product-engineer` as a horizontal breadcrumb above the task description. Clicking any segment navigates to that Agent's session. The "active Agent" (leaf) is bolded.

**Why**: This is the single most important UX decision. Without it, the user sees a task running on `fullstack-product-engineer` and has no idea how it got there. With it, the chain is the first thing the user reads — matching the way humans actually think about work ("the architect's plan that the engineer is now implementing"). A user who never wants this complexity simply doesn't enable handoff policies, and the breadcrumb degenerates to `lead → fullstack-product-engineer`.

## Architecture

### Authorization layer (configuration)

```jsonc
// openteam.json
{
  "agents": {
    "list": [
      {
        "id": "code-reviewer",
        "role": "expert",
        "handoffPolicy": {
          "allowedTargets": ["fullstack-product-engineer"],
          "maxDepth": 2  // optional, defaults to 2
        }
      },
      {
        "id": "architect",
        "role": "expert",
        "handoffPolicy": {
          "allowedTargets": ["fullstack-product-engineer", "ui-designer"]
        }
      }
    ]
  }
}
```

### Dispatch path

```
Expert A (code-reviewer)
  ├─ runs handoff-to-expert.sh fullstack-product-engineer "fix the issues in PR #123"
  │
  ▼
POST /api/expert/handoff
  ├─ verifies caller's instanceId is alive in chatId
  ├─ checks handoffPolicy.allowedTargets contains target
  ├─ checks dispatchChain.length < maxDepth
  ├─ checks target NOT in dispatchChain (no cycles)
  ├─ checks parent task remaining budget ≥ requested handoff budget ≥ MIN_HANDOFF_BUDGET
  ├─ creates child taskId; appends source agentId to dispatchChain
  ├─ launches Expert B with TaskEnvelope including dispatchChain
  ├─ writes `handoff` entry to whiteboard
  └─ returns { taskId, dispatchChain }

Expert B (fullstack-product-engineer)
  ├─ writes to {B}→{A}.jsonl (parent mailbox) — primary
  ├─ AND writes copies of {submitted, completed, failed, input-required} to {B}→lead.jsonl
  └─ status flows back through both channels

Lead Agent
  ├─ team-status.sh shows the full tree (root tasks + handoff descendants)
  └─ mailbox cc gives lifecycle visibility without flooding
```

### Message envelope

```ts
// shared/agent-message-types.ts (modified)
export interface AgentMessageBase {
  id: string
  timestamp: string
  from: string
  to: string
  chatId: string
  type: AgentMessageType
  protocolVersion: '1.0'
  taskId?: string
  replyTo?: string
  dispatchChain: string[]  // PROMOTED FROM OPTIONAL TO REQUIRED
  budget?: {
    tokens: number
    usd?: number
  }
}
```

### Server-side aggregate exposed to Lead

```ts
// team-status.sh JSON response (extended)
{
  "experts": [
    {
      "instanceId": "fullstack-product-engineer",
      "phase": "working",
      "tokensUsed": 12450,
      "currentTask": {
        "taskId": "task-...",
        "dispatchChain": ["lead", "architect", "fullstack-product-engineer"],
        "rootTaskId": "task-..."  // the Lead-originated task
      }
    }
  ],
  "dispatchTrees": [
    {
      "rootTaskId": "task-abc",
      "originator": "lead",
      "tree": {
        "lead → architect": { "status": "completed", "tokensUsed": 3200 },
        "  architect → fullstack-product-engineer": { "status": "working", "tokensUsed": 12450 }
      }
    }
  ]
}
```

## Failure modes & responses

| Failure | Server response | UX |
|---|---|---|
| Target not in `allowedTargets` | 403 with reason | Source Expert sees error in script stdout; logs `task:failed` on its own task |
| Depth exceeded | 403 | Same — Source Expert reports `task:failed` to its parent |
| Cycle detected | 403 | Same |
| Budget insufficient | 403 | Source Expert escalates `task:input-required` to Lead, asking for budget extension or termination |
| Target Agent definition missing | 503 | `task:failed` with hint to check `openteam.json` |
| `OPENTEAM_DISABLE_PEER_HANDOFF=1` | 403 | Source Expert sees disabled message; falls back to escalating to Lead |
| `--no-handoff` flag set on root dispatch | 403 | Same — fall back to Lead-mediated path |

## What stays the same

- Mailbox file format (`from→to.jsonl`)
- SSE event stream from `/api/expert/events`
- Whiteboard storage and query API
- Lead role boundary (Read/Grep/Bash-readonly + dispatch only)
- Single Lead per chat
- Single chat = single dispatch tree (no cross-chat handoff)
- All existing message types continue to work

## Migration

- All existing Agents have empty `handoffPolicy` by default → no behavior change
- Operators opt in by adding `handoffPolicy.allowedTargets` per Agent
- The `wb-post-tool-write.sh` rejection logic is replaced with recording in one PR; existing whiteboards keep working (handoff entries are append-only)
- `dispatchChain` becoming required is enforced via `createAgentMessage` helper that auto-populates `[]` when absent — existing producers do not need to change

## Open questions (for review)

1. Should `maxDepth` be globally configurable (env var) in addition to per-Agent, for emergency tightening? — proposed: yes, `OPENTEAM_HANDOFF_MAX_DEPTH=N` clamps every per-Agent setting downward.
2. Should `handoffPolicy.allowedTargets` support wildcards (`["*"]`)? — proposed: no. Explicit lists only; the operator must name every collaborator.
3. Should the user be able to approve a handoff interactively (one-time consent dialog) instead of pre-configuring the policy? — proposed: not in v1. Pre-configuration is sufficient and avoids interrupting the user mid-dispatch. Revisit if user testing shows demand.
