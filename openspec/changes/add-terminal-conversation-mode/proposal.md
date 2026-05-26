# Proposal: Add Terminal View Mode to the Chat Conversation Pane

## Summary

The left (conversation) pane of every chat surface (Mission view, Agent
view, Quad tile) today renders exclusively as a **message stream** —
derived activity cards, agent turn cards, plan cards, completion
ceremonies — assembled from JSONL events. The raw CLI session is hidden
away inside the right-hand IDE panel as a secondary tab.

Power users (especially when debugging an agent, reading raw stderr,
watching streaming token output, or driving an interactive prompt)
regularly need the *terminal* itself to be the primary surface inside the
conversation pane. They currently have to drag the splitter to widen the
right panel, fight with multiple agents-in-tabs, and lose the comfort of
the chat input area's `@-mention` / queueing / model picker affordances.

This change introduces a **chat view mode toggle** on every conversation
pane:

- **Message mode** (default) — the existing `ChatBody` stream of grouped
  agent turn cards. Unchanged.
- **Terminal mode** — `TerminalPanel` (xterm sessions) takes over the
  conversation pane in place of `ChatBody`. The right-side IDE pane
  (`RightPanel` with Files / Editor / Changes), the resize divider, and
  the collapse chevron are unchanged from message mode — the only swap
  is the left-pane content. `InputArea` and `QueuedMessagesBar` are
  **hidden** in terminal mode so xterm owns the keyboard: bytes flow
  straight to the agent's `claude` / `codex` PTY (TUI menus, password
  prompts, `Ctrl+C`, raw ANSI all work natively). The full design for
  this CLI-passthrough behaviour lives in `design-cli-interaction.md`.

The toggle is a **view-level preference of the left pane**, not a
Mission/Agent property. It lives in the **left pane's local toolbar row**
(sibling of `MessageToolbar`), persists per chat in `localStorage`, and
applies to both the Mission (merged multi-agent) and the Agent
(`?agent=X`, 1:1) views — including each tile inside the Quad layout.

This change is UI / interaction only. No new server endpoints, no schema
migrations, no impact on the JSONL-as-source-of-truth principle.

## What Changes

1. **Chat view mode state** — Add `chatViewMode: 'message' | 'terminal'`
   to chat-instance state, persisted in `localStorage` under
   `openteam:chat-view:<chatId>` (with optional `:<agentScopeOverride>`
   suffix for Quad tiles). Default is `'message'` for every chat
   (existing chats included; no migration).
2. **Toggle UI hosted by exactly one chrome row per mode** — A 28px
   segmented control (two icons: `MessageSquare` and `TerminalSquare`)
   that changes host depending on the mode:
   - In **message mode**, it lives in `ChatPaneToolbarRow`, right-aligned
     on the same row as `MessageToolbar`'s agent filter chips.
   - In **terminal mode**, `ChatPaneToolbarRow` is not rendered; the
     toggle is instead injected into `TerminalPanel`'s existing tablist
     (right-aligned, sibling of the layout-toggle button).
   This guarantees the left pane never stacks two chrome rows on top of
   each other. Tooltip + `aria-pressed` semantics. Keyboard shortcut
   **⌘⇧T** toggles.
3. **View-aware body in `ChatInstance`** — When `chatViewMode === 'message'`,
   render the existing `ChatBody` + `MessageToolbar` chips + `PlanCard`
   stack in the left pane along with the full bottom strip (`InputArea`,
   `QueuedMessagesBar`, `GlobalHeartbeatBar`, `GitStatusBar`). When
   `'terminal'`, render `TerminalPanel` in that same left pane and
   **suppress `InputArea` and `QueuedMessagesBar`** — xterm is the only
   input surface. `GlobalHeartbeatBar` and `GitStatusBar` stay (they are
   ambient indicators, not inputs). The right-side `RightPanel`, the
   resize divider, and the collapse chevron are rendered identically in
   both modes. See `design-cli-interaction.md` for queue-preservation
   and focus rules at mode switch.
4. **`ChatHeader` is not modified** — The header keeps its current
   responsibilities (workspace breadcrumb, mission title, connection
   dot). No view-mode toggle is added there.
5. **Terminal-mode behavior in Mission view** — `TerminalPanel` already
   supports its own internal split/tabs layout for multi-agent chats;
   the existing layout-toggle button (Layers / Columns2) and per-agent
   tabs are preserved. No new multi-agent semantics.
6. **Terminal-mode behavior in Agent view (`?agent=X`, Quad tile)** — The
   panel locks to the single locked agent's terminal, hides the agent
   tablist, and swaps the empty state to a single-agent message
   ("Waiting for `<agent>` to start…").
7. **View-aware empty / loading / reconnect states** — Each mode uses
   its own empty + reconnect copy so the message-mode `EmptyState`
   illustration doesn't appear over the terminal pane.
