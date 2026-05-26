# Tasks: Add Terminal View Mode to the Chat Conversation Pane

Each task is a small, verifiable unit. Check off as work lands.

## 1. Persistence hook

- [x] 1.1 Create `web/hooks/useChatViewMode.ts` exporting
  `useChatViewMode(chatId: string, agentScopeOverride?: string | null)`
  that returns `[mode, setMode]`.
- [x] 1.2 Read from `localStorage` on mount; default `'message'` when
  missing or invalid.
- [x] 1.3 Write through to `localStorage` on every `setMode` call.
- [x] 1.4 Composite key: storage key is
  `openteam:chat-view:<chatId>` and append `':' + agentScopeOverride`
  when `agentScopeOverride` is truthy, so Quad tiles pinned to
  different agents under the same `chatId` keep independent modes.
- [x] 1.5 Unit test: mode round-trips through storage; invalid stored
  value (`'foo'`) falls back to `'message'`; composite key isolates
  Quad tiles.

## 2. Toggle component

- [x] 2.1 Create `web/components/chat/ChatViewModeToggle.tsx` —
  segmented two-icon pill (`MessageSquare`, `TerminalSquare` from
  Lucide).
- [x] 2.2 Component accepts `mode`, `onChange(next)`, and optional
  `disabled`; renders 28×28 buttons inside a `border border-border-subtle`
  pill with `bg-bg-secondary`.
- [x] 2.3 Active button gets `bg-bg-elevated text-text-emphasis`,
  inactive gets `text-text-secondary hover:text-text-primary`. No
  layout shift on hover (use `opacity` for any decoration changes).
- [x] 2.4 `role="group"`, `aria-label="Chat view mode"`,
  `aria-pressed` on each button.
- [x] 2.5 Tooltip shows "Message view (⌘⇧T)" / "Terminal view (⌘⇧T)"
  with the inactive option's label as the actionable hint.

## 3. Message-mode toolbar row

