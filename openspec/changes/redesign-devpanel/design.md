# Design: Redesign DevPanel

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DevPanel (Frontend)                        │
├─────────┬──────────┬────────────┬────────────┬──────────────────┤
│ Overview│ Workflow  │   Agents   │  Protocol  │     Events       │
│         │          │            │            │                  │
│ Health  │ DAG grid │ Session    │ WS stream  │ Filtered log     │
│ Cost    │ Task     │ ACP state  │ ACP msgs   │ Search           │
│ Board   │ status   │ Token use  │ Agent msgs │ Type filter      │
└────┬────┴────┬─────┴─────┬──────┴─────┬──────┴────────┬─────────┘
     │         │           │            │               │
     ▼         ▼           ▼            ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WebSocket (dev:* channel)                      │
├─────────────────────────────────────────────────────────────────┤
│ dev:snapshot    → Overview + Agents                               │
│ dev:workflow    → Workflow DAG state (NEW)                        │
│ dev:whiteboard  → Whiteboard entries (NEW)                       │
│ dev:event       → Events stream (existing)                       │
│ dev:pipeline    → Pipeline (kept for Overview health)            │
│ dev:timeline    → Protocol entries (existing)                    │
│ dev:jsonl-messages → Agent JSONL stream (existing)               │
└─────────────────────────────────────────────────────────────────┘
```

## New Server-Side Events

### `dev:workflow`

Pushed on subscribe and on workflow state change.

```typescript
interface DevWorkflowPayload {
  chatId: string
  workflowId: string | null
  status: WorkflowStatus | null  // 'created' | 'running' | 'completed' | 'stopped'
  tasks: Array<{
    taskId: string
    agentId: string
    description: string
    status: TaskStatus  // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    dependsOn: string[]
    startedAt: string | null
    completedAt: string | null
    durationMs: number | null
    retryCount: number
    failureReason: string | null
  }>
  totalElapsedMs: number | null
}
```

### `dev:whiteboard`

Pushed on subscribe and on whiteboard entry write/archive.

```typescript
interface DevWhiteboardPayload {
  chatId: string
  goal: WhiteboardEntry | null
  active: WhiteboardEntry[]  // recent active entries (limit 20)
  totalActive: number
  totalArchived: number
}
```

## Frontend Tab Design

### Tab 1: Overview

Single-screen summary:
- **Status bar**: chat status + workflow status + health indicator
- **Cost summary**: total cost across all agents, with per-agent breakdown sparkline
- **Whiteboard digest**: current goal + last 3 active entries (decision/progress/open_question)
- **Agent status grid**: 1 row per active agent showing phase + tool + tokens

### Tab 2: Workflow

- When no workflow: show "No active workflow" placeholder
- When workflow active:
  - Flat task list with indentation showing dependency depth
  - Per-task row: `[status-dot] agentId — description [duration] [retry badge]`
  - Status dots use project convention (blue=running, green=done, red=failed, gray=pending)
  - Dependency arrows rendered as left-border connections (no graph library)
  - Collapsed detail section per task: result summary, failure reason, modified files

### Tab 3: Agents

Enhanced version of current Sessions tab:
- Card per agent with sections:
  - **Header**: agentId, status dot, phase, current tool
  - **ACP**: adapter state, capabilities, prompt in-flight indicator, last prompt duration
  - **Tokens**: model usage table (model | input | output | cache | cost)
  - **JSONL**: message count, file size, expand to view messages (existing)
  - **Lifecycle**: created → connected → disconnected timeline

### Tab 4: Protocol

Unified message inspector combining:
- **ACP session updates** (from timeline entries): agent_message_chunk, tool_call, plan, etc.
- **Agent-to-Agent messages**: task:assign, task:completed, handoff (from DevEvents)
- **WS control messages**: expert:started, expert:exit, permission requests

Each entry shows:
- Timestamp (relative to session start)
- Direction indicator: `→` outbound, `←` inbound, `↔` internal
- Source/target labels
- Type badge (color-coded by category)
- Expandable detail JSON

Filter bar: type checkboxes + agent selector + text search

### Tab 5: Events

Streamlined version of current Raw Data:
- Real-time event stream (ring buffer, newest first)
- Columns: time | type | agent | summary
- Filters: type dropdown, agent dropdown, search input
- Clear button + pause/resume toggle
- Removed: raw JSON snapshot dump (moved to Overview as copy-to-clipboard action)

## Decisions

1. **No graph library for DAG** — CSS grid with indentation is sufficient for
   typical 3-8 task workflows. Avoids adding a heavy dependency (dagre/d3-force).

2. **Reuse existing DevInspector** — Extend with 2 new WS event types rather
   than building a separate inspection service.

3. **Keep floating panel UX** — The draggable/resizable portal approach works
   well for a developer tool that shouldn't displace the main workspace.

4. **Ring buffer for Protocol/Events** — Cap at 500 entries (existing constant)
   to prevent memory growth during long-running missions.

5. **No persistence** — DevPanel state (active tab, filters, panel position)
   stays in component state. Panel position already uses `useDragResizePanel`.
