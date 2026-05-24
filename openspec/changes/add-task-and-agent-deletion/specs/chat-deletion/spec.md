# Capability: Chat and Agent-session Deletion

The system SHALL allow users to hard-delete a task (chat) and remove individual agent sessions from a chat, including the local CLI JSONL files associated with those sessions.

## ADDED Requirements

### Requirement: Task hard-delete purges associated JSONL files

The system SHALL, when deleting a chat with explicit purge intent, also unlink the local CLI JSONL file for every expert session referenced by that chat.

#### Scenario: Multi-agent task delete removes every JSONL

- **Given** a chat has two expert sessions, one for a Claude provider and one for a Codex provider
- **When** the client issues `DELETE /api/chats/:id?purgeJsonl=1`
- **Then** the chat record is removed from SQLite
- **And** the Claude JSONL at `~/.claude/projects/<projectKey>/<cliSessionId>.jsonl` is unlinked
- **And** the Codex rollout JSONL located via `locateCodexRollout(threadId)` is unlinked
- **And** the response body includes `purged: [{ agentId, path, deleted: true }, ...]`

#### Scenario: Missing JSONL is treated as already-purged

- **Given** a chat's expert session references a JSONL path that does not exist on disk
- **When** the chat is deleted with `purgeJsonl=1`
- **Then** the chat record is still removed
- **And** that session's purge entry has `deleted: false` with no error
- **And** the overall response is HTTP 200

#### Scenario: Backwards-compatible default

- **Given** a client calls `DELETE /api/chats/:id` without `purgeJsonl`
- **When** the request is processed
- **Then** the chat record and worktrees are removed (current behavior preserved)
- **And** no JSONL files are touched

#### Scenario: Refuse purge on running chat

- **Given** a chat has `status === 'running'`
- **When** the client issues `DELETE /api/chats/:id?purgeJsonl=1`
- **Then** the server responds with HTTP 409
- **And** the chat record and JSONL files are unchanged

---

### Requirement: Per-agent session removal

The system SHALL provide an endpoint to remove a single agent's expert session from a chat, including its JSONL file, without affecting other agents in the same chat or the agent's global definition.

#### Scenario: Remove worker agent from a chat

- **Given** a chat has expert sessions for agent `lead` and agent `worker-a`
- **When** the client issues `DELETE /api/chats/:id/sessions/worker-a`
- **Then** the chat's `expertSessions` map no longer contains key `worker-a`
- **And** the JSONL file for `worker-a`'s `cliSessionId` is unlinked
- **And** the chat row remains in SQLite
- **And** the agent definition `worker-a` in the agents table is unchanged
- **And** other chats that reference `worker-a` are unchanged

#### Scenario: Refuse to remove a running session

- **Given** an agent's expert session has a derived member status of `running`
- **When** the client issues `DELETE /api/chats/:id/sessions/:agentId`
- **Then** the server responds with HTTP 409
- **And** the chat is unchanged

#### Scenario: Idempotent re-deletion

- **Given** a chat has no expert session for agent `worker-a`
- **When** the client issues `DELETE /api/chats/:id/sessions/worker-a`
- **Then** the server responds with HTTP 404
- **And** no other state changes

---

### Requirement: JSONL path safety

The system SHALL validate every JSONL file path against allowed prefixes before unlinking and SHALL refuse to follow symlinks.

#### Scenario: Path outside allowed prefixes is rejected

- **Given** a session's resolved JSONL path normalizes to a location outside `~/.claude/projects/` and `~/.codex/sessions/`
- **When** the purger is invoked for that session
- **Then** no `unlink` call is issued for that path
- **And** the purge entry returns `deleted: false` with an explanatory error

#### Scenario: Symlinks are not followed

- **Given** a JSONL path resolves to a symlink
- **When** the purger checks the path via `lstat`
- **Then** the purger refuses to unlink and returns `deleted: false` with an explanatory error

---

### Requirement: UI surfacing of destructive action

The web UI SHALL communicate the additional file deletion before the user confirms a task delete, and SHALL provide a per-agent remove control in the sidebar.

#### Scenario: ChatHistoryPage confirm dialog

- **Given** a user clicks delete on a chat row that has N expert sessions
- **When** the confirmation dialog renders
- **Then** the dialog body includes the line "Also delete N local CLI session files (cannot be undone)"
- **And** confirming the dialog issues `DELETE /api/chats/:id?purgeJsonl=1`

#### Scenario: Sidebar per-agent remove respects guards

- **Given** a chat row is expanded in the sidebar showing agent rows
- **When** the user hovers over a worker agent row
- **Then** a "Remove from task" trash button is visible
- **And** the button is disabled when the agent is the chat's `primaryAgentId`
- **And** the button is disabled when that member's status is `running`

#### Scenario: Partial purge failure surfaces a toast

- **Given** the server response includes one or more `purged` entries with `deleted: false` and a non-null error
- **When** the UI processes the delete result
- **Then** a non-blocking toast lists the failing paths so the user can manually inspect
