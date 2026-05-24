# Review Multi-Agent Collab — Harden Dispatch, Memory, and Observability

## Summary

A structured review of OpenTeam's current multi-Agent collaboration mechanism (Lead/Expert dispatch, mailbox, whiteboard, plan.md, per-Agent memory), benchmarked against external research (15 docs covering orchestration patterns, A2A/ACP/MCP protocols, memory layering, self-evolution, cloud/local hybrid, and attention-pain research). The proposal converts the review findings into four concrete capability deltas — leaving the existing single-Lead/Supervisor architecture intact (it's the right fit for an attention-first, pulse-mode single operator workflow), and instead hardening the seams where the current mechanism leaks load onto the user.

**This is a review-driven proposal, not a rewrite.** The goal is to ship four incremental upgrades that resolve concrete gaps and ship value without changing the orchestration topology.

## Motivation

### What the current system is

Today OpenTeam runs a **Supervisor + Mailbox + Blackboard** hybrid:

- `lead` agent dispatches to up to 9 experts via `expert-dispatcher` skill (`ai-assets/skills/expert-dispatcher/SKILL.md:1`) over an HTTP API (`server/routes/agent/expertRoutes.ts:68-175`)
- Inter-agent messages flow through a file-based mailbox at `~/.openteam/mailbox/{chatId}/{from}→{to}.jsonl` (`server/mailbox/MailboxManager.ts:56`), exposed as `/api/expert/inbox/:instanceId` with per-instance byte cursors
- A SSE stream at `/api/expert/events` pushes only terminal phase transitions and a fixed subset of task events (`expertRoutes.ts:324-371`)
- A chat-scoped whiteboard (`server/whiteboard/WhiteboardManager.ts:55`) captures `goal | decision | artifact | progress | open_question | constraint | handoff` entries
- Each task gets a `plan.md` + `result.md` under `~/.openteam/tasks/{taskId}/` (`server/mailbox/ExecutionPlanManager.ts:22`)
- Each agent has filesystem memory under `ai-assets/agents/<id>/memory/` and a heartbeat loop (`openteam.json:48-52`)

### What the research surfaces

1. **Orchestration pattern is correct, but undocumented as a contract.** OpenTeam is a Supervisor hybrid (single Lead + parallel Workers + Blackboard + plan.md as per-task scratch). The multi-agent orchestration research confirms Supervisor is the right pick for ≤5–10 worker agents with clear dispatch. The current implementation matches, but the orchestration contract is implicit — there's no single spec describing dispatch semantics, retry, termination, or escalation. New agents (growth-marketer, product-strategist were both added recently) must reverse-engineer the rules from skill MDs.

2. **Message protocol is local-only and divergent from emerging standards.** The mailbox protocol (`expert-dispatcher/references/message-protocol.md:1-85`) defines 12 message types over logfmt JSONL files. A2A/ACP both standardize on `submitted → working → input-required → completed/failed/canceled` plus an `Artifact` concept. OpenTeam's `task:progress`, `task:milestone`, `task:idle`, `task:blocked` types overlap inconsistently and lack a documented state machine; `task:idle` and `task:milestone` are referenced in `check-inbox.sh:30-31` but have no protocol entry. This isn't an A2A migration ask — it's a contract-hardening ask, with future A2A interop kept open.

3. **Memory layering is missing the "episodic" tier.** Per-agent `memory/YYYY-MM-DD.md` is procedural/semantic mixed; CoALA's four-class taxonomy calls out **episodic memory** (task trajectories with outcome) as the substrate for the "dreaming" / Hermes / EvolveR self-improvement loops. OpenTeam already captures every task as `plan.md + result.md` but never indexes or replays them — the substrate exists, the loop doesn't.

4. **Attention-pain mitigations are partial.** The pain research is unusually directly applicable: GitHub voted with 50K+ stars on observability tools. OpenTeam has good pieces — `team-status.sh` (server-memory aggregate), SSE events, whiteboard — but is missing two specific things the research highlights: (a) **a pre-execution guardrail layer** (Aegis pattern), specifically a budget/scope kill-switch for runaway experts; (b) **a single-pane cost view** — token totals exist per chat but there's no per-task / per-expert running ledger surfaced into the UI loop.

