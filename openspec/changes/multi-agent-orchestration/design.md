# Design: Adaptive Multi-Agent Orchestration

## 1. Execution Mode Router

### 1.1 Two-Level Routing Architecture

Routing is split across two layers:

| Layer | Responsibility | Mechanism |
|-------|---------------|-----------|
| **Server-side Router** | T1 vs T2: skip Lead or spawn Lead | Regex + keyword classifier |
| **Lead's own judgment** | T0: answer directly vs dispatch | Lead SOUL.md conversation mode rules |

The server-side Router only needs to answer one question: "Is this obviously a
single-expert task?" If yes → T1 (direct Expert). If no → spawn Lead, and Lead
itself decides whether to answer directly (T0) or dispatch (T2).

```
User message arrives via WebSocket
  → ExecutionModeRouter.classify(message)
  → T1 (high confidence): ExpertLifecycle.startDirect(agentId, message)
  → otherwise: ExpertLifecycle.startLead(message)
      → Lead decides: T0 (answer directly) or T2 (dispatch Experts)
```

### 1.2 Server-Side Router: T1 Classification

```typescript
interface RouteDecision {
  tier: 'single-expert' | 'lead'
  agentId?: string        // for single-expert, which agent to route to
  confidence: number      // 0-1, below threshold routes to Lead
}
```

**T1 match rules** (all must be true):
- Input matches exactly ONE dispatch keyword group from Lead's decision tree
- No conjunction (AND/和/同时/另外) suggesting multiple tasks
- No dependency language (然后/之后/完成后/then/after)
- Confidence > 0.85

**Everything else → Lead** (Lead handles both T0 and T2 internally).

**Conservative default**: If classification confidence is below 0.85, always
route to Lead. The Lead can still fast-path answer (T0) or dispatch (T2) —
the worst case is one extra LLM reasoning step, not a failure.

### 1.3 Router Implementation

File: `server/orchestration/ExecutionModeRouter.ts`

```typescript
export class ExecutionModeRouter {
  private dispatchTree: DispatchRule[]

  constructor(agentRegistry: AgentRegistry) {
    this.dispatchTree = buildDispatchTree(agentRegistry)
  }

  classify(input: string, chatContext?: ChatContext): RouteDecision {
    const singleMatch = this.matchSingleExpert(input)
    if (singleMatch && singleMatch.confidence > 0.85) {
      return { tier: 'single-expert', agentId: singleMatch.agentId, confidence: singleMatch.confidence }
    }
    return { tier: 'lead', confidence: 1.0 }
  }
}
```

The dispatch tree reuses the same keyword mapping from Lead's SOUL.md dispatch
decision tree, ensuring consistency between router classification and Lead's
own dispatch behavior.

**Bilingual classification**: The dispatch keyword table must support both
English and Chinese from day one, since the primary user base communicates
in Chinese. Each dispatch rule includes parallel keyword sets:

```typescript
interface DispatchRule {
  agentId: string
  keywords: {
    en: string[]      // ["fix", "bug", "CSS", "style", "UI"]
    zh: string[]      // ["修复", "样式", "界面", "CSS", "UI"]
  }
  conjunctions: {
    en: string[]      // ["and", "also", "plus"]
    zh: string[]      // ["并且", "同时", "以及", "还要", "另外"]
  }
  dependencies: {
    en: string[]      // ["then", "after", "once"]
    zh: string[]      // ["然后", "之后", "完成后", "先...再", "等...好了"]
  }
}
```

### 1.4 Integration Point

The router sits in the **WebSocket dispatcher** (`server/ws/WSRouter.ts`),
at the `expert:start` branch (line 58) — before delegating to `ExpertHandler`.
WSRouter is the existing routing layer; adding classification here keeps all
routing decisions in one place:

```
User message arrives via WebSocket
  → WSRouter.handle(message)
  → type === 'expert:start'
    → ExecutionModeRouter.classify(payload.task)
    → 'single-expert': ExpertHandler.handleStartDirect(ws, agentId, payload)  [T1]
    → 'lead': ExpertHandler.handleStart(ws, payload)                          [T0 or T2, Lead decides]
```

The Router does NOT replace WSRouter — it adds a sub-routing step within
the `expert:start` branch only. All other WebSocket message types
(`expert:input`, `expert:stop`, etc.) are unaffected.

---

## 2. Tier 0: Conversation Mode (Lead Direct Answer)

### 2.1 Purpose

Lead detects simple Q&A questions and answers them directly instead of
dispatching an Expert. No new Agent definition, no additional subprocess —
Lead is already running and has project context.

### 2.2 Architecture

```
User message → Lead (already running)
                 ├── Lead's SOUL.md "Conversation Mode" rules detect Q&A pattern
                 ├── Lead answers directly using its own context + read-only tools
                 ├── No Expert dispatch, no subprocess spawn
                 └── Response streamed back via existing Lead output protocol
```

T0 is purely a **Lead behavior change** — a new section in Lead's SOUL.md that
teaches it to recognize when a question can be answered without dispatching.
No server-side Router involvement for T0.

### 2.3 Lead Conversation Mode Rules (SOUL.md Addition)

```markdown
## Conversation Mode (Direct Answer)

Before dispatching, evaluate whether you can answer directly:

**Answer directly when ALL conditions are met**:
- The message is a question (asks what/why/how, requests explanation)
- No action is required (no modify/create/fix/deploy/add intent)
- You have sufficient context to answer (project structure, recent chat history)
- Answer would not benefit from tool execution beyond Read/Glob/Grep

**Always dispatch when ANY condition is met**:
- The message requests code changes, file modifications, or deployments
- The message requires specialized domain expertise (design, architecture review)
- You're uncertain whether the answer is correct
- The message contains multiple tasks or dependency language

When answering directly, keep responses concise and factual. If you realize
mid-response that the question needs deeper investigation, stop and dispatch
to the appropriate Expert.
```

### 2.4 Escalation from T0

If Lead starts answering but realizes the question requires implementation or
deep domain expertise, it dispatches an Expert normally (existing dispatch flow).
If the initial response is complete but the user follows up with an action
request, Lead transitions naturally into T1/T2 dispatch mode.

### 2.5 Cost Model

| Metric | T0 Warm (Lead running) | T0 Cold (Lead spawn) | T2 (Lead + Expert) |
|--------|------------------------|----------------------|-------------------|
| Latency | ~2-5s | ~10-15s | ~20-30s |
| Token cost | ~$0.02-0.05 | ~$0.05-0.10 | ~$0.30-0.50 |
| Processes spawned | 0 additional | 1 (Lead) | 1 (Lead) + 1+ (Expert) |
| Context used | Lead's existing window | Fresh Lead window | Lead + Expert windows |

