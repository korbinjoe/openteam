# Spec: Chat View Modes (Message / Terminal)

## Overview

A *chat view mode* is the form the **left (conversation) pane** of a chat
uses to render its content. Two modes are supported:

- **`message` mode** — the existing `ChatBody` stream of grouped
  `AgentTurnCard`s derived from JSONL events.
- **`terminal` mode** — the existing `TerminalPanel` (xterm-backed CLI
  sessions) promoted to the primary surface inside the left pane.

The view mode is a **view-level preference of the left pane**, not a
property of the Mission or Agent. It is per-chat, persisted in
`localStorage`, defaults to `message`, and is toggled by a control in
the left pane's local toolbar (sibling of `MessageToolbar`) or by the
keyboard shortcut ⌘⇧T (⌃⇧T on non-Mac).

The toggle does not change message routing, JSONL parsing, agent
lifecycle, or persistence. It changes only which surface is rendered
inside the left pane.

## ADDED Requirements

### Requirement: Chat view mode is selectable per chat

Every chat surface (Mission view, Agent view, Quad tile) MUST expose a
two-state view-mode toggle inside the left (conversation) pane and
respect the user's selection.

#### Scenario: Toggle is visible at the top of the conversation pane in message mode

**Given** a user opens any chat in message mode
**When** the left pane renders
**Then** a segmented two-button control appears at the top of the
conversation pane, on the same row as `MessageToolbar` (right-aligned,
to the right of any agent filter chips), hosted by `ChatPaneToolbarRow`
**And** the control's left button shows a `MessageSquare` icon labeled
"Message" via tooltip
**And** the control's right button shows a `TerminalSquare` icon
labeled "Terminal" via tooltip
**And** the active mode's button has `aria-pressed="true"` and the other
has `aria-pressed="false"`
**And** the toggle is NOT rendered inside `ChatHeader` (the header
remains scoped to workspace/mission identity and connection status)

#### Scenario: Toggle moves into the terminal tablist in terminal mode

**Given** a chat is in terminal mode
**When** the left pane renders
**Then** the left pane shows exactly ONE chrome row at the top — the
`TerminalPanel` tablist
**And** the view-mode toggle is rendered inside that tablist's
right-aligned controls cluster (sibling of the layout-toggle button),
not in a separate row above it
**And** `ChatPaneToolbarRow` is NOT rendered in terminal mode (avoiding
a second, near-empty chrome row above the tablist)
**And** the toggle's appearance, `aria-pressed` semantics, and tooltips
are identical to its message-mode rendering

#### Scenario: Default mode is message for every chat

**Given** a user opens a chat for which no
`openteam:chat-view:<chatId>` entry exists in `localStorage`
**When** `ChatInstance` mounts
**Then** the left pane renders `ChatBody` (message stream)
**And** the toggle's left (Message) button is the active one

#### Scenario: Clicking the inactive button switches the left-pane surface

**Given** a chat is currently in message mode
**When** the user clicks the Terminal button in the toolbar toggle
**Then** `ChatBody` is unmounted from the left (conversation) pane
**And** `TerminalPanel` is mounted in the left (conversation) pane
**And** the right-side `RightPanel`, the resize divider, and the
collapse chevron continue to render unchanged
**And** `aria-pressed` flips on both toggle buttons

#### Scenario: Mode survives page refresh

**Given** a user has set a chat to terminal mode
**When** they refresh the browser tab and reopen the same chat
**Then** the chat re-mounts in terminal mode
**And** the toggle's right (Terminal) button is the active one

#### Scenario: Mode survives app restart in Electron

**Given** a user has set a chat to terminal mode and quit the Electron app
**When** they relaunch the app and open the same chat
**Then** the chat re-mounts in terminal mode

#### Scenario: Each Quad tile keeps its own mode

**Given** the Quad layout has four tiles for the same chat, each pinned
to a different agent via `agentScopeOverride`
**When** the user sets tile A to terminal mode and tile B remains in
message mode
**Then** tile A's left pane renders `TerminalPanel`
**And** tile B's left pane renders `ChatBody`
**And** the underlying `localStorage` keys are
`openteam:chat-view:<chatId>:<agentScopeOverrideA>` and
`openteam:chat-view:<chatId>:<agentScopeOverrideB>` respectively

### Requirement: Keyboard shortcut toggles view mode for the active chat

A keyboard shortcut MUST toggle the chat view mode of the currently
active chat without requiring the user to mouse to the toolbar.

#### Scenario: ⌘⇧T toggles between modes

**Given** a chat is active (`isActive === true`) and currently in message
mode
**When** the user presses ⌘⇧T (or ⌃⇧T on non-Mac)
**Then** the chat switches to terminal mode
**And** pressing ⌘⇧T again switches it back to message mode

#### Scenario: Shortcut does not fire on background chats

**Given** chat A is active and chat B is mounted in a background tab
**When** the user presses ⌘⇧T
**Then** chat A's mode toggles
**And** chat B's mode is unchanged

### Requirement: Terminal mode swaps the left pane and preserves the right IDE pane

