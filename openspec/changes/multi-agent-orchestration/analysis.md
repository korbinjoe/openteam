# OpenTeam Multi-Agent Orchestration: Current Model Analysis

## 1. Architecture Overview

OpenTeam's orchestration follows a **Lead-dispatch subprocess** model with three
coordination mechanisms:

```
User ─→ Lead Agent (Claude Code CLI process)
              │
              ├─→ Expert A (separate CLI process, independent file system access)
              ├─→ Expert B (separate CLI process, parallel execution)
              └─→ Expert C (separate CLI process, parallel execution)
              │
              ├── Mailbox (point-to-point async messages)
              ├── Whiteboard (chat-level shared state, war-room)
              └── SSE Event Stream (terminal state push)
```

### 1.1 Dispatch Layer

**Lead Agent** is the sole orchestrator. When a user sends a message, Lead:

1. Analyzes the request and decomposes into subtasks
2. Matches subtasks to Expert Agents via dispatch decision tree (SOUL.md)
3. Calls `start-expert.sh` which HTTP POSTs to `/api/expert/start`
4. Server spawns a new Claude Code CLI subprocess via `ExpertLifecycle`
5. `ConfigCompiler` assembles the Expert's full prompt (IDENTITY + SOUL + Skills)
6. Expert process starts with injected environment variables and task plan (plan.md)

Key files: `server/ws/ExpertLifecycle.ts`, `ai-assets/skills/expert-dispatcher/`

### 1.2 Communication Layer

Three complementary mechanisms:

| Mechanism | Type | Direction | Transport | Use case |
|-----------|------|-----------|-----------|----------|
| **Mailbox** | Async messages | Point-to-point | JSONL files on disk | Task assignment, completion, input requests |
| **Whiteboard** | Shared state | Broadcast | HTTP API (SQLite-backed) | Goals, decisions, artifacts, progress |
| **SSE Events** | Push notifications | Server → Lead | HTTP SSE stream | Terminal state changes (completed/failed/input_required) |

**AgentMessage protocol** (`shared/agent-message-types.ts`): 15 message types
as a TypeScript discriminated union, covering the full task lifecycle:
`task:assign → task:accepted → task:progress → task:milestone → task:completed/failed`

Plus control signals: `task:input_required`, `task:blocked`, `task:idle`,
`task:rejected`, `task:delegated`, `query/response`, `handoff`, `artifact`.

### 1.3 Execution Layer

Each Expert runs as an independent OS process:
- Full Claude Code CLI environment (file system, terminal, git, tools)
- Skills injected at compile time (SKILL.md frontmatter + scripts)
- Hooks for lifecycle events (PreToolUse, PostToolUse, Stop, Notification)
- Independent context window — no shared LLM state between agents

---

## 2. Strengths of Current Model

### 2.1 True Process-Level Parallelism

Unlike LangGraph (event-loop parallelism) or crewAI (sequential/delegated),
OpenTeam's experts are OS-level processes. Benefits:
- No GIL or event-loop contention
- Each expert has its own Claude API connection and context window
- A crashed expert doesn't affect other running experts
- System scales with available CPU cores and API concurrency

### 2.2 Rich Execution Environment

Each Expert has full tool access (Read, Write, Edit, Bash, etc.), not just
LLM-as-function-call. This means experts can:
- Run test suites, build tools, and dev servers
- Interact with the full file system
- Execute arbitrary shell commands
- Use MCP servers (Playwright, etc.)

This is fundamentally different from LangGraph/crewAI where agents are
essentially LLM inference + tool-call wrappers.

### 2.3 Human-Compatible Workflow

The pulse-mode design (dispatch → leave → return to review) aligns with how
human managers work. The SSE event stream and war-room whiteboard provide
async status awareness without requiring constant polling.

### 2.4 Agent Identity and Growth

SOUL.md, IDENTITY.md, GUARDRAILS.md, satisfaction scoring (MSS) — agents have
persistent identity, behavioral guidance, and performance tracking. This is
unique among the analyzed frameworks.

---

## 3. Weaknesses and Gaps

### 3.1 No Lightweight Execution Path

**Problem**: Every interaction spawns a full CLI subprocess, even for simple tasks.

```
"What's the current git branch?"
  → Lead analyzes → dispatches fullstack-product-engineer
  → CLI process spawn (~5-10s) → context compilation → tool execution → result
  → Total: ~20-30s, ~$0.10-0.30 in tokens
```

A direct answer would take <1s and ~$0.01.

**Observed impact**: 30% of sessions in the performance audit involved tasks
simple enough that a single-agent direct response would have sufficed.

### 3.2 Lead Is Always in the Loop

Every task, regardless of complexity, goes through Lead's analysis and dispatch
cycle. For simple, unambiguous tasks, this adds:
- One full LLM inference for task analysis
- Context compilation overhead for the Lead
- Dispatch latency (HTTP POST + process spawn)
- Result aggregation overhead

No bypass path exists for "just run this single agent directly."

### 3.3 No Structured Multi-Step Workflows

The system can dispatch N agents in parallel, but cannot express:
- Sequential dependencies: "Do A, then feed A's output to B"
- Conditional branching: "If review passes, deploy; else fix"
- Fan-out/fan-in: "Split into 3 chunks, process each, merge results"

Lead must manually orchestrate these patterns turn-by-turn, consuming its
context window and adding latency at each step.

### 3.4 No Checkpoint/Resume for Complex Tasks

If a multi-agent operation fails midway (e.g., 3 of 5 experts complete, then
context limit hits), there's no structured way to resume from the last known
good state. The JSONL transcript exists but is a raw log, not a checkpoint.