**Warm vs Cold**: Lead is a CLI subprocess spawned per `expert:start`, not a
persistent daemon. "Warm" means Lead is already running from a prior turn in
the same chat. "Cold" means a new Lead process must be created (new chat, or
chat after Lead exited). Cold T0 is still ~2x faster than T2 because it
skips Expert spawn + execution, but the headline "~2-5s" only applies warm.

**Future optimization**: A persistent Lead process (keep-alive per chat) would
make all T0 responses warm. This is out of scope for the current proposal.

---

## 3. Tier 1: Single Expert Direct Execution

### 3.1 Purpose

Skip Lead analysis and dispatch directly to the target Expert when the task
unambiguously maps to one agent.

### 3.2 Architecture

```
User message → Router (T1, agentId=ui-designer)
  → ExpertLifecycle.startDirect(agentId, message)
     ├── ConfigCompiler assembles Expert prompt (full SOUL.md + Skills)
     ├── CLI process spawned with task
     ├── SSE stream connected for status
     └── Results posted to Whiteboard (war-room)
```

### 3.3 Differences from T2 Dispatch

| Aspect | T1 (Direct) | T2 (via Lead) |
|--------|------------|---------------|
| Lead process | Not spawned | Spawned, analyzes, dispatches |
| Task decomposition | None (raw user input as task) | Lead decomposes into subtask with context |
| Plan.md creation | Simplified (user input + whiteboard context) | Full plan.md via ExecutionPlanManager |
| Context briefing | Whiteboard snapshot injected | Lead writes goal + context to whiteboard |
| Result verification | User reviews directly | Lead verifies against acceptance criteria |
| Multi-agent coordination | Via Handoff if needed (see §5) | Full mailbox + whiteboard + SSE |

### 3.4 Whiteboard Integration

T1 executions still write to the war-room whiteboard, so:
- Lead (if running for other tasks) sees what happened
- Future agents have context from the T1 execution
- Chat history remains coherent

### 3.5 When T1 Expert Needs Another Agent

Instead of "falling back to T2", the Expert uses the **Handoff mechanism** (§5)
to transfer the task to a more appropriate Expert. This is more efficient than
restarting the entire orchestration — context transfers directly between agents.

---

## 4. Tier 2: Orchestrated Mode (Enhanced Current Model)

### 4.1 Current Flow (Preserved)

The existing Lead → Expert dispatch model continues to serve as the default
orchestration path for multi-agent tasks. No changes to:
- Expert-dispatcher skill
- Mailbox protocol
- SSE event stream
- AgentMessage types

### 4.2 Enhancement: Workflow DAG (Optional)

For complex multi-step tasks, Lead can optionally define a **task dependency DAG**
that the server executes automatically, instead of Lead manually sequencing
each step.

#### 4.2.1 DAG Definition Format

Lead writes a workflow plan as part of its task decomposition:

```typescript
interface WorkflowDAG {
  id: string
  chatId: string
  tasks: WorkflowTask[]
}

interface WorkflowTask {
  taskId: string
  agentId: string
  description: string
  dependsOn: string[]       // taskIds that must complete before this starts
  condition?: TaskCondition  // optional structured condition (no eval)
  inputMapping?: Record<string, string>  // map outputs from dependencies
}

/**
 * Structured condition DSL — replaces free-form JS strings to prevent
 * code injection. Only allowlisted fields and safe operators.
 */
interface TaskCondition {
  operator: 'eq' | 'neq' | 'in' | 'has_items' | 'is_empty' | 'and' | 'or'
  /** dot-path into TaskResult, restricted to: status, summary, followUp */
  field?: string
  value?: string | string[]
  children?: TaskCondition[]  // for 'and' / 'or' compound conditions
}
```

Example — "Build feature with tests and review":

```json
{
  "tasks": [
    { "taskId": "t1", "agentId": "fullstack-product-engineer",
      "description": "Implement login feature", "dependsOn": [] },
    { "taskId": "t2", "agentId": "code-reviewer",
      "description": "Review login implementation", "dependsOn": ["t1"] },
    { "taskId": "t3", "agentId": "fullstack-product-engineer",
      "description": "Fix issues from review", "dependsOn": ["t2"],
      "condition": {
        "operator": "or",
        "children": [
          { "operator": "neq", "field": "t2.status", "value": "completed" },
          { "operator": "has_items", "field": "t2.followUp" }
        ]
      }
    },
    { "taskId": "t4", "agentId": "devops-engineer",
      "description": "Deploy to preview", "dependsOn": ["t2"],
      "condition": { "operator": "eq", "field": "t2.status", "value": "completed" }
    }
  ]
}
```

#### 4.2.2 Workflow Engine

File: `server/orchestration/WorkflowEngine.ts`

```typescript
export class WorkflowEngine {
  private dag: WorkflowDAG
  private results: Map<string, TaskResult>

  async execute(): Promise<WorkflowResult> {
    while (this.hasRunnableTasks()) {
      const ready = this.getReadyTasks()
      await Promise.all(ready.map(t => this.executeTask(t)))
    }
    return this.aggregateResults()
  }

  private getReadyTasks(): WorkflowTask[] {
    return this.dag.tasks.filter(t =>
      !this.results.has(t.taskId) &&
      t.dependsOn.every(dep => this.results.has(dep)) &&
      this.evaluateCondition(t.condition)
    )
  }

  /**
   * Evaluate structured TaskCondition against completed task results.
   * Only reads allowlisted fields (status, summary, followUp) from TaskResult.
   * No eval(), no Function(), no vm — pure data comparison.
   */
  private evaluateCondition(cond?: TaskCondition): boolean {
    if (!cond) return true
    switch (cond.operator) {
      case 'eq':    return this.resolveField(cond.field!) === cond.value
      case 'neq':   return this.resolveField(cond.field!) !== cond.value
      case 'in':    return (cond.value as string[]).includes(this.resolveField(cond.field!) as string)
      case 'has_items': return (this.resolveField(cond.field!) as unknown[] ?? []).length > 0
      case 'is_empty':  return (this.resolveField(cond.field!) as unknown[] ?? []).length === 0
      case 'and':   return cond.children!.every(c => this.evaluateCondition(c))
      case 'or':    return cond.children!.some(c => this.evaluateCondition(c))
    }
  }

  /** Resolve "t2.status" → this.results.get("t2").status */
  private resolveField(dotPath: string): unknown {
    const ALLOWED_FIELDS = new Set(['status', 'summary', 'followUp'])
    const [taskId, field] = dotPath.split('.')
    if (!ALLOWED_FIELDS.has(field)) return undefined
    return (this.results.get(taskId) as Record<string, unknown>)?.[field]
  }
}
```

