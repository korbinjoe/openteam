# Tasks: Add Tray Mission Overview

## Phase 1: Server snapshot endpoint

- [x] **Add `TrayMissionDTO` shape to `shared/`** — new file
  `shared/tray-types.ts` (standalone, not re-exported through
  `ws-types.ts`; consumed directly by `electron/`, `server/`, and
  `web/tray-panel/`).
- [x] **Implement `GET /api/tray/active-missions`** — extracted into
  `server/routes/system/trayRoutes.ts` (kept out of `chatRoutes.ts`
  to avoid bloating that module). Joins `chatStore.listAll()` +
  `sessionRegistry.getActiveActivities()` +
  `workspaceStore.get(workspaceId)` (resolves `workspaceName`).
  Filters to missions with at least one non-`completed` agent. Wired
  in `server/startup/routeSetup.ts`.
- [x] **Unit test the endpoint** —
  `server/__tests__/trayActiveMissions.test.ts`. Covers: empty state
  when no `sessionRegistry`, filters out missions whose agents are
  all `completed`, aggregates tool progress + cost across agents,
  defaults `workspaceName` to `'Unknown'` when the workspace is
  missing, excludes chats whose record cannot be loaded.

## Phase 2: Tray title + count fan-out

- [x] **Replace `setBadgeCount` with `setMissionCount(n)`** in
  `electron/modules/TrayManager.ts`. Drives `tray.setTitle()` with `● N`
  when `n > 0`, empty string otherwise. (No prior `setBadgeCount`
  callsites existed in source — only the placeholder method on
  `TrayManager` itself was renamed.)
- [x] **Maintain an active-mission Set in `IPCBridge`** — implemented
  as `Set<chatId>` plus `Map<chatId, TerminalRemovalTimer>` rather
  than a single map: clearer separation between "currently active"
  vs "scheduled-to-remove". On each `chat:activity`, `trackMissionActivity()`
  either adds immediately (working) or schedules removal after the
  1500ms debounce (terminal). `publishMissionCount()` fans out to
  `trayManager.setMissionCount(set.size)` on every change.
- [x] **Bootstrap initial count on WS open** —
  `IPCBridge.bootstrapActiveMissions()` runs on WS `open`, fetches
  `/api/tray/active-missions`, and seeds the set. Avoids the panel
  showing stale `● 0` while reconnecting.

## Phase 3: Electron tray-panel window

- [x] **New `electron/modules/TrayPanelManager.ts`** — owns a frameless
  `BrowserWindow` (360×420, `transparent: true`, `alwaysOnTop: true`,
  `show: false`, `skipTaskbar: true`,
  `webPreferences: { preload: trayPreloadPath, contextIsolation: true }`).
  Lazy-created on first `toggle()`.
- [x] **Position relative to tray bounds** — `computePosition()` uses
  `tray.getBounds()` + `screen.getDisplayNearestPoint()` and clamps the
  panel inside the work area (`TRAY_GAP_Y = 4`).
- [x] **Auto-hide on blur** — `panelWindow.on('blur', () => panelWindow.hide())`,
  skipped when dev tools are focused.
- [x] **Wire tray left-click** — `TrayManager` now takes an optional
  `trayPanelManager`; the `'click'` handler calls
  `trayPanelManager.toggle(tray.getBounds())` when provided, otherwise
  falls back to `focusMain()`. Right-click still shows the existing
  context menu.
- [x] **New `electron/tray-preload.ts`** — exposes
  `window.trayBridge`: `openMission(chatId)`, `openWorkbench()`,
  `getServerPort()`. Renderer subscribes to WS + fetches itself; the
  main process only handles "open mission" / "open workbench" /
  port lookup.
- [x] **Bundle tray preload in build pipeline** — `package.json`
  `build:electron:main` now invokes `esbuild` for
  `electron/tray-preload.ts` →
  `dist/electron/tray-preload.cjs`.

## Phase 4: Renderer panel

- [x] **New Vite entry `web/tray-panel/`** — mirrors
  `web/notch-panel/` directory layout: `main.tsx`, `TrayPanelApp.tsx`,
  `MissionCard.tsx`, `useTrayMissions.ts`, `types.d.ts`, `index.html`.
  Vite serves `web/tray-panel/index.html` directly in dev (matching
  the notch-panel pattern); production-parity is a known gap shared
  with notch-panel.
- [x] **`useTrayMissions` hook** — initial fetch from
  `/api/tray/active-missions`; subscribes to WS `chat:activity` to
  patch state in place (removes when all agents terminal, refetches
  when a payload arrives for a mission missing from the snapshot)
  and to `chat:status-changed` to trigger a refetch.
- [x] **`MissionCard` component** — title, workspace name (faint
  uppercase), agent chips (`name · phase · tool`), `completed/total
  tools`, cost when >0. Status dot uses the project's color
  vocabulary (`bg-accent-red` / `bg-accent-yellow` /
  `bg-accent-brand` + `animate-ping-soft` / `bg-text-muted`).
- [x] **`TrayPanelApp` empty state** — when zero active missions,
  shows "No active missions" centered with a faint "Open OpenTeam"
  button calling `window.trayBridge?.openWorkbench()`.
- [x] **Card click → navigate** — calls
  `window.trayBridge?.openMission(chatId)`; the main process focuses
  the main window, hides the panel, and broadcasts
  `companion:navigate-to-chat`, which `ElectronNavigator` routes.
- [ ] **i18n keys** — deferred. Strings inlined to match
  `notch-panel` (which also doesn't load the i18n bundle).
  Documented in design.md as a deviation; revisit if/when notch and
  tray panels gain a shared i18n loader.

## Phase 5: Naming-contract compliance

- [x] **Fix `ElectronNavigator` route from `/chat/` to `/mission/`** —
  `web/components/ElectronNavigator.tsx` now imports
  `buildMissionUrl()` from `@/components/workspace/urls` and calls
  `navigate(buildMissionUrl(chat.workspaceId, chat.id))` instead of
  the hand-rolled `/workspace/.../chat/...` string.
- [x] **Audit new strings for `mission` vs `chat`** — all
  user-facing copy in `web/tray-panel/` says "Mission"; remaining
  `chat*` identifiers in the renderer are wire-level
  (`chatId`, `chat:activity` WS event names), which is the project's
  documented convention.

## Phase 6: Cleanup + verification

- [x] **Remove dead `setBadgeCount` path** — no callsites existed
  outside the renamed method; nothing else to delete.
- [ ] **Manual smoke test on macOS** — pending; not runnable from
  the agent environment. Suggested checklist:
  1. Start two missions in parallel; verify tray shows `● 2`.
  2. Click the tray; panel opens with both cards, agents and progress
     match the sidebar.
  3. Click a card; main window focuses and lands on the mission's URL.
  4. Mark one mission completed; after ~1.5s the tray reads `● 1` and
     the panel drops that card.
  5. Right-click the tray; native context menu still appears.
  6. Resize the main window to multiple displays; tray panel still
     anchors to the menu bar correctly.
- [x] **Run `openspec validate add-tray-mission-overview --strict`** —
  passes (`Change 'add-tray-mission-overview' is valid`).
