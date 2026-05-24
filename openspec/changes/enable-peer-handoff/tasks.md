# Tasks — Enable Peer-to-Peer Agent Handoff

Phase 0 establishes preconditions and is blocking. Phases 1–6 deliver the capability incrementally; each phase is shippable on its own with the kill switch (`OPENTEAM_DISABLE_PEER_HANDOFF=1`) keeping production behavior unchanged until Phase 6.

## Phase 0 — Preconditions

- [ ] 0.1 Land `proposal.md`, `design.md`, `tasks.md`, and the `peer-handoff` spec delta in `openspec/changes/enable-peer-handoff/`
- [ ] 0.2 Confirm `review-multi-agent-collab` change exists and has `agent-evolution` (TaskBudgetTracker) and `agent-messaging` (canonical state names) — peer handoff depends on both
- [ ] 0.3 Reword the "Worker-to-Worker handoff is rejected" Scenario in `openspec/changes/review-multi-agent-collab/specs/multi-agent-orchestration/spec.md` to "Worker-to-Worker handoff requires policy approval" — coordinated edit, both changes archive together
- [ ] 0.4 Promote `dispatchChain` from optional to required in `openspec/changes/review-multi-agent-collab/specs/agent-messaging/spec.md`
- [ ] 0.5 Run `openspec validate enable-peer-handoff --strict` — must pass before implementation begins

## Phase 1 — Authorization layer (config + types)

- [ ] 1.1 Extend `openteam.json` schema to allow `handoffPolicy: { allowedTargets: string[], maxDepth?: number }` per Agent in `agents.list[]`
- [ ] 1.2 Add `HandoffPolicy` type to `shared/agent-message-types.ts`
- [ ] 1.3 Update `server/agent/AgentRegistry` (or equivalent loader) to surface `handoffPolicy` per Agent
- [ ] 1.4 Add `server/__tests__/AgentRegistryHandoffPolicy.test.ts` — verify default empty policy, parsed allowedTargets, default maxDepth=2
- [ ] 1.5 Default for all existing Experts: empty policy (no peer handoff). Land config-only commit; no behavior change yet.

## Phase 2 — Server endpoint + dispatch chain

- [ ] 2.1 Promote `dispatchChain: string[]` to required in `shared/agent-message-types.ts` `AgentMessageBase`; update `createAgentMessage` to default to `[]`
- [ ] 2.2 Add `POST /api/expert/handoff` to `server/routes/agent/expertRoutes.ts` — body: `{ from, to, task, chatId, sourceTaskId, budget?, handoffPayload }`
- [ ] 2.3 Implement authorization check: caller's `instanceId` is alive in `chatId`; target is in caller's `handoffPolicy.allowedTargets`
- [ ] 2.4 Implement depth check: `dispatchChain.length < maxDepth` (use min of per-Agent and `OPENTEAM_HANDOFF_MAX_DEPTH` env var)
- [ ] 2.5 Implement cycle check: target NOT in current `dispatchChain`
- [ ] 2.6 Implement kill-switch checks: `OPENTEAM_DISABLE_PEER_HANDOFF=1` and per-task `--no-handoff` flag inherited via `dispatchChain` metadata
- [ ] 2.7 On success: create child task, append source agentId to `dispatchChain`, launch target Expert via existing `ExpertHandler.handleStart` with the augmented envelope
- [ ] 2.8 On failure: return 403 with structured reason (`policy_violation | depth_exceeded | cycle | budget_insufficient | disabled`)
- [ ] 2.9 Add `server/__tests__/expertHandoffEndpoint.test.ts` — cover all reject paths and the happy path

## Phase 3 — Budget inheritance

- [ ] 3.1 In `POST /api/expert/handoff`, fetch parent task remaining budget from `TaskBudgetTracker`
- [ ] 3.2 Reject if requested child budget > parent remaining; reject if requested child budget < `MIN_HANDOFF_BUDGET` (default 5000 tokens)
- [ ] 3.3 Reject if `OPENTEAM_HANDOFF_REQUIRE_BUDGET=1` (production default) and parent has no budget
- [ ] 3.4 Register child task with `TaskBudgetTracker` carrying the carved budget; on completion, refund unused portion to parent for further handoffs (idempotent)
- [ ] 3.5 Add `server/__tests__/HandoffBudgetInheritance.test.ts` — verify budget partition, refund, floor enforcement

