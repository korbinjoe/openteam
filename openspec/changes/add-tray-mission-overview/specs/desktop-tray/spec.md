# Spec: Desktop Tray Mission Overview

## Overview

The macOS tray icon (`TrayManager`) carries a live count of currently
running missions and exposes a click-to-open dropdown panel that lists
each running mission with its agents, progress, and cost. The panel is a
sibling `BrowserWindow` to the main app, positioned under the tray icon,
and clicking a mission card brings the main window to focus on that
mission's URL.

## ADDED Requirements

### Requirement: Tray title reflects the count of running missions

The macOS tray icon MUST display the count of currently running missions
in its title, formatted as `● N`, and be empty when no mission is
running. The count MUST update within one debounce window (≤1500ms) of
any mission's activity phase changing.

#### Scenario: Two missions running shows count 2

**Given** the app is running on macOS
**And** two missions each have at least one agent with a non-`completed`
  phase
**Then** the tray title reads `● 2`
**And** the underlying tray icon stays a macOS Template Image (theme-
  adaptive)

#### Scenario: Last mission completes within debounce window

**Given** one mission is running and the tray title reads `● 1`
**When** that mission's last agent transitions to `completed`
**Then** within ≤1500ms the tray title becomes empty
**And** the icon remains visible

#### Scenario: Quick phase churn does not flicker the count

**Given** a mission whose agent toggles `tool_running` → `responding` →
  `tool_running` every 200ms
**Then** the tray count MUST NOT change for that mission
**And** the count only decrements after a terminal phase persists for
  ≥1500ms

### Requirement: Left-clicking the tray opens a mission overview panel

Left-clicking the tray icon on macOS MUST toggle a frameless
`BrowserWindow` panel anchored under the tray icon. The panel MUST list
one card per running mission and reflect live activity updates without
the user re-opening it.

#### Scenario: First click creates and shows the panel

**Given** the tray panel has never been opened in this session
**When** the user left-clicks the tray icon
**Then** a frameless `BrowserWindow` (~360×420, always-on-top,
  non-resizable) is created
**And** it is positioned so its top edge aligns under the tray icon
  bounds on the active display
**And** it loads the `#/tray-panel` renderer entry

#### Scenario: Second click toggles the panel hidden

**Given** the tray panel is currently shown
**When** the user left-clicks the tray icon
**Then** the panel hides (it is not destroyed)

#### Scenario: Panel auto-hides on blur

**Given** the tray panel is shown
**When** focus leaves the panel (the user clicks anywhere outside)
**Then** the panel hides
**Exception** if the dev tools window is focused, the panel does NOT
  hide

#### Scenario: Right-click preserves the native context menu

**Given** the app is running on macOS
**When** the user right-clicks the tray icon
**Then** the existing native context menu (Show OpenTeam, Quit) appears
**And** the tray panel does NOT open

### Requirement: Each mission card shows mission identity and live progress

Each card in the tray panel MUST display the mission title, the owning
workspace name, the running agents (name + phase + current tool when
present), the aggregated tool progress, and accumulated cost. Cards MUST
update from the same `chat:activity` WS stream the in-app sidebar uses.

#### Scenario: Card shows mission and workspace identity

**Given** a running mission titled "Refactor billing flow" in workspace
  "Acme"
**When** the user opens the tray panel
**Then** the card renders the mission title prominently
**And** renders the workspace name `Acme` in a muted secondary slot

#### Scenario: Card shows running agents and current tool

**Given** a mission with agent `Fullstack` currently running tool `Bash`
  in phase `tool_running`
**Then** the card shows a chip / row reading `Fullstack · tool_running ·
  Bash`
**And** the status dot uses the project's shared color vocabulary for
  `tool_running` (blue with `ping-soft` animation)

#### Scenario: Card shows aggregated progress and cost

**Given** a mission's agents have collectively completed 3 of 5 tools
  and accumulated $0.42
**Then** the card shows `3 / 5 tools`
**And** the card shows `$0.42` in a faint cost slot
**And** when the accumulated cost is 0, the cost slot is hidden

