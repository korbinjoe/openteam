# Capability: Agent Cost Ledger and Budget Guardrail

A per-task token/cost budget with soft-warn at 75% and hard-pause at 100%, plus a running per-Expert cost line surfaced through `team-status.sh` and the UI. Directly addresses the attention-pain findings in `AI超级个体工作痛点调研.md` (痛点 B: Token/cost anxiety, with documented \$1,400 Cursor and \$3,167 Flutter incidents). Not a tool firewall (Aegis-style) — that is a separate, larger capability deferred.

## ADDED Requirements

### Requirement: Task Budget Envelope

The `TaskEnvelope` SHALL support an optional `budget` block: `{ maxInputTokens?, maxOutputTokens?, maxUsd? }`. All three fields SHALL be optional; when `budget` is omitted entirely or all fields are null, the task runs unbounded (current behavior). Budgets are per-task, not per-Agent.

#### Scenario: Dispatch with token budget

- **Given** the Lead calls `start-expert.sh --budget tokens=50000`
- **When** the `TaskEnvelope` is constructed
- **Then** `envelope.budget.maxInputTokens + envelope.budget.maxOutputTokens` equals `50000` (or `maxInputTokens` alone if only input is bounded)
- **And** the Expert receives the envelope with the budget intact

#### Scenario: Dispatch without budget runs unbounded

- **Given** the Lead calls `start-expert.sh` with no `--budget` flag
- **When** the `TaskEnvelope` is constructed
- **Then** `envelope.budget` is undefined (or all fields null)
- **And** the budget tracker treats the task as unlimited

---

### Requirement: Soft Warning at 75% Consumption

When a budgeted task's cumulative consumption reaches 75% of any defined limit (`maxInputTokens`, `maxOutputTokens`, or `maxUsd`), the system SHALL emit a `task:warning` message with `kind: "budget"` and a `detail` field describing which limit and current consumption. The warning SHALL fire exactly once per limit per task.

#### Scenario: Token warning at 75%

- **Given** a task with `maxInputTokens = 40000`
- **When** cumulative input token usage crosses 30000 (75%)
- **Then** a `task:warning` message is emitted with `kind: "budget"` and `detail` including `{ limit: "maxInputTokens", used: 30000, max: 40000 }`
- **And** subsequent token consumption below 100% does NOT emit additional warnings

#### Scenario: USD warning fires independently

- **Given** a task with both `maxInputTokens = 40000` and `maxUsd = 5.0`
- **When** USD consumption crosses \$3.75 (75% of \$5)
- **Then** a separate `task:warning` with `detail.limit = "maxUsd"` is emitted
- **And** the token-limit warning may fire separately when its threshold is crossed

---

### Requirement: Hard Pause at 100% Consumption

When a budgeted task's cumulative consumption reaches 100% of any defined limit, the system SHALL pause the Expert and emit `task:input-required` with `kind: "budget_exceeded"`, asking the Lead/user to either extend the budget (with a new envelope) or cancel the task. The Expert SHALL NOT continue consuming the model until a response arrives.

#### Scenario: Token limit pauses Expert

- **Given** a task with `maxInputTokens = 40000`
- **When** cumulative input token usage reaches 40000
- **Then** the Expert is paused (no further model calls)
- **And** a `task:input-required` message is emitted with `kind: "budget_exceeded"` and detail of the breached limit
- **And** the task state is `input-required`

#### Scenario: Extension resumes Expert

- **Given** an Expert is paused on `budget_exceeded`
- **When** the Lead responds with an extended budget (new `maxInputTokens = 60000`)
- **Then** the Expert resumes work with the updated budget
- **And** the next warning threshold is calculated against the new max

#### Scenario: Cancellation terminates Expert

- **Given** an Expert is paused on `budget_exceeded`
- **When** the Lead responds with `task:canceled`
- **Then** the Expert terminates the task
- **And** the lifecycle ends in `canceled`

---

### Requirement: No False Positives Without Budget

When `envelope.budget` is undefined or all fields are null, the `TaskBudgetTracker` SHALL NOT emit any `task:warning` or `task:input-required` messages of `kind: "budget"`. Unbounded tasks behave exactly as they do today.

#### Scenario: Unbounded task emits no budget events

- **Given** a task dispatched without `--budget`
- **When** the Expert consumes 1,000,000 input tokens
- **Then** no `task:warning` with `kind: "budget"` is emitted
- **And** no `task:input-required` with `kind: "budget_exceeded"` is emitted

---

### Requirement: Cost Line in Team Status

The `team-status.sh` JSON output (from `expertHandler.getTeamStatus`) SHALL include a `cost` block per Expert: `{ tokensUsed, tokensBudget?, usdEstimate }`. `tokensBudget` is omitted when the task is unbounded. The UI task list SHALL surface a running cost line (one column or sub-row) per Expert.

#### Scenario: Status JSON exposes cost

- **Given** an Expert has consumed 12,000 input + 3,000 output tokens
- **And** USD estimate is \$0.18
- **When** `team-status.sh` is invoked
- **Then** the JSON includes `cost: { tokensUsed: 15000, usdEstimate: 0.18 }` for that Expert
- **And** if a budget exists, `tokensBudget` is also populated

#### Scenario: UI shows running cost

- **Given** a UI task list with three running Experts
- **When** the cost block updates over time
- **Then** each Expert row shows its current `tokensUsed` and `usdEstimate`
- **And** Experts with a budget show a progress indicator (e.g., `15000 / 40000`)
- **And** Experts without a budget show only the absolute number

---

### Requirement: Budget Syntax Documentation

The `expert-dispatcher/SKILL.md` SHALL document the `--budget` flag for `start-expert.sh`, including syntax (`--budget tokens=50000`, `--budget usd=5.0`, combined), default behavior (unbounded), and the warn/pause thresholds.

#### Scenario: Skill documentation includes budget syntax

- **Given** an Agent reads `expert-dispatcher/SKILL.md`
- **When** the Agent encounters the `start-expert.sh` section
- **Then** the doc shows the `--budget` flag with at least one tokens example and one USD example
- **And** the doc states the 75% warn / 100% pause behavior
