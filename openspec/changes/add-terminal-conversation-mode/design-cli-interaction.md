# Design Addendum: Terminal Mode as a True CLI Passthrough

This document supplements `design.md`. It scopes the interaction model
for terminal mode so that switching to terminal mode means "drive the
underlying Claude Code / Codex CLI directly", not "watch raw output
while still typing into a React box."

If accepted, it **revises** the proposal's stance that `InputArea`
remains pinned at the bottom in terminal mode (proposal §2/§3, design
D8) and supersedes the related lines in `specs/chat-view-modes/spec.md`
under *"Terminal mode swaps the left pane …"* → "Chat input and
decorators stay pinned in terminal mode."

## Architectural gap: ACP is not a PTY

Switching to terminal mode requires more than wiring xterm to the
existing agent process. The ACP-based agent that runs in the chat does
not expose a PTY surface:

- Server-side, an agent is spawned via `ConfigCompiler` →
  `StreamJsonManager` with `--print --verbose --output-format
  stream-json --input-format stream-json`. Output is line-delimited JSON
  parsed by `ACPToFrontendBridge` into structured events
  (`expert:partial-text`, `expert:activity`, `expert:plan-update`,
  `expert:mode-change`, etc.). The server never emits `expert:data`
  to a web client — `expert:data` exists only for the `openteam cli`
  client transport.
- Server-side `ExpertHandler.handleInput` writes incoming
  `expert:input` bytes via `acpClient.write`, but the receiver is a
  stream-json reader, not a TUI parser. Typing `Ctrl+C` through xterm
  has no effect on the agent; typing `/help` is just a literal token
  the stream-json reader does not parse.
- Web-side, `useTerminalWsEvents` listens for `expert:data` to feed
  xterm. With no emitter, xterm stays blank in terminal mode.

In short: agent ↔ web today carries **structured ACP events**, not
**raw CLI TUI bytes**. The proposal's promise — "drive the underlying
CLI directly" — is not delivered by the existing pipeline.

## Decision: spawn a sibling PTY that resumes the agent's JSONL

We add a server-side bridge. When the user enters terminal view for an
agent, the server spawns a sibling `claude --resume <cliSessionId>` (or
codex equivalent) as a `node-pty` process in the chat's cwd. Its
stdout is streamed to the web client as `expert:data`; web-side
`expert:input` and `expert:resize` are routed to the PTY's stdin
instead of the ACP adapter when a view-PTY is active for that
`(connectionId, chatId, agentId)`.

The ACP process keeps running unchanged in the background. **ACP
remains the primary interaction mode** — all inter-agent handoff,
orchestration, and scheduling stay on ACP. Terminal mode is purely an
opt-in surface that gives the user a native CLI experience anchored to
the same conversation history.

### New WS contract

| Direction | Message | Payload | Purpose |
|-----------|---------|---------|---------|
| Web → Server | `expert:cli-attach` | `{ chatId, agentId, cols, rows }` | User entered terminal view; spawn / size the resume-PTY for this agent |
| Web → Server | `expert:cli-detach` | `{ chatId, agentId }` | User left terminal view; kill the resume-PTY |
| Web → Server | `expert:input` | `{ chatId, agentId, data }` | If a view-PTY is active → PTY stdin; else → ACP `acpClient.write` (unchanged) |
| Web → Server | `expert:resize` | `{ chatId, agentId, cols, rows }` | If a view-PTY is active → `pty.resize`; else no-op (unchanged) |
| Server → Web | `expert:data` | `{ chatId, agentId, snapshot, data, ptySize }` | Raw TUI bytes from view-PTY; first chunk flagged `snapshot: true` |
| Server → Web | `expert:exit` | `{ chatId, agentId, exitCode }` | View-PTY exited (CLI quit, hangup, crash) |
| Server → Web | `expert:error` | `{ chatId, agentId, error, message }` | Spawn failure (CLI not on PATH, missing cliSessionId, cwd gone, unsupported provider) |

The bridge is **per-WebSocket-connection** and keyed by
`(connectionId, chatId, agentId)`. A given chat can have multiple
concurrent web clients in terminal view; each owns its own PTY.

### Server: `TerminalViewManager`