The active view mode MUST control only the content of the left
(conversation) pane and the **input-bearing** elements at the bottom of
that pane. The right-side `RightPanel`, the resize divider, the collapse
chevron, and the ambient indicator bars (`GlobalHeartbeatBar`,
`GitStatusBar`) MUST render identically in both modes. The React input
surface (`InputArea`) and the React message queue (`QueuedMessagesBar`)
MUST be suppressed in terminal mode so xterm owns the keyboard and bytes
flow directly to the agent's underlying `claude` / `codex` PTY.

#### Scenario: Terminal mode renders `TerminalPanel` in the left pane

**Given** a chat is in terminal mode
**When** `ChatInstance` renders
**Then** `TerminalPanel` is the left-pane content (where `ChatBody`
would render in message mode)
**And** the left pane width is governed by the same `chatPanelStyle`
that controls width in message mode

#### Scenario: Right IDE pane stays mounted in terminal mode

**Given** a chat is in terminal mode and `hideRightPanel` is `false`
and `rightPanelMountNode` is `null`
**When** `ChatInstance` renders
**Then** the resize divider is rendered between the left and right panes
**And** the right pane mounts a `RightPanel` instance (Files / Editor /
Changes) just as it does in message mode
**And** the user can resize the divider and collapse the left pane via
the chevron with the same behaviour as message mode

#### Scenario: Terminal mode hides the React composer and queue

**Given** a chat is in terminal mode
**When** `ChatInstance` renders
**Then** `InputArea` is NOT rendered
**And** `QueuedMessagesBar` is NOT rendered
**And** `GlobalHeartbeatBar` and `GitStatusBar` continue to render below
the left pane as ambient indicators
**And** xterm is the only keyboard-input surface in the chat

#### Scenario: Toggling into terminal mode focuses the active agent's xterm

**Given** a chat is active (`isActive === true`), has at least one
running agent terminal, and is currently in message mode
**When** the user toggles to terminal mode (via the toolbar button or
`⌘⇧T`)
**Then** the active agent's `TerminalInstance.focus()` is called once
the panel has mounted
**And** subsequent keystrokes flow to the underlying CLI via
`expert:input`
**And** toggling back to message mode returns focus to `InputArea`

#### Scenario: Queue is preserved across mode switches

**Given** a chat in message mode has N (N > 0) pending queued messages
in `QueuedMessagesBar`
**When** the user toggles to terminal mode
**Then** the queued messages remain in memory (not flushed, not lost)
**And** a one-line non-modal notice is shown above
`GlobalHeartbeatBar` reading "N queued messages preserved — switch to
message view to send" (i18n key
`chat:chatViewMode.queuePreservedNotice`)
**And** toggling back to message mode re-renders `QueuedMessagesBar`
with the same entries

#### Scenario: First turn for an idle agent requires message mode

**Given** a chat is in terminal mode, no agent in the chat is currently
running, and no PTY exists yet
**When** `TerminalPanel` renders its empty state
**Then** the empty-state copy directs the user to switch to message view
to launch the agent (i18n keys
`chat:chatViewMode.firstTurnHintLocked` for `lockedAgentId` chats and
`chat:chatViewMode.firstTurnHintMulti` for multi-agent chats)
**And** the launch path (`expert:direct-input` with `autoStart: true`,
carrying cwd / repositories / model / system prompt) is NOT exposed in
terminal mode

#### Scenario: `hideRightPanel` and `rightPanelMountNode` semantics are unchanged

**Given** a Quad tile passes `hideRightPanel === true` (or a non-null
`rightPanelMountNode`) to its `ChatInstance`
**When** that instance is in terminal mode
**Then** the right-pane suppression / portal behaviour matches what
that instance would have done in message mode
**And** the chat-view-mode toggle does not introduce any new
right-pane rendering branch

### Requirement: Terminal mode in single-agent surfaces locks to that agent

Terminal mode MUST show only the locked agent's terminal and MUST NOT
expose multi-agent affordances when the chat is bound to a single agent
(Agent view via the agent query parameter, or a Quad tile via
`agentScopeOverride`).

#### Scenario: Tablist is hidden when locked

