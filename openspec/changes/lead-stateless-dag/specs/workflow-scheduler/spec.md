# Spec: Workflow Scheduler

## ADDED Requirements

### Requirement: Auto-schedule ready tasks after workflow creation

The server MUST automatically start all initially-ready tasks (those with no
dependencies) immediately after a workflow is created via the API.

#### Scenario: DAG with independent root tasks

Given a DAG with tasks T1 (no deps) and T2 (no deps) and T3 (depends on T1, T2)
When the workflow is created
Then T1 and T2 are started in parallel
And T3 remains pending

#### Scenario: DAG with single entry point

Given a DAG with T1 (no deps) and T2 (depends on T1)
When the workflow is created
Then T1 is started immediately
And T2 remains pending

---

### Requirement: Auto-schedule dependent tasks on completion

When a task completes, the scheduler MUST evaluate all pending tasks and start
any whose dependencies are now fully resolved.

#### Scenario: Sequential dependency chain

Given T1 is running and T2 depends on T1
When T1 completes successfully
Then T2 is started automatically

#### Scenario: Fan-in (multiple dependencies)

Given T3 depends on T1 and T2, and T1 is completed
When T2 completes successfully
Then T3 is started automatically

#### Scenario: Conditional task not met

Given T2 depends on T1 with condition `T1.result.status eq "approved"`
When T1 completes with status "rejected"
Then T2 is skipped (condition not met)

---

### Requirement: Handle agent start failure gracefully

If starting an agent fails (process spawn error, agent not found), the scheduler
MUST record the task as failed and apply the configured failure policy.

#### Scenario: Agent spawn fails with stop policy

Given T1 has onFailure: stop
When the scheduler fails to start T1's agent
Then T1 is recorded as failed with reason "agent_start_failed"
And all downstream tasks are skipped
And workflow status becomes "stopped"
And a `workflow:stopped` event is broadcast to the chat

---

### Requirement: React to agent completion events

The scheduler MUST subscribe to agent lifecycle events to detect when an expert
finishes its work, and feed the result back to the WorkflowEngine.

#### Scenario: Agent completes successfully

Given T1 is running with agent "fullstack-product-engineer"
When the agent's session ends with a success result
Then the scheduler calls `engine.recordTaskResult(T1, result)`
And the scheduling loop evaluates next ready tasks

#### Scenario: Agent crashes

Given T1 is running with agent "code-reviewer"
When the agent's session ends unexpectedly (no result)
Then the scheduler calls `engine.recordTaskFailure(T1, "agent_crashed")`
And the failure policy is applied

---

## MODIFIED Requirements

### Requirement: Workflow creation API returns immediately

The `POST /api/workflow/create` endpoint MUST return success as soon as the DAG
is persisted and initial scheduling is triggered. It MUST NOT wait for any task
to complete.

#### Scenario: Lead submits DAG and exits

Given Lead calls create-workflow with a valid DAG
When the API returns 200 with workflowId
Then Lead can exit immediately
And the scheduler continues operating independently

---

### Requirement: Startup reconciliation resumes scheduling

On server restart, `reconcileOnStartup()` MUST not only recover workflow state
but also re-activate the scheduler for any workflow in `running` status.

#### Scenario: Server restarts with active workflow

Given a workflow was running with T1 completed and T2 pending (deps resolved)
When the server restarts and reconciles
Then T2 is started by the scheduler automatically
