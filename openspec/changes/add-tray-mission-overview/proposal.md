# Add Tray Mission Overview

## Summary

Extend the macOS tray icon (`TrayManager`) with a live count of running
missions and replace the existing text-only context menu with a custom
BrowserWindow dropdown that lists each running mission as a card. Each
card shows mission title, owning workspace, the agents currently working,
their phase, tool progress, and accumulated cost. Clicking a card focuses
the main app window and navigates to that mission.

## Why

Today the tray only carries a single status word ("Idle / Working /
Completed / Error"). When the user is away from the app and several
missions are running in parallel — exactly the pulse-mode case OpenTeam
is built for — there is no way to glance at the menu bar and see *how
many* missions are alive, *what* they are doing, or *how* to jump back
into a specific one without first opening the main window and scanning
the sidebar.

The data already exists server-side: `SessionRegistry.getActiveActivities()`
returns per-chat aggregated `phase / toolCount / cost / agentActivities`,
and the `chat:activity` WS event already pushes per-chat deltas that the
Electron `IPCBridge` consumes to drive the current tray status. We can
piggyback on that stream to feed a real overview rather than collapsing
it to one global status.

## Goals

- Tray title shows the count of running missions (e.g. `● 3`); empty when
  zero. Icon stays a Template Image so it adapts to the macOS menubar
  theme.
- Clicking the tray opens a custom BrowserWindow panel anchored under the
  tray icon, listing each running mission as a card with: mission title,
  workspace name, running agents (name + phase + current tool), tool
  progress (`completed / total`), accumulated cost.
- Clicking a mission card focuses the main app window and navigates to
  `/workspace/:workspaceId/mission/:missionId`.
- Panel updates live via the existing `chat:activity` WS event — no
  polling, no extra REST round-trips after the initial open.
- Right-click on the tray still shows the existing native context menu
  (Show OpenTeam, Quit) so the simple paths remain.

## What Changes

- **ADDED** Tray title now carries `● N` where N is the live count of
  running missions; empty when zero.
- **ADDED** Left-clicking the macOS tray opens a custom BrowserWindow
  dropdown (`#/tray-panel`) listing one card per running mission with
  workspace name, agents + phase + current tool, tool progress, and
  cost. Cards live-update via the existing `chat:activity` WS event.
- **ADDED** Card click focuses the main window and navigates to
  `/workspace/:workspaceId/mission/:chatId` via the existing
  `companion:navigate-to-chat` IPC channel.
- **ADDED** Server endpoint `GET /api/tray/active-missions` returning
  the enriched snapshot of currently running missions (joins
  `chatStore` + `sessionRegistry.getActiveActivities()` + workspace
  name resolution).
- **MODIFIED** `electron/modules/TrayManager.ts` left-click handler:
  was `focusMain()`, now `trayPanelManager.toggle()`. Right-click /
  keyboard menu still shows the existing native context menu.
- **MODIFIED** `electron/modules/IPCBridge.ts` maintains a debounced
  active-mission Map (1.5s window) so phase churn doesn't flicker the
  count, and feeds `trayManager.setMissionCount(map.size)`.
- **MODIFIED** `web/components/ElectronNavigator.tsx` navigates via
  `buildMissionUrl()` (`/mission/:chatId`) instead of the legacy
  `/chat/:chatId` path, aligning with the project's naming contract.
- **REMOVED** `TrayManager.setBadgeCount()` (single-purpose helper
  superseded by `setMissionCount`).

## Non-Goals

- Replacing or removing the existing main-window `GlobalHeartbeatBar` /
  `AgentActivityPanel` — those serve the in-app view; the tray panel is
  the *out-of-app* glance surface.
- Notification rework. The existing native completion / error
  notification path in `IPCBridge.showNativeNotification` stays as-is.
- Cross-platform parity. Tray dropdowns behave differently on Windows /
  Linux; this change targets macOS first. Other platforms keep the
  current text menu (gated on `process.platform === 'darwin'`).
- Persisting tray state across app restarts — the panel is rebuilt from
  the live activity snapshot every open.

## Approach

1. **Server snapshot endpoint.** Add `GET /api/tray/active-missions`
   returning the enriched list: `{ chatId, title, workspaceId,
   workspaceName, agents: [{ name, phase, currentTool, toolCompleted,
   toolCount, cost }], topPhase, totalToolProgress, totalCost }`. Source
   data comes from `chatStore` + `sessionRegistry.getActiveActivities()`
   joined by `workspaceId`. This is what the panel reads on open.

2. **Electron `TrayPanelManager`** (new module under `electron/modules/`).
   Owns a frameless, always-on-top, non-resizable `BrowserWindow` (~360×
   420) that loads a dedicated renderer route `#/tray-panel`. Positioned
   relative to `tray.getBounds()` on macOS. Toggled by tray click.

3. **Tray click swap.** `TrayManager` left-click now calls
   `trayPanelManager.toggle()` instead of `windowManager.focusMain()`.
   Right-click keeps the native context menu (existing behavior on macOS
   when `setContextMenu` is set + user uses the keyboard menu / right-
   click).

4. **Count in tray title.** Replace the single-status `setBadgeCount`
   with `setMissionCount(n)` — drives `tray.setTitle()` with `● N` when
   `n > 0`, empty string otherwise. The existing `updateStatus()` path
   stays for icon variants but no longer carries a separate badge.

5. **Renderer panel.** New `web/tray-panel/` entry (mirrors the existing
   `web/notch-panel/` pattern). On mount: fetch
   `/api/tray/active-missions`, subscribe to the WS `chat:activity` event,
   and re-render the card list. Card click sends
   `companion:navigate-to-chat` (existing IPC channel) — `ElectronNavigator`
   already routes it. Panel auto-hides on blur.

6. **Activity → count fan-out.** `IPCBridge.updateTrayFromActivity` is
   updated to maintain a `Map<chatId, phase>` of live missions, calling
   `trayManager.setMissionCount(map.size)` on every transition. Missions
   drop out of the map when phase becomes `completed` or `error` (with a
   short fade interval to avoid flicker on quick tool turnover).

## Risks

- **Multi-window IPC tax.** A second BrowserWindow doubles preload +
  renderer cost. Mitigation: lazy-create the panel window on first tray
  click, keep it hidden between opens (not destroyed), reuse the
  existing `IPCBridge` WS stream rather than opening a second one.
- **Tray-panel positioning drift.** macOS menubar coordinates differ
  across notch / external display setups. Mitigation: position by
  `tray.getBounds()` + `screen.getDisplayNearestPoint()`; fall back to
  `screen.getCursorScreenPoint()` if bounds are empty (rare but known on
  some setups).
- **Activity flicker.** A mission that toggles `tool_running` →
  `responding` → `tool_running` would otherwise blink the count.
  Mitigation: only remove a mission from the active set after its phase
  has been non-running for ≥1.5s (configurable constant).
- **Naming-contract risk.** Per `openspec/project.md`, new URLs / UI
  strings must use *mission*. The new API path uses `/api/tray/active-
  missions`, the renderer route uses `#/tray-panel`, and all UI strings
  say "Mission". Storage / WS keys still use `chatId` — unchanged.
- **Test gap.** Electron BrowserWindow positioning is hard to unit-test.
  We rely on a smoke pass: open panel, count cards matches API, click →
  navigate.