- [x] 3.1 Create `web/components/chat/ChatPaneToolbarRow.tsx` — a thin
  flex row container with `MessageToolbar`-style padding. Left slot
  hosts the existing `MessageToolbar` agent filter chips (matching
  today's visibility rule of chip count > 1). Right slot is a
  `trailing?: ReactNode` prop, used by `ChatInstance` to inject the
  view-mode toggle.
- [x] 3.2 The row renders **only in message mode**. In terminal mode,
  `ChatInstance` does not render this component at all (the toggle
  hops into the `TerminalPanel` tablist instead — see Task 6.5).
- [x] 3.3 `ChatHeader` is not modified by this change — verify no new
  prop is added to it.

## 4. `ChatInstance` view-mode branching

- [x] 4.1 Wire `useChatViewMode(chatId, agentScopeOverride)` into
  `ChatInstance`; build a single `viewToggle` JSX element from
  `<ChatViewModeToggle mode={mode} onChange={setMode} />`.
- [x] 4.2 In `'message'` mode, render
  `<ChatPaneToolbarRow trailing={viewToggle} {...messageToolbarProps} />`
  inside the left pane, then the existing `ChatBody` + `PlanCard`
  stack.
- [x] 4.3 In `'terminal'` mode, render
  `<TerminalPanel chatId={chatId} ... lockedAgentId={...} headerExtras={viewToggle} />`
  with **no** `ChatPaneToolbarRow` above it (avoid stacked chrome).
- [x] 4.4 Leave the right-pane code path untouched: `RightPanel`, the
  resize divider, and the collapse chevron continue to render in both
  modes exactly as they do today. `chatCollapsed`, `hideRightPanel`,
  and `rightPanelMountNode` semantics are unchanged.
- [x] 4.5 Continue to render `GlobalHeartbeatBar`, `GitStatusBar`,
  `QueuedMessagesBar`, and `InputArea` in both modes.

## 5. ⌘⇧T keyboard shortcut

- [x] 5.1 In `ChatInstance`'s existing `useEffect` that registers
  ⌘⇧D and ⌘K, add a ⌘⇧T (⌃⇧T on non-Mac) branch that calls
  `setMode(mode === 'message' ? 'terminal' : 'message')` when
  `isActive`.
- [x] 5.2 Call `e.preventDefault()` to keep browser-level conflicts
  out (Chrome's reopen-closed-tab also uses this, but the app pane
  has focus while in chat).

## 6. `TerminalPanel` locked-agent variant

- [x] 6.1 Add optional prop `lockedAgentId?: string | null` to
  `TerminalPanelProps`.
- [x] 6.2 When `lockedAgentId` is truthy:
  - Filter `experts` shown in the tablist to that one entry.
  - Hide the layout-toggle button (Layers/Columns2).
  - Hide the hidden-experts reopen menu (no hide affordance shown).
  - Swap the empty-state copy from
    `t('terminal.emptyHint')` → `t('terminal.emptyHintLocked', { agent })`.
- [x] 6.3 Hide-expert handler short-circuits when locked (no-op).
- [x] 6.4 Add i18n string `terminal.emptyHintLocked` in
  `web/i18n/locales/{en,zh}/chat.json`.
- [x] 6.5 Add optional prop `headerExtras?: ReactNode` to
  `TerminalPanelProps`. When provided, render the node in the tablist's
  right-aligned controls cluster, immediately before the existing
  layout-toggle button (so the view-mode toggle and layout-toggle sit
  side-by-side as siblings). When `lockedAgentId` is truthy and the
  layout-toggle is hidden, `headerExtras` still renders. Existing call
  sites that omit `headerExtras` see no change.

## 7. i18n strings

- [x] 7.1 Add `chat:chatViewMode.message` ("Message"),
  `chat:chatViewMode.terminal` ("Terminal"),
  `chat:chatViewMode.tooltipMessage`,
  `chat:chatViewMode.tooltipTerminal`,
  `chat:chatViewMode.shortcut` ("⌘⇧T"),
  `chat:chatViewMode.ariaLabel` ("Chat view mode") in both
  `en/chat.json` and `zh/chat.json`.
- [x] 7.2 Verify pluralization / translation lengths do not break
  the 28×28 button width.

## 8. HTML mockups

- [x] 8.1 Create `openspec/changes/add-terminal-conversation-mode/mockup-message-mode.html`
  showing the new toggle at the top of the left pane (message side
  active), the existing message stream, the IDE panel on the right.
  `ChatHeader` shows no toggle and no `plan`/`code` agent-mode badge.
- [x] 8.2 Create `openspec/changes/add-terminal-conversation-mode/mockup-terminal-mode.html`
  showing the same toolbar row at the top of the left pane (terminal
  side active), the full-pane `TerminalPanel` in split layout with two
  agent tiles, the input area pinned at the bottom, the heartbeat +
  git-status bars, the unchanged right IDE pane.
- [x] 8.3 Both mockups: real strings (no Lorem ipsum), real agent
  names (`fullstack`, `growth-marketer`), real mission title
  ("Ship terminal view mode toggle"), Tailwind tokens already present
  in `tailwind.config.js`. Neither mockup includes the
  `plan`/`code` badge in the header.
- [x] 8.4 Both mockups open standalone in a browser (no JS, no
  build step).

## 9. Validation

- [x] 9.1 Run `npx openspec validate add-terminal-conversation-mode --strict`
  and resolve every reported issue before sharing.
- [x] 9.2 Spec scenarios manually walked against the mockups.

## 10. Terminal-mode CLI passthrough (per design-cli-interaction.md)

- [x] 10.1 `TerminalInstance.ts`: expose a public `focus()` that
  forwards to the underlying xterm `Terminal.focus()`. No-op if not
  opened or disposed.
- [x] 10.2 `TerminalPanel.tsx`: extend `TerminalPanelHandle` with
  `focusActive(): void`. Implementation calls
  `terminalsRef.current.get(activeKey)?.focus()` guarded by `isOpened`.
- [x] 10.3 `ChatInstance.tsx`: add
  `terminalPanelRef = useRef<TerminalPanelHandle>(null)`, pass it to
  `<TerminalPanel ref={terminalPanelRef} ... />` in terminal mode.
- [x] 10.4 `ChatInstance.tsx`: in terminal mode, do NOT render
  `InputArea` or `QueuedMessagesBar`. `GlobalHeartbeatBar` and
  `GitStatusBar` continue to render.
- [x] 10.5 `ChatInstance.tsx`: add a `useEffect` keyed on
  `[viewMode, isActive]` — when entering `'terminal'` mode and
  `isActive`, schedule
  `requestAnimationFrame(() => terminalPanelRef.current?.focusActive())`;
  when entering `'message'` mode and `isActive`, schedule
  `requestAnimationFrame(() => inputAreaRef.current?.focus())`.
- [x] 10.6 `ChatInstance.tsx`: when `viewMode === 'terminal'` and
  `queuedMessages.length > 0`, render a one-line non-modal notice
  above `GlobalHeartbeatBar` using
  `t('chat:chatViewMode.queuePreservedNotice', { count })`. Use
  existing tokens (`bg-bg-secondary`, `text-text-secondary`, subtle
  border).
- [x] 10.7 `TerminalPanel.tsx`: when the scoped empty state would
  render and the chat is in terminal mode with no running session,
  swap the copy to `t('chat:chatViewMode.firstTurnHintLocked', { agent })`
  for `lockedAgentId` chats and
  `t('chat:chatViewMode.firstTurnHintMulti')` otherwise. (Terminal mode
  signal is conveyed by an existing prop or a new optional boolean
  prop `inTerminalView?: boolean` — choose the lighter-touch option at
  implementation time.)
- [x] 10.8 `web/locales/{en,zh}/chat.json`: add
  `chatViewMode.queuePreservedNotice`,
  `chatViewMode.firstTurnHintLocked`,
  `chatViewMode.firstTurnHintMulti`.
- [x] 10.9 `useChatViewMode.test.ts`: add a regression — `setMode`
  followed by `setMode` back round-trips through storage (already
  covered; expand if needed for focus-effect helper).
- [ ] 10.10 Manual smoke: launch dev server, open a mission with one
  running agent, toggle to terminal mode, confirm:
  - `InputArea` is gone, xterm has focus, typing reaches the CLI;
  - `Ctrl+C` interrupts the CLI without exiting terminal mode;
  - `⌘⇧T` flips back, `InputArea` regains focus, queue (if any)
    re-appears.
- [x] 10.11 Run `npx openspec validate add-terminal-conversation-mode --strict`.

## 12. Resume-PTY bridge (per design-cli-interaction.md "Decision: spawn a sibling PTY")

The ACP stream-json process does not expose a PTY surface, so terminal
mode requires a separate server-side bridge that resumes the agent's
JSONL inside a real `node-pty`. The ACP process keeps running for
handoff / orchestration / scheduling; the bridge serves only the
user's opt-in native terminal experience.

- [x] 12.1 `shared/ws/index.ts`: add two new web→server message types
  to `WSMessageMap`:
  - `expert:cli-attach` with payload `{ chatId, agentId, cols, rows }`
  - `expert:cli-detach` with payload `{ chatId, agentId }`
- [x] 12.2 `server/terminal/TerminalViewManager.ts`: new class owning
  a `Map<string, ViewPty>` keyed by `(connectionId, chatId, agentId)`.
  Methods: `has()`, `handleAttach()`, `handleDetach()`,
  `forwardInput()`, `forwardResize()`, `handleResize()`,
  `handleDisconnect()`.
  - `handleAttach` looks up `cliSessionId`/`cwd`/`provider` from
    `SessionRegistry.findByChat` (live) then `ChatStore.expertSessions`
    (persisted); resolves CLI command via `resolveCliCommandAsync` +
    `resolveInterpreter`; spawns `pty.spawn(spawnCmd, [...prependArgs,
    '--resume', cliSessionId], { name: 'xterm-256color', cwd, cols,
    rows, env })`.
  - `pty.onData` emits `expert:data` with `snapshot: true` on the
    first chunk, `false` thereafter; `pty.onExit` emits `expert:exit`
    and removes the entry.
  - Error cases emit `expert:error` with codes
    `terminal_view_unavailable`, `terminal_view_unsupported_provider`
    (codex), `terminal_view_cli_not_found`,
    `terminal_view_spawn_failed`.
- [x] 12.3 `server/ws/WSRouter.ts`: accept optional
  `terminalViewManager` in deps; route `expert:cli-attach` and
  `expert:cli-detach`; for `expert:input` and `expert:resize`,
  short-circuit to `forwardInput` / `forwardResize` when a view-PTY
  exists for the triple, otherwise fall through to the existing
  `ExpertHandler` (ACP) path. In `handleDisconnect`, call
  `terminalViewManager?.handleDisconnect(connectionId)`.
- [x] 12.4 `server/index.ts`: construct
  `const terminalViewManager = new TerminalViewManager(sessionRegistry,
  chatStore)` and pass it into `new WSRouter({ ..., terminalViewManager
  })`.
- [x] 12.5 `web/components/terminal/TerminalPanel.tsx`: when
  `inTerminalView` is true, send `expert:cli-attach` for each running
  agent in scope (filtered by `lockedAgentId` when locked); on
  cleanup (toggle out / unmount), send `expert:cli-detach` for each
  attached agent.
- [x] 12.6 `design-cli-interaction.md`: replace the obsolete "PTY link
  already exists" section with the architectural-gap / Resume-PTY
  bridge / new-WS-contract content.
- [x] 12.7 spec.md: add the "Terminal mode bridges the agent to a
  resumed CLI PTY" requirement and its scenarios.
- [ ] 12.8 Web: add a `wsClient.on('reconnected')` handler inside
  `TerminalPanel` that re-emits `expert:cli-attach` for currently
  attached agents, so a WS reconnect re-spawns view-PTYs (the prior
  ones were killed by server-side `handleDisconnect`).
- [ ] 12.9 Manual smoke (extends 10.10): with a running agent in a
  chat, toggle to terminal mode and confirm xterm renders the
  resumed `claude` TUI, typing reaches the CLI, `Ctrl+C` interrupts,
  toggling back to message mode kills the view-PTY (no leaked
  `claude --resume` process in `ps`), and the original ACP session is
  still streaming events in the background.
- [x] 12.10 Run `npx openspec validate add-terminal-conversation-mode --strict`.

## 11. Post-merge follow-ups (do not block proposal)

- [ ] 11.1 Dogfood: if toggling repeatedly during an active stream
  causes xterm flicker, swap `ChatInstance`'s render branch for the
  keep-mounted `display: none` pattern used by `ChatTabContainer`.
- [ ] 11.2 Consider promoting the per-chat preference to an agent-
  level default once usage data confirms the pattern.
- [ ] 11.3 Consider a "compact composer" overlay (`@mention` / slash
  only) inside terminal mode if telemetry shows users round-tripping
  to message mode frequently just for those affordances.
