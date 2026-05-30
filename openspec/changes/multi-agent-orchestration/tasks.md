# Tasks: Adaptive Multi-Agent Orchestration

## Phase 1: Agent-to-Agent Handoff

- [x] Design Handoff skill directory structure (`ai-assets/skills/handoff/`)
- [x] Create `handoff.sh` script — calls `POST /api/expert/handoff`, exits 0 on success / 1 on failure
- [x] Implement server endpoint `POST /api/expert/handoff` in expertRoutes
- [x] Implement connectionId resolution: chatId + sourceAgentId → ExpertSessionStore → connectionId → WebSocket
- [x] Implement HandoffContext assembly (original message, work summary, relevant files, key findings)
- [x] Inject HandoffContext into target Agent's prompt via ConfigCompiler (plan.md extension)
- [x] Spawn target Agent via ExpertLifecycle under source Agent's connectionId
- [x] Return sync success/failure response to handoff.sh (Agent A stays alive until confirmed)
- [x] Handle handoff failure: return error → Agent A continues working, `handoff:failed` whiteboard entry
- [x] Record successful handoff in Whiteboard (war-room) as `handoff` entry type
- [x] Enforce max chain depth (1) via `dispatchChain` field in AgentMessage
- [x] Add `handoff` skill to all Expert agents in `openteam.json`
- [x] Add "Handoff Awareness" section to all Expert SOUL.md files (when to handoff, targets table)
- [x] Emit `expert:handoff` WebSocket event to frontend on successful handoff
- [ ] Test: Agent A detects task mismatch → hands off to Agent B → B completes with context
- [ ] Test: Chain depth limit (A → B allowed, B → C rejected with error)
- [ ] Test: Handoff failure (target agent config not found) → Agent A continues working

## Phase 2: Execution Mode Router + T1 Direct Execution

- [x] Create `server/orchestration/ExecutionModeRouter.ts` — keyword/regex classifier
- [x] Build bilingual (EN/ZH) dispatch keyword table in `server/orchestration/dispatchRules.ts`
- [x] Include conjunction detection keywords (EN: and/also/plus, ZH: 并且/同时/以及/还要/另外)
- [x] Include dependency detection keywords (EN: then/after/once, ZH: 然后/之后/完成后/先...再)
- [x] Include action verb counting heuristic (multiple action verbs → route to Lead)
- [x] Integrate Router into `WSRouter.ts` at `expert:start` branch — classify before ExpertHandler delegation
- [ ] Add `handleStartDirect(agentId, message, chatId)` method to ExpertHandler — skip Lead, spawn Expert directly
- [ ] Create simplified plan.md generation for T1 (user input + whiteboard context, no TaskEnvelope from Lead)
- [ ] Ensure T1 Expert writes results to Whiteboard for cross-session visibility
- [x] Add `executionMode` field to `expert:started` WebSocket event payload
- [ ] Add `orchestration.router` config section to `openteam.json` schema
- [ ] Add T1 execution tracking to `execution_logs` (new `execution_mode` column)
- [ ] Test: verify "fix this CSS bug" routes directly to ui-designer (T1)
- [ ] Test: verify "修复这个CSS样式问题" routes to ui-designer (T1, Chinese)
- [ ] Test: verify ambiguous input falls back to T2 (Lead dispatch)
- [ ] Test: verify "fix the bug and update docs" routes to Lead (conjunction detected)
- [ ] Test: verify T1 Expert can Handoff if task turns out to need another agent

## Phase 3: T0 Lead Conversation Mode

- [x] Add "Conversation Mode (Direct Answer)" section to Lead SOUL.md
- [x] Define answer-vs-dispatch decision criteria (question patterns, no action verbs, context sufficiency)
- [ ] Add examples of T0-eligible vs dispatch-required messages to Lead SOUL.md
- [ ] Test: verify Lead answers "what does this function do?" directly without spawning Expert
- [ ] Test: verify Lead dispatches Expert for "explain this and then fix the bug"
- [ ] Test: verify Lead transitions from T0 to T2 when user follow-up requires action

