# Tasks — Review Multi-Agent Collab

Each task is small, verifiable, and ships user-visible progress. Phases 1–4 align 1:1 with the four spec deltas. Phases can run in parallel after Phase 0; tasks within a phase are sequential.

## Phase 0 — Foundation (blocks Phases 1–4)

- [ ] 0.1 Land `proposal.md`, `design.md`, `tasks.md`, and four spec deltas in `openspec/changes/review-multi-agent-collab/` (this PR)
- [ ] 0.2 Run `openspec validate review-multi-agent-collab --strict` — all green
- [ ] 0.3 Get architect + lead sign-off on `proposal.md` and `design.md`

## Phase 1 — Orchestration Contract (capability: `multi-agent-orchestration`)

- [ ] 1.1 Create `server/contract/OrchestrationContract.ts` — typed constants for `TaskState`, `DispatchLifecycle`, `EscalationPath`
- [ ] 1.2 Cite the contract from `ai-assets/skills/expert-dispatcher/SKILL.md` and `ai-assets/skills/whiteboard/SKILL.md` (single source-of-truth link, no duplication)
- [ ] 1.3 Add `server/__tests__/OrchestrationContract.test.ts` — verify constants match `agent-message-types.ts`
- [ ] 1.4 Document role boundaries (Lead vs Expert) in spec — Lead MUST NOT execute tools listed in `lead.allowedTools` exclusion (Bash with side effects, Edit, Write — already enforced by `openteam.json:24-27`)
- [ ] 1.5 Document termination guarantees — every dispatched task reaches one of `completed | failed | canceled` within bounded time (no orphaned `working` state)

## Phase 2 — Message Protocol Hardening (capability: `agent-messaging`)

### 2A — Bug fixes

- [ ] 2.1 Fix `expertRoutes.ts:349-358` SSE filter — forward `task:warning`, `task:blocked` (transitional), and any new canonical types, not only `task:input_required|completed|failed`
- [ ] 2.2 Fix `expertRoutes.ts:129` — when `getConnectionWs` returns undefined, queue events to in-memory buffer keyed by `instanceId` and replay on next WS attach instead of silently dropping
- [ ] 2.3 Add `server/__tests__/expertRoutesSSE.test.ts` — verify each canonical message type round-trips through SSE

### 2B — State alias layer

- [ ] 2.4 In `shared/agent-message-types.ts`, add canonical type names + alias table mapping legacy types (`task:progress` → `task:working`, etc.)
- [ ] 2.5 Update `MailboxManager.writeMessage` to normalize legacy aliases on write, log deprecation warning
- [ ] 2.6 Update `check-inbox.sh:25-45` jq filter to recognize both old and new names; prefer canonical in display
- [ ] 2.7 Update `expert-dispatcher/references/message-protocol.md` — replace table with canonical state machine + alias note
- [ ] 2.8 Add `server/__tests__/MessageProtocolAlias.test.ts` — every alias round-trips and emits deprecation warning exactly once per process

### 2C — Producer migration

- [ ] 2.9 Replace `task:progress` emit sites with `task:working` (grep `'task:progress'` in `server/` and `ai-assets/`)
- [ ] 2.10 Collapse `task:milestone` into `task:working` with `milestone` field
- [ ] 2.11 Drop `task:idle` (covered by `task:working` with empty phase)
- [ ] 2.12 Update agent prompts that quote message types (architect SOUL, fullstack-product-engineer SOUL, etc.) — search for `task:` in `ai-assets/agents/`

## Phase 3 — Episodic Memory Index (capability: `agent-memory`)

- [ ] 3.1 Add migration `server/stores/migrations/v22.ts` — create `episodic_tasks` table per `design.md`
- [ ] 3.2 Create `server/memory/EpisodicMemoryIndex.ts` — `recordCompletion(taskId)` parses `result.md` + token usage, inserts row
- [ ] 3.3 Hook `EpisodicMemoryIndex.recordCompletion` into `ExpertHandler` task-complete path (and task-failed for negative examples)
- [ ] 3.4 Add `EpisodicMemoryIndex.lookup(agentId, queryText, limit=3)` — BM25 over title+summary+tags, weighted toward `outcome=completed` and recency
- [ ] 3.5 Augment `ExecutionPlanManager.createPlan` — prepend "## Prior similar tasks" section pulled from `EpisodicMemoryIndex.lookup`
- [ ] 3.6 Add `server/__tests__/EpisodicMemoryIndex.test.ts` — record + lookup roundtrip; ranking respects recency + outcome
- [ ] 3.7 Add a hidden CLI flag `OPENTEAM_DISABLE_EPISODIC=1` for opt-out; document in README troubleshooting

## Phase 4 — Cost Ledger + Budget Guardrail (capability: `agent-evolution`)

- [ ] 4.1 Extend `TaskEnvelope` in `shared/agent-message-types.ts` with optional `budget` block
- [ ] 4.2 Create `server/budget/TaskBudgetTracker.ts` — subscribes to `ExpertTokenTracker`, checks against task budget, emits `task:warning` at 75% and `task:input-required` (with kind=`budget_exceeded`) at 100%
- [ ] 4.3 Wire `TaskBudgetTracker` into `ExpertLifecycle` start/stop
- [ ] 4.4 Add `cost: { tokensUsed, tokensBudget?, usdEstimate }` to `team-status.sh` JSON response (`expertHandler.getTeamStatus`)
- [ ] 4.5 Surface running cost line in UI task list (one new column or sub-row)
- [ ] 4.6 Add `server/__tests__/TaskBudgetTracker.test.ts` — verify 75% warn, 100% pause, no false positives with budget=null
- [ ] 4.7 Document budget syntax in `expert-dispatcher/SKILL.md` (`start-expert.sh --budget tokens=50000`)

## Phase 5 — Cross-cutting verification

- [ ] 5.1 Manual e2e: dispatch 3 parallel experts with budgets, hit one budget, verify Lead is notified and can extend or kill
- [ ] 5.2 Manual e2e: complete a task → verify `episodic_tasks` row exists → dispatch a similar task → verify prior summary appears in plan.md
- [ ] 5.3 Update `openspec/AGENTS.md` quick-reference with the new canonical message types (link to spec, do not duplicate)
- [ ] 5.4 Architecture review by `architect` agent — write `review.md` under "Architecture Review"
- [ ] 5.5 Code review by `code-reviewer` agent — write `review.md` under "Code Review"
- [ ] 5.6 Run `openspec validate review-multi-agent-collab --strict` again before archive
- [ ] 5.7 Archive: merge `specs/*` into `openspec/specs/*`, mark complete

## Parallelization Notes

- Phase 1 (contract) is the cheapest and unblocks reference links elsewhere — do first.
- Phase 2A (bug fixes) is independent of 2B/2C and should ship as soon as 1 lands.
- Phase 3 and Phase 4 have no overlap; can run by different owners in parallel after Phase 1.
- Phase 5 verification depends on 1–4 being merged.