#### Scenario: Live update on WS activity

**Given** the tray panel is open and showing one mission card
**When** the server broadcasts a `chat:activity` event with that
  mission's `toolCompleted` incrementing from 3 to 4
**Then** the card updates to `4 / 5 tools` within one render tick
**And** the panel does NOT re-fetch `/api/tray/active-missions`

#### Scenario: Empty state when no mission is active

**Given** no mission has a non-`completed` agent
**When** the user opens the tray panel
**Then** the panel shows "No active missions" centered
**And** offers a button "Open OpenTeam" that focuses the main window

### Requirement: Clicking a card opens the mission in the main app

Clicking a mission card MUST focus the main app window and navigate it
to the mission's URL using the project's `mission` URL contract
(`/workspace/:workspaceId/mission/:chatId`).

#### Scenario: Card click focuses main window and routes to mission

**Given** the tray panel is showing a card for mission `m_123` in
  workspace `ws_acme`
**When** the user clicks the card
**Then** the main app window receives focus (`windowManager.focusMain()`
  in the main process)
**And** the main app navigates to `/workspace/ws_acme/mission/m_123`
**And** the tray panel auto-hides after the click

#### Scenario: Card click reuses the existing IPC channel

**Given** the renderer card click handler is invoked
**Then** it MUST send the existing `companion:navigate-to-chat` IPC
  message with `{ chatId }` payload
**And** the main process MUST broadcast the same channel to the main
  window, where `ElectronNavigator` resolves the workspace and
  navigates

### Requirement: Server exposes a snapshot endpoint for the panel

The server MUST expose `GET /api/tray/active-missions` that returns the
current set of missions with at least one non-`completed` agent,
enriched with workspace name and aggregated progress / cost.

#### Scenario: Endpoint returns active missions only

**Given** the server tracks three chats: A (one agent `tool_running`),
  B (one agent `completed`), C (two agents, one `responding` and one
  `completed`)
**When** the client requests `GET /api/tray/active-missions`
**Then** the response includes A and C
**And** the response does NOT include B
**And** for C the `agents` array includes BOTH agents (the panel may
  choose to render only running agents)

#### Scenario: Response includes workspace name

**Given** mission A belongs to workspace `ws_acme` whose display name is
  `Acme`
**When** the endpoint returns A
**Then** the DTO's `workspaceName` field is `"Acme"`
**And** when the workspace cannot be resolved, `workspaceName` is
  `"Unknown"` and the chat is still included

#### Scenario: Response aggregates tool progress and cost

**Given** mission C's agents have `toolCompleted` values 2 and 1 and
  `toolCount` values 4 and 3, and `cost` 0.10 and 0.25
**Then** the DTO's `totalToolProgress` is `{ completed: 3, total: 7 }`
**And** the DTO's `totalCost` is `0.35`

### Requirement: Naming-contract compliance for new surfaces

All new URLs, UI strings, and TypeScript identifiers MUST follow the OpenTeam naming contract: user-facing surfaces say "mission" / "Mission" / "Missions"; storage and WS keys may keep `chatId` / `chat`.

#### Scenario: Renderer route uses mission vocabulary

**Given** the new tray panel renderer entry
**Then** its route fragment is `#/tray-panel` (neutral) and all
  user-visible strings reference "Mission"
**And** TypeScript identifiers on the renderer side use names like
  `TrayMissionDTO`, `useTrayMissions`, `openMission`

#### Scenario: API path uses mission vocabulary

**Given** the new tray snapshot endpoint
**Then** its path is `/api/tray/active-missions`
**And** it does NOT introduce any new `/chats` URL segment

#### Scenario: Existing chat URL bug is corrected

**Given** the pre-existing `ElectronNavigator` navigates to
  `/workspace/:wsId/chat/:chatId`
**When** this change is applied
**Then** `ElectronNavigator` instead uses `buildMissionUrl()` and
  navigates to `/workspace/:wsId/mission/:chatId`
**And** the tray-panel card click reuses the corrected path