A new class in `server/terminal/TerminalViewManager.ts` owns the view-
PTY map. It:

- Looks up the agent's `cliSessionId` / `cwd` / `provider` from
  `SessionRegistry.findByChat(chatId, agentId)` (live) or
  `ChatStore.get(chatId).expertSessions[agentId]` (persisted).
- Resolves the CLI command (`claude` / `qodercli`) via
  `resolveCliCommandAsync` + `resolveInterpreter`.
- `node-pty.spawn(command, ['--resume', cliSessionId], { cwd, cols,
  rows, env: { TERM: 'xterm-256color', ... } })`.
- Pipes `pty.onData` → `expert:data` (first chunk
  `snapshot: true`).
- Pipes `pty.onExit` → `expert:exit` and clears the entry.
- Receives `expert:input` / `expert:resize` from
  `WSRouter` and forwards to the PTY when a view exists for that key.
- Cleans up all view-PTYs for a connection on WS disconnect.

### Codex support

`codex` does not currently advertise `--resume`. For provider `codex`
the server returns `expert:error` with
`terminal_view_unsupported_provider`. The web client treats this as a
disabled state (terminal view tab shows the empty-state copy with a
"Switch to message view" hint). Adding codex support is a follow-up
once the codex CLI exposes a resume command.

### Coexistence with ACP

Two processes referencing the same `cliSessionId` write into separate
session files (the resume process forks a new session under the hood;
`claude` does not currently support shared write access). For the
MVP we accept this fork as the trade-off — the user sees the
conversation history in the TUI and can keep typing, but turns typed
in terminal view do NOT show up in message view, and vice versa, until
the user toggles back. A future iteration can re-attach by reading
JSONL diffs across the two session files; out of scope here.

### Reconnect

A WS reconnect closes and re-opens the connection, which means the old
view-PTY is killed by `handleDisconnect` and a fresh one must be
attached by the new connection. The web client re-sends
`expert:cli-attach` on `wsClient.on('reconnected')`. Because the
resume command re-renders the conversation TUI on startup, the user
sees the same content in the new PTY; mid-typed input is lost (an
acceptable cost for an MVP).

## Source code anchors

- Web: `web/components/terminal/useTerminalInstances.ts:66-82`,
  `web/components/terminal/useTerminalWsEvents.ts:68-114`,
  `web/components/terminal/TerminalPanel.tsx` (cli-attach effect).
- Server: `server/terminal/TerminalViewManager.ts`,
  `server/ws/WSRouter.ts` (route + intercept), `server/index.ts`
  (manager construction).
- Shared types: `shared/ws/index.ts` (`expert:cli-attach` /
  `expert:cli-detach`), `shared/ws/expert.ts` (`ExpertDataPayload`,
  `ExpertExitPayload`).

## The real question: input semantics

Today the proposal keeps `InputArea` pinned in both modes. That leaves
two parallel writers attached to the same PTY:

- React `InputArea` → `expert:direct-input` (carries text, image
  attachments, `previousContext`, autoStart). It also drives the queue,
  `@mention` palette, model picker, and slash-command palette.
- xterm focus → `expert:input` (raw keystrokes, including `\r`).

Both reach `expert.acpClient.write(...)` server-side. They cannot
coexist coherently:

- Two input surfaces compete for keyboard focus on every click.
- The queue / `@mention` / model picker / slash palette are React
  abstractions that have **no analogue** in raw PTY input — typing them
  into xterm would inject literal `@`/`/` characters into the CLI,
  which is exactly what a user driving `claude --resume` mid-prompt
  does **not** want.
- `Enter` semantics diverge: in `InputArea`, Enter sends (post-build);
  in xterm, Enter is a literal `\r` going straight into stdin. A user
  bouncing focus between them will eventually send a message the wrong
  way.

The proposal's promise — "the user has direct CLI access" — is only
delivered if terminal mode actually means *terminal mode*.

## Decision: terminal mode hides InputArea and bottom bars; xterm owns input

In terminal mode:

1. **`InputArea` is not rendered.** No model picker, no queue input,
   no `@mention` palette, no slash palette. The terminal *is* the
   prompt.