## Phase 4: Mailbox Deprecation

Must complete BEFORE Phase 5 (DAG Engine) so the DAG builds against the
clean communication model (SSE + Whiteboard), not the deprecated Mailbox.

Pre-deprecation instrumentation (1 week before removal):
- [x] Add call-site logging to `MailboxManager.readMessages()` to identify hidden consumers
- [x] Monitor logs for unexpected mailbox reads beyond `check-inbox.sh`

Stop writing:
- [x] Remove mailbox write block from `ExpertExitHandler.ts` (lines 207-232)
- [ ] Verify `watch-events.sh` SSE payload includes sufficient summary + artifact refs

Remove reading infrastructure:
- [x] Remove `check-inbox.sh` and `watch-inbox.sh` from expert-dispatcher skill scripts
- [x] Remove mailbox references from `expert-dispatcher/SKILL.md`

Remove server infrastructure:
- [x] Remove `MailboxManager` from server DI — 7 files: `ExpertExitHandler.ts`, `ExpertActivityHandler.ts`, `ExpertEventWiring.ts`, `ExpertLifecycle.ts`, `ExpertHandler.ts`, `server/index.ts`, `expertRoutes.ts`
- [x] Delete `server/mailbox/MailboxManager.ts`
- [x] Remove `~/.openteam/mailbox/` directory creation from server startup

Clean up types:
- [x] Mark deprecated AgentMessage types with `@deprecated` in `shared/agent-message-types.ts`: task:accepted, task:progress, task:milestone, task:idle, task:rejected, task:delegated, query, response
- [x] Keep active types: task:assign, task:completed, task:failed, task:input_required, task:blocked, handoff, artifact

Verify:
- [ ] Test: verify T2 Lead still detects Expert completion via SSE (watch-events.sh) without mailbox
- [ ] Test: verify no runtime errors from removed mailbox references
- [ ] Test: verify no hidden consumers surfaced during instrumentation period

## Phase 5: Workflow DAG Engine

Builds on the post-Mailbox communication model. Task completion detection
uses SSE event stream + Whiteboard artifact entries (NOT mailbox).

Core engine:
- [x] Define `WorkflowDAG`, `WorkflowTask`, `TaskCondition`, and `WorkflowResult` types in `shared/workflow-types.ts`
- [x] Include `onFailure` (stop/skip/retry), `maxRetries`, `timeoutMinutes` fields in `WorkflowTask`
- [x] Implement `TaskCondition` evaluator with allowlisted field access (status, summary, followUp only)
- [x] Create `server/orchestration/WorkflowEngine.ts` — DAG execution with dependency resolution
- [x] Implement task ready-set calculation (dependsOn resolution + structured condition evaluation)
- [ ] Implement parallel execution of independent ready tasks via ExpertLifecycle
- [ ] Integrate with SSE event stream + Whiteboard artifact entries for task completion detection

Failure handling and retry:
- [x] Implement `onFailure` policy: `stop` (halt DAG, skip remaining), `skip` (mark failed, continue non-dependents), `retry` (re-spawn Expert, up to maxRetries)
- [x] Implement `WorkflowResult` with per-task status (completed/failed/skipped/pending) and aggregate counts
- [x] Persist `result.json` to `~/.openteam/workflows/<id>/` on DAG completion or stop

Per-task timeout:
- [x] Implement per-task timeout timer (default 30 min, overridable in `WorkflowTask.timeoutMinutes`)
- [ ] On timeout: SIGTERM → 10s grace → SIGKILL → mark task `failed` with reason `timeout`
- [x] Apply `onFailure` policy after timeout-induced failure

DAG-internal Handoff awareness:
- [x] In Handoff endpoint: check if source Agent belongs to an active Workflow
- [x] If so: call `WorkflowEngine.reassignTask(workflowId, taskId, newAgentId)` to update task assignment
- [x] Update `state.json` with new agent assignment
- [x] Engine distinguishes handoff-exit (old agent, ignore) from task-completion (current agent, record result)