## Phase 4 — Mailbox cc + lifecycle

- [ ] 4.1 In `MailboxManager.writeMessage`, when message is on a handoff-spawned task and type ∈ `{task:submitted, task:completed, task:failed, task:input-required}`, also append a copy to `{from}→lead.jsonl`
- [ ] 4.2 Mark cc'd messages with `payload.cc: true` so the Lead can render them differently (or filter them out of "primary" feed)
- [ ] 4.3 Update `team-status.sh` server handler to assemble a `dispatchTrees` view: per root task, the full descendant chain with status + tokens
- [ ] 4.4 Update SSE filter (`expertRoutes.ts:349-358`) to forward terminal cc'd events to the Lead's WS connection
- [ ] 4.5 Add `server/__tests__/HandoffMailboxCC.test.ts` — verify cc happens for terminals only, not `task:working`

## Phase 5 — Skill scripts + whiteboard

- [ ] 5.1 Add `ai-assets/skills/expert-dispatcher/scripts/handoff-to-expert.sh` — wraps `POST /api/expert/handoff`, reads source instanceId from env, validates inputs, returns child taskId
- [ ] 5.2 Update `ai-assets/skills/expert-dispatcher/SKILL.md` — document `handoff-to-expert.sh` usage, when-to-use guidance, and `--no-handoff` behavior on root dispatches
- [ ] 5.3 Add `ai-assets/skills/expert-dispatcher/references/handoff-protocol.md` — concrete examples of policy + chain + budget interactions
- [ ] 5.4 Replace handoff-rejection logic in `ai-assets/hooks/wb-post-tool-write.sh:62-67` with handoff-recording: write a `handoff` whiteboard entry on every successful peer handoff with `{ from, to, sourceTaskId, summary, chain }`
- [ ] 5.5 Update `ai-assets/skills/whiteboard/SKILL.md` — document the new `handoff` entry semantics under peer-handoff
- [ ] 5.6 Update each peer-eligible Expert's SOUL.md (e.g., `code-reviewer`, `architect`) to add `expert-dispatcher` skill scoped to handoff scripts only, with brief "when to handoff vs escalate to Lead" guidance
- [ ] 5.7 Sanity test: dispatch a task to `code-reviewer`, watch it hand off to `fullstack-product-engineer`, observe whiteboard entry + Lead cc + UI breadcrumb

## Phase 6 — UI + user controls

- [ ] 6.1 Render `dispatchChain` as a horizontal breadcrumb on workspace task cards (`web/components/...`)
- [ ] 6.2 Make breadcrumb segments clickable — navigate to that Agent's session
- [ ] 6.3 Surface `--no-handoff` toggle in the dispatch dialog (when user starts a task from UI)
- [ ] 6.4 Surface a "Peer handoff" status indicator on the team-status panel — green = enabled, gray = disabled per kill switch, yellow = enabled but no Agents have policies configured
- [ ] 6.5 When a handoff is rejected (depth/policy/cycle), surface a non-modal toast in the UI with the reason and a link to the source Agent's session
- [ ] 6.6 Add `web/__tests__/DispatchChainBreadcrumb.test.tsx` — render the breadcrumb for chains of length 1, 2, 3
- [ ] 6.7 Update README / user docs with a "Peer handoff" section: opt-in steps, kill switches, troubleshooting

## Phase 7 — Validation & rollout

- [ ] 7.1 End-to-end test: a real chat with `architect` → `fullstack-product-engineer` policy enabled, observe full lifecycle including budget, cc, whiteboard, UI breadcrumb
- [ ] 7.2 Soak test: 10 successive peer handoffs in one chat — assert no orphan tasks, no budget drift, Lead inbox not flooded
- [ ] 7.3 Failure-injection test: target Agent crashes mid-task — verify parent receives `task:failed` and Lead receives cc
- [ ] 7.4 Document the rollout plan in `review.md` — staged enablement (start with one Expert pair, expand after one week)
- [ ] 7.5 Add a metrics line to `team-status.sh` output: `peerHandoffsToday: N` for observability
- [ ] 7.6 Get architect + lead sign-off on the live behavior before flipping `OPENTEAM_DISABLE_PEER_HANDOFF` to default-off
