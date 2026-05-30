# Tasks: Adaptive Multi-Agent Orchestration

## Phase 1: Agent-to-Agent Handoff

- [ ] Design Handoff skill directory structure (`ai-assets/skills/handoff/`)
- [ ] Create `handoff.sh` script — calls `POST /api/expert/handoff`, exits 0 on success / 1 on failure
- [ ] Implement server endpoint `POST /api/expert/handoff` in expertRoutes
- [ ] Implement connectionId resolution: chatId + sourceAgentId → ExpertSessionStore → connectionId → WebSocket
- [ ] Implement HandoffContext assembly (original message, work summary, relevant files, key findings)
- [ ] Inject HandoffContext into target Agent's prompt via ConfigCompiler (plan.md extension)
- [ ] Spawn target Agent via ExpertLifecycle under source Agent's connectionId
- [ ] Return sync success/failure response to handoff.sh (Agent A stays alive until confirmed)
- [ ] Handle handoff failure: return error → Agent A continues working, `handoff:failed` whiteboard entry
- [ ] Record successful handoff in Whiteboard (war-room) as `handoff` entry type
- [ ] Enforce max chain depth (1) via `dispatchChain` field in AgentMessage
- [ ] Add `handoff` skill to all Expert agents in `openteam.json`
- [ ] Add "Handoff Awareness" section to all Expert SOUL.md files (when to handoff, targets table)
- [ ] Emit `expert:handoff` WebSocket event to frontend on successful handoff
- [ ] Test: Agent A detects task mismatch → hands off to Agent B → B completes with context
- [ ] Test: Chain depth limit (A → B allowed, B → C rejected with error)
- [ ] Test: Handoff failure (target agent config not found) → Agent A continues working

## Phase 2: Execution Mode Router + T1 Direct Execution

- [ ] Create `server/orchestration/ExecutionModeRouter.ts` — keyword/regex classifier
- [ ] Build bilingual (EN/ZH) dispatch keyword table in `server/orchestration/dispatchRules.ts`
- [ ] Include conjunction detection keywords (EN: and/also/plus, ZH: 并且/同时/以及/还要/另外)
- [ ] Include dependency detection keywords (EN: then/after/once, ZH: 然后/之后/完成后/先...再)
- [ ] Include action verb counting heuristic (multiple action verbs → route to Lead)
- [ ] Integrate Router into `WSRouter.ts` at `expert:start` branch — classify before ExpertHandler delegation
- [ ] Add `handleStartDirect(agentId, message, chatId)` method to ExpertHandler — skip Lead, spawn Expert directly
- [ ] Create simplified plan.md generation for T1 (user input + whiteboard context, no TaskEnvelope from Lead)
- [ ] Ensure T1 Expert writes results to Whiteboard for cross-session visibility
- [ ] Add `executionMode` field to `expert:started` WebSocket event payload
- [ ] Add `orchestration.router` config section to `openteam.json` schema
- [ ] Add T1 execution tracking to `execution_logs` (new `execution_mode` column)
- [ ] Test: verify "fix this CSS bug" routes directly to ui-designer (T1)
- [ ] Test: verify "修复这个CSS样式问题" routes to ui-designer (T1, Chinese)
- [ ] Test: verify ambiguous input falls back to T2 (Lead dispatch)
- [ ] Test: verify "fix the bug and update docs" routes to Lead (conjunction detected)
- [ ] Test: verify T1 Expert can Handoff if task turns out to need another agent

## Phase 3: T0 Lead Conversation Mode

- [ ] Add "Conversation Mode (Direct Answer)" section to Lead SOUL.md
- [ ] Define answer-vs-dispatch decision criteria (question patterns, no action verbs, context sufficiency)
- [ ] Add examples of T0-eligible vs dispatch-required messages to Lead SOUL.md
- [ ] Test: verify Lead answers "what does this function do?" directly without spawning Expert
- [ ] Test: verify Lead dispatches Expert for "explain this and then fix the bug"
- [ ] Test: verify Lead transitions from T0 to T2 when user follow-up requires action

