# Capability: Agent growth tracking from task lifecycle

The system SHALL automatically increment an agent's growth metrics in response to task lifecycle events emitted via the mailbox protocol, so the existing `GrowthStore` and its REST surface (`GET /api/agents/:id/growth`) reflect real activity without manual operator input.

## ADDED Requirements

### Requirement: Task completion increments the agent's task counter

The system SHALL, when a `task:completed` mailbox event is received for an agent, increment that agent's `tasks_completed` metric by 1 and recompute the metric's `level` against the existing `LEVEL_THRESHOLDS` table.

#### Scenario: First completed task creates the metric row

- **Given** agent `fullstack-product-engineer` has no `agent_growth` row for metric `tasks_completed`
- **When** the server receives a `task:completed` mailbox event with `from='fullstack-product-engineer'` and `taskId='t-1'`
- **Then** `GrowthStore.getMetric('fullstack-product-engineer', 'tasks_completed').value === 1`
- **And** the same metric's `level === 1`

#### Scenario: Crossing a level threshold updates level

- **Given** agent `fullstack-product-engineer` has `tasks_completed.value === 9` and `level === 1`
- **When** the server receives another `task:completed` event for that agent
- **Then** `tasks_completed.value === 10`
- **And** `level === 2`

#### Scenario: Failure does not increment in Phase 1

- **Given** agent `fullstack-product-engineer` has `tasks_completed.value === 5`
- **When** the server receives a `task:failed` mailbox event for that agent
- **Then** `tasks_completed.value` is unchanged at 5
- **And** no other growth metric is incremented

### Requirement: Increment is idempotent per task id

The system SHALL ensure that a duplicate `task:completed` mailbox event with the same `(from, taskId)` does not double-count the metric.

#### Scenario: Replayed task:completed is ignored

- **Given** the server has already processed `task:completed` with `from='architect'` and `taskId='t-7'`
- **And** `GrowthStore.getMetric('architect', 'tasks_completed').value === N`
- **When** the same `task:completed` event is replayed (e.g. on mailbox re-read after restart)
- **Then** `tasks_completed.value` remains `N`

### Requirement: Increment writes do not break existing REST surface

The system SHALL keep `POST /api/agents/:id/growth/:metric` operational alongside the automatic incrementer; manual and automatic writes share the same store and accumulate.

#### Scenario: Manual POST after auto-capture accumulates

- **Given** the auto-capture has set `architect.tasks_completed.value === 3`
- **When** a client issues `POST /api/agents/architect/growth/tasks_completed` with `{"amount": 5}`
- **Then** `tasks_completed.value === 8`
- **And** `level === 1`
