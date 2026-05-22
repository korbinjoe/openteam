# Tasks: Upgrade Workspace UI v2

## Phase 1: Layout Shell & Sidebar (Foundation)

- [x] **Create `WorkspaceLayout` component** — Three-zone grid: TaskSidebar (240px) | main content area. Register in `App.tsx` as layout for workspace routes. Include toolbar slot and status bar slot.
- [x] **Create `WorkspaceContext`** — Context + useReducer with viewMode, selectedAgentId, selectedTaskId, layoutMode, panelCollapsed, terminalOpen, activeIdeTab, expandedTasks, overlay states. Persist layout preferences to localStorage.
- [x] **Implement `TaskSidebar` container** — 240px panel (collapsible to 52px) containing: SidebarHeader, TaskSessionList, SidebarFooter. Collapse animation 200ms ease.
- [x] **Implement `TaskSessionList`** — Three sections: Pinned (static items), Active Tasks (expandable groups), Completed (collapsed). Urgency sort within active: error → waiting → running.
- [x] **Implement `TaskGroupItem`** — Expandable task row showing: expand chevron, status dot (aggregated from agents), task name, agent count badge. Click chevron toggles expansion, click name opens task overview.
- [x] **Implement `AgentSessionItem`** — Nested agent row (indented 32px) showing: status dot (animated pulse for running), agent name, role badge (LEAD/auto), duration. Handoff indicator (↳) for auto-dispatched agents. Vertical connector line for hierarchy.
- [x] **Implement `SidebarFooter`** — Icon bar: history, agents, workspaces, skills, cron | divider | theme, notifications (with red dot), settings. Each icon 28×28px with hover state.
- [x] **Implement collapsed sidebar mode** — 52px width showing only status dots per agent, with expand button. Toggle via button click.
- [x] **Implement `WorkspaceToolbar`** — 38px height bar with: agent/task info on left, layout controls on right. Agent mode shows: status dot + agent name + "in task-name" link + sibling agent dots. Task mode shows: group icon + "Task Chat" + GROUP badge + task name.
- [x] **Implement `LayoutControls`** — Toggle group: single | split | quad. Visual indicator for active mode. Hint text "⌘\".
- [x] **Implement `WorkspaceStatusBar`** — 28px fixed bottom bar: running count (pulsing dot) + waiting count + error count | divider | branch name | divider | tools count | divider | token count | divider | cost | divider | elapsed time.

## Phase 2: Workspace Content (Agent View)

- [x] **Implement `WorkspaceContent` router** — Renders content based on `viewMode` + `layoutMode` combination. 6 possible states (see design.md component hierarchy).
- [x] **Implement `ChatPane`** — Agent-specific message log + input field + stop button. Input placeholder: "Message {agentName}...". Dynamically shows messages for selected agent.
- [x] **Implement single layout mode** — Full-width ChatPane with scrollable messages and bottom input bar.
- [x] **Implement split layout mode** — CSS Grid 44%|56% split. Left: ChatPane. Right: IDEPanel with terminal.
- [x] **Implement `IDEPanel`** — Right panel container with: IDETabBar (top), tab content (flex), Terminal section (bottom, collapsible). Tab content area renders based on activeIdeTab.
- [x] **Implement `IDETabBar`** — Tabs: Files, Changes (with file count badge), War Room, Browser. Active tab highlighted. Right-aligned workspace name.
- [x] **Implement Files tab content** — Show workspace files with status indicators (new/modified).
- [x] **Implement Changes tab content** — Header with "Unstaged Changes" + file count + Stage All + Commit buttons. File list with status (A/M), path, diff stats (+/-).
- [x] **Implement War Room tab content** — Render cards: DECISION (accent), OPEN QUESTION (yellow), CONSTRAINT (red). Each card shows: type label, content, "by Agent · Xm ago".
- [x] **Implement Browser tab placeholder** — Empty state with globe icon, "No preview running" text, "Start Dev Server" button.
- [x] **Implement terminal section** — Collapsible (120px open, 26px header-only closed). Header: terminal icon + "Terminal" label + "zsh" + collapse chevron. Body: monospace output with green prompt. Toggle via header click.
- [x] **Implement quad layout mode** — CSS Grid 2×2. Each cell is a `MiniAgentPane` showing: compact header (status + name + shortcut key), truncated message log (last 4 entries), no input field. Click header to select agent. Double-click expands to split view.

## Phase 3: Task Overview Mode

