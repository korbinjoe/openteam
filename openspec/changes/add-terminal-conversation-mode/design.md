# Design: Chat View Mode Toggle (Message / Terminal)

This document captures the cross-cutting design choices for the message /
terminal **chat view mode** toggle. Per-requirement detail lives in
`specs/chat-view-modes/spec.md`. Non-design implementation steps live in
`tasks.md`.

> **Addendum** — `design-cli-interaction.md` revises the input semantics
> for terminal mode: `InputArea` and `QueuedMessagesBar` are hidden so
> xterm owns the keyboard and bytes flow straight to the agent's
> `claude` / `codex` PTY. That addendum supersedes the parts of D8 below
> that describe `InputArea` as "always visible".

## Surfaces and primitives

Three pre-existing pieces meet at this change:

- `ChatInstance` — the chat shell, owns layout, splits left (`ChatBody`) and
  right (`RightPanel` containing `IDEPanel` + `TerminalPanel` + `ChangesTab`).
- `ChatBody` — renders the message stream as Virtuoso-virtualized
  `AgentTurnCard`s.
- `TerminalPanel` — renders xterm-backed agent CLI sessions (split or
  tabbed). Currently lives inside `RightPanel`.

This change does not invent a new surface. It re-routes which existing
surface fills the left (conversation) pane inside `ChatInstance`.

## Decisions

### D0: Information architecture — the toggle belongs to the left pane, not the chat header

The chat surface is hierarchical:

```
Workspace
└─ Mission/Agent      (chatId — business entity)
   └─ ChatInstance    (UI shell, spans left + right panes)
      ├─ ChatHeader   (cross-pane chrome: workspace breadcrumb, mission
      │                title, connection dot)
      ├─ Left pane    (conversation surface)
      │  ├─ in-pane toolbar row (MessageToolbar + view-mode toggle)
      │  ├─ ChatBody / PlanCard  (or TerminalPanel)
      │  └─ Heartbeat / Git / Queued / InputArea
      └─ Right pane   (RightPanel: Files / Editor / Changes)
```

`ChatHeader` carries **Mission/Agent identity and system status** —
workspace path, mission name, connection state. Putting the message↔terminal
toggle there conflates two distinct levels:

- **Mission/Agent-level** state: business identity, persisted in SQLite,
  shared across users of the chat.
- **Left-pane view preference**: "how I want to see this conversation right
  now," local to one user's browser, never leaves the device.

The toggle is the second kind. It belongs **inside the left pane**, on the
same toolbar row as `MessageToolbar` (also a pane-local control). This
matches the user's mental model: the toolbar row at the top of the pane is
"controls for this pane"; `ChatHeader` is "what mission am I in."

### D1: Segmented control over kebab menu / right-click / settings drawer

The toggle is a two-icon segmented pill placed in the left pane's local
toolbar row. Rejected alternatives:

- **Inside `ChatHeader`**: wrong information level (see D0). Mixes
  view-preference with Mission/Agent identity.
- **Kebab menu**: extra click; mode is not a settings-shaped thing — it's a
  frequent cockpit switch.
- **Right-click on chat**: undiscoverable; conflicts with native context
  menus.
- **Settings drawer / preferences page**: turns a fast cockpit switch
  into a deep-buried preference. Wrong shape.
- **Floating button over the body**: visually noisy; hides under the
  Virtuoso scroll.

The segmented pill matches the existing visual language already used
elsewhere in the app for layout toggles.

### D2: Mode is per-chat, persisted in `localStorage`, default `'message'`

- **Per-chat** because users explicitly want different views for different
  conversations (debug a stuck agent in terminal mode while keeping the
  Mission overview in message mode).
- **`localStorage`** because the mode is purely a UI view preference; no
  server state. Persisting in the SQLite `chats` table would require a
  schema migration for a UI-only flag and would imply the mode is a
  Mission property (it is not — see D0). We can promote to SQLite later if
  multi-device sync becomes a real requirement.
- **Default `'message'`** preserves the existing UX for every user. The
  toggle is opt-in, not surprise-on.
- **Storage key**: `openteam:chat-view:<chatId>` (with optional Quad
  suffix — see D3). The `chat-view` namespace explicitly signals "view
  preference of the chat UI," not "mode of the Mission."

### D3: Quad tile uses composite storage key

Each Quad tile mounts its own `ChatInstance` against the same `chatId`,
distinguished by `agentScopeOverride`. To keep tile modes independent we
key as:

```
'openteam:chat-view:' + chatId + (agentScopeOverride ? ':' + agentScopeOverride : '')
```

Top-level (non-Quad) Mission and Agent views use the plain `chatId` form,
so existing single-pane chats keep one mode setting regardless of whether
the URL pins them to one agent or not.

### D4: Branch render, do not keep-mount both

For the first cut we render either `ChatBody` *or* `TerminalPanel`, not
both inside hidden containers. Reasoning:

- `TerminalPanel` already manages its own xterm lifecycle (open / dispose /
  reactivate) and is designed to come up cleanly on mount.
- `ChatBody` is Virtuoso-driven and re-establishes its scroll position
  via `viewKey`; mounting/unmounting it is cheap.

If users report jank toggling repeatedly during an active session, the
fallback is the keep-mounted-with-`display:none` pattern already used by
`ChatTabContainer`. We have an open task in `tasks.md` to evaluate this
after dogfooding.

### D5: Terminal mode swaps only the left pane; the right IDE pane is unchanged

- The view mode is a property of the **left (conversation) pane** only.
  Both modes keep the same right column: `RightPanel` (Files / Editor /
  Changes / its own IDE-scoped terminal drawer), the resize divider, and
  the collapse chevron all render exactly as they do today.
