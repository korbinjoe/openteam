# Design: Lead Stateless DAG

## Architecture

```
┌──────────┐   POST /api/workflow/create   ┌──────────────────┐
│   Lead   │ ─────────────────────────────▶│ WorkflowRegistry │
│ (exits)  │                               │   createWorkflow │
└──────────┘                               └────────┬─────────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │ WorkflowEngine  │
                                           │  (state machine)│
                                           └────────┬────────┘
                                                    │ events
                                                    ▼
                                           ┌──────────────────┐
                                           │WorkflowScheduler │
                                           │  (new module)    │
                                           └────────┬─────────┘
                                                    │ starts agents
                                                    ▼
                                           ┌──────────────────┐
                                           │  ExpertHandler   │
                                           │  handleStart()   │
                                           └──────────────────┘
```

## WorkflowScheduler Design

### Responsibilities

1. React to `task-resolved` events → start next ready agents
2. React to `workflow created` → start initial ready agents (no dependencies)
3. React to agent stop/crash → record task failure in engine
4. On `workflow-completed` → broadcast to chat (already wired in Registry)

### Interface

```typescript
// server/orchestration/WorkflowScheduler.ts

interface WorkflowSchedulerDeps {
  workflowRegistry: WorkflowRegistry
  expertHandler: ExpertHandler
  broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void
}

class WorkflowScheduler {
  constructor(deps: WorkflowSchedulerDeps)

  // Called after createWorkflow — starts initial tasks
  scheduleWorkflow(engine: WorkflowEngine): void

  // Called when any agent finishes (from expert:stopped event)
  onAgentCompleted(chatId: string, agentId: string, result: TaskResult): void
}
```

### Scheduling Loop (per engine)

```
on task-resolved(taskId, status):
  readyTasks = engine.getReadyTasks()
  for each task in readyTasks:
    engine.markTaskRunning(task.taskId)
    expertHandler.handleStart(ws, { agentId: task.agentId, task: task.description, chatId })
    if start fails:
      engine.recordTaskFailure(task.taskId, "agent_start_failed")
```

### Integration Point: Agent Completion

When an expert finishes (detected via `expert:stopped` event in the WS layer),
the scheduler must be notified. The existing `ExpertSessionStore` emits events
when sessions end — the scheduler subscribes to these.

```
on expert:stopped(chatId, agentId, result):
  engine = workflowRegistry.findByAgent(agentId)
  if engine:
    engine.recordTaskResult(taskId, result)
    // task-resolved event fires → scheduling loop triggers
```

## Lead SOUL.md Changes

### Before (current)

```
# Core Skills
- handoff — primary dispatch mechanism
- expert-dispatcher — workflow DAG management (create-workflow, resume-workflow,
  list-workflows, team-status)
```

Lead also has startup recovery and `watch-events.sh` monitoring.

### After

```
# Core Skills
- handoff — primary dispatch mechanism (single-agent tasks)
- expert-dispatcher — create-workflow (multi-step tasks), team-status (on-demand)
```

Decision model simplified:
- Single-agent → `handoff.sh` → Lead exits
- Multi-agent DAG → `create-workflow.sh` → Lead exits
- Both paths: Lead exits after submission

## Decisions

1. **No user confirmation on workflow completion** — broadcast a WS event
   (`workflow:completed`) that the frontend renders as a notification/badge.
   User checks results at their own pace (pulse-mode compatible).

2. **Failure notification threshold** — broadcast `workflow:stopped` immediately
   when a `stop` policy halts the workflow. User decides whether to re-plan.

3. **Scheduler lives in WorkflowRegistry** — not a separate singleton. The
   Registry already manages engine lifecycle; the scheduler is just the
   "active loop" that was missing.