The engine:
1. Identifies tasks with all dependencies satisfied
2. Evaluates structured conditions via safe field comparison (no eval)
3. Starts ready tasks in parallel via `ExpertLifecycle`
4. Waits for completion (via `expert:exit` WebSocket event + Whiteboard artifact entries)
5. Records results, re-evaluates ready set
6. Repeats until all tasks complete or a task fails without a fallback path

#### 4.2.3 Lead Integration

Lead creates the DAG via a new skill script:

```bash
bash {SKILL_DIR}/scripts/create-workflow.sh '<dag-json>'
```

The server's `WorkflowEngine` executes the DAG, sending progress updates to
Lead's SSE stream. Lead only needs to intervene on:
- `task:input_required` (Expert needs a decision)
- `task:failed` without a fallback path
- Workflow completion (aggregate and report to user)

This reduces Lead's context window consumption for multi-step tasks significantly.

#### 4.2.4 Checkpoint and Resume

The `WorkflowEngine` persists DAG state to disk:

```
~/.openteam/workflows/<workflow-id>/
  dag.json            — original DAG definition
  state.json          — current execution state (which tasks completed, results)
  tasks/<taskId>/     — individual task plan.md + result.md (existing format)
```

If the workflow is interrupted (Lead context limit, process crash), a new
Lead session can resume by reading the persisted state:

```bash
bash {SKILL_DIR}/scripts/resume-workflow.sh <workflow-id>
```

The engine skips completed tasks and continues from the last incomplete step.

#### 4.3 Workflow Resilience

The DAG Engine must guarantee that complex tasks either run to completion or
fail visibly — never silently stall or lose partial results. This section
addresses five failure modes that the basic engine loop does not cover.

##### 4.3.1 Task Failure Handling and Retry

A single task failure should not unconditionally kill the entire DAG.

**Failure policy per task**:

```typescript
interface WorkflowTask {
  // ... existing fields ...
  onFailure: 'stop' | 'skip' | 'retry'   // default: 'stop'
  maxRetries?: number                      // default: 1 (for 'retry' policy)
}
```

| Policy | Behavior | Use case |
|--------|----------|----------|
| `stop` | Halt the DAG, mark remaining tasks as `skipped`, report partial results | Default — most conservative |
| `skip` | Mark this task as `failed`, continue executing tasks that don't depend on it | Non-critical tasks (e.g., "generate docs") |
| `retry` | Re-spawn the Expert with the same plan.md, up to `maxRetries` | Transient failures (timeout, API error) |

**Partial results**: When the DAG stops or completes with some tasks failed,
`aggregateResults()` produces a `WorkflowResult` with per-task status:

```typescript
interface WorkflowResult {
  workflowId: string
  status: 'completed' | 'partial' | 'failed'
  tasks: Array<{
    taskId: string
    status: 'completed' | 'failed' | 'skipped' | 'pending'
    result?: TaskResult        // from Expert execution
    failureReason?: string
    retryCount?: number
  }>
  completedCount: number
  failedCount: number
  skippedCount: number
}
```

The `WorkflowResult` is persisted to `~/.openteam/workflows/<id>/result.json`
and written to the Whiteboard as a `progress` entry, so it survives Lead
process restarts.

##### 4.3.2 Per-Task Timeout

The engine loop `while (this.hasRunnableTasks())` can stall indefinitely if
an Expert process hangs. Each task gets a timeout enforced by the server:

```typescript
interface WorkflowTask {
  // ... existing fields ...
  timeoutMinutes?: number     // default: 30
}
```

**Timeout flow**:
1. Engine starts a task → records `startedAt` in `state.json`
2. A timer fires after `timeoutMinutes`
3. If the task's Expert hasn't exited:
   - Send SIGTERM to the Expert process via `ExpertSessionStore`
   - Wait 10s for graceful exit
   - If still alive, SIGKILL
4. Task is marked `failed` with `failureReason: 'timeout'`
5. `onFailure` policy applies (stop/skip/retry)

**Default 30 minutes** matches the current observed upper bound for single-agent
tasks. Lead can override per-task when creating the DAG.

##### 4.3.3 DAG-Internal Handoff Awareness

When an Expert inside a DAG triggers a Handoff (Expert A → Expert B), the
Engine must track the replacement so it doesn't lose the task:

**Problem**: Engine waits for Expert A's `expert:exit` event for taskId `t3`.
Expert A exits (handoff success), but the actual work is now on Expert B.
Engine sees exit code 0 and records `t3` as completed — wrong.

**Solution**: The Handoff endpoint checks whether the source Agent is part of
an active Workflow. If so, it updates the DAG's task assignment:

```
Handoff request arrives for Agent A (part of workflow W1, task t3)
  → Server:
    1. WorkflowEngine.reassignTask(workflowId, taskId, newAgentId)
    2. Update state.json: t3.agentId = Expert B, t3.status = 'running'
    3. Engine now waits for Expert B's exit event for t3 (not Expert A's)
    4. Agent A's exit is treated as a handoff-exit (not a task completion)
```

The `expert:exit` event already carries `agentId`. The engine distinguishes
between a normal completion (agentId matches task assignment) and a
handoff-exit (agentId is the OLD assignment, task was reassigned).

```typescript
// In WorkflowEngine
private handleExpertExit(agentId: string, exitCode: number): void {
  const task = this.findTaskByCurrentAgent(agentId)
  if (!task) return  // handoff-exit: agent was reassigned, ignore
  // normal completion: record result
  this.results.set(task.taskId, /* ... */)
  this.persistCheckpoint()
}
```

##### 4.3.4 Automatic Workflow Recovery

When Lead crashes (context limit, process kill), pending Workflows must not
be orphaned. The recovery chain:

```
New Lead session starts (user sends next message, or new chat session)
  → Lead's SOUL.md "Workflow Recovery" section instructs:
    1. On startup, check for pending workflows:
       bash {SKILL_DIR}/scripts/list-workflows.sh --status=running
    2. If any are found:
       a. Read the workflow's result.json (if exists) — may have partial results
       b. Report status to user: "Workflow W1 is in progress: 3/5 tasks done"
       c. Call resume-workflow.sh to continue
    3. If all tasks completed while Lead was down:
       a. Read result.json
       b. Aggregate and present to user
```