Checkpoint and recovery:
- [x] Implement checkpoint persistence (`~/.openteam/workflows/<id>/state.json`) using atomic write-then-rename
- [x] Add tmp file fallback: if `state.json` missing but `state.json.tmp` exists, read tmp on recovery
- [x] Implement workflow state machine: created → running → completed/stopped/suspended
- [x] Add `suspended` task state — distinct from `failed`, does not consume retry budget
- [x] Server startup: scan `~/.openteam/workflows/` for `running`/`suspended` workflows, reconcile with live processes
- [x] For `suspended` tasks: re-queue as `pending` (automatic retry)
- [x] For `running` tasks with dead processes: mark `failed` (apply onFailure policy)

Graceful shutdown integration:
- [x] Implement `WorkflowRegistry.suspendAll()` — marks in-progress tasks as `suspended`, persists checkpoint
- [x] Add `suspendAll()` call to `gracefulShutdown()` in `server/index.ts` BEFORE `sessionRegistry.killAll()`
- [x] Ensure shutdown ordering: flush checkpoints → kill Experts → close HTTP server
- [x] Create `list-workflows.sh` skill script (filter by status)
- [x] Create `resume-workflow.sh` skill script for resuming interrupted workflows
- [x] Add "Workflow Recovery" section to Lead SOUL.md: on startup, check for pending workflows and resume

Result aggregation:
- [x] `aggregateResults()` produces `WorkflowResult` with per-task breakdown
- [ ] Write Whiteboard `progress` entry on DAG completion with summary
- [ ] Emit `workflow:completed` WebSocket event to frontend (chatId, status, completedCount, totalCount)
- [ ] Frontend shows notification banner for workflows that completed while user was away

Skill scripts and SOUL.md:
- [x] Create `create-workflow.sh` skill script for Lead to submit DAG
- [x] Add workflow DAG creation guidelines to Lead SOUL.md (including onFailure/timeout defaults)
- [x] Update expert-dispatcher SKILL.md with workflow commands

Tests:
- [ ] Test: sequential dependency (A → B) executes in order
- [ ] Test: parallel tasks (A, B independent) execute concurrently
- [ ] Test: conditional branching using structured DSL (review pass → deploy, fail → fix → review)
- [ ] Test: checkpoint + resume after simulated Lead crash
- [ ] Test: invalid condition field (not in allowlist) returns false, not error
- [ ] Test: task timeout → SIGTERM → retry policy re-spawns Expert
- [ ] Test: task failure with `onFailure=skip` → dependent tasks skipped, non-dependent tasks continue
- [ ] Test: task failure with `onFailure=stop` → DAG stops, partial WorkflowResult generated
- [ ] Test: DAG-internal Handoff → engine tracks replacement agent, task completes correctly
- [ ] Test: server restart with running workflow → reconcile and mark orphaned tasks as failed
- [ ] Test: Lead crash + new Lead startup → detects pending workflow, resumes from checkpoint
- [ ] Test: graceful shutdown (SIGTERM) → tasks marked `suspended`, not `failed`; retry budget preserved
- [ ] Test: graceful shutdown + restart → suspended tasks automatically re-queued and retried
- [ ] Test: crash (kill -9) → state.json intact from last checkpoint; running tasks marked `failed` on restart
- [ ] Test: atomic write — corrupt state.json.tmp does not overwrite valid state.json

## Phase 6: Observability and Tuning

- [x] Add router classification metrics to execution_logs (tier, confidence, actual complexity)
- [x] Add handoff metrics (frequency, chain depth, success rate) to execution_logs
- [x] Add orchestration metrics API endpoint (`GET /api/execution-logs/orchestration-metrics`)
- [x] Add workflow completion events (Whiteboard progress entry + WebSocket `workflow:completed` broadcast)
- [ ] Create router accuracy report script (classification vs actual execution pattern)
- [ ] Tune classification thresholds based on 2-week production data
- [ ] Add workflow execution timeline visualization to frontend
- [ ] Document orchestration modes and handoff protocol in project docs