### 3.5 Single-Level Hierarchy

Lead dispatches Experts, but Experts cannot dispatch sub-Experts. The `handoff`
message type exists but is peer-to-peer recommendation, not delegation.

For complex tasks (e.g., "redesign the entire workspace UI"), the Lead must
coordinate all subtasks itself, leading to:
- Lead context window exhaustion
- Serialized coordination bottleneck
- No ability for domain-expert-led sub-decomposition

### 3.6 Conversation-Only Interface Requires Full Agent Overhead

Simple conversational interactions ("explain this code", "what does this
function do?") must go through the full Expert lifecycle. There's no
"conversation mode" that provides a quick LLM response without the orchestration
overhead.

---

## 4. Scenario Analysis

### 4.1 Complex Multi-Agent Task (e.g., "Build a new feature with tests")

**Current flow**:
1. Lead decomposes → dispatches fullstack-engineer + code-reviewer
2. Lead monitors SSE stream, handles input_required
3. Engineers complete → Lead verifies → done

**Gaps**:
- No way to express "reviewer starts after engineer finishes"
- Lead must stay in loop to sequence these — wastes Lead's context
- If review finds issues, Lead must manually re-dispatch fixes

**Ideal**: Sequential dependency with conditional loop — engineer → review →
(pass → done | fail → engineer with feedback → review)

### 4.2 Simple Single-Agent Task (e.g., "Fix this CSS bug")

**Current flow**:
1. Lead analyzes → identifies ui-designer as target
2. Dispatches ui-designer with full context compilation
3. ui-designer fixes → completes → Lead verifies

**Gaps**:
- The Lead analysis step is pure overhead — the task clearly maps to one agent
- Could skip Lead entirely and route directly to ui-designer

**Ideal**: Direct agent execution, no orchestration overhead.

### 4.3 Simple Conversation (e.g., "What's the project structure?")

**Current flow**:
1. Lead attempts to answer? Or dispatches an expert?
2. Either way: full CLI process overhead for a read-only question

**Gaps**:
- No fast-path for questions that don't require tool execution
- A conversational response from the LLM directly would be sufficient

**Ideal**: Direct LLM response with project context, no subprocess.

### 4.4 Parallel Independent Tasks (e.g., "Fix login bug AND update docs")

**Current flow**:
1. Lead decomposes → dispatches fullstack-engineer + fullstack-engineer#2
2. Both run in parallel
3. Lead monitors both, handles individually

**Assessment**: This scenario works well. The subprocess model naturally
supports parallel execution. The main gap is the lack of structured fan-in
(no "wait for all, then aggregate" primitive).

---

## 5. Component Inventory for Orchestration Evolution

### 5.1 Reusable As-Is

| Component | Value | Notes |
|-----------|-------|-------|
| `ExpertLifecycle` | Expert spawn + stream management | Core subprocess manager |
| `AgentMessage` protocol | 15 message types, full lifecycle | Well-designed, extensible |
| `MailboxManager` | Point-to-point async messaging | Proven, handles concurrency |
| `WhiteboardManager` | Chat-level shared state | Good for cross-agent context |
| `ConfigCompiler` | Prompt assembly from IDENTITY + SOUL + Skills | Modular, composable |
| `SessionRegistry` | CLI session tracking | Needed for any execution model |
| SSE event stream | Push-based status notification | Efficient, reduces polling |
| Hook system | Lifecycle event handlers | Extensible, proven (satisfaction-score.sh) |

### 5.2 Needs Extension

| Component | Gap | Extension needed |
|-----------|-----|-----------------|
| `ExecutionPlanManager` | Only creates plans, no dependency tracking | Add DAG execution with dependency resolution |
| `ExpertLifecycle` | No support for lightweight execution | Add fast-path for simple tasks |
| Lead dispatch | Always full analysis cycle | Add routing shortcuts for unambiguous tasks |
| Expert-to-Expert communication | Peer handoff only, no hierarchical delegation | Support sub-task dispatch from Experts |

### 5.3 New Components Needed

| Component | Purpose |
|-----------|---------|
| **Execution Mode Router** | Classify incoming requests into conversation / single-agent / multi-agent |
| **Workflow Engine** | Execute DAG-defined task sequences with dependency resolution |
| **Checkpoint Manager** | Save/restore multi-agent task state for resume |
| **Lightweight Responder** | Fast LLM response path without subprocess overhead |

---

## 6. Key Metrics (from Performance Audit)

| Metric | Value | Relevance |
|--------|-------|-----------|
| Sessions analyzed | 216 | Over 11 days |
| Avg turns per session | 4.2 | Most tasks are 3-5 turns |
| Correction rate | 3.5% | Target <2.0% with new optimizations |
| Timeout rate | 30% | Many sessions hit context limits |
| Avg cost per turn | $0.22-0.42 | Varies by agent |
| fullstack-engineer effectiveness | 73% | Highest volume agent |
| ui-designer effectiveness | 67% | High completion but low MSS |
| code-reviewer effectiveness | 61% | Scope mismatch issues |

### Estimated Complexity Distribution (from audit)

| Complexity | % of tasks | Current overhead | Ideal overhead |
|------------|-----------|-----------------|----------------|
| Conversation (Q&A, explain) | ~15% | Full Expert lifecycle | Direct LLM response |
| Simple single-agent | ~35% | Lead + Expert lifecycle | Direct agent execution |
| Multi-agent standard | ~40% | Lead + N Expert lifecycles | Optimized dispatch |
| Complex multi-step | ~10% | Lead + sequential re-dispatch | DAG workflow engine |