5. **Real bugs in current mechanism.** Code review surfaced concrete issues: `expertRoutes.ts:129` warns that `getConnectionWs` may return undefined, in which case `expert:data` events are silently lost — a known data-loss path with only a log warning, no recovery. The mailbox SSE `/api/expert/events` only forwards `task:input_required | task:completed | task:failed` (`expertRoutes.ts:349-358`) — `task:blocked` and `task:milestone` defined in the protocol are never pushed, forcing the Lead to fall back to polling for those.

### Why now

Recent change directories (`add-growth-marketer-agent`, `add-product-strategist-agent`, `redesign-layout-agent-workspace`, `cleanup-codebase-redundancy`) all touch the agent / dispatch surface. Without a documented orchestration contract, every new agent rediscovers the rules and reinforces drift. Locking the contract before further additions is cheap; doing it after is not.

## Goals

1. **Document the orchestration contract** as a versioned spec (Supervisor topology, dispatch lifecycle, retry/termination, escalation rules, role boundaries) — so new agents and new agent types have one source of truth.
2. **Harden the inter-agent message protocol** — close the gaps between `message-protocol.md`, `check-inbox.sh`, the SSE event stream, and the actual emitted types; align state names with A2A/ACP terminology to keep interop optional but available.
3. **Add an episodic memory index** — make existing `plan.md` + `result.md` searchable per-agent, with a minimal pre-task lookup (last N successful task summaries on the same topic) so experts stop re-deriving from scratch.
4. **Add a guardrail + ledger layer** — per-task token/cost budget with soft warn + hard stop, and a running per-expert cost line in `team-status.sh` and the UI, addressing the attention-pain findings directly.

## Non-Goals

- **No topology change.** Not switching to Swarm, Hierarchical, or any A2A/ACP transport. Single Lead is correct at current agent count (9). Revisit only when team size > 15 or cross-org sharing is on the roadmap.
- **No external A2A/ACP server.** Protocol alignment is naming/state-machine only; no HTTP `/.well-known/agent.json`, no JSON-RPC, no Agent Card emission.
- **No new transport layer.** Mailbox files + SSE remain the substrate. No message queue, no broker, no Redis.
- **No model fine-tuning or RL loop.** Self-evolution stays non-parametric: index + retrieve existing trajectories, do not modify weights.
- **No mobile / external notification channel** (Lucarne pattern). Out of scope for this proposal; tracked separately.
- **Not unifying with the cloud/Pod codepath** (cloud-debug skill). The cloud handoff is its own change.

## Approach

Four spec deltas, each independently shippable:

| Capability | Delta type | Files | Risk |
|---|---|---|---|
| `multi-agent-orchestration` | NEW | New spec; new `openspec/specs/multi-agent-orchestration/` after archive | Low — codifies existing behavior + 2 small clarifications |
| `agent-messaging` | NEW | New spec; refactors `message-protocol.md`, fixes 2 SSE bugs, aligns state machine | Medium — touches `expertRoutes.ts`, `check-inbox.sh`, `MailboxManager` |
| `agent-memory` | NEW | Adds `EpisodicMemoryIndex` service + pre-task hook; reuses `~/.openteam/tasks/` | Low — additive read-side |
| `agent-evolution` | NEW | Cost ledger + budget guardrail + pre-execution check | Medium — touches expert lifecycle and team-status output |

Each capability gets its own spec folder per OpenSpec convention. See `design.md` for architectural reasoning and trade-offs.

## Risks

- **Spec sprawl**: adding four spec folders for one review could feel heavy. Mitigation: each delta maps 1:1 to a discrete code change owner, and the deltas have no cross-dependency.
- **Protocol-rename churn**: aligning task state names with A2A (`working` vs `in_progress`) will touch `check-inbox.sh`, the SSE filter, and several agent prompts. Mitigation: keep old names as aliases for one release; emit warnings.
- **Budget guardrail false positives**: an over-eager hard-stop interrupts legitimate long tasks. Mitigation: hard-stop only on explicit per-task budget; default is soft warn + ask user.
- **Episodic memory privacy**: indexing all `result.md` raises leakage risk if a user wants per-project isolation. Mitigation: index is per-agent under `ai-assets/agents/<id>/memory/episodic/`, never cross-agent; scoped to current chat's workspace by default.
