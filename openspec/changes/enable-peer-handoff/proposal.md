# Enable Peer-to-Peer Agent Handoff

## Summary

Open up direct Expert-to-Expert handoff so any Agent can hand a task off to another Agent without going through the Lead. This change introduces a `peer-handoff` capability with explicit safeguards: per-Agent handoff policy, max chain depth, budget inheritance, mandatory Lead visibility cc, dispatch-chain audit trail in the mailbox protocol and the whiteboard, and a per-task / global kill switch.

The protocol layer already reserves an `Expert → Expert handoff` message type and a `HandoffPayload` interface (`shared/agent-message-types.ts:152`), but no end-to-end path exists today: only the `lead` Agent has the `expert-dispatcher` skill and the `subAgentNames` field (`openteam.json:23`), and a defensive hook explicitly rejects handoff chains (`ai-assets/hooks/wb-post-tool-write.sh:62-67`). This proposal lights up that path with bounds.

## Motivation

Current state forces every cross-Agent collaboration through the Lead:

- `code-reviewer` finds a refactor opportunity → must report to Lead → Lead re-dispatches `fullstack-product-engineer`
- `architect` finishes design doc → must report to Lead → Lead dispatches `fullstack-product-engineer` with the doc
- `ui-designer` needs `fullstack-product-engineer` to wire a hook → same round trip

Every hop adds latency, Lead-side LLM token cost (re-reading context to make the dispatch decision), and a serialization point that defeats the parallelism the system is supposed to enable. For tightly-coupled handoffs (review → fix, design → implement, scaffold → polish) the Lead is mechanical glue, not a value-adding decision-maker.

Opening peer handoff is a deliberate trade: we accept the UX risks documented in `design.md` (loss of single-pane visibility if uncontrolled, dispatch-chain explosion, runaway cost) in exchange for shorter critical paths and lower Lead overhead. The safeguards below are non-negotiable — without them this change is net-negative for the attention-first product positioning.

### Why now

1. The protocol substrate (`HandoffPayload`, `dispatchChain` placeholder in `createAgentMessage`) is already in place — lighting it up is incremental, not green-field.
2. Recent additions of specialized Experts (`growth-marketer`, `product-strategist`) increase the realistic count of multi-step Expert chains that benefit from skipping the Lead.
3. The `agent-evolution` capability proposed in `review-multi-agent-collab` introduces per-task budget tracking, which is a hard prerequisite for safe handoff (without it, a handoff chain has no spending ceiling).

## Goals

1. **Define a `peer-handoff` capability** — explicit, bounded, auditable Expert → Expert dispatch.
2. **Per-Agent handoff policy** — each Expert declares the set of Agents it MAY hand off to; policy is configuration, not prompt-only convention.
3. **Mandatory dispatch-chain telemetry** — every message carries the full `dispatchChain` of Agent IDs from the originating Lead dispatch; the chain is enforced server-side.
4. **Bounded chain depth** — hard cap on chain length; cycles forbidden; over-depth handoffs rejected before launch.
5. **Lead visibility preserved** — every peer handoff cc's `task:submitted` / `task:completed` / `task:failed` to the Lead's mailbox; the Lead remains the single observation point even when it is not the dispatcher.
6. **Budget inheritance** — child task budget is carved out of remaining parent task budget; no peer handoff can grow the total token / USD ceiling assigned at the original Lead dispatch.
7. **User kill switches** — per-task `--no-handoff` flag and global `OPENTEAM_DISABLE_PEER_HANDOFF=1` env var both hard-disable peer handoff.
8. **UI surfacing** — the workspace UI displays the dispatch chain inline so the user always sees `lead → architect → fullstack-product-engineer`, never just the leaf.

## Non-Goals