**Server-side guarantee**: The `WorkflowEngine` runs in the server process,
NOT inside Lead's CLI process. So even when Lead exits:
- Running Expert processes continue executing their tasks
- The Engine continues recording `expert:exit` events and updating `state.json`
- When tasks complete, results accumulate in checkpoint files on disk
- The Engine stops scheduling NEW tasks (no new Expert spawns) until Lead resumes

This means the server is a **stateful executor** that outlives Lead sessions.
The key invariant: `state.json` is always up-to-date, even without Lead.

**Server restart**: If the server itself restarts, it scans
`~/.openteam/workflows/` for `state.json` files with `status: 'running'`.
For each:
- Tasks marked `running` whose Expert processes no longer exist → mark `failed`
  (the Expert was killed by the server restart)
- Tasks marked `pending` → ready for re-scheduling when Lead resumes

```typescript
// Server startup
const pendingWorkflows = scanWorkflowDir()
for (const wf of pendingWorkflows) {
  const engine = WorkflowEngine.fromCheckpoint(wf.path)
  engine.reconcileWithRunningProcesses(sessionRegistry)
  workflowRegistry.register(engine)
}
```

##### 4.3.5 Result Aggregation Chain

After the DAG completes, results must reach the user. This requires a Lead
process, which may not be the same Lead that created the DAG:

```
DAG completes (all tasks done or stopped on failure)
  → WorkflowEngine:
    1. Writes final result.json to disk
    2. Writes Whiteboard 'progress' entry: "Workflow W1 completed: 5/5 tasks done"
    3. Emits WebSocket event: workflow:completed { workflowId, status, summary }
  → If Lead is running:
    4. Lead receives SSE event via watch-events.sh
    5. Lead reads result.json
    6. Lead generates user-facing summary and reports
  → If Lead is NOT running (already exited):
    7. Results persist in result.json + Whiteboard
    8. Next time Lead starts (user sends message):
       - Lead sees Whiteboard progress entry
       - Lead reads result.json
       - Lead presents results to user as the first response
    9. Frontend can also show a notification banner:
       "Workflow completed while you were away — X/Y tasks succeeded"
```

**Frontend notification**: The `workflow:completed` WebSocket event is sent
to all connections viewing the chat. Even without Lead, the frontend can
show an immediate status indicator:

```typescript
{
  type: 'workflow:completed'
  payload: {
    chatId: string
    workflowId: string
    status: 'completed' | 'partial' | 'failed'
    completedCount: number
    totalCount: number
    summary: string           // auto-generated from task descriptions
  }
}
```

##### 4.3.6 Execution Lifecycle State Machine

The complete lifecycle of a Workflow, covering all failure and recovery paths:

```
                    ┌──────────────┐
                    │   created    │  Lead calls create-workflow.sh
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
               ┌────│   running    │────────────────────────┐
               │    └──────┬───────┘                        │
               │           │                                │
          Lead crashes     │ all tasks                 task fails
          (or server       │ resolved                  (onFailure=stop)
           restart)        │                                │
               │    ┌──────▼───────┐               ┌───────▼──────┐
               │    │  completed   │               │   stopped    │
               │    └──────────────┘               └───────┬──────┘
               │                                           │
               │           ┌───────────────────────────────┘
               │           │
        ┌──────▼───────────▼──┐
        │   suspended         │  state.json on disk, no active scheduler
        └──────────┬──────────┘
                   │
            Lead resumes
            (resume-workflow.sh)
                   │
            ┌──────▼───────┐
            │   running    │  picks up from last checkpoint
            └──────────────┘
```

States persisted in `state.json`:
- `created` → DAG received, no tasks started yet
- `running` → at least one task in progress
- `completed` → all tasks resolved (completed/skipped/failed with skip policy)
- `stopped` → a task failed with stop policy, remaining tasks skipped
- `suspended` → engine is not actively scheduling (Lead/server not running)

##### 4.3.7 Graceful Shutdown Integration

When the application exits (Electron `before-quit`, server `SIGTERM`), running
Workflows must persist their in-flight state to disk before processes die.
Two mechanisms ensure checkpoint integrity across all exit scenarios.

**Atomic checkpoint writes**

All `state.json` writes use write-then-rename to prevent partial/corrupt files
if the process is killed mid-write:

```typescript
private async persistCheckpoint(): Promise<void> {
  const data = JSON.stringify(this.serializeState(), null, 2)
  const tmpPath = this.statePath + '.tmp'
  await writeFile(tmpPath, data)
  await rename(tmpPath, this.statePath)   // atomic on POSIX
}
```

On recovery, if `state.json` is missing but `state.json.tmp` exists, the
engine reads the tmp file (it may be more recent than a missing main file).

**Shutdown flush**

The server's `gracefulShutdown()` must flush all active Workflow checkpoints
BEFORE killing Expert processes:

```typescript
// server/index.ts — gracefulShutdown addition
const gracefulShutdown = async (signal: string) => {
  log.info(`${signal} received, shutting down gracefully...`)

  // 1. Flush workflow checkpoints FIRST (while Experts are still alive)
  await workflowRegistry.suspendAll()
  //    For each running workflow:
  //    - Mark in-progress tasks as 'suspended' (not 'failed' — they were
  //      not given a chance to finish, not broken)
  //    - Persist checkpoint with current task assignments
  //    - Write workflow status = 'suspended'

  // 2. Then kill Expert processes (existing logic)
  sessionRegistry.killAll()

  // 3. Cleanup (existing logic)
  if (IS_DAEMON_FILE_OWNER) removePorts()
  // ...
}
```

The ordering matters: `suspendAll()` runs while Expert processes are still
alive, so `state.json` accurately reflects which tasks were `running` vs
`pending`. After suspend, `sessionRegistry.killAll()` terminates the processes.

**Recovery after graceful shutdown**:

```
App restarts → Server scans ~/.openteam/workflows/
  → Finds state.json with status = 'suspended'
  → Tasks marked 'suspended' are re-queued as 'pending' (not 'failed')
  → Lead starts → resume-workflow.sh → Engine re-spawns Experts for those tasks
  → Net effect: tasks that were in-flight are retried from scratch
     (partial file changes from the killed Expert remain on disk — the
      new Expert sees them and can continue or redo)
```

**Distinction between `suspended` and `failed`**:

| Task state | Meaning | On resume |
|-----------|---------|-----------|
| `suspended` | Process was killed by graceful shutdown, not by a bug | Re-queued as `pending`, retried automatically |
| `failed` | Expert exited with error, timeout, or crash | Subject to `onFailure` policy (stop/skip/retry) |

This distinction prevents graceful app exits from burning retry budgets.
A task suspended 3 times by the user closing the app should still have its
full `maxRetries` available for actual failures.

**Crash (non-graceful) exit**:

If the app is force-killed (`kill -9`, OS crash, power loss),
`gracefulShutdown` does NOT run. In this case:
- `state.json` reflects the last `persistCheckpoint()` call (last task
  completion/failure event)
- Tasks that were `running` at crash time have no process → on next startup,
  reconcile marks them `failed` (conservative — we don't know if they
  were making progress or stuck)
- This is the worst case: running tasks lose progress AND count against
  retry budget. Acceptable because non-graceful kills are rare.

---

## 5. Agent-to-Agent Handoff

### 5.1 Motivation

In any tier, an Agent may realize mid-execution that another Agent is better
suited for the task at hand. Examples:

- T0 assistant realizes the question requires code implementation → handoff to fullstack-engineer
- T1 fullstack-engineer finds the task is purely visual design → handoff to ui-designer
- T2 code-reviewer finds a bug root cause and recommends → handoff to fullstack-engineer to fix

Without Handoff, these scenarios require the user to manually re-dispatch or
Lead to restart the entire orchestration cycle. With Handoff, the running Agent
transfers the task directly to the appropriate peer.

### 5.2 Handoff Protocol

```typescript
interface HandoffRequest {
  from: string              // source agent instanceId
  to: string                // target agent ID (from openteam.json)
  chatId: string
  reason: string            // why this agent is more appropriate
  task: string              // task description for the target agent
  context: HandoffContext   // accumulated context to carry forward
}

interface HandoffContext {
  originalUserMessage: string      // what the user originally asked
  workDoneSoFar: string            // summary of what source agent accomplished
  relevantFiles: string[]          // files the source agent touched or read
  keyFindings: string[]            // insights discovered during execution
  conversationSummary?: string     // condensed conversation history
}
```

### 5.3 Handoff Execution Flow

```
Agent A (running) detects task mismatch
  → Agent A calls handoff script: bash handoff.sh <targetAgentId> "<task>" "<context-json>"
  → Server receives handoff request via HTTP POST /api/expert/handoff
  → Server:
      1. Resolves connectionId:
         - Look up source Agent A's entry in ExpertSessionStore using chatId + from
         - Extract connectionId from the entry
         - Retrieve WebSocket via ExpertHandler.getConnectionWs(connectionId)
         - If no connection found → return 500, Agent A continues working
      2. Records handoff in war-room whiteboard (type: 'handoff')
      3. Writes HandoffContext to target agent's plan.md
      4. Spawns target Agent B via ExpertLifecycle under the SAME connectionId
      5. Returns { status: 'ok', targetSessionId } to Agent A (sync HTTP response)
      6. Agent A receives 200 OK and exits gracefully
  → Agent B continues the task with full context from Agent A
```

**Failure handling**: The handoff is synchronous — Agent A's `curl` call blocks
until the server confirms the spawn succeeded. If any step fails:
- Server returns `{ status: 'error', reason: '...' }` with HTTP 4xx/5xx
- Agent A receives the error, logs it, and **continues working** on the task
  (does NOT exit — only exits on success confirmation)
- A `handoff:failed` entry is written to the whiteboard for audit trail
- If the failure is transient (e.g., target Agent config not found), Agent A
  can retry once or report to the user

### 5.4 Handoff Skill Script

Added to all Expert Agents' skills. File: `ai-assets/skills/handoff/scripts/handoff.sh`

```bash
#!/bin/bash
# handoff.sh — Transfer task to a more appropriate Agent
# Usage: bash handoff.sh <targetAgentId> "<task>" "<context-json>"

TARGET_AGENT="${1:?Usage: handoff.sh <targetAgentId> <task> <context-json>}"
TASK="${2:?Usage: handoff.sh <targetAgentId> <task> <context-json>}"
CONTEXT="${3:-{}}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${EXPERT_API_BASE}/api/expert/handoff" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg from "$OPENTEAM_INSTANCE_ID" \
    --arg to "$TARGET_AGENT" \
    --arg chatId "$OPENTEAM_CHAT_ID" \
    --arg task "$TASK" \
    --argjson context "$CONTEXT" \
    '{from: $from, to: $to, chatId: $chatId, task: $task, context: $context}')")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "HANDOFF_OK: Task transferred to $TARGET_AGENT"
  echo "$BODY"
else
  echo "HANDOFF_FAILED: HTTP $HTTP_CODE — $BODY" >&2
  exit 1
fi
```

The script exits 0 on success (Agent should exit cleanly) and exits 1 on
failure (Agent should continue working or report to the user).

### 5.5 Handoff Rules (Agent SOUL.md Addition)

Each Agent gets a handoff awareness section in SOUL.md:

```markdown
## Handoff Awareness

If you determine during execution that another Agent is better suited for
this task, initiate a Handoff immediately rather than struggling with work
outside your expertise.

**When to Handoff**:
- Task requires skills outside your core competency
- You've spent >3 turns without meaningful progress on the task
- The task explicitly matches another Agent's domain

**How to Handoff**:
1. Summarize what you've done so far and what you've discovered
2. Identify the most appropriate target Agent
3. Call: `bash {SKILL_DIR}/scripts/handoff.sh <agentId> "<task>" '<context>'`
4. Exit cleanly after confirmation

**Handoff targets**:
- Visual/UI/styling tasks → ui-designer
- Code review/quality analysis → code-reviewer
- Architecture/refactoring → architect
- Deploy/CI/CD → devops-engineer
- Implementation/bug fixes → fullstack-product-engineer
```

### 5.6 Handoff vs Existing Mechanisms

| Mechanism | Direction | When | What happens |
|-----------|-----------|------|-------------|
| **Lead dispatch** | Lead → Expert | Task start | Lead analyzes and assigns |
| **Agent Handoff** (new) | Expert → Expert | Mid-execution realignment | Source exits, target spawns with full context, no Lead needed |

The key difference: Agent Handoff is **self-directed** — the running Expert
makes the routing decision autonomously, spawns the target, and exits. No Lead
involvement needed for simple rerouting.

