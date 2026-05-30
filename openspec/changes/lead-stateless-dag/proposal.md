# Proposal: Lead Stateless DAG

## Summary

Make Lead Agent stateless for DAG workflows: Lead submits a DAG and immediately
exits. The server-side WorkflowEngine takes full responsibility for scheduling
tasks, starting agents, handling failures, and notifying the user of results.

## Motivation

Currently, Lead stays alive after submitting a DAG to monitor progress via
`watch-events.sh`. This is wasteful:

1. **Resource waste** — Lead occupies a CLI subprocess slot doing nothing but
   polling for events it cannot influence
2. **Unnecessary complexity** — Lead's SOUL.md has recovery logic
   (`list-workflows --status=running`, `resume-workflow`) that duplicates what
   the server engine should handle autonomously
3. **Fragility** — if Lead crashes or is killed, the workflow stalls until a
   user manually resumes it

The WorkflowEngine already tracks state, dependencies, failure policies, and
checkpoints. The only missing piece is an **active scheduler** that reacts to
`task-resolved` events by starting the next ready agents.

## Goals

1. Lead submits DAG → exits immediately (same as a handoff)
2. Server-side scheduler auto-starts agents when their dependencies resolve
3. Server notifies user (via WS broadcast) on workflow completion or unrecoverable failure
4. Existing failure policies (stop/skip/retry) remain unchanged
5. No change to the DAG JSON format submitted by Lead

## Non-Goals

- Changing the WorkflowEngine's state machine or persistence model
- Adding a UI for workflow management (future work)
- Removing the `expert-dispatcher` skill entirely (it still owns `create-workflow.sh` and `team-status.sh`)

## Approach

### Server: Add WorkflowScheduler

A new module `server/orchestration/WorkflowScheduler.ts` that:
- Listens to `task-resolved` events from each WorkflowEngine
- On each event, calls `getReadyTasks()` and starts the corresponding agents via `expertHandler.handleStart()`
- Also starts initial ready tasks immediately after `createWorkflow()` returns
- On `workflow-completed`, broadcasts result to the chat (already partially implemented in WorkflowRegistry)

### Lead SOUL.md: Simplify

- Remove `watch-events.sh` monitoring pattern
- Remove startup workflow recovery logic (server handles it)
- DAG submission becomes fire-and-forget (like handoff)
- Keep `team-status.sh` for on-demand queries (user asks "what's the progress?")

### expert-dispatcher Skill: Trim

- Remove `watch-events.sh`, `resume-workflow.sh` (server auto-resumes on startup)
- Keep `create-workflow.sh`, `list-workflows.sh`, `team-status.sh`

## Risks

| Risk | Mitigation |
|------|-----------|
| Server restart loses in-flight workflows | Already mitigated: `reconcileOnStartup()` recovers from checkpoints |
| No human judgment on ambiguous failures | `onFailure: stop` halts the workflow; user can check status and re-dispatch |
| Agent start failure in scheduler | Emit `workflow:task-start-failed` event, apply failure policy same as task failure |

## Impact

- `server/orchestration/` — new WorkflowScheduler, minor wiring in WorkflowRegistry
- `ai-assets/agents/lead/SOUL.md` — simplify decision model
- `~/.openteam/skills/expert-dispatcher/` — remove dead scripts
- No DB schema changes, no new dependencies
