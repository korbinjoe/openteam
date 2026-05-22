# Spec Delta: Chat Members (new capability)

## ADDED Requirements

### Requirement: Per-member status on Chat

Every `Chat` returned by the server MUST include a `members: ChatMember[]` field with one entry per agent participating in the task.

Each `ChatMember` MUST carry:

- `agentId` — stable agent identifier
- `role` — `'lead' | 'worker'`
- `status` — `'running' | 'waiting' | 'error' | 'idle' | 'done'`
- `lastMessageAt` — ISO timestamp, falling back to `chat.lastMessageAt` when no per-member events exist
- `lastMessage` — optional preview, truncated to ≤120 characters
- `cliSessionId` — optional, present once the agent has started

The members array MUST be ordered: lead first, then workers in `teamAgentIds` order.

#### Scenario: Server derives members from expert sessions

**Given** a chat with `primaryAgentId='lead-agent'` and `teamAgentIds=['worker-1', 'worker-2']`
**And** `expertSessions['lead-agent'].cliSessionId='abc'`, `expertSessions['worker-1'].cliSessionId='def'`
**When** the client requests the chat via `getChat()` or `getChatsByWorkspace()`
**Then** the returned `Chat.members` contains 3 entries
**And** `members[0]` has `agentId='lead-agent'` and `role='lead'`
**And** `members[1]` has `agentId='worker-1'` and `role='worker'`
**And** worker-2 (no cliSessionId yet) still appears with `status='idle'` and no `cliSessionId`

#### Scenario: Member status derived from JSONL tail

**Given** the lead agent's JSONL session file ends with a tool-error event
**When** the member aggregator reads the tail
**Then** `members[0].status` is `'error'`
**And** `members[0].lastMessageAt` matches the timestamp of the last JSONL event
**And** `members[0].lastMessage` contains a ≤120-char preview of the last message

### Requirement: Rolled-up chat status preserved for backward compatibility

The existing `chat.status` and `chat.taskStatus` fields MUST remain populated as the worst-of priority across `members[].status`. The priority order is `error > waiting > running > done > idle`.

#### Scenario: Worst-of rollup

**Given** members with statuses `['running', 'waiting', 'running']`
**When** the chat is serialized
**Then** `chat.status` is `'waiting'`

**Given** members with statuses `['error', 'done', 'running']`
**When** the chat is serialized
**Then** `chat.status` is `'error'`

### Requirement: Member-state updates pushed over WebSocket

When the `SessionFileWatcher` detects a JSONL change for a known `cliSessionId`, the server MUST invalidate the member aggregator cache for that session and emit the existing `chat:updated` event carrying the refreshed `members[]`.

#### Scenario: Live status refresh

**Given** the client is subscribed to a chat with a running agent
**When** a new tool-error event is appended to that agent's JSONL file
**Then** within one debounce window the server emits `chat:updated`
**And** the payload's `members[]` reflects the updated `status='error'`

### Requirement: Member aggregator cache

The `MemberAggregator` service MUST cache derived member state with an LRU keyed by `(cliSessionId, fileMTime)` to avoid re-parsing JSONL on every chat read.

#### Scenario: Cache hit on repeat read

**Given** a chat's member aggregation was computed once
**When** the chat is read again with no JSONL file change
**Then** the cached members array is returned without re-parsing

## Related Capabilities

- [task-navigation](../task-navigation/spec.md) — Sidebar consumes `members[]` for per-agent status dots
- [workspace-area](../workspace-area/spec.md) — Toolbar sibling dots consume `members[]`
- [agent-orchestration](../agent-orchestration/spec.md) — Task overview and group chat consume `members[]`