8. **High-fidelity HTML mockups** — Two screens
   (`mockup-message-mode.html`, `mockup-terminal-mode.html`) at the
   change directory's root, inheriting the project's existing Tailwind
   tokens and color variables, used as the visual contract for
   implementation. Mockups omit the per-agent CLI mode badge
   (`plan`/`code`) from `ChatHeader`.

## Why

**The product runs on agents that *are* CLI sessions.** OpenTeam's whole
identity is "operating system for AI super-individuals" — and the lowest
layer of every agent is a Claude Code or Codex CLI process whose JSONL
output we parse, decorate, and surface as message cards. Hiding that
process inside a secondary right-panel tab works for the routine case
but actively fights the power user in three frequent scenarios:

1. **Debugging a stuck agent** — When an agent's JSONL parser desyncs or
   the agent throws raw stderr that the parser doesn't model, the
   message stream silently drops the signal. The terminal still has it.
   Today the user has to widen the right panel and click into the right
   tab; tomorrow they should be one keystroke away.
2. **Interactive prompts mid-task** — Codex / Claude Code occasionally
   surface interactive picks (TUI menus, password prompts, signed-URL
   inputs) that the message UI cannot represent. The user must reach
   for the terminal anyway. Promoting it to a peer surface inside the
   conversation pane eliminates the disconnect.
3. **Live tail of streaming token output** — Some users prefer reading
   the raw stream rather than the polished card. The terminal pane
   already renders this losslessly; the toggle lets them pick.

**The cost of hiding the toggle behind a right-panel tab is attention.**
Every extra click in the dispatch ↔ review pulse breaks the
"attention-first" principle. A two-state segmented control at the top of
the conversation pane trades zero information loss for one keystroke.

**Information architecture matters.** The toggle is a **view-level
preference of the left pane**, not a property of the Mission or Agent.
That is why it lives in the left pane's local toolbar row (next to
`MessageToolbar`) rather than in `ChatHeader` (which holds Mission/Agent
identity). See `design.md` D0 for the full reasoning.

