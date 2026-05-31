# Tasks: Redesign DevPanel

## Phase 1: Server-Side Data Exposure

- [x] Add `dev:workflow` WS event to DevInspector — query WorkflowRegistry for active workflow by chatId, emit task states
- [x] Add `dev:whiteboard` WS event to DevInspector — query WhiteboardManager for snapshot, emit on subscribe + entry changes
- [x] Extend `useDevPanel` hook to subscribe to new events and store workflow + whiteboard state

## Phase 2: Frontend Tab Structure

- [x] Refactor DevPanel tab system — replace 4 tabs (Pipeline|Sessions|Protocol|Raw) with 5 tabs (Overview|Workflow|Agents|Protocol|Events)
- [x] Create `DevOverviewTab` component — chat/workflow status, cost summary, whiteboard digest, agent status grid
- [x] Create `DevWorkflowTab` component — flat task list with status dots, dependency indentation, expandable detail
- [x] Refactor existing Sessions tab into `DevAgentsTab` — add ACP state, token usage table, session info
- [x] Create `DevProtocolTab` component — unified message inspector with direction indicators, type badges, filters
- [x] Create `DevEventsTab` component — streamlined event log with filters, search, pause/resume

## Phase 3: Polish & Validation

- [x] Verify ⌘⇧D toggle works end-to-end (fixed in prior commit, validated with WorkspaceLayout mount)
- [ ] Test with active multi-agent workflow — ensure DAG tab renders correctly
- [ ] Test with single-agent mission — ensure graceful empty states
- [ ] Verify no performance regression with high-frequency ACP updates