2. **`QueuedMessagesBar` is not rendered.** Queue semantics belong to
   the React message flow. A user in terminal mode is talking to one
   CLI process at a time; the bar would dangle queued items they can
   no longer flush. (See "Queue handling at mode switch" below for how
   we treat pre-existing queue entries.)
3. **`GlobalHeartbeatBar` and `GitStatusBar` stay.** These are
   indicators, not input. They keep ambient awareness intact.
4. **xterm gets focus on mode switch.** When the user toggles to
   terminal mode (or presses `⌘⇧T`), the currently active agent's
   `TerminalInstance.focus()` is called inside a `requestAnimationFrame`
   so the focus lands after layout settles. If no agent is active yet,
   focus is deferred until the first `expert:started` arrives.
5. **Agent routing follows xterm focus.** In a multi-agent chat,
   clicking another agent's tab/tile (split layout) both switches the
   active tab and shifts focus. There is no separate target-agent
   selector in terminal mode — the focused xterm *is* the routing.
6. **`ChatHeader` keeps the toggle in its `trailing` slot** (current
   placement). The user gets back to message mode by clicking the
   message icon or pressing `⌘⇧T`.

The toggle therefore has a single meaning: *"who owns the keyboard
right now — the React chat composer or the underlying CLI?"*

## Queue handling at mode switch

`QueuedMessagesBar` exposes pending React-flow messages. When the user
toggles to terminal mode while the queue is non-empty:

- The queue is **preserved in-memory** (`useChatActions.queuedMessages`
  is already non-persistent). It is simply not shown.
- A one-line non-modal toast above `GlobalHeartbeatBar` notifies:
  "N queued messages preserved — switch to message view to send"
  (i18n: `chat:chatViewMode.queuePreservedNotice`).
- Toggling back to message mode restores the bar with the same entries.

Rationale: silently dropping queued user intent is worse than the
extra visual rule.

## Focus, keyboard, and accessibility

- `TerminalInstance` already exposes `focus()` (xterm.js native).
  Add a `focusActive()` method on the imperative handle of
  `TerminalPanel` that calls `terminalsRef.current.get(activeKey)?.focus()`
  iff the instance is opened.
- `ChatInstance`'s view-mode effect calls
  `terminalPanelRef.current?.focusActive()` whenever `viewMode`
  transitions to `'terminal'`. Skipped when `isActive === false`.
- `⌘⇧T` keeps the existing toggle behavior. When toggling *into*
  terminal mode it focuses xterm. When toggling *out* it focuses
  `InputArea` (existing `inputAreaRef.current?.focus()`).
- `Esc` inside xterm is forwarded to PTY as a literal `\x1b` (this is
  intentional — needed for vim, `claude` permission prompts, etc.). It
  does **not** exit terminal mode. The user uses the toggle or `⌘⇧T`.
- Screen reader: the `xterm-accessibility` addon already provides a
  live region. The view-mode toggle's `aria-pressed` announces the
  switch.

## Reconnect, resume, and exit

- On WS reconnect (`useTerminalWsEvents.handleReconnected`), the
  existing snapshot replay reactivates xterm and re-sends
  `expert:resize`. No change required for terminal mode.
- If the underlying agent exits while in terminal mode, the existing
  `expert:exit` handler writes the yellow `[Agent terminated …]` line
  to xterm. The terminal becomes read-only for that agent (PTY is
  gone). User can switch to another agent's tab or back to message
  mode to start a new task. No special handling required.
- If `lockedAgentId` is set (Agent view, Quad tile) and that agent
  exits, the empty-state copy
  `terminal.emptyHintLocked` reappears, alongside an existing message
  to restart the agent via the React composer in message mode.

## How to start a new turn from terminal mode

The simplest answer: the user types into xterm. `claude` / `codex`
accept input at any prompt they show; pressing `Enter` sends to the
CLI's own parser, which is the same path that would have run had the
user typed in `InputArea` and pressed Send.

This means **terminal mode does not support starting a brand-new
session** for an agent that has never been launched in this chat. The
launch path (`expert:start` with cwd / repositories / model / system
prompt) is still owned by `useChatActions.handleSend` → `expert:direct-input` with
`autoStart: true`, which only `InputArea` can produce. The
empty-state copy in terminal mode therefore tells the user to switch
back to message mode for the *first* turn:

```
Locked + no session yet:    "Switch to message view to launch <agent>"
Multi-agent + nothing running:  "Switch to message view to start a session"
```

i18n keys to add: `chat:chatViewMode.firstTurnHintLocked`,
`chat:chatViewMode.firstTurnHintMulti`.

Subsequent turns (when the CLI is at its prompt) flow through xterm
directly. This is the same constraint a user has driving `claude` in a
real terminal: you launch the binary once with arguments, then you
talk to it at the prompt.

## Files affected by this addendum (delta from current implementation)

- `web/components/chat/ChatInstance.tsx`
  - Add `terminalPanelRef = useRef<TerminalPanelHandle>(null)`.
  - In terminal mode, do **not** render `InputArea`,
    `QueuedMessagesBar`. Render `GlobalHeartbeatBar` and
    `GitStatusBar` unchanged.
  - Add a `useEffect` keyed on `[viewMode, isActive]` that calls
    `terminalPanelRef.current?.focusActive()` when entering terminal
    mode and `inputAreaRef.current?.focus()` when leaving.
  - When toggling into terminal mode with `queuedMessages.length > 0`,
    surface a one-line preserved-queue notice (new component
    `QueuePreservedNotice`, or inline div using existing tokens).
- `web/components/terminal/TerminalPanel.tsx`
  - Extend `TerminalPanelHandle` with `focusActive(): void`.
  - Implement it via `terminalsRef.current.get(activeKey)?.focus()`
    guarded by `isOpened`.
  - In `lockedAgentId` empty state, when terminal mode is active and
    no session exists, render the
    `firstTurnHintLocked` / `firstTurnHintMulti` copy from the new
    i18n keys.
- `web/components/terminal/TerminalInstance.ts`
  - No change required — xterm.js `Terminal.focus()` already exists.
    Just expose via the surrounding wrapper.
- `web/locales/{en,zh}/chat.json`
  - Add: `chatViewMode.queuePreservedNotice`,
    `chatViewMode.firstTurnHintLocked`,
    `chatViewMode.firstTurnHintMulti`.
- `openspec/changes/add-terminal-conversation-mode/specs/chat-view-modes/spec.md`
  - Replace the existing scenario "Chat input and decorators stay
    pinned in terminal mode" with two scenarios:
    1. *Terminal mode hides React composer and queue.*
    2. *Toggling into terminal mode focuses the active agent's xterm.*
  - Add scenario *"Queue is preserved across mode switches."*
  - Add scenario *"First turn for an idle agent requires message
    mode."*

## Risks and counterpoints

- **Power users want `@mention` while watching raw output.**
  Acceptable cost: hop back to message mode for one keystroke
  (`⌘⇧T`), send, hop back. Cheaper than reconciling two writer
  semantics. We can revisit a "compact composer" sub-mode later if
  the round-trip proves painful (out of scope here, captured as
  follow-up).
- **First-turn UX cliff.** A user new to the app may toggle to
  terminal mode on an idle chat and see "switch back to launch."
  Mitigation: the first-turn hint is one line of copy, and the
  default mode remains `'message'`. The cliff only hits a user who
  explicitly opts in.
- **Focus theft.** Auto-focusing xterm could steal focus from a
  modal or palette the user just opened. Guarded by `isActive` and
  scheduled in `requestAnimationFrame`, so any synchronously-rendered
  overlay still wins.
- **Queue confusion.** Preserving the queue invisibly might
  surprise users. The one-line notice mitigates; if telemetry later
  shows confusion we can flush queue on entering terminal mode
  instead.
- **Mode discoverability.** Users who never read tooltips might
  not realize the toggle exists. Same risk as the original proposal;
  not made worse.

## Out of scope (explicit non-goals of this addendum)

- A "compact composer" overlay inside terminal mode for `@mention` /
  slash. Could be added later if the round-trip pattern shows
  friction.
- Routing `InputArea` sends through `expert:input` (raw PTY) instead
  of `expert:direct-input` (ACP). The ACP path carries
  attachments / previousContext metadata the raw path cannot express.
- Auto-switching back to message mode when the agent exits. The user
  may want to read the final output before moving on.
- Mobile / narrow-viewport behavior. Same constraint as base
  proposal.