- This keeps the change surgical: the only mode-dependent code path in
  `ChatInstance` is the conditional inside the existing `chatPanelStyle`
  div. The `hideRightPanel` and `rightPanelMountNode` props continue to
  mean exactly what they mean today (Quad / portal layouts), independent
  of view mode.
- The user gets symmetry: in either mode they can still browse files,
  view diffs, and pop the IDE's own terminal drawer — without losing the
  primary conversation surface they picked.
- **xterm instance ownership**: the left-pane `TerminalPanel` and the
  IDE's right-pane `IDETerminalTabs` are independent xterm systems backed
  by different hooks. They share a `chatId` but never share xterm
  instances, so mounting both at once is safe. We do not try to dedupe.

### D6: Locked-agent terminal variant

In Agent view (`?agent=X`) and inside Quad tiles, `lockedAgentId` is
non-null. `TerminalPanel` currently always shows a tablist with all
running agents in the chat, which would leak cross-agent surfaces into a
view the user explicitly pinned to one agent.

Add an optional `lockedAgentId` prop that:

1. Filters the `experts` list shown in the tablist to that one agent.
2. Hides the layout-toggle button (Layers/Columns2) — meaningless with
   one tile.
3. Swaps the empty-state copy from "Open the chat panel and select an
   agent…" to "Waiting for `<agent>` to start…".

The hidden-experts persistence (`cc:terminal:hidden:<chatId>`) does not
apply when locked (a single-agent surface should never hide its only
agent); the prop short-circuits the hide-handler.

### D7: Keyboard shortcut ⌘⇧T

- `T` for "Terminal" — directional name even though the shortcut toggles
  both ways.
- ⌘⇧T avoids macOS / Chrome built-in conflicts and matches the existing
  app convention for Cmd+Shift+letter shortcuts (⌘⇧D for devpanel).
- Only fires when the chat is `isActive` so background tabs do not steal
  the binding.

### D8: Each mode renders exactly one chrome row above the body

The view-mode toggle must be reachable without a keyboard shortcut in
both modes, but the left pane must never stack two near-empty chrome rows
on top of each other. The toggle therefore **changes host depending on
the mode**, while remaining the same component:

- **Message mode** — toggle lives in `ChatPaneToolbarRow` (right-aligned,
  same row as the agent filter chips). `TerminalPanel` is not rendered.
- **Terminal mode** — `ChatPaneToolbarRow` is **not rendered**.
  `TerminalPanel`'s own tablist already exists at the top of the pane
  (per-agent tabs on the left, layout-toggle button on the right); the
  view-mode toggle joins that right-aligned controls cluster as a sibling
  of the layout toggle.

This avoids the "two stacked toolbars" anti-pattern where a near-empty
`ChatPaneToolbarRow` would sit above the terminal tablist with nothing
to show but the toggle itself. See D10 for the slot mechanic that makes
the toggle position-agnostic.

`GlobalHeartbeatBar` provides the cross-agent activity glance and remains
useful (and short — one row); shown in both modes. `GitStatusBar` is
project-state, not view-state; shown in both modes. `QueuedMessagesBar`
is queue state for the input area; shown in both modes.

### D9: HTML mockups use existing tokens, no fabricated palette

The mockups embed the project's CSS variables (sourced from
`web/styles/theme.css` / `tailwind.config.js`) directly so the visuals
match the running app exactly. No new color values; no new font; no
new icons (Lucide names referenced via inline SVG matching Lucide's
SVG output for the relevant icons).

The mockups show:

- **`mockup-message-mode.html`** — Mission view with merged stream of
  user messages and agent turn cards, the existing right IDE panel, the
  new view-mode toggle visible at the top of the left pane (message side
  active). `ChatHeader` is unchanged — no toggle inside the header.
- **`mockup-terminal-mode.html`** — same Mission, terminal mode active.
  Two agent tiles in split layout, one running (blue dot), one completed
  (green check). Heartbeat bar, git-status bar, input area pinned at the
  bottom. The view toggle in the left pane's toolbar row has the
  terminal side active. The right IDE pane stays mounted.

### D10: `ChatViewModeToggle` is a positionless component, hosted by the parent

To make D8 work without `ChatViewModeToggle` knowing about its container,
the toggle is a **pure presentation component** with no opinion on where
it lives:

- `ChatPaneToolbarRow` renders it directly in message mode.
- `TerminalPanel` accepts an optional `headerExtras?: ReactNode` prop
  rendered immediately before the existing layout-toggle button in the
  tablist's controls cluster. `ChatInstance` passes
  `<ChatViewModeToggle mode={mode} onChange={setMode} />` as
  `headerExtras` in terminal mode.

This keeps the toggle a single component, keeps `TerminalPanel`'s tablist
agnostic to what gets injected (the slot accepts any node), and lets
`ChatInstance` remain the sole place that decides "in terminal mode the
toggle hops into the tablist." If we later want the toggle in a third
location (e.g., a future Quad mode), only `ChatInstance` changes.

Both mockups intentionally **omit the per-agent CLI mode badge**
(`plan` / `code`) from `ChatHeader`. That badge belongs to a different
information level (Agent capability mode) and the team has decided not to
surface it on the chat header — out of scope for this change but reflected
in the mockup baseline so the visual contract stays accurate.

## Open questions

None block this proposal. Captured for follow-up:

- Should we eventually surface a "remember terminal view for this agent"
  preference at the agent definition level (not chat level)? Probably yes
  once we see usage data; out of scope here.
- Should we offer a "no input area in terminal mode, type into xterm
  directly" sub-mode for users who do not want the React `InputArea`?
  Punted; current scope keeps `InputArea` always visible.