**The toggle is per-chat, not global.** Two parallel chats can be in
different modes — for example, the user keeps the Mission view in
message mode (for overview) while their `growth-marketer` 1:1 stays in
terminal mode (because they're driving an interactive flow there).

## Goals

- **G1**: A user can switch any open chat between message mode and
  terminal mode in one click or one keystroke (⌘⇧T), without scrolling
  state being lost when they switch back.
- **G2**: Message mode renders identically to today — zero visual
  regression in the conversation pane, in `ChatHeader`, or in
  `RightPanel`.
- **G3**: Terminal mode swaps the left-pane content from `ChatBody` to
  `TerminalPanel`, hides `InputArea` and `QueuedMessagesBar` so xterm
  owns the keyboard, and keeps the right-side IDE pane, the resize
  divider, the collapse chevron, `GlobalHeartbeatBar`, and `GitStatusBar`
  identical to message mode.
- **G4**: The mode persists per chat across page refresh, app restart,
  and workspace switch (`localStorage`).
- **G5**: The toggle works correctly inside the Quad layout (each tile
  retains its own mode independently, since each tile is its own
  `ChatInstance`).
- **G6**: No new database state, no new WebSocket events, no JSONL
  contract change.
- **G7**: Two HTML high-fidelity mockups exist in the change directory,
  using only Tailwind classes already present in the project's
  `tailwind.config.js`, so the implementation has a precise visual
  target.

## Non-Goals

- Removing or restructuring the right-side `RightPanel`/IDE column. It
  is rendered identically in both modes — Files / Editor / Changes
  remain a peer of the conversation surface regardless of which surface
  the user picked on the left.
- Adding any control to `ChatHeader`. The header is intentionally kept
  scoped to Mission/Agent identity and connection state. The
  `plan`/`code` agent-mode badge is also not surfaced in the mockups
  (out of scope here; see design D9).
- Adding a third or fourth view mode (e.g., "diff mode",
  "raw JSONL mode"). Not now.
- Changing how `TerminalPanel` itself works internally (its split/tabs
  layout toggle, hidden experts, Changes tab, theming) — all reused
  as-is.
- A global setting to make terminal mode the default for new chats.
  Default stays `'message'` for everyone; overriding it is a per-chat
  user action.
- Mobile viewport. Both modes assume a desktop pane width like the
  current product.
- Replacing the message stream with a "terminal-but-themed-as-messages"
  hybrid. Terminal mode renders the real `xterm` output; message mode
  renders the existing turn cards. They are distinct surfaces.
- Changing `InputArea` *behaviour* in message mode, slash-command palette,
  queue semantics, or `@-mention` flow. Terminal mode hides `InputArea`
  entirely; message mode is unchanged.

## Approach

### State and persistence

Add a `useChatViewMode(chatId, agentScopeOverride?)` hook in
`web/hooks/useChatViewMode.ts`:

- Reads
  `localStorage.getItem('openteam:chat-view:' + chatId + (agentScopeOverride ? ':' + agentScopeOverride : ''))`
  on mount.
- Returns `[mode, setMode]` with `mode: 'message' | 'terminal'`.
- Writes through to `localStorage` on `setMode`.
- Default value `'message'` if missing or invalid.

`ChatInstance` consumes the hook, threads `mode` and `setMode` to the
conversation pane's toolbar row, and branches the body render between
`ChatBody` and `TerminalPanel` based on `mode`. `ChatHeader` is not
touched.

### One chrome row per mode (toggle changes host)

`ChatViewModeToggle` is a positionless presentation component. Its host
depends on the mode so the left pane never stacks two near-empty rows:

**Message mode** — `ChatPaneToolbarRow` renders at the top of the left
pane (agent filter chips on the left, toggle on the right):

```
┌──────────────────────────────────────────────────────────┐
│  [chip] [chip] [chip]                          [💬│⌨︎]   │  ← ChatPaneToolbarRow
├──────────────────────────────────────────────────────────┤
│                       ChatBody                           │
├──────────────────────────────────────────────────────────┤
│  GlobalHeartbeatBar / GitStatusBar / Queued / InputArea  │
└──────────────────────────────────────────────────────────┘
```

**Terminal mode** — `ChatPaneToolbarRow` is *not* rendered;
`TerminalPanel`'s tablist gains a new `headerExtras` slot that hosts the
toggle alongside the existing layout-toggle button:

```
┌──────────────────────────────────────────────────────────┐
│ [●F fullstack] [●G growth-marketer]    [💬│⌨︎] [▣│⫶]    │  ← TerminalPanel tablist
├──────────────────────────────────────────────────────────┤
│                    TerminalPanel body                    │
├──────────────────────────────────────────────────────────┤
│  GlobalHeartbeatBar / GitStatusBar / Queued / InputArea  │
└──────────────────────────────────────────────────────────┘
```

- Two icon-only buttons inside a 28px-tall pill border
  (`border-border-subtle`, `bg-bg-secondary`), each 28px wide.
- Active button uses `bg-bg-elevated text-text-emphasis`, inactive uses
  `text-text-secondary hover:text-text-primary`.
- `aria-pressed` toggled on each button; group `role="group"`,
  `aria-label="Chat view mode"`.
- Keyboard: ⌘⇧T (or ⌃⇧T on non-Mac) toggles when the chat is
  `isActive`.

### `ChatInstance` left-pane branching

The branching happens **inside** the existing left/`chatPanelStyle` pane
only. The right-pane composition (`RightPanel`, divider, collapse
chevron) is unchanged.

```tsx
const viewToggle = (
  <ChatViewModeToggle mode={mode} onChange={setMode} />
)

<div style={chatPanelStyle}>
  <ChatHeader ... />                 {/* unchanged — no toggle here */}
  {mode === 'message' ? (
    <>
      <ChatPaneToolbarRow
        trailing={viewToggle}
        {...messageToolbarProps}
      />
      <ChatBody ... />
      {currentPlan && <PlanCard ... />}
    </>
  ) : (
    <TerminalPanel
      chatId={chatId}
      gitStatus={primaryGitStatus}
      agentActive={...}
      connected={connected}
      lockedAgentId={singleAgentMode ? lockedAgentKey : null}
      headerExtras={viewToggle}
    />
  )}
  <GlobalHeartbeatBar ... />
  <GitStatusBar ... />
  <QueuedMessagesBar ... />
  <InputArea ... />
</div>
{/* The right pane (RightPanel + divider + collapse chevron) renders
    identically in both modes — code path unchanged. */}
```

### `TerminalPanel` minimal additions

Three minor additions to `TerminalPanel`:

- Optional `lockedAgentId?: string | null`. When set, the panel hides
  the tablist (and the layout-toggle button), shows only that agent's
  pane, and adjusts the empty state copy.
- A guard to keep the existing per-chat `cc:terminal:hidden:<chatId>`
  behavior unchanged when locked.
- Optional `headerExtras?: ReactNode`. When provided, the node is
  rendered in the tablist's right-aligned controls cluster, immediately
  before the existing layout-toggle button. `ChatInstance` uses this to
  hand the view-mode toggle to `TerminalPanel` in terminal mode without
  `TerminalPanel` having to know what a "view mode" is.

These changes are additive; existing call sites pass nothing new.

### Quad layout

Each `ChatInstance` inside `QuadAgentTile` keeps its own
`useChatViewMode(chatId, agentScopeOverride)` (the chat id is shared
across tiles, but the locked agent differs per tile). To keep modes
independent per tile, the hook keys the storage on
`chatId + ':' + agentScopeOverride` when an `agentScopeOverride` is
present, falling back to plain `chatId` otherwise.

### HTML mockups

Two mockups under `openspec/changes/add-terminal-conversation-mode/`:

- `mockup-message-mode.html` — current product state, with the new
  toggle control visible at the top of the left pane (message side
  active). Demonstrates the toggle's "off" treatment for the terminal
  icon. `ChatHeader` is shown without any toggle and without the
  `plan`/`code` badge.
- `mockup-terminal-mode.html` — terminal mode active. Shows the
  full-pane `TerminalPanel` (split layout with two agent tiles), the
  in-pane toolbar row at the top still showing the view toggle (now
  with the terminal side active), the input area pinned at the bottom,
  the heartbeat bar, the git-status bar, and the unchanged right IDE
  pane.

Both mockups use real strings (no Lorem ipsum), real agent names, real
mission titles, the existing color tokens (`bg-bg-primary`,
`text-text-emphasis`, `accent-brand`, etc.), and demonstrate hover /
active / disabled states for the toggle. They are static HTML, no JS,
no build step, openable in a browser directly.

## Risks

- **xterm "first paint after switch" jank** — `TerminalPanel` calls
  `tryOpen` on mount and resizes via the fit addon. Toggling between
  modes unmounts/remounts the panel. Mitigation: the panel already
  supports a `reactivateAll` path on the imperative handle for keep-alive
  scenarios; if jank is observed in practice, swap the conditional
  render for a `display: none` keep-mounted approach (matches
  `ChatTabContainer`'s existing strategy elsewhere in the app). Tracked
  in `tasks.md`.
- **Mode persistence drift after chat deletion** — Stale
  `openteam:chat-view:<chatId>` keys accumulate in `localStorage`.
  Acceptable: each entry is ~32 bytes; we do not need a janitor pass
  for this size. (We can revisit if `localStorage` budget pressure
  becomes real.)
- **Quad-tile mode confusion** — Users may expect a single "switch this
  whole quad to terminal" toggle. Out of scope for this change. Each
  tile has its own toggle in its own pane. We document this in the
  in-app tooltip ("View applies to this pane only").
- **Discoverability of the toggle** — A two-icon pill at the top of the
  pane is small. Mitigation: tooltip on first hover; ⌘⇧T shortcut;
  `aria-pressed` on each button announces the active mode to screen
  readers.
- **Same-chat xterm reuse across left and right panes** — Both
  `TerminalPanel` (left pane in terminal mode) and the IDE's own
  `IDETerminalTabs` (right pane, accessible via the IDE's terminal
  drawer) accept the same `chatId`. They are independent xterm systems
  backed by different hooks (`useTerminalInstances` vs.
  `IDETerminalTabs`'s own state) and do not collide. We document this
  in `design.md` so future changes don't accidentally try to share
  xterm instances across panes.

## Affected Code

- `web/components/chat/ChatInstance.tsx` — add `useChatViewMode`,
  branch the **left-pane** body (ChatBody ↔ TerminalPanel) inside the
  existing `chatPanelStyle` div, render `ChatPaneToolbarRow` only in
  message mode, pass the view-mode toggle to `TerminalPanel` as
  `headerExtras` in terminal mode, add ⌘⇧T shortcut. Right-pane code
  path (RightPanel, divider, collapse chevron) is untouched.
  `ChatHeader` is not modified.
- `web/components/chat/ChatPaneToolbarRow.tsx` (new) — message-mode-only
  toolbar row: wraps `MessageToolbar` agent filter chips and an
  optional `trailing` slot (used to host the view-mode toggle).
- `web/components/chat/ChatViewModeToggle.tsx` (new) — the segmented
  two-icon pill control. Positionless; its parent decides where it
  renders.
- `web/hooks/useChatViewMode.ts` (new) — persistence hook keyed by
  `openteam:chat-view:<chatId>[:<agentScopeOverride>]`.
- `web/components/terminal/TerminalPanel.tsx` — accept optional
  `lockedAgentId` prop, hide tablist + layout toggle when locked, swap
  empty-state copy; accept optional `headerExtras?: ReactNode` slot
  rendered in the tablist controls cluster before the layout-toggle
  button.
- `web/components/workspace/QuadAgentTile.tsx` — no code change; the
  per-tile `ChatInstance` already drives its own hook, but audited for
  storage-key collision (mitigation in the hook itself).
- `web/i18n/locales/{en,zh}/chat.json` — strings for tooltip, toggle
  labels, `aria-label`, terminal-mode empty state.
- `openspec/changes/add-terminal-conversation-mode/mockup-message-mode.html`
  (new) — static visual.
- `openspec/changes/add-terminal-conversation-mode/mockup-terminal-mode.html`
  (new) — static visual.
