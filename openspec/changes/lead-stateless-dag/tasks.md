# Tasks: Lead Stateless DAG

## Implementation Order

### Phase 1: Server-side Scheduler

- [x] Create `server/orchestration/WorkflowScheduler.ts` — listens to engine events, starts ready agents via `expertHandler.handleStart()`
- [x] Wire scheduler into `WorkflowRegistry.createWorkflow()` — auto-start initial ready tasks on creation
- [x] Subscribe scheduler to `expert:stopped` events — detect agent completion and feed results back to engine
- [x] Handle agent start failures — call `engine.recordTaskFailure()` if `handleStart()` throws
- [x] Wire scheduler into `WorkflowRegistry.reconcileOnStartup()` — resume scheduling for recovered workflows

### Phase 2: Lead Agent Simplification

- [x] Update `ai-assets/agents/lead/SOUL.md` — remove monitoring loop, make DAG submission fire-and-forget (same exit behavior as handoff)
- [x] Remove startup workflow recovery logic from Lead's decision model

### Phase 3: Skill Cleanup

- [x] Remove `~/.openteam/skills/expert-dispatcher/scripts/watch-events.sh`
- [x] Remove `~/.openteam/skills/expert-dispatcher/scripts/resume-workflow.sh`
- [x] Update `expert-dispatcher/SKILL.md` — remove references to watch-events and resume-workflow

### Phase 4: Verification

- [ ] Test: single DAG with 2 sequential tasks completes without Lead alive
- [ ] Test: parallel tasks in DAG start simultaneously
- [ ] Test: `onFailure: stop` halts downstream tasks and broadcasts `workflow:stopped`
- [ ] Test: `onFailure: retry` retries failed task up to maxRetries
- [ ] Test: server restart recovers in-flight workflow and continues scheduling