Note: The existing Mailbox `handoff` message type is superseded by the HTTP-based
Handoff mechanism (see §6 — Mailbox Deprecation).

### 5.7 Handoff in Different Tiers

| Tier | Handoff Scenario | Example |
|------|-----------------|---------|
| T0 | Lead dispatches after direct answer | "What's the login flow?" → user follows up with "fix the bug" → Lead dispatches Expert (normal T2 flow, not handoff) |
| T1 | Expert A → Expert B | Router sent task to fullstack-engineer, but it's purely CSS → handoff to ui-designer |
| T2 | Expert → Expert | During orchestrated task, code-reviewer finds issue and recommends fix → handoff to fullstack-engineer (with Lead awareness via whiteboard) |

Note: T0 doesn't need Handoff because Lead is already the orchestrator — it can
simply dispatch an Expert via the existing expert-dispatcher skill when a
conversation escalates to an action task.

### 5.8 Conversation Context Continuity

When a Handoff occurs, the target Agent receives:
1. Original user message (what started the task)
2. Summary of work done by source Agent
3. Key findings and file references
4. The source Agent's JSONL session path (for deep context if needed)

The target Agent's CLI process starts with this context pre-injected into its
prompt, providing continuity without requiring the user to repeat themselves.

### 5.9 Handoff Constraints

- **Max chain depth**: 1 (A → B is allowed, but B cannot handoff further;
  prevents cascading misclassifications). If B also can't handle the task, it
  reports to the user rather than chaining further. Server enforces via
  `dispatchChain` in AgentMessage. Can be relaxed to 2 if real usage data
  shows a need.
- **Same chat only**: Handoff stays within the same chat context.
- **No self-handoff**: Agent cannot handoff to itself.
- **Whiteboard recording**: Every handoff (including failures) is recorded as
  a whiteboard entry, ensuring full audit trail regardless of tier.

---

## 6. Communication Mechanism Overhaul: Deprecate Mailbox

### 6.1 Problem Statement

The Mailbox system (`~/.openteam/mailbox/{chatId}/{from}→{to}.jsonl`) was
designed as the inter-agent communication channel. In practice, its only active
use is:

1. `ExpertExitHandler` writes `task:completed/failed` to `{agentId}→lead.jsonl`
2. Lead reads via `check-inbox.sh`

But analysis of `ExpertExitHandler.ts:207-232` reveals the mailbox message
contains **low-quality auto-generated content**:

```typescript
// Line 218: summary is last 300 chars of assistant output, truncated
summary = ((lastText as any)?.content || '').substring(0, 300)
// artifacts and modifiedFiles are always empty arrays
artifacts: [], modifiedFiles: []
```

Meanwhile, the same "Expert completed" event is **already signaled through 3
other channels**:

| Channel | What it carries | Mechanism |
|---------|----------------|-----------|
| WebSocket `expert:exit` | exitCode, finalActivity (cost, tokens, tool calls) | `sessionRegistry.sendToSession()` |
| Whiteboard auto-extract | Structured artifact/progress entries | `wb-auto-extract.sh` Stop hook |
| Frontend WebSocket | `expert:list-updated` for UI refresh | `sendTo(connectionId, ...)` |

Lead already acts on the **SSE/WebSocket notification** (`watch-events.sh`),
then uses `team-status.sh` for details. The mailbox read (`check-inbox.sh`)
is documented as "last resort fallback" in the expert-dispatcher SKILL.md.

### 6.2 Deprecation Strategy

**Phase 1 — Stop writing** (immediate, with new orchestration):
- `ExpertExitHandler`: remove mailbox write block (lines 207-232)
- T1 mode never had a mailbox reader — no impact
- T2 (Lead): switch from `check-inbox.sh` to relying on SSE + `team-status.sh`

**Phase 2 — Remove reading infrastructure**:
- Remove `check-inbox.sh` and `watch-inbox.sh` from expert-dispatcher skill
- Remove mailbox references from SKILL.md
- Remove `MailboxManager` from server dependency injection

**Phase 3 — Clean up**:
- Remove `MailboxManager.ts` and related imports (9 files reference it)
- Remove `~/.openteam/mailbox/` directory creation
- Clean up `shared/agent-message-types.ts` (remove unused message types)

### 6.3 What Replaces Mailbox's Functions

| Mailbox function | Replacement | Already exists? |
|-----------------|-------------|-----------------|
| Expert → Lead completion notification | WebSocket `expert:exit` event → SSE `watch-events.sh` | Yes |
| Structured completion summary | Whiteboard `progress` entry via `wb-auto-extract.sh` | Yes |
| Task result details (artifacts, files) | Whiteboard `artifact` entries + JSONL transcript | Yes |
| `task:input_required` signal | SSE event stream (already pushed) | Yes |
| Expert → Expert recommendation | **Handoff HTTP API** (new, §5) | New |
| `task:assign` (Lead → Expert) | plan.md via `ExecutionPlanManager` (already used) | Yes |

### 6.4 AgentMessage Protocol Slimming

With Mailbox deprecated, the 16-type discriminated union can be reduced to
types that are still referenced by active code:

**Keep** (used by SSE, Whiteboard, or Handoff):
- `task:completed` — exit handler still constructs this for execution_log metadata
- `task:failed` — same
- `task:input_required` — SSE push to Lead for permission forwarding
- `task:blocked` — war-room `open_question` equivalent
- `artifact` — whiteboard auto-extract

**Deprecate** (no active producer or consumer in server code):
- `task:assign` — replaced by plan.md + HTTP start
- `task:accepted` — never implemented
- `task:progress` — replaced by `team-status.sh` memory query
- `task:milestone` — replaced by whiteboard `progress` entry
- `task:idle` — never implemented
- `task:rejected` — never implemented
- `task:delegated` — replaced by Handoff API
- `query` / `response` — never implemented

**Approach**: Mark deprecated types with `@deprecated` JSDoc in
`shared/agent-message-types.ts`. Remove from runtime code but keep type
definitions for 1 release cycle to avoid breaking any external tooling that
references the type file.

### 6.5 Resulting Communication Architecture

