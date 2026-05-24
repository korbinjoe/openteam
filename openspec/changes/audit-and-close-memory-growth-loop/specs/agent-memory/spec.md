# Capability: Agent cross-session memory capture

The system SHALL automatically mirror durable war-room signals (decisions, constraints, resolved open questions) authored by an agent into that agent's cross-session memory store, so the next session for the same agent receives them through the existing `Cross-Session Memory` prompt injection.

## ADDED Requirements

### Requirement: Mirror decisions and constraints into agent memory

The system SHALL, when an agent writes a whiteboard entry of type `decision` or `constraint`, create exactly one `AgentMemory` row for the authoring agent containing the entry summary.

#### Scenario: Decision entry creates a memory row

- **Given** agent `architect` is active in chat `c-1`
- **And** the chat's war-room has no entry with id `e-1`
- **When** the agent calls `wb-write.sh decision "use sqlite for memory store"` and the server assigns `entry.id = e-1`
- **Then** `MemoryStore.listByAgent('architect')` contains exactly one row where `source === 'wb:c-1:e-1'`
- **And** that row's `category === 'context'`
- **And** that row's `importance === 2`
- **And** that row's `chatId === 'c-1'`

#### Scenario: Constraint entry uses higher importance

- **Given** the same setup
- **When** the agent writes a `constraint` entry with id `e-2`
- **Then** the created row's `importance === 3`
- **And** the row's `category === 'context'`

#### Scenario: Idempotent on re-emission

- **Given** the system has already mirrored entry `e-1` into a memory row
- **When** the same entry is observed again (e.g. on server restart replaying `entries.jsonl`)
- **Then** no new memory row is created
- **And** `MemoryStore.listByAgent('architect')` still contains exactly one row with `source === 'wb:c-1:e-1'`

#### Scenario: Unknown author is skipped

- **Given** a whiteboard entry whose `by` field does not match any agent registered in `AgentRegistry`
- **When** the entry is observed
- **Then** no memory row is created
- **And** the server logs a debug-level skip message

### Requirement: Mirror resolved open questions as feedback

The system SHALL, when an `open_question` whiteboard entry transitions from `active` to `archived`, create one `AgentMemory` row for the entry's original author with `category='feedback'`.

#### Scenario: Archiving an open question creates a feedback memory

- **Given** agent `architect` wrote an `open_question` with id `e-3` in chat `c-1`
- **And** the system has not yet mirrored it as feedback
- **When** the entry is archived via `wb-archive.sh e-3`
- **Then** `MemoryStore.listByAgent('architect')` contains a row where `source === 'wb:c-1:e-3:archived'`
- **And** that row's `category === 'feedback'`
- **And** that row's `importance === 2`

#### Scenario: Active open question is not mirrored as feedback

- **Given** an `open_question` entry that has never been archived
- **When** it is observed by the capture service
- **Then** no `feedback` memory row is created
- **And** no `context` memory row is created (only `decision` / `constraint` map to context)

### Requirement: Memory dedup index survives restart

The system SHALL ensure that the dedup index (mapping `(agentId, source) → exists`) is rebuilt at process boot from the persisted `agent_memories` table, so a restart does not produce duplicate rows when historical signals are replayed.

#### Scenario: Restart preserves dedup

- **Given** `MemoryStore` contains a row with `agent_id='architect'` and `source='wb:c-1:e-1'`
- **And** the server process restarts
- **When** the whiteboard replays entry `e-1` during boot
- **Then** no new row is created
- **And** `MemoryStore.listByAgent('architect')` returns the original row unchanged

### Requirement: Agent workspace memory directory exists

The system SHALL create `<workspaceDir>/memory/` for every registered agent during workspace seeding, so the per-day log file path documented in the system prompt (`memory/YYYY-MM-DD.md`) is writable on first use.

#### Scenario: Seeding creates memory directory

- **Given** agent `architect` has no `~/.openteam/agents/architect/memory/` directory
- **When** the server completes its workspace seeding pass at boot
- **Then** the directory `~/.openteam/agents/architect/memory/` exists
- **And** the directory is empty (no template file is created)
