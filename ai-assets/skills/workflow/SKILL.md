---
name: workflow
description: >
  Workflow DAG orchestration. Submit multi-step task graphs to the server-side
  WorkflowEngine, query team status, and manage running workflows.
allowed-tools: Bash
---

# Workflow DAG

For tasks with multiple steps and dependencies, submit a DAG to the server.
The server-side WorkflowEngine handles scheduling, agent startup, failure
policies, and completion notification. **Exit immediately after submission.**

## Environment Variables (Injected)

| Variable | Description |
|----------|-------------|
| `EXPERT_API_BASE` | openteam-server HTTP address |
| `OPENTEAM_CHAT_ID` | Current chat ID |
| `OPENTEAM_INSTANCE_ID` | Your instance ID |

## Create Workflow

```bash
bash {SKILL_DIR}/scripts/create-workflow.sh '<dag-json>'
```

DAG JSON format:
```json
{
  "tasks": [
    { "taskId": "t1", "agentId": "fullstack-product-engineer", "description": "Implement feature", "dependsOn": [], "onFailure": "stop" },
    { "taskId": "t2", "agentId": "code-reviewer", "description": "Review implementation", "dependsOn": ["t1"], "onFailure": "stop" }
  ]
}
```

Task fields:
- `taskId`: unique identifier within the workflow
- `agentId`: which expert agent to run this task
- `description`: task description sent to the agent
- `dependsOn`: array of taskIds that must complete first
- `onFailure`: `stop` (halt DAG), `skip` (continue others), `retry` (re-run)
- `maxRetries`: retry attempts (default 1, only for `retry` policy)
- `timeoutMinutes`: per-task timeout (default 30)

## List Workflows

```bash
bash {SKILL_DIR}/scripts/list-workflows.sh [status]
```

Filter by status: `running`, `suspended`, `completed`, `stopped`

## Resume Workflow

```bash
bash {SKILL_DIR}/scripts/resume-workflow.sh <workflow-id>
```

## Advance Workflow

```bash
bash {SKILL_DIR}/scripts/advance-workflow.sh '<workflow-id>'
```

Start all ready tasks in a workflow. Called by Lead after receiving a
`[Workflow progress]` notification and reviewing the completed task.

## Team Status

```bash
bash {SKILL_DIR}/scripts/team-status.sh
```

Returns real-time status of all Experts in the current Chat.

## Calling Convention

All script calls must use Bash's `description` parameter:

| Script | description example |
|--------|-------------------|
| `create-workflow.sh` | `Create workflow DAG` |
| `advance-workflow.sh` | `Advance workflow` |
| `team-status.sh` | `Check team status` |
| `list-workflows.sh` | `List workflows` |
| `resume-workflow.sh` | `Resume workflow` |
