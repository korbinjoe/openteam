---
name: expert-dispatcher
description: >
  Workflow DAG management and team status monitoring.
  Used by Lead Agent to create multi-step workflows, check progress, and resume interrupted workflows.
allowed-tools: Bash,Monitor
---

# Expert Dispatch Instructions

You can manage Expert Agents via the following scripts. All required environment variables are auto-injected — no manual setup needed.

## Environment Variables (Injected)

| Variable | Description |
|----------|-------------|
| `EXPERT_API_BASE` | openteam-server HTTP address |
| `EXPERT_CONNECTION_ID` | Current WS connection ID |
| `OPENTEAM_CHAT_ID` | Current chat ID |
| `OPENTEAM_INSTANCE_ID` | Your instance ID |

## Calling Convention

When calling all dispatcher scripts, **you must use Bash's `description` parameter** with a short description. This makes the UI display a clear operation description instead of a long script path.

| Script | description example |
|--------|-------------------|
| `team-status.sh` | `Check team status` |
| `create-workflow.sh` | `Create workflow DAG` |
| `resume-workflow.sh` | `Resume workflow` |
| `list-workflows.sh` | `List workflows` |
| `start-expert.sh` | `Start expert (fallback)` |
| `watch-events.sh` | `Start expert event stream` |

## Team Status

```bash
bash {SKILL_DIR}/scripts/team-status.sh
```

Returns real-time status of all Experts in current Chat (phase, current tool, progress, cost).
Served directly from server memory, zero file IO. Use for on-demand progress awareness.

## Workflow DAG Commands

For multi-step tasks with dependencies, use the workflow DAG engine.

### Create Workflow

```bash
bash {SKILL_DIR}/scripts/create-workflow.sh '<dag-json>'
```

The DAG JSON defines tasks with dependencies:
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
- `onFailure`: `stop` (halt DAG), `skip` (continue others), `retry` (re-run up to maxRetries)
- `maxRetries`: number of retry attempts (default 1, only for `retry` policy)
- `timeoutMinutes`: per-task timeout (default 30)

### List Workflows

```bash
bash {SKILL_DIR}/scripts/list-workflows.sh [status]
```

Filter by status: `running`, `suspended`, `completed`, `stopped`

### Resume Workflow

```bash
bash {SKILL_DIR}/scripts/resume-workflow.sh <workflow-id>
```

Resume a suspended or stopped workflow from its last checkpoint.

## Fallback: Direct Expert Start

For cases where handoff is not suitable (e.g., you need to stay alive and monitor):

```bash
bash {SKILL_DIR}/scripts/start-expert.sh <agentId> "<task>" [instanceSuffix]
```

Use Monitor with `watch-events.sh` to receive SSE push notifications:

```
Monitor tool parameters:
  command: "bash {SKILL_DIR}/scripts/watch-events.sh"
  description: "Expert event stream"
  persistent: true
```

**Prefer handoff over start-expert for single-agent tasks.** Handoff is simpler
(no monitoring loop) and lets the Expert interact directly with the user.

## Message Protocol

For detailed message type definitions for inter-Agent communication, see `references/message-protocol.md`.
