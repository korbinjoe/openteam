# Design: Tray Mission Overview

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│   macOS Menu Bar                                        │
│                                                         │
│   [● 3] ◄── TrayManager.setTitle()                      │
│      │                                                  │
│      │ left-click                                       │
│      ▼                                                  │
│   ┌──────────────────────┐                              │
│   │  TrayPanelManager    │   ── new module              │
│   │  BrowserWindow       │      (electron/modules/)     │
│   │  url = #/tray-panel  │                              │
│   └──────────────────────┘                              │
│             │                                           │
│             │ WS chat:activity (reuses IPCBridge feed)  │
│             │ + initial fetch GET /api/tray/active-     │
│             │                       missions            │
│             ▼                                           │
│   ┌──────────────────────┐                              │
│   │  web/tray-panel/     │   ── new entry               │
│   │  (Vite multi-entry)  │      (mirrors notch-panel)   │
│   │  • MissionCardList   │                              │
│   │  • useTrayMissions   │                              │
│   └──────────────────────┘                              │
│             │ card click                                │
│             ▼                                           │
│   ipcRenderer.send('companion:navigate-to-chat',        │
│                    { chatId })                          │
│             │                                           │
│             ▼                                           │
│   IPCBridge → main window → ElectronNavigator           │
│     → navigate(/workspace/:wsId/mission/:chatId)        │
└─────────────────────────────────────────────────────────┘
```

The tray panel is a sibling renderer to the main window, not embedded in
it. It reuses three existing rails:

- **`IPCBridge`** in the main process — already subscribes to
  `chat:activity` WS events.
- **`companion:navigate-to-chat`** IPC channel — already routes a
  `chatId` to the main window's `ElectronNavigator`, which fetches the
  chat to learn `workspaceId` and pushes to `/workspace/:wsId/chat/:chatId`.
- **`SessionRegistry.getActiveActivities()`** in the server — already
  produces the per-chat aggregated payload the panel needs.

## Data Models

### Server response — `GET /api/tray/active-missions`

```ts
type TrayMissionDTO = {
  chatId: string
  title: string                     // mission title
  workspaceId: string
  workspaceName: string             // resolved from workspaceStore
  topPhase: 'thinking' | 'tool_running' | 'responding' | 'waiting_input' | 'waiting_confirm' | 'error'
  agents: Array<{
    agentId: string
    agentName: string
    phase: string
    currentTool?: string
    toolCompleted: number
    toolCount: number
    cost?: number
  }>
  totalToolProgress: { completed: number; total: number }
  totalCost: number
  startedAt: number                 // epoch ms — oldest agent's activity start
}

type TrayActiveMissionsResponse = {
  missions: TrayMissionDTO[]
}
```

Only chats where at least one agent's `activitySnapshot.phase` is *not*
`completed` are included — same predicate
`ActivityAggregator.getActiveActivities()` already uses.

### Renderer state

```ts
type TrayMissionState = {
  missions: TrayMissionDTO[]
  isStale: boolean      // true between WS disconnect and reconnect
  lastUpdatedAt: number
}
```

The renderer maintains a `Map<chatId, TrayMissionDTO>` to apply WS deltas
cheaply. WS `chat:activity` payloads are transformed: if `agentActivities`
is empty *or* every agent is `completed`, the entry is removed from the
map (after the debounce window — see Decisions).

## API Contracts

### REST

`GET /api/tray/active-missions` → `200 TrayActiveMissionsResponse`

No query params. Auth: same middleware as `/api/chats/recent` (already
shared). Implementation lives in `server/routes/chat/chatRoutes.ts`
beside `recent`, since it depends on the same `chatStore` +
`sessionRegistry` injection.

### WebSocket (no schema change)

Reuses the existing `chat:activity` event. The tray-panel renderer
subscribes via the shared `wsClient` (same one used by `useAllChats`),
matching the in-app sidebar's pattern.

### IPC

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `tray:toggle-panel` | renderer (main UI) → main | — | Optional dev shortcut — not user-facing |
| `tray:panel-ready` | renderer (tray-panel) → main | — | Panel signals it's mounted; main may close-on-blur afterwards |
| `companion:navigate-to-chat` | renderer (tray-panel) → main → main UI | `{ chatId }` | **Reused.** Card click sends, `IPCBridge` re-broadcasts to main window |

## Decisions

### D1: Custom BrowserWindow over native Menu.popup()

A native `Menu` only supports flat label / icon menu items. We need
multi-line cards (title + agents + progress + cost), live updates
without rebuilding the whole menu, and a click-target that opens a
specific mission. A `BrowserWindow` mirrors the proven
`NotchManager` pattern in `electron/modules/NotchManager.ts` (frameless,
always-on-top, positioned to a tray bound). Cost: a second renderer
process. Mitigated by lazy-create + keep-hidden (not destroyed) on
subsequent toggles.

### D2: Server endpoint vs. composing from existing endpoints

Could compose from `/api/chats/recent` (already includes `activity`) +
workspace store. We add a dedicated endpoint because:

1. `/api/chats/recent` returns archived / inactive chats too — the panel
   needs the *active* slice and would re-filter client-side.
2. Workspace name resolution would force a second fetch.
3. Surface area: keeping a tray-specific endpoint isolates response
   shape changes from the in-app sidebar's `recent` contract.

### D3: Debounce active-set transitions by 1500ms

Agent phases churn (`thinking → tool_running → responding →
tool_running`) on the order of hundreds of ms. The tray badge count must
not flicker. A mission only leaves the active set after its top phase has
been `completed` / `error` / `idle` for ≥1500ms. The constant lives in
`IPCBridge` next to the active-set Map; not user-configurable.

### D4: Tray title format `● N`

The macOS tray title is monospaced and theme-aware when the icon is a
Template Image. A literal bullet + count keeps the indicator under 4
characters even at N=99, doesn't conflict with the icon's silhouette,
and reads at a glance. When N=0, the title is empty (icon alone).
Animation (rippling dot) belongs *inside* the panel, not the menu bar —
macOS tray titles cannot animate.

### D5: Panel auto-hide on blur

Standard macOS menu-extra behavior. Listener:
`panelWindow.on('blur', () => panelWindow.hide())`. Cmd-click /
right-click on the tray bypasses the panel and shows the existing
native context menu (Show OpenTeam, Quit) — that path is preserved.

### D6: Storage / wire names stay `chat`

Per the naming contract in `openspec/project.md`, `chatId` and storage
keys remain. The product surface (URL fragment, UI strings, TypeScript
identifiers in the renderer like `TrayMissionDTO`, `missions`,
`navigateToMission`) all use *mission*.

## Open Questions Deferred

- **Windows / Linux parity** — out of scope for v1; the tray context
  menu stays text-only on non-macOS. Filed for follow-up once macOS
  ergonomics are settled.
- **Tray panel keyboard navigation** — arrow keys + Enter to pick a
  mission. Nice-to-have; not blocking for v1. Mouse click is sufficient.
