# Capability: Agent evolution feed

The system SHALL expose a unified per-agent evolution feed derived from the existing `MemoryStore` and `GrowthStore`, so the existing `EvolutionLog` UI surface has a data source without introducing a separate `evolution_events` table.

## ADDED Requirements

### Requirement: GET endpoint returns derived evolution entries

The system SHALL provide `GET /api/agents/:id/evolution` returning a JSON array of `EvolutionEntry` objects derived from the agent's current `MemoryStore` and `GrowthStore` state.

#### Scenario: Memory rows surface as memory_updated entries

- **Given** agent `architect` has 3 rows in `agent_memories`
- **When** a client issues `GET /api/agents/architect/evolution`
- **Then** the response contains exactly 3 entries of `type === 'memory_updated'`
- **And** each entry's `description` is the memory's `content` truncated to 160 characters
- **And** each entry's `timestamp` equals the memory's `updatedAt`

#### Scenario: Crossed growth threshold surfaces as milestone

- **Given** agent `architect` has a `tasks_completed` growth row with `value === 12` and `level === 2`
- **When** the client issues `GET /api/agents/architect/evolution`
- **Then** the response contains one entry of `type === 'milestone'` with `title` containing `"level 2"` and `"tasks_completed"`

#### Scenario: Pre-threshold growth does not surface

- **Given** agent `architect` has only a `tasks_completed` row with `level === 1`
- **When** the client issues `GET /api/agents/architect/evolution`
- **Then** the response contains no entry of `type === 'milestone'`

### Requirement: Feed is sorted and capped

The system SHALL sort the returned entries by `timestamp` descending and cap the response at 100 entries.

#### Scenario: Newest entry first

- **Given** the feed would produce entries with timestamps `[T1, T2, T3]` where `T1 < T2 < T3`
- **When** the client issues `GET /api/agents/architect/evolution`
- **Then** the response order is `[T3, T2, T1]`

#### Scenario: Cap at 100

- **Given** the feed would produce 250 raw entries before capping
- **When** the client issues `GET /api/agents/architect/evolution`
- **Then** the response contains exactly 100 entries
- **And** the 100 entries are the newest 100 by `timestamp`

### Requirement: Empty feed returns empty array, not 404

The system SHALL return an empty JSON array (HTTP 200) when an agent has no memory rows and no growth rows above the first level threshold.

#### Scenario: New agent has empty feed

- **Given** agent `growth-marketer` has never had any memory or growth rows written
- **When** the client issues `GET /api/agents/growth-marketer/evolution`
- **Then** the response status is 200
- **And** the response body is `[]`
