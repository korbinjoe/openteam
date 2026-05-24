# Capability: Agent Messaging Protocol

The inter-agent message protocol used over the file-based mailbox (`~/.openteam/mailbox/{chatId}/{from}→{to}.jsonl`) and the SSE event stream (`/api/expert/events`). This capability hardens the existing protocol: canonical state names aligned with A2A/ACP, a state alias layer for backward compatibility, two bug fixes in the SSE filter and event delivery, and a documented state machine.

## ADDED Requirements

### Requirement: Canonical Task Message Types

The system SHALL define the following canonical `task:*` message types, matching A2A/ACP terminology:

| Type | Direction | Required payload |
|---|---|---|
| `task:submitted` | Lead → Expert | `TaskEnvelope` |
| `task:accepted` | Expert → Lead | `{ taskId }` |
| `task:working` | Expert → Lead | `{ taskId, phase, milestone?, blocked? }` |
| `task:input-required` | Expert → Lead | `{ taskId, question, options? }` |
| `task:warning` | Expert → Lead | `{ taskId, kind, detail }` |
| `task:completed` | Expert → Lead | `{ taskId, summary, artifacts? }` |
| `task:failed` | Expert → Lead | `{ taskId, failureReason, recoverable? }` |
| `task:canceled` | Lead → Expert | `{ taskId, reason }` |

The previous types `task:progress`, `task:milestone`, `task:blocked`, `task:idle`, `task:assign`, `task:input_required` SHALL be REMOVED from the canonical set (see alias layer below for backward compatibility).

#### Scenario: Producer emits canonical type

- **Given** an Expert reaches a milestone
- **When** it writes a progress update
- **Then** it SHALL emit `task:working` with a `milestone` field
- **And** it SHALL NOT emit a separate `task:milestone` message

#### Scenario: Consumer parses canonical type

- **Given** a `task:input-required` message arrives at the Lead's mailbox
- **When** `check-inbox.sh` renders the inbox
- **Then** the message is displayed as awaiting Lead input
- **And** the SSE stream forwards the event to UI subscribers

---

### Requirement: Backward-Compatible State Alias Layer

The system SHALL accept legacy message types as aliases for one release cycle. The alias table:

| Legacy | Canonical |
|---|---|
| `task:assign` | `task:submitted` |
| `task:progress` | `task:working` |
| `task:milestone` | `task:working` with `milestone` field |
| `task:blocked` (waiting on user) | `task:input-required` |
| `task:blocked` (waiting on dependency) | `task:working` with `blocked: true` |
| `task:idle` | `task:working` with empty `phase` |
| `task:input_required` | `task:input-required` |

`MailboxManager.writeMessage` SHALL normalize legacy aliases to canonical types on write and emit a deprecation warning exactly once per process per legacy type.

#### Scenario: Legacy type normalized on write

- **Given** an Agent emits `task:progress` via `send-to-expert.sh`
- **When** `MailboxManager.writeMessage` processes the message
- **Then** the persisted JSONL line uses `type=task:working`
- **And** a deprecation warning is logged with the source and the canonical replacement
- **And** subsequent writes of `task:progress` in the same process do NOT re-warn

#### Scenario: Reader recognizes both during transition

- **Given** an inbox file contains both `task:progress` (legacy) and `task:working` (canonical) lines from older runs
- **When** `check-inbox.sh` reads the inbox
- **Then** both are displayed as "working" entries
- **And** the canonical form is preferred in any aggregated view

---

### Requirement: SSE Filter Forwards Full Canonical Set

The `/api/expert/events` SSE endpoint SHALL forward all canonical `task:*` types (`submitted`, `accepted`, `working`, `input-required`, `warning`, `completed`, `failed`, `canceled`), not only the current subset (`input_required | completed | failed`). The endpoint SHALL also continue forwarding `expert:phase` and other non-task events.

#### Scenario: Warning event reaches UI

- **Given** an Expert emits `task:warning` with `kind: "budget"`
- **When** a UI client subscribed to `/api/expert/events` receives the stream
- **Then** the `task:warning` event SHALL be delivered to the client
- **And** the existing behavior for `task:completed | task:failed | task:input-required` is preserved

#### Scenario: Working heartbeat reaches UI

- **Given** an Expert emits `task:working` every 60 seconds
- **When** a UI client is subscribed
- **Then** each `task:working` event is forwarded
- **And** the UI can use it to refresh the per-task status row

---

### Requirement: Missing-WebSocket Event Buffer

When `getConnectionWs` returns undefined at the moment an `expert:data` (or any per-instance) event is produced, the system SHALL buffer the event in memory keyed by `instanceId` instead of silently dropping it. On the next WebSocket attach for that `instanceId`, buffered events SHALL be replayed in original order before live events resume. The buffer SHALL cap at 1 MB per instance; on overflow the oldest events are dropped with a logged warning.

#### Scenario: Late-attaching WebSocket replays buffered events

- **Given** an Expert produces 10 `expert:data` events between t=0 and t=2s
- **And** no WebSocket is attached during that window
- **When** a WebSocket attaches at t=3s for the same `instanceId`
- **Then** the 10 buffered events are delivered before any new live event
- **And** the order matches the production order

#### Scenario: Buffer overflow drops oldest

- **Given** an Expert produces events totaling >1 MB while no WS is attached
- **When** the buffer would exceed 1 MB
- **Then** the oldest events are dropped to make room
- **And** a `warning` log line records `instanceId`, dropped byte count, and `kind: "buffer-overflow"`

---

### Requirement: Mailbox Path and Format Stability

The mailbox file path `~/.openteam/mailbox/{chatId}/{from}→{to}.jsonl` and the logfmt JSONL line format SHALL remain stable. This proposal does NOT change the transport, the serializer, or the byte-cursor read API. The only mailbox change is the canonical type set in the `type=` field plus the alias normalization on write.

#### Scenario: Existing consumers continue to work

- **Given** an external script reads `~/.openteam/mailbox/{chatId}/architect→lead.jsonl` directly
- **When** the script parses each line as logfmt
- **Then** the parse succeeds with the same shape as before
- **And** only the value of the `type` field changes (canonical preferred, legacy still accepted on read)