- [x] **Implement `TaskOverview` container** — Activated when user clicks task name in sidebar. Contains: TaskInfoSidebar (200px, left) + GroupChat (flex, right).
- [x] **Implement `TaskInfoSidebar`** — Sections: Goal (text + workspace label), Team (lead agent + worker agents with hierarchy + "Add Agent" row), Timeline (vertical event list with colored dots + connector lines), Actions ("Cancel Task" button at bottom).
- [x] **Implement `GroupChat` timeline** — Merges messages from all task agents by timestamp. Message types: system (centered pill), handoff (blue banner with arrow), agent-start (avatar + "joined"), message (avatar + text), tool-call (indented, ⚡ icon), done (indented, ✓ icon), error (card with red border), waiting (card with yellow border + Reply/Open 1:1 buttons), progress (pulsing dot + text).
- [x] **Implement `GroupChatMessage` renderer** — Handle all 8 message types with correct styling. Agent avatar shows first letter with role-based color (purple for lead, accent for worker). Clickable avatar/name jumps to agent 1:1 view.
- [x] **Implement `GroupChatInput`** — Bottom input with: @agent target selector (click to cycle), text input, Enter to send. Stop button (red square icon). Target selector shows current target agent name with accent background.
- [x] **Implement task-overview split mode** — When layoutMode=split and viewMode=task: left 44% is GroupChat, right 56% is IDEPanel (same as agent split).
- [x] **Implement task-overview quad mode** — 2×2 grid of MiniAgentPane for task's agents (max 4). Empty slots show "+ Add Agent" placeholder.

## Phase 4: Overlays & Orchestration

- [x] **Implement `CommandPalette`** — ⌘K triggered overlay. Dark scrim + centered 520px dialog. Search input with icon + esc hint. Results: "Active Tasks" section (nested agents), "Actions" section (with shortcuts). Fuzzy filter on type. Arrow key navigation + Enter to execute.
- [x] **Implement `AddAgentPicker`** — Overlay triggered by "+ Add Agent" rows. Header: title + task name + instruction input. Body: scrollable agent type list (icon + name + description + arrow). Footer: "Agent will inherit task context" hint + Cancel button.
- [x] **Wire keyboard shortcuts** — ⌘K (command palette), ⌘\ (cycle layout), ⌘B (toggle sidebar), ⌘` (toggle terminal), ⌘1-4 (focus agent by index), Escape (close overlays). Register at WorkspaceLayout level.
- [x] **Implement "New Task" button** — SidebarHeader contains "New Task" row with ⌘N hint.

## Phase 5: Integration & Polish

- [x] **Wire sidebar selection to workspace content** — selectAgent → viewMode='agent', show that agent's ChatPane with agent-specific messages. openTaskOverview → viewMode='task-overview', show merged group chat.
- [x] **Wire toolbar to selection state** — AgentInfoBar shows selected agent name/status/task. TaskInfoBar shows selected task name with GROUP badge.
- [x] **Responsive behavior** — Panel auto-collapses at < 1024px viewport. Quad mode falls back to split at < 1024px. Single forced at < 768px.
- [x] **Implement sidebar collapsed interactions** — In 52px mode: show expand chevron. Click expands. ⌘B toggles.
- [x] **Connect to real data** — _Superseded by `fix-workspace-v2-task-agent-routing` (Phases 1 + 4)._ Server-side `MemberAggregator` enriches every chat with `members[]` carrying per-agent `status` + `lastMessageAt` derived from `SessionRegistry` activity. V2 TaskInfoSidebar / GroupChat / WorkspaceToolbar / MiniAgentPane read via `useV2Task` + `useWhiteboard` instead of mocks. WS heartbeat reuse pending (poll-based for now, see Phase 1 deferral note).
- [x] **Implement Pinned section persistence** — Allow users to pin tasks. Pin state persisted to localStorage. Pinned items show at top of sidebar with pin icon + age label. Includes manual archive/unarchive.
- [ ] **Performance: virtualize long agent lists** — If > 20 tasks visible in sidebar, use virtual scrolling. Debounce status update renders to 100ms.
- [ ] **Terminal resize handling** — On panel collapse/expand, layout mode change, and window resize: debounce xterm `fit()` at 100ms. Handle the 4 scenarios: initial load, refresh, resize, session restore.

## Dependencies & Parallelization

- Phase 1 is prerequisite for all other phases
- Phase 2, 3, 4 can run in parallel after Phase 1
- Phase 5 requires Phases 1-4 complete

## Validation Criteria

- [x] Sidebar correctly renders task hierarchy with nested agents
- [x] Agent status dots animate (pulse) for running state
- [x] Layout mode toggle (single/split/quad) works without terminal rendering issues
- [x] Task overview group chat shows interleaved messages from all task agents
- [x] Command palette opens on ⌘K, filters results, and navigates on selection
- [x] Add Agent picker dispatches new agent to correct task
- [x] Status bar shows live aggregate stats
- [x] Panel collapse/expand animates smoothly
- [x] All existing routes remain accessible (settings, agents hub, etc.)
- [x] Page refresh preserves layout state (selected agent, layout mode, panel state)
