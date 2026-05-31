# Proposal: Redesign DevPanel

## Summary

Redesign the DevPanel (⌘⇧D) to fully visualize OpenTeam's information
architecture, data flow, and agent coordination — enabling developers to
diagnose issues across the entire system stack from a single panel.

## Motivation

The current DevPanel was built during the single-agent era and covers only:
- Pipeline stage visualization (local/network/backflow zones)
- Agent session list (PTY process state, JSONL file info)
- ACP protocol timeline (recent updates)
- Raw data dump (snapshot JSON + event log)

OpenTeam has since evolved into a multi-agent orchestration system with:
- **Workflow DAG engine** — parallel task scheduling with dependency graphs
- **Agent-to-Agent messaging** — task:assign, handoff, progress reports
- **Whiteboard** — shared context (goals, decisions, constraints, open questions)
- **ACP protocol** — full JSON-RPC bidirectional communication layer
- **Token/cost tracking** — per-agent, per-model usage breakdown
- **Session lifecycle** — spawn/connect/disconnect/kill state machine

None of these are visible in the current DevPanel, making multi-agent debugging
a painful exercise of reading raw JSONL files and server logs.

## Goals

1. Provide a single-pane-of-glass view for all system state relevant to debugging
2. Visualize Workflow DAG execution with dependency edges and per-task status
3. Show real-time Agent-to-Agent message flow (task:assign → completed → handoff)
4. Surface Whiteboard entries as shared-context visibility
5. Expose bidirectional WebSocket + ACP event stream with filtering
6. Display per-agent token/cost breakdown
7. Maintain the existing draggable/resizable floating panel UX

## Non-Goals

- Adding new server-side data collection (reuse existing DevInspector + WS events)
- Changing the DevPanel's access model (remains dev-only, ⌘⇧D toggle)
- Building a graph layout engine (use simple list/timeline views; DAG uses CSS grid)
- Persisting DevPanel preferences to the database

## Approach

Replace the current 4-tab layout (Pipeline | Sessions | Protocol | Raw) with a
5-tab layout that maps to OpenTeam's information layers:

| Tab | Data Source | Purpose |
|-----|-------------|---------|
| **Overview** | DevSnapshot + Whiteboard + TokenUsage | At-a-glance system health |
| **Workflow** | WorkflowEngine state | DAG visualization + task status |
| **Agents** | SessionRegistry + ACP inspect | Per-agent deep dive |
| **Protocol** | ACP updates + Agent messages | Bidirectional message inspector |
| **Events** | DevEvents stream | Filterable raw event log |

Server changes are minimal — expose `workflow:state` and `whiteboard:snapshot`
over the existing `dev:*` WS channel.

## Risks

- **Performance**: High-frequency ACP updates could flood the event list →
  mitigate with ring-buffer (existing MAX_EVENTS=500) and throttled rendering
- **Scope creep**: DAG visualization could become arbitrarily complex →
  constrain to flat list with indentation for dependencies (no force-directed graph)
- **Stale data**: DevPanel polls every 5s; workflow transitions can happen faster →
  use push-based `dev:event` for state changes, poll only as fallback
