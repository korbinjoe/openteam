# Capability: Agent Episodic Memory

A per-Agent index of completed task trajectories, built on the existing `~/.openteam/tasks/{taskId}/{plan,result}.md` substrate. Provides pre-task lookup so Experts begin with context from prior similar tasks, closing the missing "episodic" tier in OpenTeam's memory layering (CoALA taxonomy: working / episodic / semantic / procedural — OpenTeam previously had only the last three). No vector DB; BM25 over title+summary+tags is sufficient at current corpus sizes.

## ADDED Requirements

### Requirement: Episodic Tasks Index Table

The system SHALL add a new SQLite table `episodic_tasks` via migration `v22`, with the following columns: `id` (taskId, PRIMARY KEY), `agent_id`, `chat_id`, `title`, `summary`, `outcome` (`completed | failed | canceled`), `tags` (JSON array), `tokens_used`, `usd_cost`, `duration_ms`, `created_at`, `completed_at`. Indices on `(agent_id, completed_at DESC)` and `(agent_id, outcome)`.

#### Scenario: Migration applies cleanly

- **Given** a database at schema version `v21`
- **When** the server starts
- **Then** migration `v22` runs and creates `episodic_tasks`
- **And** the schema version advances to `v22`
- **And** no existing tables are altered

#### Scenario: Per-agent isolation

- **Given** two Agents `architect` and `code-reviewer` each complete one task
- **When** rows are inserted
- **Then** each row carries the correct `agent_id`
- **And** queries scoped to `agent_id = "architect"` return only that Agent's tasks

---

### Requirement: Recording Task Completion

When a task reaches a terminal state (`completed | failed | canceled`), the system SHALL parse `~/.openteam/tasks/{taskId}/result.md` (extracting the `## Summary` section if present), gather token usage from `ExpertTokenTracker`, and insert a row into `episodic_tasks`. Recording is best-effort: an exception during recording SHALL be logged but SHALL NOT block the task-completion code path.

#### Scenario: Successful task is recorded

- **Given** an Expert completes a task with `taskId = "T-123"` and writes `result.md` with `## Summary\nFixed SSE filter bug`
- **When** the task-complete code path fires
- **Then** an `episodic_tasks` row is inserted with `outcome = "completed"`, `summary = "Fixed SSE filter bug"`, `agent_id` set to the Expert's id
- **And** `tokens_used` and `usd_cost` are populated from the token tracker

#### Scenario: Failed task is recorded for negative examples

- **Given** a task ends in `task:failed` with `failureReason = "no-heartbeat-timeout"`
- **When** the task-failed code path fires
- **Then** an `episodic_tasks` row is inserted with `outcome = "failed"`
- **And** the `summary` field captures the `failureReason`

#### Scenario: Recording failure does not block completion

- **Given** the `episodic_tasks` insert throws (e.g., disk full)
- **When** the task-complete code path runs
- **Then** the exception is logged
- **And** the `task:completed` mailbox message is still emitted normally

---

### Requirement: Pre-Task Similar-Tasks Lookup

The system SHALL provide an `EpisodicMemoryIndex.lookup(agentId, queryText, limit=3)` API returning the top-N prior `episodic_tasks` rows for that Agent matching `queryText`, ranked by BM25 over `title + summary + tags` and weighted toward `outcome = "completed"` and recency. Rows older than 90 days SHALL be deprioritized but not excluded.

#### Scenario: Lookup returns top matches

- **Given** Agent `fullstack-product-engineer` has 20 completed tasks indexed
- **And** the new task title is "Fix WebSocket reconnect race"
- **When** `lookup("fullstack-product-engineer", "Fix WebSocket reconnect race", 3)` is called
- **Then** the top 3 matching prior tasks are returned
- **And** completed tasks rank above failed ones for the same score
- **And** more recent tasks rank above older ones for the same score

#### Scenario: Cross-Agent reads are forbidden

- **Given** Agent `architect` calls `lookup("architect", ...)`
- **When** the index is queried
- **Then** only rows with `agent_id = "architect"` are considered
- **And** the API SHALL NOT expose a cross-Agent variant

---

### Requirement: Plan.md Augmentation Hook

When `ExecutionPlanManager.createPlan` generates a new task's `plan.md`, the system SHALL prepend a `## Prior similar tasks` section listing up to 3 results from `EpisodicMemoryIndex.lookup`. Each entry SHALL include taskId, completion date, outcome, and the one-line summary. If no prior tasks match, the section is omitted (not rendered as empty).

#### Scenario: Plan includes prior task summaries

- **Given** Agent `architect` is dispatched a new task
- **And** `lookup` returns 2 matching prior tasks
- **When** `createPlan` runs
- **Then** `plan.md` begins with `## Prior similar tasks` followed by 2 entries
- **And** each entry shows `[taskId] (YYYY-MM-DD, completed) — <summary>`
- **And** the original plan template content follows

#### Scenario: No matches omits the section

- **Given** `lookup` returns an empty result set
- **When** `createPlan` runs
- **Then** `plan.md` does NOT contain a `## Prior similar tasks` section
- **And** the plan template renders unchanged

---

### Requirement: Opt-Out Flag

The system SHALL respect environment variable `OPENTEAM_DISABLE_EPISODIC=1`. When set, the recording hook is a no-op and `lookup` returns an empty array. Documented in README troubleshooting.

#### Scenario: Opt-out disables recording

- **Given** the server runs with `OPENTEAM_DISABLE_EPISODIC=1`
- **When** a task completes
- **Then** no row is inserted into `episodic_tasks`
- **And** the task-complete flow otherwise behaves identically

#### Scenario: Opt-out disables lookup

- **Given** the server runs with `OPENTEAM_DISABLE_EPISODIC=1`
- **When** `createPlan` runs
- **Then** `lookup` returns an empty result set
- **And** `plan.md` omits the `## Prior similar tasks` section