- **No Swarm topology**. Peer handoff is a controlled exception to the Supervisor pattern, not a topology change. There is still exactly one `lead` per chat; the Lead remains the only Agent that can originate a top-level dispatch from a user message.
- **No new transport.** Mailbox JSONL files + SSE stay. No message broker, no queue.
- **No A2A external transport**. State names and payload shapes align with the canonical names introduced in `review-multi-agent-collab/agent-messaging` but stay local.
- **No automatic handoff**. Every handoff is an explicit Agent decision invoking a script — never silent or implicit.
- **No handoff to the Lead**. Experts cannot "hand off" back to the Lead; that is a regular `task:completed` / `task:input-required` / `task:failed` and stays unchanged.
- **No handoff across chats**. Handoff target MUST be in the same `chatId`.

## Approach

A single new capability `peer-handoff` that codifies the authorization, lifecycle, telemetry, and bounds. Two existing capabilities defined in the in-flight `review-multi-agent-collab` change will need targeted updates at archive time (`multi-agent-orchestration` requirement "Worker-to-Worker handoff is rejected" must be reworded; `agent-messaging` must promote `dispatchChain` from optional to mandatory). Those updates are tracked in `tasks.md` Phase 0 as preconditions and do not need their own delta in this change since `review-multi-agent-collab` has not yet archived.

| Component | Change |
|---|---|
| `openteam.json` | Add `handoffPolicy: { allowedTargets: [...], maxDepth?: number }` per Expert |
| `expert-dispatcher` skill | New `handoff-to-expert.sh`; existing scripts unchanged |
| `server/routes/agent/expertRoutes.ts` | New `POST /api/expert/handoff` endpoint, distinct from `start`, enforces policy + depth + budget |
| `shared/agent-message-types.ts` | Promote `dispatchChain` to required; reuse existing `HandoffPayload` |
| `server/mailbox/MailboxManager.ts` | Auto-cc Lead on `task:submitted | completed | failed` for handoff-spawned tasks |
| `server/budget/TaskBudgetTracker.ts` (from `review-multi-agent-collab` Phase 4) | Reject handoff if remaining budget < `MIN_HANDOFF_BUDGET` |
| `ai-assets/hooks/wb-post-tool-write.sh` | Replace handoff-chain rejection with handoff-chain *recording* (write `handoff` whiteboard entry with full chain) |
| Workspace UI | Render dispatch chain on task cards; surface `--no-handoff` toggle in dispatch dialog |
| Each Expert's SOUL.md | Add `expert-dispatcher` skill (handoff scripts only); add brief handoff-when-to-use guidance |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Dispatch chain explosion (A→B→C→D…) | High | Hard `maxDepth` (default 2, ceiling 3) enforced server-side; reject and emit `task:failed` if exceeded |
| Cycle (A→B→A) | High | Server-side check: target MUST NOT appear in the existing `dispatchChain` |
| Cost runaway in user-absent windows | High | Budget inheritance + `MIN_HANDOFF_BUDGET` floor + 100% pause from `agent-evolution` |
| Loss of Lead visibility | High | Mandatory cc to Lead on lifecycle terminals; Lead can interrupt any descendant |
| User confusion ("who started this?") | Medium | UI displays full `dispatchChain`; whiteboard records every handoff with `by` field |
| Authorization drift (Expert hands to disallowed target) | Medium | `handoffPolicy.allowedTargets` enforced server-side, not by prompt |
| Backward compat with single-Lead chats | Low | Default `handoffPolicy` is empty (no targets) — peer handoff opt-in per Agent |
| Conflict with `review-multi-agent-collab` "Worker-to-Worker rejected" requirement | Low | Coordinated via Phase 0 task — reword that requirement before archiving either change |

## Coordination with In-Flight Changes

This change has hard dependencies on capabilities introduced in `review-multi-agent-collab`:

- `agent-messaging` — relies on the canonical `task:submitted | working | input-required | completed | failed` state machine
- `agent-evolution` — relies on `TaskBudgetTracker` for budget inheritance
- `multi-agent-orchestration` — must reword "Worker-to-Worker handoff is rejected" to permit policy-gated peer handoff

Recommended sequencing: archive `review-multi-agent-collab` first (or merge it into this change's prerequisite Phase 0), then this change. The two changes are not in conflict if applied in order.