**Given** a chat is in terminal mode and `lockedAgentId` is non-null
**When** `TerminalPanel` renders
**Then** the per-agent tablist is hidden (only the single locked
agent's pane is visible)
**And** the layout-toggle button (Layers/Columns2) is hidden
**And** the reopen-hidden-experts menu is not rendered

#### Scenario: Empty-state copy reflects the locked agent

**Given** a chat is in terminal mode, locked to agent `growth-marketer`,
and that agent has not yet started any session
**When** `TerminalPanel` renders
**Then** the empty state shows "Waiting for growth-marketer to start…"
instead of the generic multi-agent hint

#### Scenario: Hide-handler is a no-op when locked

**Given** a chat is in terminal mode and `lockedAgentId` is non-null
**When** the user (somehow) triggers the hide-expert handler for the
locked agent
**Then** the handler does nothing
**And** the `cc:terminal:hidden:<chatId>` storage entry is not modified

### Requirement: Terminal mode bridges the agent to a resumed CLI PTY

The server MUST spawn a sibling resume-PTY keyed to `(connectionId, chatId, agentId)` when the user enters terminal mode for an agent that already has a CLI session, run `claude --resume <cliSessionId>` (or `qodercli --resume <cliSessionId>` for the `qoder` provider) in the agent's `cwd`, stream raw TUI bytes back to the client as `expert:data`, and consume web `expert:input` / `expert:resize` events in place of the ACP adapter so xterm keystrokes drive the underlying CLI directly. The original ACP stream-json process MUST continue to run unchanged so that handoff, orchestration, and scheduling stay on ACP.

#### Scenario: cli-attach spawns a resume-PTY for a running agent

**Given** a chat is in terminal mode with at least one running agent
**And** the agent has a recorded `cliSessionId` (live in
`SessionRegistry` or persisted in `ChatStore.expertSessions`) and a
valid `cwd`
**When** the web client sends `expert:cli-attach` with `{ chatId,
agentId, cols, rows }`
**Then** the server resolves the agent's provider (defaulting to
`claude`) and spawns a node-pty process for `claude --resume
<cliSessionId>` (or `qodercli --resume <cliSessionId>` for `qoder`) in
the agent's `cwd`
**And** the first chunk of `pty.onData` is delivered to the client as
`expert:data` with `snapshot: true` so xterm can clear and replay
**And** subsequent chunks stream as `expert:data` with `snapshot: false`

#### Scenario: expert:input is routed to the resume-PTY when one is attached

**Given** a view-PTY exists for `(connectionId, chatId, agentId)`
**When** the web client sends `expert:input` for that triple
**Then** the bytes are written directly to the view-PTY's stdin
**And** the ACP adapter does NOT receive the input
**And** when no view-PTY exists for the triple, `expert:input` falls
through to the existing ACP `acpClient.write` path unchanged

#### Scenario: expert:resize is forwarded to the resume-PTY when attached

**Given** a view-PTY exists for `(connectionId, chatId, agentId)`
**When** the web client sends `expert:resize` with new `cols` / `rows`
**Then** `pty.resize(cols, rows)` is called on the view-PTY
**And** the cached size is updated so subsequent `expert:data` frames
carry the new `ptySize`

#### Scenario: cli-detach kills the resume-PTY

**Given** a view-PTY is active for `(connectionId, chatId, agentId)`
**When** the web client sends `expert:cli-detach` for that triple
(emitted on toggle back to message mode, or on `TerminalPanel`
unmount)
**Then** the server kills the node-pty process and removes the entry
from the view-PTY map
**And** subsequent `expert:input` for that triple falls back to the ACP
adapter

#### Scenario: WS disconnect cleans up all view-PTYs for the connection

**Given** one or more view-PTYs are active under a WebSocket
connection
**When** that WebSocket disconnects
**Then** every view-PTY whose `connectionId` matches is killed
**And** the view-PTY map is purged of those entries
**And** the original ACP processes continue to run (handoff /
orchestration / scheduling remain available)

#### Scenario: Unsupported provider returns expert:error

**Given** a chat's agent uses a provider whose CLI does not yet expose
a `--resume` command (currently `codex`)
**When** the web client sends `expert:cli-attach` for that agent
**Then** the server emits `expert:error` with `error:
"terminal_view_unsupported_provider"` and a message naming the
provider
**And** no view-PTY is created
**And** the web client displays a "switch to message view" empty-state
hint for that agent

#### Scenario: View-PTY exit emits expert:exit

**Given** a view-PTY is active for `(connectionId, chatId, agentId)`
**When** the user quits the CLI inside xterm (or the process crashes
or receives a hangup)
**Then** the server emits `expert:exit` with `{ chatId, agentId,
exitCode }`
**And** the entry is removed from the view-PTY map
**And** the original ACP process continues to run unchanged

#### Scenario: Missing CLI session id returns expert:error

**Given** the user enters terminal mode for a chat whose agent has
never been launched (no `cliSessionId` in `SessionRegistry` or
`ChatStore.expertSessions`)
**When** the web client sends `expert:cli-attach`
**Then** the server emits `expert:error` with `error:
"terminal_view_unavailable"` and a message instructing the user to
launch the agent in message view first
**And** no view-PTY is created

### Requirement: Message mode is unchanged from the pre-change baseline

Switching back to message mode MUST restore the pre-change visual and
behavioural baseline of the left pane.

#### Scenario: Message mode still renders the existing message stream

**Given** a chat is in message mode
**When** `ChatInstance` renders
**Then** `MessageToolbar` (when applicable), `ChatBody`, and
`PlanCard` (when applicable) all render in their pre-change positions
**And** the IDE divider and `RightPanel` render to the right of the
left pane unchanged
**And** `ChatHeader` renders exactly as it did before this change
(no new toggle inside the header)

#### Scenario: Toggling away and back preserves Virtuoso scroll behaviour

**Given** a chat is in message mode and Virtuoso has scrolled to the
latest user turn
**When** the user toggles to terminal mode and immediately back to
message mode
**Then** the message stream's `viewKey` is unchanged
**And** Virtuoso re-mounts with `initialTopMostItemIndex={ index: 'LAST' }`
so the latest turn is visible