After Mailbox deprecation, the inter-agent communication model simplifies to:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Communication Channels                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐      Chat-level broadcast                  │
│  │   Whiteboard    │      (goals, decisions, artifacts,         │
│  │   (war-room)    │       progress, constraints)               │
│  └────────┬────────┘                                            │
│           │ write: any Agent (via hooks or manual)               │
│           │ read: any Agent (via Context Briefing at start,      │
│           │       or wb-snapshot.sh on demand)                   │
│                                                                 │
│  ┌─────────────────┐      Point-to-point directed               │
│  │   Handoff API   │      (Agent A → Agent B, with full         │
│  │   (HTTP POST)   │       context transfer)                    │
│  └────────┬────────┘                                            │
│           │ Source Agent calls handoff.sh                        │
│           │ Server spawns target, injects HandoffContext         │
│                                                                 │
│  ┌─────────────────┐      Server → Agent/Frontend push          │
│  │  WebSocket/SSE  │      (expert:exit, expert:started,         │
│  │   Events        │       permission-request, list-updated)    │
│  └────────┬────────┘                                            │
│           │ ExpertLifecycle emits lifecycle events               │
│           │ Lead receives via watch-events.sh (Monitor)          │
│           │ Frontend receives directly via WebSocket             │
│                                                                 │
│  ┌─────────────────┐      One-time context injection            │
│  │    Plan.md      │      (task description, acceptance         │
│  │  (+ Briefing)   │       criteria, dependencies)              │
│  └─────────────────┘                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Four channels, each with a clear single responsibility:
1. **Whiteboard**: shared state (what's happening in this chat)
2. **Handoff API**: directed transfer (I'm passing this to you)
3. **WebSocket/SSE**: lifecycle events (system notifications)
4. **Plan.md**: task contract (here's what to do)

---

## 7. Architecture Overview Diagram

```
                              ┌─────────────────────┐
                              │   User (WebSocket)   │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ ExecutionModeRouter  │
                              │ (T1 vs Lead decide) │
                              └──────┬─────────┬────┘
                                     │         │
                          T1 ────────┘         └──────── Lead
                          │                              │
                ┌─────────▼─────────┐         ┌─────────▼─────────┐
                │ Direct Expert     │         │ Lead Agent        │
                │ Execution         │         │ (CLI proc)        │
                │                   │         │                   │
                │ • Skip Lead       │         │ T0: Answer direct │
                │ • Full SOUL.md    │         │ T2: Dispatch      │
                │ • Can Handoff →   │         │ T2+DAG: Workflow  │
                └───────┬───────────┘         └────────┬──────────┘
                        │                              │
                        │         ┌────────────────────┘
                        │         │  (dispatch / DAG)
                        │         │
              ┌─────────▼─────────▼──────────────────────────────┐
              │              ExpertLifecycle                      │
              │     (CLI subprocess spawn + manage)               │
              └──────────────────────┬───────────────────────────┘
                                     │
                    ┌────────────────┬┴───────────────────┐
                    │                │                     │
              ┌─────▼─────┐  ┌──────▼──────┐     ┌──────▼──────┐
              │ Expert A   │  │ Expert B    │     │ Expert C    │
              │ (CLI proc) │  │ (CLI proc)  │     │ (CLI proc)  │
              │            │  │             │     │             │
              │  ──Handoff──→ │             │     │             │
              └────────────┘  └─────────────┘     └─────────────┘
```

---

## 8. Implementation Phases

### Phase 1: Agent Handoff Mechanism

The foundational primitive that T1 depends on. Enables agent autonomy and
provides the safety net when server-side routing is imprecise.

**Scope**:
- Handoff skill (`ai-assets/skills/handoff/`) with `handoff.sh` script
- Server endpoint `POST /api/expert/handoff`
- HandoffContext assembly and injection into target Agent's prompt
- Whiteboard entry for handoff audit trail
- Handoff chain depth enforcement (max 1, relaxable via config)
- SOUL.md handoff awareness section for all Experts
- `dispatchChain` tracking in AgentMessage

**Impact**: Unblocks T1 by providing the escape valve when routing is wrong.

### Phase 2: Execution Mode Router + T1 Direct Execution

Route unambiguous single-agent tasks directly to the target Expert.

**Scope**:
- `ExecutionModeRouter` with keyword classification (T1 vs Lead)
- `ExpertLifecycle.startDirect()` method (skip Lead, spawn Expert directly)
- Whiteboard integration for T1 results
- Routing logic in WebSocket handler

**Impact**: ~35% of tasks bypass Lead → ~40% latency reduction for those tasks.

### Phase 3: T0 Lead Conversation Mode

Enable Lead to answer simple questions directly without dispatching.

**Scope**:
- Add "Conversation Mode" section to Lead SOUL.md
- Define answer-vs-dispatch decision criteria
- No new agent definition, no server-side changes — purely Lead behavior

**Impact**: ~15% of tasks answered without Expert spawn → eliminates Expert
startup latency entirely for simple Q&A.

### Phase 4: Mailbox Deprecation

Remove the redundant Mailbox communication channel. Must happen BEFORE the
DAG Engine so Phase 5 builds against the clean communication model.

**Scope**:
- Remove mailbox write from `ExpertExitHandler.ts`
- Remove `check-inbox.sh` / `watch-inbox.sh` from expert-dispatcher
- Remove `MailboxManager` from server DI (7 files)
- Mark deprecated AgentMessage types
- Pre-deprecation: instrument `MailboxManager.readMessages()` for 1 week to
  catch hidden consumers

**Impact**: Simplifies communication from 5 channels to 4. Unblocks DAG Engine
design against the clean model.

### Phase 5: Workflow DAG Engine

Enable structured multi-step task execution. Builds on the post-Mailbox
communication model (SSE + Whiteboard only, no Mailbox dependency).

**Scope**:
- `WorkflowEngine` with DAG execution and structured condition DSL
- `create-workflow.sh` skill script for Lead
- Checkpoint persistence and `resume-workflow.sh`
- Lead SOUL.md update with DAG creation guidelines

**Impact**: ~10% of tasks (complex ones) get structured execution → fewer
context-limit timeouts, automatic dependency sequencing.

---

## 9. Migration and Compatibility

### 8.1 Zero Breaking Changes

All additions are additive. The current path (T2 via Lead) remains the
default and is fully preserved. New tiers and Handoff are opt-in.

### 8.2 Gradual Rollout

- Phase 1: Handoff available but agents only use it when confidence is high
- Phase 2: Router starts with conservative thresholds (confidence > 0.9 for T1)
- Phase 3: T0 conversation mode added (Lead SOUL.md only, zero server risk)
- Phase 4: Mailbox deprecated — clean communication model established
- Phase 5: DAG engine for power users / complex tasks (builds on clean model)
- Monitor misclassification rate via whiteboard entries; T2 always available as fallback

### 8.3 Configuration

```json
// openteam.json addition
{
  "orchestration": {
    "router": {
      "enabled": true,
      "t1Enabled": true,
      "t1ConfidenceThreshold": 0.85
    },
    "handoff": {
      "enabled": true,
      "maxChainDepth": 1
    }
  }
}
```

Note: T0 has no server-side configuration — it's controlled purely by Lead's
SOUL.md behavior rules. T1 routing can be disabled while keeping T0 active.

---

## 10. Success Metrics

| Metric | Current | Target (Phase 1-3) | Target (All Phases) |
|--------|---------|--------------------|-----------------------|
| Avg task latency (conversation, warm) | ~25s | ~2-5s (Lead direct) | ~2-5s |
| Avg task latency (conversation, cold) | ~25s | ~10-15s (Lead spawn + direct) | ~10-15s |
| Avg task latency (single-agent) | ~25s | ~10s (skip Lead) | ~10s |
| Avg task latency (multi-agent) | ~30s | ~30s | ~25s (DAG auto-sequence) |
| Lead context consumption | 100% tasks need Expert spawn | ~50% answered directly or T1 | ~40% |
| Timeout rate (complex tasks) | 30% | 30% | ~15% (checkpoint resume) |
| Role mismatch resolution | Manual re-dispatch | Auto-handoff | Auto-handoff |
| Avg cost per task (conversation) | ~$0.30 (Expert spawn) | ~$0.03 (Lead only) | ~$0.03 |
| Avg cost per task (single-agent) | ~$0.50 | ~$0.30 (no Lead overhead) | ~$0.30 |
| Handoff success rate | N/A | >85% | >90% |

---

## 11. Frontend Interface Contracts

The server-side changes in this proposal affect what the frontend sees via
WebSocket events. This section defines the interface contracts to ensure the
UI can represent all tiers and handoffs correctly.

### 11.1 New WebSocket Events

#### `expert:handoff`

Sent when a Handoff occurs, so the frontend can show the transition:

```typescript
{
  type: 'expert:handoff'
  payload: {
    chatId: string
    sourceAgentId: string     // Agent that handed off
    targetAgentId: string     // Agent that received the task
    reason: string            // why the handoff happened
    sourceSessionId: string   // for linking in chat history
  }
}
```

#### `expert:handoff-failed`

Sent when a Handoff attempt fails:

```typescript
{
  type: 'expert:handoff-failed'
  payload: {
    chatId: string
    sourceAgentId: string
    targetAgentId: string
    error: string
  }
}
```

### 11.2 Extended `expert:started` Payload

Add `executionMode` and `handoffFrom` to the existing `expert:started` event:

```typescript
{
  type: 'expert:started'
  payload: {
    agentId: string
    chatId: string
    sessionId: string
    // ... existing fields ...
    executionMode: 't0' | 't1' | 't2'    // NEW: which tier this execution uses
    handoffFrom?: string                  // NEW: source agent if this is a handoff target
  }
}
```

### 11.3 Frontend Behavior Per Tier

| Tier | Frontend behavior | Key difference from current |
|------|------------------|---------------------------|
| T0 | Lead appears in expert list, answers directly. No Expert entry appears. | Same as current when Lead happens to not dispatch |
| T1 | Expert appears directly (no Lead entry). Chat input shows Expert identity. | No Lead entry in `expert:list-updated` |
| T2 | Lead + Expert(s) appear. Same as current. | No change |
| Handoff | Source Expert disappears, target Expert appears. A handoff indicator shows in chat timeline. | New `expert:handoff` event triggers transition animation |

### 11.4 Chat History Display

- T1 messages: attributed to the Expert that ran (no Lead wrapper)
- Handoff messages: a system message in the chat timeline shows "Agent A handed
  off to Agent B: {reason}" between the two agents' outputs
- DAG workflow: a workflow progress indicator (future Phase, placeholder spec)

---

## 12. Architecture Revision: Handoff-First Dispatch Model

### 12.1 Motivation

The original design had three routing layers:
1. Server-side keyword router (T1) — regex/keyword bypass of Lead
2. Lead conversation mode (T0) — Lead answers directly
3. Lead manual dispatch (T2) — Lead uses expert-dispatcher to start/monitor/aggregate

In practice, the server-side router (T1) never triggered due to overly
conservative scoring (keyword coverage ratio yields ~0.5 for clear matches,
well below the 0.85 threshold). Meanwhile, Lead already has LLM-level
understanding of task intent — duplicating that with regex adds complexity
without benefit.

### 12.2 Revised Decision Model

All routing decisions are made by Lead (LLM judgment), not the server:

```
User message → Lead spawns
  → Lead evaluates:
    ├── T0: Question/status → Answer directly, no Expert
    ├── Single-agent task → Handoff to best-fit Expert (Lead exits)
    └── Multi-step task → Create Workflow DAG (Engine orchestrates)
```

**Key change**: Lead uses the `handoff` skill (not `start-expert`) for
single-agent dispatch. This means:
- Lead exits after successful handoff — no monitoring loop
- Expert interacts directly with the user
- No intermediate aggregation step

### 12.3 expert-dispatcher Role Change

| Before | After |
|--------|-------|
| Primary dispatch mechanism (start-expert + watch-events + send-to-expert) | Workflow DAG management only (create/resume/list-workflows + team-status) |
| Lead stays alive to monitor, forward input, aggregate results | Lead exits after handoff; Expert owns the user interaction |
| Manual sequential dispatch for multi-step tasks | Workflow DAG Engine handles scheduling automatically |

The `start-expert.sh` and `watch-events.sh` scripts remain as fallback
for edge cases but are no longer the primary dispatch path.

### 12.4 Server-Side Router (T1) Status

The `ExecutionModeRouter` is retained in code but **disabled by default**
(`t1Enabled: false`). It can be re-enabled after collecting production data
from `execution_logs.execution_mode` to tune the scoring algorithm.

The router code and dispatch rules are preserved for future optimization —
once enough data shows which tasks consistently route to the same Expert,
the T1 bypass can be enabled with data-driven thresholds.

### 12.5 Impact on Existing Tiers

| Tier | Before | After |
|------|--------|-------|
| T0 | Lead answers directly | Unchanged |
| T1 | Server router bypasses Lead | Disabled by default; Lead handles all routing |
| T2 | Lead → start-expert → monitor → aggregate | Lead → handoff (single) or create-workflow (multi) |
| Handoff | Expert-to-Expert peer transfer | Also used for Lead-to-Expert dispatch |