## Phase 4: Mailbox Deprecation

Must complete BEFORE Phase 5 (DAG Engine) so the DAG builds against the
clean communication model (SSE + Whiteboard), not the deprecated Mailbox.

Pre-deprecation instrumentation (1 week before removal):
- [ ] Add call-site logging to `MailboxManager.readMessages()` to identify hidden consumers
- [ ] Monitor logs for unexpected mailbox reads beyond `check-inbox.sh`

Stop writing:
- [ ] Remove mailbox write block from `ExpertExitHandler.ts` (lines 207-232)
- [ ] Verify `watch-events.sh` SSE payload includes sufficient summary + artifact refs

Remove reading infrastructure:
- [ ] Remove `check-inbox.sh` and `watch-inbox.sh` from expert-dispatcher skill scripts
- [ ] Remove mailbox references from `expert-dispatcher/SKILL.md`

Remove server infrastructure:
- [ ] Remove `MailboxManager` from server DI — 7 files: `ExpertExitHandler.ts`, `ExpertActivityHandler.ts`, `ExpertEventWiring.ts`, `ExpertLifecycle.ts`, `ExpertHandler.ts`, `server/index.ts`, `expertRoutes.ts`
- [ ] Delete `server/mailbox/MailboxManager.ts`
- [ ] Remove `~/.openteam/mailbox/` directory creation from server startup

Clean up types:
- [ ] Mark deprecated AgentMessage types with `@deprecated` in `shared/agent-message-types.ts`: task:accepted, task:progress, task:milestone, task:idle, task:rejected, task:delegated, query, response
- [ ] Keep active types: task:assign, task:completed, task:failed, task:input_required, task:blocked, handoff, artifact

Verify:
- [ ] Test: verify T2 Lead still detects Expert completion via SSE (watch-events.sh) without mailbox
- [ ] Test: verify no runtime errors from removed mailbox references
- [ ] Test: verify no hidden consumers surfaced during instrumentation period

## Phase 5: Workflow DAG Engine

Builds on the post-Mailbox communication model. Task completion detection
uses SSE event stream + Whiteboard artifact entries (NOT mailbox).

- [ ] Define `WorkflowDAG`, `WorkflowTask`, and `TaskCondition` types in `shared/workflow-types.ts`
- [ ] Implement `TaskCondition` evaluator with allowlisted field access (status, summary, followUp only)
- [ ] Create `server/orchestration/WorkflowEngine.ts` — DAG execution with dependency resolution
- [ ] Implement task ready-set calculation (dependsOn resolution + structured condition evaluation)
- [ ] Implement parallel execution of independent ready tasks via ExpertLifecycle
- [ ] Integrate with SSE event stream + Whiteboard artifact entries for task completion detection
- [ ] Create `create-workflow.sh` skill script for Lead to submit DAG
- [ ] Create `resume-workflow.sh` skill script for resuming interrupted workflows
- [ ] Implement checkpoint persistence (`~/.openteam/workflows/<id>/state.json`)
- [ ] Add workflow DAG creation guidelines to Lead SOUL.md
- [ ] Update expert-dispatcher SKILL.md with workflow commands
- [ ] Test: sequential dependency (A → B) executes in order
- [ ] Test: parallel tasks (A, B independent) execute concurrently
- [ ] Test: conditional branching using structured DSL (review pass → deploy, fail → fix → review)
- [ ] Test: checkpoint + resume after simulated interruption
- [ ] Test: invalid condition field (not in allowlist) returns false, not error

## Phase 6: Observability and Tuning

- [ ] Add router classification metrics to execution_logs (tier, confidence, actual complexity)
- [ ] Add handoff metrics (frequency, chain depth, success rate) to execution_logs
- [ ] Create router accuracy report script (classification vs actual execution pattern)
- [ ] Tune classification thresholds based on 2-week production data
- [ ] Add workflow execution timeline visualization to frontend
- [ ] Document orchestration modes and handoff protocol in project docs
